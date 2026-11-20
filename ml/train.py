"""
Klear fraud-model trainer.

Reads ml/dataset.csv (train/val) and ml/golden.csv (held-out truth),
both produced by scripts/gen-dataset.ts using the exact runtime feature
builder. Trains:

  1. LightGBM  -> artifacts/model.onnx     (primary, scored via onnxruntime-node)
  2. Logistic  -> artifacts/weights.json   (zero-dependency fallback)

Writes artifacts/metrics.json with held-out AUC / precision / recall / F1
and a confusion matrix at the 0.5 operating point, then verifies the ONNX
file loads and scores.

Run: /tmp/opencode/mlvenv/bin/python ml/train.py
"""
import json
import time
from pathlib import Path

import numpy as np
import lightgbm as lgb
import onnxruntime as ort
import onnxmltools
import pandas as pd
from onnxmltools.convert.common.data_types import FloatTensorType
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    auc,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
ML = ROOT / "ml"
ARTIFACTS = ROOT / "artifacts"

FEATURES = [
    "amount_rupees", "hour_of_day", "txns_last_1h", "txns_last_24h",
    "is_new_customer", "amount_z", "refund_ratio", "method_risk",
    "attempts_on_order", "success_ratio", "prior_count",
]

def load(path: Path) -> tuple[np.ndarray, np.ndarray]:
    df = pd.read_csv(path)
    X = df[FEATURES].to_numpy(dtype=np.float32)
    y = df["is_fraud"].to_numpy(dtype=np.int64)
    return X, y

def main() -> None:
    ARTIFACTS.mkdir(exist_ok=True)

    X_train_full, y_train_full = load(ML / "dataset.csv")
    X_gold, y_gold = load(ML / "golden.csv")
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_full, y_train_full, test_size=0.15, random_state=21, stratify=y_train_full
    )

    print(f"train rows: {len(X_train)}  val rows: {len(X_val)}  golden rows: {len(X_gold)}")
    print(f"train fraud rate: {y_train.mean():.3f}  golden fraud rate: {y_gold.mean():.3f}")

    # ── 1. LightGBM ────────────────────────────────────────────────────
    pos_weight = float((y_train == 0).sum()) / max(1, (y_train == 1).sum())
    lgbm = lgb.LGBMClassifier(
        n_estimators=400,
        learning_rate=0.05,
        num_leaves=31,
        min_child_samples=40,
        scale_pos_weight=pos_weight,
        subsample=0.9,
        colsample_bytree=0.9,
        random_state=21,
        verbose=-1,
    )
    lgbm.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        eval_metric="auc",
        callbacks=[lgb.early_stopping(30, verbose=False)],
    )

    # ── 2. Logistic fallback (standardised) ─────────────────────────────
    scaler = StandardScaler().fit(X_train)
    logit = LogisticRegression(max_iter=2000, C=1.0)
    logit.fit(scaler.transform(X_train), y_train)

    weights = {
        "features": FEATURES,
        "scalerMean": [float(v) for v in scaler.mean_],
        "scalerScale": [float(v) for v in scaler.scale_],
        "coef": [float(v) for v in logit.coef_[0]],
        "intercept": float(logit.intercept_[0]),
    }
    (ARTIFACTS / "weights.json").write_text(json.dumps(weights, indent=2))
    print("✓ artifacts/weights.json (logistic fallback)")

    # ── Export LightGBM → ONNX (zipmap off → plain probability tensor) ─
    onnx_model = onnxmltools.convert_lightgbm(
        lgbm,
        name="klear-fraud-lgbm",
        initial_types=[("input", FloatTensorType([None, len(FEATURES)]))],
        zipmap=False,
    )
    onnx_path = ARTIFACTS / "model.onnx"
    onnxmltools.save_model(onnx_model, str(onnx_path))
    print("✓ artifacts/model.onnx (lightgbm)")

    # ── Verify ONNX loads and agrees with sklearn ──────────────────────
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    sample = X_gold[:8].astype(np.float32)
    (label_out, prob_out) = session.run(None, {session.get_inputs()[0].name: sample})
    sk = lgbm.predict_proba(sample)[:, 1]
    delta = float(np.max(np.abs(np.asarray(prob_out)[:, 1] - sk)))
    assert delta < 1e-4, f"ONNX/sklearn disagree by {delta}"
    print(f"✓ ONNX verified against sklearn (max Δ {delta:.2e})")

    # ── Held-out metrics on golden ─────────────────────────────────────
    probs = lgbm.predict_proba(X_gold)[:, 1]
    preds = (probs >= 0.5).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_gold, preds, labels=[0, 1]).ravel()
    prec, rec, _ = precision_recall_curve(y_gold, probs)
    metrics = {
        "model": "lightgbm-onnx-v1",
        "features": FEATURES,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "golden_rows": int(len(y_gold)),
        "golden_fraud_rows": int(y_gold.sum()),
        "auc_roc": round(float(roc_auc_score(y_gold, probs)), 4),
        "auc_pr": round(float(auc(rec, prec)), 4),
        "precision_at_0.5": round(float(precision_score(y_gold, preds, zero_division=0)), 4),
        "recall_at_0.5": round(float(recall_score(y_gold, preds, zero_division=0)), 4),
        "f1_at_0.5": round(float(f1_score(y_gold, preds, zero_division=0)), 4),
        "confusion_at_0.5": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }
    (ARTIFACTS / "metrics.json").write_text(json.dumps(metrics, indent=2))

    print()
    print("Held-out golden metrics (LightGBM @ 0.5):")
    print(f"  AUC-ROC     {metrics['auc_roc']}")
    print(f"  AUC-PR      {metrics['auc_pr']}")
    print(f"  precision   {metrics['precision_at_0.5']}")
    print(f"  recall      {metrics['recall_at_0.5']}")
    print(f"  F1          {metrics['f1_at_0.5']}")
    print(f"  confusion   TP {tp}  FP {fp}  FN {fn}  TN {tn}")
    print()
    print("✓ artifacts/metrics.json written — training complete")

if __name__ == "__main__":
    main()
