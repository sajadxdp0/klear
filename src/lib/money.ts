/**
 * Money utilities. All amounts are integer paise.
 */

export function rupees(paise: number): number {
  return paise / 100;
}

/** "₹1,23,456.78" — Indian digit grouping, tabular-friendly. */
export function formatINR(paise: number, opts?: { sign?: boolean }): string {
  const value = paise / 100;
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  if (opts?.sign && paise !== 0) {
    return (paise > 0 ? "+" : "−") + formatted;
  }
  return paise < 0 ? "−" + formatted : formatted;
}

/** Compact rupees for hero metrics: "₹4.2L", "₹18.3K", "₹1.2Cr". */
export function formatINRCompact(paise: number): string {
  const v = paise / 100;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}
