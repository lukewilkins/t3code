export interface ThreadSpecGuardVerdict {
  readonly ok: boolean;
  readonly reason: string;
  /** The offending line, copied from the added text; present whenever `ok` is false. */
  readonly quote: string;
}

const allow: ThreadSpecGuardVerdict = { ok: true, reason: "", quote: "" };

/**
 * The checker's answer as a verdict. Anything that is not a clear refusal with a quote allows the
 * write: malformed output, a refusal without a line to point at, a refusal quoting text the write
 * did not add (invented), or a fragment too short to point at a line.
 */
export function parseThreadSpecGuardVerdict(value: unknown, added: string): ThreadSpecGuardVerdict {
  let parsed = value;
  if (typeof parsed === "string") {
    const start = parsed.indexOf("{");
    const end = parsed.lastIndexOf("}");
    if (start === -1 || end < start) return allow;
    try {
      parsed = JSON.parse(parsed.slice(start, end + 1));
    } catch {
      return allow;
    }
  }
  if (parsed === null || typeof parsed !== "object") return allow;
  const record = parsed as Record<string, unknown>;
  if (record.ok !== false) return allow;
  const quote = typeof record.quote === "string" ? record.quote.trim() : "";
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (quote === "" || reason === "") return allow;
  if (!added.includes(quote)) return allow;
  if (quote.length < 4 && !added.split("\n").some((line) => line.trim() === quote)) return allow;
  return { ok: false, reason, quote };
}
