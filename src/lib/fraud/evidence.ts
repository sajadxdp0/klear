/**
 * Evidence pack builder — turns a fraud flag into an auditable dossier
 * via Cashfree SecureID:
 *
 *   1. PAN-360  → who the PAN says this person is
 *   2. name-match (claimed name vs PAN-registered name) → score
 *   3. bank penny-drop → name at bank + VALID/FRAUD_ACCOUNT status
 *
 * In simulation mode the pack is deterministic and reason-aware:
 * identity-fraud patterns surface identity evidence; behavioral flags
 * (refund abuse) keep clean identity — the evidence explains the band.
 * Every simulated field is labeled. Nothing here blocks money on its own.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { auditLog, fraudFlags, orders } from "@/lib/db/schema";
import {
  bankAccountSync,
  nameMatch,
  panAdvance,
  verificationConfigured,
  type BankVerifyResult,
  type NameMatchResult,
  type PanAdvanceResult,
} from "@/lib/cashfree/verification";

export interface EvidencePack {
  flagId: number;
  orderId: string;
  customerName: string | null;
  band: string;
  builtAt: number;
  mode: "live" | "simulated";
  pan: PanAdvanceResult;
  nameMatch: NameMatchResult;
  bank: BankVerifyResult | null;
  summary: string;
}

const SIM_PAN = "ABCPX1234K"; // obviously-mock PAN for simulation mode
const SIM_ACCOUNT = "50100000000000";
const SIM_IFSC = "HDFC0000001";

export async function buildEvidencePack(flagId: number): Promise<EvidencePack> {
  const db = getDb();
  const flagRows = await db.select().from(fraudFlags).where(eq(fraudFlags.id, flagId)).limit(1);
  if (flagRows.length === 0) throw new Error("flag not found");
  const flag = flagRows[0];

  const orderRows = await db.select().from(orders).where(eq(orders.id, flag.orderId)).limit(1);
  const customerName = orderRows[0]?.customerName ?? null;

  const reasons = JSON.parse(flag.reasons) as { code: string }[];
  const reasonCodes = new Set(reasons.map((r) => r.code));

  // In simulation, let the reason pattern steer the evidence so the story
  // is coherent (identity fraud → identity mismatch; behavior → clean ID).
  const identitySuspect =
    reasonCodes.has("CLUSTER_BURST") ||
    reasonCodes.has("VELOCITY_BURST") ||
    reasonCodes.has("NEW_HIGH_TICKET") ||
    reasonCodes.has("AMOUNT_ANOMALY");

  const mode: "live" | "simulated" = verificationConfigured() ? "live" : "simulated";

  const pan = await panAdvance(SIM_PAN, customerName ?? undefined);

  const nameMatchRes: NameMatchResult = identitySuspect
    ? mode === "live"
      ? await nameMatch(customerName ?? "—", pan.registeredName)
      : { mode: "simulated", score: 0.53, result: "POOR_PARTIAL_MATCH" }
    : mode === "live"
      ? await nameMatch(customerName ?? "—", pan.registeredName)
      : { mode: "simulated", score: 1.0, result: "DIRECT_MATCH" };

  const bank: BankVerifyResult =
    mode === "live"
      ? await bankAccountSync(SIM_ACCOUNT, SIM_IFSC, customerName ?? undefined)
      : identitySuspect
        ? {
            mode: "simulated",
            accountStatus: "INVALID",
            statusCode: "FRAUD_ACCOUNT",
            nameAtBank: "— different beneficiary —",
            nameMatchScore: 0.0,
            nameMatchResult: "NO_MATCH",
          }
        : {
            mode: "simulated",
            accountStatus: "VALID",
            statusCode: "ACCOUNT_IS_VALID",
            nameAtBank: customerName ?? "—",
            nameMatchScore: 1.0,
            nameMatchResult: "DIRECT_MATCH",
          };

  const summary =
    mode === "live"
      ? `PAN registered name: ${pan.registeredName}. Name-match ${nameMatchRes.result} (${nameMatchRes.score.toFixed(2)}). Bank account ${bank.accountStatus}${bank.statusCode === "FRAUD_ACCOUNT" ? " — FRAUD_ACCOUNT status from penny drop" : ""}.`
      : `SIMULATION — PAN registered name: ${pan.registeredName}. Name-match ${nameMatchRes.result} (${nameMatchRes.score.toFixed(2)}). Bank ${bank.statusCode === "FRAUD_ACCOUNT" ? "flagged FRAUD_ACCOUNT" : "valid, name matches"}. With SecureID keys this pack runs against real PAN, name-match and penny-drop APIs.`;

  const pack: EvidencePack = {
    flagId,
    orderId: flag.orderId,
    customerName,
    band: flag.riskBand,
    builtAt: Date.now(),
    mode,
    pan,
    nameMatch: nameMatchRes,
    bank,
    summary,
  };

  // persist onto the flag (evidence column) + audit
  const existingEvidence = flag.evidence ? (JSON.parse(flag.evidence) as Record<string, unknown>) : {};
  db.update(fraudFlags)
    .set({
      evidence: JSON.stringify({ ...existingEvidence, pack }),
    })
    .where(eq(fraudFlags.id, flagId))
    .run();

  db.insert(auditLog)
    .values({
      actor: mode === "live" ? "cashfree-secureid" : "secureid(simulation)",
      action: "EVIDENCE_PACK_BUILT",
      entity: "fraud_flag",
      entityId: String(flagId),
      payload: JSON.stringify({
        orderId: flag.orderId,
        band: flag.riskBand,
        nameMatch: `${nameMatchRes.result} (${nameMatchRes.score.toFixed(2)})`,
        bankStatus: bank.statusCode,
      }),
      createdAt: pack.builtAt,
    })
    .run();

  return pack;
}
