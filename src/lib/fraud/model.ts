/**
 * Model wrapper with a strictly ordered fallback chain:
 *   1. LightGBM → ONNX   (artifacts/model.onnx, scored via onnxruntime-node)
 *   2. Logistic → JSON  (artifacts/weights.json, pure-TS sigmoid)
 *   3. Heuristic        (rule contributions only — zero-dependency floor)
 *
 * The engine records which model produced every flag (modelVersion), so
 * nothing is ever silently misattributed.
 */
import fs from "node:fs";
import path from "node:path";
import { FEATURE_NAMES, type FeatureRow } from "./features";

export interface ModelResult {
  score: number; // calibrated-ish 0..1
  version: string;
  kind: "lgbm-onnx" | "logistic-json" | "heuristic";
}

const ARTIFACTS_DIR = path.join(process.cwd(), "artifacts");

/* ── 2. Logistic JSON ────────────────────────────────────────────────── */

interface LogisticWeights {
  features: string[];
  scalerMean: number[];
  scalerScale: number[];
  coef: number[];
  intercept: number;
}

function loadLogistic(): LogisticWeights | null {
  const p = path.join(ARTIFACTS_DIR, "weights.json");
  if (!fs.existsSync(p)) return null;
  try {
    const w = JSON.parse(fs.readFileSync(p, "utf8")) as LogisticWeights;
    if (
      !Array.isArray(w.coef) ||
      w.coef.length !== FEATURE_NAMES.length ||
      w.features.join() !== FEATURE_NAMES.join()
    ) {
      return null;
    }
    return w;
  } catch {
    return null;
  }
}

function logisticScore(w: LogisticWeights, row: FeatureRow): number {
  let z = w.intercept;
  for (let i = 0; i < w.coef.length; i++) {
    const x = (row[i] - w.scalerMean[i]) / w.scalerScale[i];
    z += w.coef[i] * x;
  }
  return 1 / (1 + Math.exp(-z));
}

/* ── 1. ONNX (LightGBM) ──────────────────────────────────────────────── */

interface OrtSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>;
  inputNames: string[];
  outputNames: string[];
}
interface OrtModule {
  InferenceSession: {
    create(path: string): Promise<OrtSession>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
}

let onnxSession: OrtSession | null | undefined; // undefined = not attempted

async function getOnnxSession(): Promise<OrtSession | null> {
  if (onnxSession !== undefined) return onnxSession;
  onnxSession = null;
  const p = path.join(ARTIFACTS_DIR, "model.onnx");
  if (!fs.existsSync(p)) return null;
  try {
    const ort = (await import("onnxruntime-node")) as unknown as OrtModule;
    onnxSession = await ort.InferenceSession.create(p);
  } catch {
    onnxSession = null;
  }
  return onnxSession;
}

async function onnxScore(session: OrtSession, row: FeatureRow): Promise<number | null> {
  const ort = (await import("onnxruntime-node")) as unknown as OrtModule;
  const tensor = new ort.Tensor(
    "float32",
    Float32Array.from(row),
    [1, row.length]
  );
  const feeds: Record<string, unknown> = {};
  feeds[session.inputNames[0]] = tensor;
  const outputs = await session.run(feeds);

  // find the probabilities output: a float tensor [1,2] or [1]
  for (const key of session.outputNames) {
    const val = outputs[key] as unknown as {
      data: Float32Array | number[];
      dims: number[];
    } | undefined;
    if (!val || !val.data) continue;
    const dims = val.dims ?? [];
    if (dims.length === 2 && dims[1] === 2) {
      return Number(val.data[1]); // probability of the fraud class
    }
  }
  return null;
}

/* ── Public API ──────────────────────────────────────────────────────── */

export async function modelScore(row: FeatureRow): Promise<ModelResult> {
  const session = await getOnnxSession();
  if (session) {
    const score = await onnxScore(session, row);
    if (score !== null && Number.isFinite(score)) {
      return { score, version: "lgbm-onnx-v1", kind: "lgbm-onnx" };
    }
  }

  const logistic = loadLogistic();
  if (logistic) {
    return {
      score: logisticScore(logistic, row),
      version: "logistic-json-v1",
      kind: "logistic-json",
    };
  }

  // heuristic floor — score stays 0; rules carry everything
  return { score: 0, version: "heuristic-v1", kind: "heuristic" };
}

export function modelArtifactStatus(): {
  onnx: boolean;
  weights: boolean;
} {
  return {
    onnx: fs.existsSync(path.join(ARTIFACTS_DIR, "model.onnx")),
    weights: fs.existsSync(path.join(ARTIFACTS_DIR, "weights.json")),
  };
}
