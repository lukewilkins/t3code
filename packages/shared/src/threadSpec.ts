import type { ThreadSpecEdit, ThreadSpecLineEdit } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** An edit that can't apply; nothing in its batch was applied. */
export class ThreadSpecEditError extends Schema.TaggedError<ThreadSpecEditError>()(
  "ThreadSpecEditError",
  { message: Schema.String },
) {}

const refuse = (message: string) => new ThreadSpecEditError({ message });

/** The spec's lines numbered like `cat -n`: right-aligned number, tab, text. */
export function numberSpecLines(body: string): string {
  const lines = body.split("\n");
  const width = Math.max(4, String(lines.length).length);
  return lines.map((line, index) => `${String(index + 1).padStart(width)}\t${line}`).join("\n");
}

/** One trailing newline ends the last line rather than adding an empty one. */
function textLines(text: string): string[] {
  if (text === "") return [];
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

interface WorkLine {
  readonly text: string;
  /** Its line number in the base revision; null once an earlier edit in the batch wrote it. */
  readonly origin: number | null;
}

const isLineEdit = (edit: ThreadSpecEdit): edit is ThreadSpecLineEdit => "start_line" in edit;

/**
 * Applies `edits` in order to `body` (revision `revision`), all or nothing. Line edits name lines of
 * the base revision, so an earlier edit in the batch never shifts them; touching lines an earlier
 * edit already rewrote is refused.
 */
export function applyThreadSpecEdits(
  body: string,
  edits: ReadonlyArray<ThreadSpecEdit>,
  revision: number,
): string {
  if (edits.length === 0) throw refuse("edits must be a non-empty list");
  const at = `the spec is at revision ${revision}`;
  let lines: WorkLine[] = body.split("\n").map((text, index) => ({ text, origin: index + 1 }));
  const baseCount = lines.length;
  const indexOfOrigin = (origin: number) => lines.findIndex((line) => line.origin === origin);

  edits.forEach((edit, n) => {
    const which = `Edit ${n + 1}`;
    if (isLineEdit(edit)) {
      const { start_line: start, end_line: end, new_text: newText, expected } = edit;
      if (end < start - 1 || end > baseCount || start > baseCount + 1) {
        throw refuse(
          `${which}: lines ${start}-${end} aren't in revision ${revision}, which has ${baseCount} lines (${at}; t3_spec_read shows them)`,
        );
      }
      let from: number;
      let count: number;
      if (end === start - 1) {
        const anchor = start <= baseCount ? indexOfOrigin(start) : indexOfOrigin(baseCount) + 1;
        if (anchor < 0 || (start > baseCount && anchor === 0)) {
          throw refuse(
            `${which}: line ${start} was already changed by an earlier edit in this call (${at})`,
          );
        }
        from = anchor;
        count = 0;
      } else {
        from = indexOfOrigin(start);
        const to = indexOfOrigin(end);
        if (from < 0 || to < 0 || to - from !== end - start) {
          throw refuse(
            `${which}: lines ${start}-${end} overlap an earlier edit in this call; give each edit its own lines (${at})`,
          );
        }
        count = end - start + 1;
        if (expected !== undefined) {
          const actual = lines
            .slice(from, from + count)
            .map((line) => line.text)
            .join("\n");
          const wanted = expected.endsWith("\n") ? expected.slice(0, -1) : expected;
          if (actual !== wanted) {
            throw refuse(
              `${which}: lines ${start}-${end} don't match expected (${at}). They read:\n${actual}`,
            );
          }
        }
      }
      lines.splice(from, count, ...textLines(newText).map((text) => ({ text, origin: null })));
      return;
    }

    const { old_string: oldString, new_string: newString, replace_all: replaceAll } = edit;
    if (oldString === "") {
      throw refuse(`${which}: old_string is empty; use a line edit to insert text`);
    }
    if (oldString === newString) {
      throw refuse(`${which}: old_string and new_string are the same`);
    }
    const text = lines.map((line) => line.text).join("\n");
    const hits: number[] = [];
    for (
      let i = text.indexOf(oldString);
      i >= 0;
      i = text.indexOf(oldString, i + oldString.length)
    ) {
      hits.push(i);
    }
    const first = hits[0];
    const last = hits.at(-1);
    if (first === undefined || last === undefined) {
      throw refuse(`${which}: old_string wasn't found (${at}; t3_spec_read shows it)`);
    }
    if (hits.length > 1 && replaceAll !== true) {
      throw refuse(
        `${which}: old_string appears ${hits.length} times (${at}). Add surrounding text to make it unique, or pass replace_all`,
      );
    }
    // The lines the matches span lose their base line numbers; the others keep them.
    const lineOf = (offset: number) => text.slice(0, offset).split("\n").length - 1;
    const startLine = lineOf(first);
    const endLine = lineOf(last + oldString.length);
    const spanStart = lines
      .slice(0, startLine)
      .reduce((sum, line) => sum + line.text.length + 1, 0);
    const span = lines
      .slice(startLine, endLine + 1)
      .map((line) => line.text)
      .join("\n");
    const offset = first - spanStart;
    const replaced =
      replaceAll === true
        ? span.split(oldString).join(newString)
        : span.slice(0, offset) + newString + span.slice(offset + oldString.length);
    lines = [
      ...lines.slice(0, startLine),
      ...replaced.split("\n").map((lineText) => ({ text: lineText, origin: null })),
      ...lines.slice(endLine + 1),
    ];
  });
  return lines.map((line) => line.text).join("\n");
}

type DiffOp = { readonly kind: "ctx" | "del" | "add"; readonly text: string };

function diffOps(a: ReadonlyArray<string>, b: ReadonlyArray<string>): DiffOp[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const n = x.length;
  const m = y.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  const at = (i: number, j: number) => lcs[i]?.[j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i];
    if (row === undefined) continue;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = x[i] === y[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const mid: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      mid.push({ kind: "ctx", text: x[i] ?? "" });
      i++;
      j++;
    } else if (j < m && (i >= n || at(i, j + 1) >= at(i + 1, j))) {
      mid.push({ kind: "add", text: y[j++] ?? "" });
    } else {
      mid.push({ kind: "del", text: x[i++] ?? "" });
    }
  }
  // Deletions before additions within each changed run, as git prints them.
  const ordered: DiffOp[] = [];
  for (let k = 0; k < mid.length;) {
    const op = mid[k];
    if (op?.kind === "ctx") {
      ordered.push(op);
      k++;
      continue;
    }
    const run: DiffOp[] = [];
    while (k < mid.length && mid[k]?.kind !== "ctx") {
      const changed = mid[k++];
      if (changed) run.push(changed);
    }
    ordered.push(...run.filter((o) => o.kind === "del"), ...run.filter((o) => o.kind === "add"));
  }
  return [
    ...a.slice(0, head).map((text) => ({ kind: "ctx" as const, text })),
    ...ordered,
    ...a.slice(a.length - tail).map((text) => ({ kind: "ctx" as const, text })),
  ];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_FENCE = /^\s*\$\$\s*$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
const QUOTE = /^ {0,3}>/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const isBlank = (line: string) => line.trim() === "";
const isIndented = (line: string) => /^(?: {2,}|\t)/.test(line);
const startsBlock = (line: string) =>
  FENCE.test(line) ||
  MATH_FENCE.test(line) ||
  HEADING.test(line) ||
  LIST_ITEM.test(line) ||
  QUOTE.test(line) ||
  RULE.test(line);

interface SpecBlock {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Top-level markdown blocks as line ranges: a fence, heading, rule, quote, paragraph or table, or
 * one list item with everything nested under it. Each renders on its own like it does in place.
 */
function specBlocks(lines: ReadonlyArray<string>): SpecBlock[] {
  const blocks: SpecBlock[] = [];
  const at = (index: number) => lines[index] ?? "";
  let i = 0;
  while (i < lines.length) {
    const line = at(i);
    if (isBlank(line)) {
      i++;
      continue;
    }
    const start = i++;
    const fence = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      const close = new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}\\s*$`);
      while (i < lines.length && !close.test(at(i))) i++;
      i = Math.min(i + 1, lines.length);
    } else if (MATH_FENCE.test(line)) {
      while (i < lines.length && !MATH_FENCE.test(at(i))) i++;
      i = Math.min(i + 1, lines.length);
    } else if (HEADING.test(line) || RULE.test(line)) {
      // One line.
    } else if (QUOTE.test(line)) {
      while (i < lines.length && QUOTE.test(at(i))) i++;
    } else if (LIST_ITEM.test(line)) {
      while (i < lines.length) {
        const next = at(i);
        if (isBlank(next)) {
          let j = i;
          while (j < lines.length && isBlank(at(j))) j++;
          if (j < lines.length && isIndented(at(j))) i = j;
          else break;
        } else if (isIndented(next) || !startsBlock(next)) i++;
        else break;
      }
    } else {
      while (i < lines.length && !isBlank(at(i)) && !startsBlock(at(i))) i++;
    }
    let end = i;
    while (end > start && isBlank(at(end - 1))) end--;
    blocks.push({ start, end, text: lines.slice(start, end).join("\n") });
  }
  return blocks;
}

export interface ThreadSpecDiffChunk {
  readonly kind: "same" | "added" | "removed";
  /** 1-based first line in its revision: `before` for removed chunks, `after` for the rest. */
  readonly line: number;
  /** Source markdown of consecutive blocks, spacing kept, so lists stay tight and numbered. */
  readonly markdown: string;
}

const CHUNK_KIND = { ctx: "same", add: "added", del: "removed" } as const;

/**
 * `before` to `after` as rendered-markdown chunks, diffed by top-level block so a changed block shows
 * as its old version removed and its new one added. Empty when no block changed.
 */
export function threadSpecBlockDiff(before: string, after: string): ThreadSpecDiffChunk[] {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const a = specBlocks(beforeLines);
  const b = specBlocks(afterLines);
  const ops = diffOps(
    a.map((block) => block.text),
    b.map((block) => block.text),
  );
  if (ops.every((op) => op.kind === "ctx")) return [];
  const runs: Array<{ kind: DiffOp["kind"]; blocks: SpecBlock[] }> = [];
  let inA = 0;
  let inB = 0;
  for (const op of ops) {
    const block = op.kind === "del" ? a[inA] : b[inB];
    if (op.kind !== "add") inA++;
    if (op.kind !== "del") inB++;
    if (block === undefined) continue;
    const last = runs.at(-1);
    if (last?.kind === op.kind) last.blocks.push(block);
    else runs.push({ kind: op.kind, blocks: [block] });
  }
  return runs.map(({ kind, blocks }) => {
    const start = blocks[0]?.start ?? 0;
    return {
      kind: CHUNK_KIND[kind],
      line: start + 1,
      markdown: (kind === "del" ? beforeLines : afterLines)
        .slice(start, blocks.at(-1)?.end ?? 0)
        .join("\n"),
    };
  });
}

const isHeading = (line: string) => /^#{1,6}\s/.test(line);

/**
 * What a write added: the lines of `after` that `before` lacks (as a multiset, so a moved or
 * untouched line is never "added"; blank lines don't count), and the sections that hold them.
 */
export function threadSpecChangedSections(
  before: string,
  after: string,
): { readonly sections: string; readonly added: string } {
  const seen = new Map<string, number>();
  for (const line of before.split("\n")) seen.set(line, (seen.get(line) ?? 0) + 1);
  const lines = after.split("\n");
  const added: string[] = [];
  const ranges = new Map<number, number>();
  lines.forEach((line, index) => {
    const remaining = seen.get(line) ?? 0;
    if (remaining > 0) {
      seen.set(line, remaining - 1);
      return;
    }
    if (!line.trim()) return;
    added.push(line);
    let from = index;
    while (from > 0 && !isHeading(lines[from] ?? "")) from--;
    if (ranges.has(from)) return;
    let to = index + 1;
    while (to < lines.length && !isHeading(lines[to] ?? "")) to++;
    ranges.set(from, to);
  });
  const sections = [...ranges].map(([from, to]) => lines.slice(from, to).join("\n")).join("\n\n");
  return { sections, added: added.join("\n") };
}

/** The text under the spec's Goal heading, else its opening, so a reader knows the subject. */
export function threadSpecGoal(spec: string): string {
  const lines = spec.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s+goal\b/i.test(line));
  if (start === -1) return spec.slice(0, 2000);
  let end = start + 1;
  while (end < lines.length && !isHeading(lines[end] ?? "")) end++;
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}
