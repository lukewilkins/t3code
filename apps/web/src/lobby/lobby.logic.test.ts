import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../test-fixtures";
import { adjacentLobbyCardIndex, clampLobbyCardWidth, selectLobbyThreads } from "./lobby.logic";

const environmentId = EnvironmentId.make("environment-test");
const NOW = "2026-03-09T12:00:00.000Z";

const thread = (id: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) =>
  makeThreadFixture({ id: ThreadId.make(id), environmentId, ...overrides });

const ids = (threads: ReadonlyArray<{ id: string }>) => threads.map((entry) => entry.id);

describe("selectLobbyThreads", () => {
  it("keeps only open, listed threads and leaves out parked ones", () => {
    const threads = [
      thread("open"),
      thread("settled", { settledOverride: "settled", settledAt: NOW }),
      thread("archived", { archivedAt: NOW }),
      thread("deleted", { deletedAt: NOW }),
      { ...thread("snoozed"), snoozedUntil: "2026-03-10T00:00:00.000Z" },
      { ...thread("snooze-over"), snoozedUntil: "2026-03-09T11:00:00.000Z" },
      thread("subagent", {
        lineage: {
          rootThreadId: ThreadId.make("open"),
          parentThreadId: ThreadId.make("open"),
          relationshipToParent: "subagent",
        },
      }),
    ];
    const selected = selectLobbyThreads({
      threads,
      delegatedUnderParent: new Set(),
      now: NOW,
    });
    expect(ids(selected)).toEqual(["open", "snooze-over"]);
  });

  it("puts pinned threads first in pin order, then the rest oldest first", () => {
    const threads = [
      { ...thread("newest"), createdAt: "2026-03-09T10:03:00.000Z" },
      { ...thread("pinned-b"), pinnedAt: NOW, pinOrderKey: "b" },
      { ...thread("oldest"), createdAt: "2026-03-09T10:01:00.000Z" },
      { ...thread("pinned-a"), pinnedAt: NOW, pinOrderKey: "a" },
      { ...thread("middle"), createdAt: "2026-03-09T10:02:00.000Z" },
    ];
    const selected = selectLobbyThreads({
      threads,
      delegatedUnderParent: new Set(),
      now: NOW,
    });
    expect(ids(selected)).toEqual(["pinned-a", "pinned-b", "oldest", "middle", "newest"]);
  });
});

describe("adjacentLobbyCardIndex", () => {
  const all = () => true;
  it.each([
    { currentIndex: 0, direction: "next", expected: 1 },
    { currentIndex: 2, direction: "next", expected: 0 },
    { currentIndex: 0, direction: "previous", expected: 2 },
    { currentIndex: -1, direction: "next", expected: 0 },
    { currentIndex: -1, direction: "previous", expected: 2 },
  ] as const)(
    "$direction from $currentIndex of 3 is $expected",
    (input: { currentIndex: number; direction: "next" | "previous"; expected: number }) => {
      expect(adjacentLobbyCardIndex({ count: 3, canFocus: all, ...input })).toBe(input.expected);
    },
  );

  it("skips cards without a prompt, wrapping past them", () => {
    const withoutPrompt = new Set([1, 3]);
    const canFocus = (index: number) => !withoutPrompt.has(index);
    expect(adjacentLobbyCardIndex({ count: 4, currentIndex: 0, direction: "next", canFocus })).toBe(
      2,
    );
    expect(adjacentLobbyCardIndex({ count: 4, currentIndex: 2, direction: "next", canFocus })).toBe(
      0,
    );
    expect(
      adjacentLobbyCardIndex({ count: 4, currentIndex: -1, direction: "previous", canFocus }),
    ).toBe(2);
  });

  it("has nothing to focus with no cards or when only the current card can take focus", () => {
    expect(
      adjacentLobbyCardIndex({ count: 0, currentIndex: -1, direction: "next", canFocus: all }),
    ).toBeNull();
    expect(
      adjacentLobbyCardIndex({
        count: 3,
        currentIndex: 1,
        direction: "next",
        canFocus: (index) => index === 1,
      }),
    ).toBeNull();
  });
});

describe("clampLobbyCardWidth", () => {
  it("bounds stored widths and recovers from a corrupt value", () => {
    expect(clampLobbyCardWidth(10)).toBe(280);
    expect(clampLobbyCardWidth(5000)).toBe(900);
    expect(clampLobbyCardWidth(Number.NaN)).toBe(380);
  });
});
