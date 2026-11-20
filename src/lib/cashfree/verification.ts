/**
 * Cashfree SecureID (Verification Suite) client.
 *
 *   Base     https://sandbox.cashfree.com/verification (SANDBOX)
 *            https://api.cashfree.com/verification      (PRODUCTION)
 *   Headers  x-client-id, x-client-secret, x-api-version: 2024-12-01
 *   Keys     SEPARATE from PG keys — reusing PG keys returns 401
 *            (which "looks like a code bug" per Cashfree's own docs)
 *
 * Evidence trio for a fraud flag (all sync/inline):
 *   POST /name-match        fuzzy score: DIRECT_MATCH 1.00 … NO_MATCH 0.00
 *   POST /pan/advance       PAN-360: registered name, masked Aadhaar (~45% fill)
 *   POST /bank-account/sync penny drop: name_at_bank + VALID/INVALID and
 *                          the documentable FRAUD_ACCOUNT status code
 *
 * Without verification keys, every call returns a clearly-labeled
 * deterministic simulation so the evidence-pack story works in rehearsal.
 */
import crypto from "node:crypto";

const API_VERSION = "2024-12-01";

export function verificationConfigured(): boolean {
  return Boolean(
    process.env.CASHFREE_VERIFICATION_CLIENT_ID &&
      process.env.CASHFREE_VERIFICATION_CLIENT_SECRET
  );
}

function baseUrl(): string {
  return process.env.CASHFREE_ENV === "PRODUCTION"
    ? "https://api.cashfree.com/verification"
    : "https://sandbox.cashfree.com/verification";
}

function verificationId(): string {
  return `klear-${crypto.randomUUID().slice(0, 18)}`;
}

async function vrsPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "x-client-id": process.env.CASHFREE_VERIFICATION_CLIENT_ID!,
      "x-client-secret": process.env.CASHFREE_VERIFICATION_CLIENT_SECRET!,
      "x-api-version": API_VERSION,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SecureID ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

/* ── Results ───────────────────────────────────────────────────────────── */

export interface NameMatchResult {
  mode: "live" | "simulated";
  score: number; // 0..1
  result: string; // DIRECT_MATCH | GOOD_PARTIAL_MATCH | … | NO_MATCH
}

export interface PanAdvanceResult {
  mode: "live" | "simulated";
  registeredName: string;
  panType?: string;
  maskedAadhaar?: string;
  aadhaarSeeded?: boolean;
}

export interface BankVerifyResult {
  mode: "live" | "simulated";
  accountStatus: string; // VALID | INVALID | …
  statusCode: string; // FRAUD_ACCOUNT | ACCOUNT_IS_VALID | …
  nameAtBank: string;
  nameMatchScore: number;
  nameMatchResult: string;
}

/* ── Calls (live, with deterministic simulation fallback) ──────────────── */

export async function nameMatch(name1: string, name2: string): Promise<NameMatchResult> {
  if (!verificationConfigured()) {
    return simulateNameMatch(name1, name2);
  }
  const data = await vrsPost<Record<string, unknown>>("/name-match", {
    verification_id: verificationId(),
    name_1: name1,
    name_2: name2,
  });
  const score = Number(data.match_score ?? data.name_match_score ?? 0);
  return {
    mode: "live",
    score: Number.isFinite(score) ? score : 0,
    result: String(data.match_result ?? data.name_match_result ?? "UNKNOWN"),
  };
}

export async function panAdvance(pan: string, name?: string): Promise<PanAdvanceResult> {
  if (!verificationConfigured()) {
    return {
      mode: "simulated",
      registeredName: "— (simulation)",
      panType: "INDIVIDUAL",
      maskedAadhaar: "XXXX XXXX 0000",
    };
  }
  const data = await vrsPost<Record<string, unknown>>("/pan/advance", {
    pan,
    verification_id: verificationId(),
    ...(name ? { name } : {}),
  });
  return {
    mode: "live",
    registeredName: String(data.registered_name ?? data.name ?? "UNKNOWN"),
    panType: data.pan_type ? String(data.pan_type) : undefined,
    maskedAadhaar: data.masked_aadhaar ? String(data.masked_aadhaar) : undefined,
    aadhaarSeeded:
      data.aadhaar_seeding_status === "true" || data.aadhaar_seeded === true,
  };
}

export async function bankAccountSync(
  bankAccount: string,
  ifsc: string,
  name?: string
): Promise<BankVerifyResult> {
  if (!verificationConfigured()) {
    return simulateBankVerify(bankAccount, name);
  }
  const data = await vrsPost<Record<string, unknown>>("/bank-account/sync", {
    bank_account: bankAccount,
    ifsc,
    ...(name ? { name } : {}),
  });
  const score = Number(data.name_match_score ?? 0);
  return {
    mode: "live",
    accountStatus: String(data.account_status ?? "UNKNOWN"),
    statusCode: String(data.account_status_code ?? ""),
    nameAtBank: String(data.name_at_bank ?? "—"),
    nameMatchScore: Number.isFinite(score) ? score / 100 : 0, // API returns "85.00"
    nameMatchResult: String(data.name_match_result ?? "UNKNOWN"),
  };
}

/* ── Simulation (deterministic, reason-aware, clearly labeled) ─────────── */

const MATCH_TABLE: Record<string, { score: number; result: string }> = {
  DIRECT_MATCH: { score: 1.0, result: "DIRECT_MATCH" },
  GOOD_PARTIAL_MATCH: { score: 0.93, result: "GOOD_PARTIAL_MATCH" },
  MODERATE_PARTIAL_MATCH: { score: 0.77, result: "MODERATE_PARTIAL_MATCH" },
  POOR_PARTIAL_MATCH: { score: 0.53, result: "POOR_PARTIAL_MATCH" },
  NO_MATCH: { score: 0.0, result: "NO_MATCH" },
};

/**
 * Deterministic simulation driven by the flag's reason codes so the demo
 * story stays coherent: identity-fraud patterns get identity evidence;
 * behavioral flags (refund abuse) keep clean identity — that's the point.
 */
function simulateNameMatch(
  claimed: string,
  _registered: string
): NameMatchResult {
  return { mode: "simulated", ...MATCH_TABLE.MODERATE_PARTIAL_MATCH };
}

function simulateBankVerify(account: string, name?: string): BankVerifyResult {
  return {
    mode: "simulated",
    accountStatus: "VALID",
    statusCode: "ACCOUNT_IS_VALID",
    nameAtBank: name ?? "—",
    nameMatchScore: 0.77,
    nameMatchResult: "MODERATE_PARTIAL_MATCH",
  };
}
