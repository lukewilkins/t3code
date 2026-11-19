import { describe, expect, it } from "vite-plus/test";

import { parseThreadSpecGuardVerdict } from "./threadSpecGuard.ts";

const added = "Round 2: fixed the review notes\nShip the export page";

describe("parseThreadSpecGuardVerdict", () => {
  it("refuses only with a reason and a quote the write added", () => {
    expect(
      parseThreadSpecGuardVerdict(
        { ok: false, reason: "That is a change log.", quote: "Round 2: fixed the review notes" },
        added,
      ),
    ).toEqual({
      ok: false,
      reason: "That is a change log.",
      quote: "Round 2: fixed the review notes",
    });
  });

  it("reads a JSON object out of surrounding model prose", () => {
    const verdict = parseThreadSpecGuardVerdict(
      'Here you go: {"ok": false, "reason": "History.", "quote": "Round 2"} thanks',
      added,
    );
    expect(verdict.ok).toBe(false);
  });

  it.each([
    ["malformed output", "not json at all"],
    ["a broken object", "{ok: false"],
    ["a non-object", 42],
    ["a refusal without a quote", { ok: false, reason: "History.", quote: "" }],
    ["a refusal without a reason", { ok: false, reason: "", quote: "Round 2" }],
    ["an invented quote", { ok: false, reason: "History.", quote: "Previously we did x" }],
    ["a short fragment inside a line", { ok: false, reason: "History.", quote: "the" }],
    ["an explicit allow", { ok: true, reason: "", quote: "" }],
  ])("allows the write on %s", (_name, value) => {
    expect(parseThreadSpecGuardVerdict(value, added).ok).toBe(true);
  });

  it("accepts a short quote that is a whole added line", () => {
    expect(
      parseThreadSpecGuardVerdict({ ok: false, reason: "A bare marker.", quote: "- -" }, "- -\nok")
        .ok,
    ).toBe(false);
  });
});
