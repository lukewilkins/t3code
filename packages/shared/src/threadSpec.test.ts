import { describe, expect, it } from "vite-plus/test";

import {
  applyThreadSpecEdits,
  fencedDiffMarkdown,
  numberSpecLines,
  ThreadSpecEditError,
  threadSpecChangedSections,
  threadSpecGoal,
  threadSpecUnifiedDiff,
} from "./threadSpec.ts";

const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ThreadSpecEditError);
    return (error as ThreadSpecEditError).message;
  }
  throw new Error("expected the edit to be refused");
};

describe("applyThreadSpecEdits", () => {
  const body = ["# Goal", "one", "two", "three"].join("\n");

  it("inserts after the last line with start_line one past the end", () => {
    expect(applyThreadSpecEdits(body, [{ start_line: 5, end_line: 4, new_text: "four" }], 1)).toBe(
      ["# Goal", "one", "two", "three", "four"].join("\n"),
    );
  });

  it("inserts before a line and replaces a range, by the base revision's numbers", () => {
    expect(
      applyThreadSpecEdits(
        body,
        [
          { start_line: 2, end_line: 1, new_text: "zero" },
          { start_line: 3, end_line: 4, new_text: "two and three" },
        ],
        1,
      ),
    ).toBe(["# Goal", "zero", "one", "two and three"].join("\n"));
  });

  it("refuses line edits that overlap an earlier edit in the batch", () => {
    const message = refusal(() =>
      applyThreadSpecEdits(
        body,
        [
          { start_line: 2, end_line: 3, new_text: "a" },
          { start_line: 3, end_line: 4, new_text: "b" },
        ],
        1,
      ),
    );
    expect(message).toContain("overlap an earlier edit");
  });

  it("refuses lines past the end and shows what is there when expected differs", () => {
    expect(
      refusal(() => applyThreadSpecEdits(body, [{ start_line: 9, end_line: 9, new_text: "x" }], 3)),
    ).toContain("revision 3, which has 4 lines");
    const mismatch = refusal(() =>
      applyThreadSpecEdits(
        body,
        [{ start_line: 2, end_line: 3, new_text: "x", expected: "one\nTWO" }],
        1,
      ),
    );
    expect(mismatch).toContain("don't match expected");
    expect(mismatch).toContain("one\ntwo");
  });

  it("accepts expected with a trailing newline", () => {
    expect(
      applyThreadSpecEdits(
        body,
        [{ start_line: 2, end_line: 2, new_text: "uno", expected: "one\n" }],
        1,
      ),
    ).toBe(["# Goal", "uno", "two", "three"].join("\n"));
  });

  it("refuses a string edit whose text is missing, empty or unchanged", () => {
    expect(
      refusal(() => applyThreadSpecEdits(body, [{ old_string: "nope", new_string: "x" }], 1)),
    ).toContain("wasn't found");
    expect(
      refusal(() => applyThreadSpecEdits(body, [{ old_string: "", new_string: "x" }], 1)),
    ).toContain("old_string is empty");
    expect(
      refusal(() => applyThreadSpecEdits(body, [{ old_string: "one", new_string: "one" }], 1)),
    ).toContain("are the same");
  });

  it("refuses an ambiguous string edit unless replace_all is set", () => {
    const repeated = "a\nb\na";
    expect(
      refusal(() => applyThreadSpecEdits(repeated, [{ old_string: "a", new_string: "c" }], 1)),
    ).toContain("appears 2 times");
    expect(
      applyThreadSpecEdits(repeated, [{ old_string: "a", new_string: "c", replace_all: true }], 1),
    ).toBe("c\nb\nc");
  });

  it("names the failing edit and returns nothing when a later edit in the batch fails", () => {
    const message = refusal(() =>
      applyThreadSpecEdits(
        body,
        [
          { old_string: "one", new_string: "uno" },
          { old_string: "missing", new_string: "x" },
        ],
        1,
      ),
    );
    expect(message).toContain("Edit 2");
  });

  it("refuses an empty edit list", () => {
    expect(refusal(() => applyThreadSpecEdits(body, [], 1))).toContain("non-empty");
  });

  it("keeps line numbers of untouched lines valid after a string edit", () => {
    expect(
      applyThreadSpecEdits(
        body,
        [
          { old_string: "one", new_string: "uno\nuno bis" },
          { start_line: 4, end_line: 4, new_text: "tres" },
        ],
        1,
      ),
    ).toBe(["# Goal", "uno", "uno bis", "two", "tres"].join("\n"));
  });
});

