import { describe, expect, it } from "vite-plus/test";

import { resolveThreadSpecContent } from "./threadSpecView.logic";

const base = {
  snapshotLoaded: true,
  liveError: null,
  shown: 2,
  previous: 1,
  showChanges: false,
  shownBody: "# Spec\nnew",
  shownError: null,
  previousBody: "# Spec\nold",
  previousError: null,
};

describe("resolveThreadSpecContent", () => {
  it("loads, then fails with a retry for the live stream", () => {
    expect(resolveThreadSpecContent({ ...base, snapshotLoaded: false })).toEqual({
      kind: "loading",
    });
    expect(resolveThreadSpecContent({ ...base, snapshotLoaded: false, liveError: "boom" })).toEqual(
      { kind: "error", message: "boom", retry: "live" },
    );
  });

  it("shows the empty state only once the snapshot has no revisions", () => {
    expect(resolveThreadSpecContent({ ...base, shown: null, previous: null })).toEqual({
      kind: "empty",
    });
  });

  it("waits for an earlier revision body and retries just that fetch", () => {
    expect(resolveThreadSpecContent({ ...base, shownBody: null })).toEqual({ kind: "loading" });
    expect(resolveThreadSpecContent({ ...base, shownBody: null, shownError: "x" })).toEqual({
      kind: "error",
      message: "x",
      retry: "shown",
    });
  });

  it("renders the shown body, ignoring show changes on the first revision", () => {
    expect(resolveThreadSpecContent(base)).toEqual({ kind: "markdown", text: "# Spec\nnew" });
    expect(resolveThreadSpecContent({ ...base, showChanges: true, previous: null })).toEqual({
      kind: "markdown",
      text: "# Spec\nnew",
    });
  });

  it("renders the change as a diff fence, waiting on the previous body", () => {
    const diff = resolveThreadSpecContent({ ...base, showChanges: true });
    expect(diff.kind === "markdown" && diff.text.startsWith("```diff\n--- r1\n+++ r2")).toBe(true);
    expect(resolveThreadSpecContent({ ...base, showChanges: true, previousBody: null })).toEqual({
      kind: "loading",
    });
    expect(
      resolveThreadSpecContent({
        ...base,
        showChanges: true,
        previousBody: null,
        previousError: "nope",
      }),
    ).toEqual({ kind: "error", message: "nope", retry: "previous" });
  });

  it("reports a revision that changed nothing", () => {
    expect(
      resolveThreadSpecContent({ ...base, showChanges: true, previousBody: base.shownBody }),
    ).toEqual({ kind: "unchanged" });
  });
});
