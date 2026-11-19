import { describe, expect, it } from "vite-plus/test";

import { resolveShownThreadSpecRevision } from "./threadSpec.ts";

const revisions = [{ revision: 1 }, { revision: 2 }, { revision: 3 }];

describe("resolveShownThreadSpecRevision", () => {
  it("shows nothing for a spec with no revisions", () => {
    expect(resolveShownThreadSpecRevision([], null)).toEqual({
      shown: null,
      latest: null,
      previous: null,
      isLatest: true,
    });
  });

  it("follows the newest revision when nothing is pinned, including as new ones arrive", () => {
    expect(resolveShownThreadSpecRevision(revisions, null)).toMatchObject({
      shown: 3,
      previous: 2,
      isLatest: true,
    });
    expect(resolveShownThreadSpecRevision([...revisions, { revision: 4 }], null).shown).toBe(4);
  });

  it("holds a pinned earlier revision when a newer one arrives", () => {
    const shown = resolveShownThreadSpecRevision([...revisions, { revision: 4 }], 2);
    expect(shown).toMatchObject({ shown: 2, previous: 1, latest: 4, isLatest: false });
  });

  it("has no previous revision for the first one", () => {
    expect(resolveShownThreadSpecRevision(revisions, 1).previous).toBeNull();
  });

  it("falls back to the newest when the pin is the newest or missing", () => {
    expect(resolveShownThreadSpecRevision(revisions, 3).isLatest).toBe(true);
    expect(resolveShownThreadSpecRevision(revisions, 9)).toMatchObject({
      shown: 3,
      isLatest: true,
    });
  });
});
