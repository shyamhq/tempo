// Truncated, never-throwing stringification for audit rows. The audit log holds
// provenance (who called what, when, how long), not payloads — so request and
// response summaries are capped. Total-function: circular refs, BigInt, and
// undefined all resolve to a string rather than throwing on the audit path.
export function summarize(value: unknown, max = 500): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    s = String(value);
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
