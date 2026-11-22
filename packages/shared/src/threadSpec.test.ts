import { describe, expect, it } from "vite-plus/test";

import {
  applyThreadSpecEdits,
  numberSpecLines,
  ThreadSpecEditError,
  threadSpecChangedSections,
  threadSpecGoal,
  threadSpecBlockDiff,
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

describe("threadSpecBlockDiff", () => {
  it("is empty when no block changed, even if blank lines did", () => {
    expect(threadSpecBlockDiff("# A\n\nx", "# A\n\nx")).toEqual([]);
    expect(threadSpecBlockDiff("# A\nx", "# A\n\n\nx")).toEqual([]);
  });

  it("shows a changed block as removed then added between unchanged runs", () => {
    expect(threadSpecBlockDiff("# A\n\nold\n\n# B", "# A\n\nnew\n\n# B")).toEqual([
      { kind: "same", line: 1, markdown: "# A" },
      { kind: "removed", line: 3, markdown: "old" },
      { kind: "added", line: 3, markdown: "new" },
      { kind: "same", line: 5, markdown: "# B" },
    ]);
  });

  it("keeps a tight list tight and its numbering when one item changes", () => {
    expect(threadSpecBlockDiff("1. a\n2. b\n3. c", "1. a\n2. B\n3. c")).toEqual([
      { kind: "same", line: 1, markdown: "1. a" },
      { kind: "removed", line: 2, markdown: "2. b" },
      { kind: "added", line: 2, markdown: "2. B" },
      { kind: "same", line: 3, markdown: "3. c" },
    ]);
  });

  it("merges neighbouring unchanged blocks into one chunk with their spacing", () => {
    const chunks = threadSpecBlockDiff("- a\n- b\n\npara", "- a\n- b\n\npara\n\nnew");
    expect(chunks).toEqual([
      { kind: "same", line: 1, markdown: "- a\n- b\n\npara" },
      { kind: "added", line: 6, markdown: "new" },
    ]);
  });

  it("carries nested lines and lazy continuations with their list item", () => {
    const before = "- parent\n  - child\ncontinued\n- next";
    const after = "- parent\n  - child!\ncontinued\n- next";
    expect(threadSpecBlockDiff(before, after)).toEqual([
      { kind: "removed", line: 1, markdown: "- parent\n  - child\ncontinued" },
      { kind: "added", line: 1, markdown: "- parent\n  - child!\ncontinued" },
      { kind: "same", line: 4, markdown: "- next" },
    ]);
  });

  it("keeps a fence whole across blank lines and markdown-looking lines inside it", () => {
    const fence = (body: string) => `\`\`\`\`md\n# not a heading\n\n\`\`\`\n${body}\n\`\`\`\``;
    expect(threadSpecBlockDiff(`${fence("x")}\n\nafter`, `${fence("y")}\n\nafter`)).toEqual([
      { kind: "removed", line: 1, markdown: fence("x") },
      { kind: "added", line: 1, markdown: fence("y") },
      { kind: "same", line: 8, markdown: "after" },
    ]);
  });

  it("ends a paragraph at a heading with no blank line between", () => {
    expect(threadSpecBlockDiff("text\n## H", "text\n## H2")).toEqual([
      { kind: "same", line: 1, markdown: "text" },
      { kind: "removed", line: 2, markdown: "## H" },
      { kind: "added", line: 2, markdown: "## H2" },
    ]);
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