describe("threadSpecChangedSections", () => {
  it("counts lines as a multiset, so a duplicated line is added but a moved one is not", () => {
    const before = "# A\nx\ny";
    expect(threadSpecChangedSections(before, "# A\ny\nx").added).toBe("");
    expect(threadSpecChangedSections(before, "# A\nx\nx\ny").added).toBe("x");
  });

  it("ignores blank lines and returns only the sections that hold added lines", () => {
    const before = "# Goal\ng\n\n# Plan\np1\n\n# Status\ns";
    const after = "# Goal\ng\n\n\n# Plan\np1\np2\n\n# Status\ns";
    expect(threadSpecChangedSections(before, after)).toEqual({
      added: "p2",
      sections: "# Plan\np1\np2\n",
    });
  });

  it("reports an added heading with its own section", () => {
    expect(threadSpecChangedSections("# A\nx", "# A\nx\n# B\ny")).toEqual({
      added: "# B\ny",
      sections: "# B\ny",
    });
  });
});

describe("threadSpecUnifiedDiff", () => {
  it("is empty for equal text", () => {
    expect(threadSpecUnifiedDiff("a\nb", "a\nb", "r1", "r2")).toBe("");
  });

  it("prints git-style hunk headers with deletions before additions", () => {
    expect(threadSpecUnifiedDiff("a\nb\nc", "a\nB\nc", "r1", "r2")).toBe(
      ["--- r1", "+++ r2", "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n"),
    );
  });

  it("starts an all-added diff at line 0 on the empty side", () => {
    expect(threadSpecUnifiedDiff("", "a\nb", "r0", "r1")).toBe(
      ["--- r0", "+++ r1", "@@ -0,0 +1,2 @@", "+a", "+b"].join("\n"),
    );
    expect(threadSpecUnifiedDiff("a\nb", "", "r1", "r2")).toBe(
      ["--- r1", "+++ r2", "@@ -1,2 +0,0 @@", "-a", "-b"].join("\n"),
    );
  });

  it("splits distant changes into separate hunks", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
    const changed = lines.map((line, i) => (i === 0 || i === 19 ? `${line}!` : line));
    const hunks = threadSpecUnifiedDiff(lines.join("\n"), changed.join("\n"), "a", "b")
      .split("\n")
      .filter((line) => line.startsWith("@@"));
    expect(hunks).toEqual(["@@ -1,4 +1,4 @@", "@@ -17,4 +17,4 @@"]);
  });
});

describe("threadSpecGoal and numberSpecLines", () => {
  it("returns the text under the Goal heading, else the opening", () => {
    expect(threadSpecGoal("# Title\n\n## Goal\nship it\n\n## Plan\nstep")).toBe("ship it");
    expect(threadSpecGoal("no headings here")).toBe("no headings here");
  });

  it("numbers lines like cat -n, widening past 9999 lines", () => {
    expect(numberSpecLines("a\nb")).toBe("   1\ta\n   2\tb");
    expect(
      numberSpecLines(Array.from({ length: 10_000 }, () => "x").join("\n")).split("\n")[0],
    ).toBe("    1\tx");
  });
});

describe("fencedDiffMarkdown", () => {
  it("wraps a diff in a diff fence without a blank trailing line", () => {
    expect(fencedDiffMarkdown("-a\n+b\n")).toBe("```diff\n-a\n+b\n```");
  });

  it("widens the fence past backtick runs in the spec text", () => {
    const fenced = fencedDiffMarkdown("+```ts\n+x\n+```");
    expect(fenced.startsWith("````diff\n")).toBe(true);
    expect(fenced.endsWith("\n````")).toBe(true);
  });
});
