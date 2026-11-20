/**
 * Runs all three engines in order: recon → fraud → triage.
 * Triage runs last so it sees fresh fraud bands.
 */
import { runRecon } from "@/lib/recon/run";
import { runFraudSweep } from "@/lib/fraud/engine";
import { runTriage } from "@/lib/recovery/triage";

export async function runAllEngines() {
  const recon = await runRecon();
  const fraud = await runFraudSweep();
  const triage = await runTriage();
  return {
    recon: {
      klearScore: recon.klearScore,
      orderValuePaise: recon.orderValuePaise,
      clearedValuePaise: recon.clearedValuePaise,
      inFlightValuePaise: recon.inFlightValuePaise,
      atRiskValuePaise: recon.atRiskValuePaise,
      exceptions: recon.exceptions,
    },
    fraud: {
      scored: fraud.scored,
      ok: fraud.ok,
      review: fraud.review,
      block: fraud.block,
      modelVersion: fraud.modelVersion,
    },
    triage: { proposals: triage.created },
  };
}
