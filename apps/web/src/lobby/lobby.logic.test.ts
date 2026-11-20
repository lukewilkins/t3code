import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../test-fixtures";
import {
  adjacentLobbyCardIndex,
  clampLobbyCardWidth,
  isRepeatSettlePress,
  type LobbyActiveOrder,
  lobbyThreadKey,
  selectLobbyThreads,
} from "./lobby.logic";

const environmentId = EnvironmentId.make("environment-test");
const NOW = "2026-03-09T12:00:00.000Z";

const thread = (id: string, overrides: Parameters<typeof makeThreadFixture>[0] = {}) =>
  makeThreadFixture({ id: ThreadId.make(id), environmentId, ...overrides });

const ids = (threads: ReadonlyArray<{ id: string }>) => threads.map((entry) => entry.id);

const MANUAL: LobbyActiveOrder = { kind: "manual" };

const select = (
  threads: ReadonlyArray<ReturnType<typeof thread>>,
  options: {
    showWorking?: boolean;
    added?: ReadonlyArray<string>;
    activeOrder?: LobbyActiveOrder;
  } = {},
) =>
  selectLobbyThreads({
    threads,
    delegatedUnderParent: new Set(),
    now: NOW,
    showWorking: options.showWorking ?? true,
    addedKeys: new Set(
      (options.added ?? []).map((id) => lobbyThreadKey({ environmentId, id: ThreadId.make(id) })),
    ),
    activeOrder: options.activeOrder ?? MANUAL,
  });

const entryIds = (entries: ReadonlyArray<{ thread: { id: string } }>) =>
  ids(entries.map((entry) => entry.thread));

describe("selectLobbyThreads", () => {
  const parked = [
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

  it("keeps only open, listed threads and leaves out parked ones", () => {
    expect(entryIds(select(parked))).toEqual(["open", "snooze-over"]);
  });

  it("brings in parked threads added by hand, but never archived or deleted ones", () => {
    const entries = select(parked, { added: ["settled", "snoozed", "archived", "deleted"] });
    expect(entries.map(({ thread: { id }, added, open }) => ({ id, added, open }))).toEqual([
      { id: "open", added: false, open: true },
      { id: "snooze-over", added: false, open: true },
      { id: "snoozed", added: true, open: false },
      { id: "settled", added: true, open: false },
    ]);
  });

  it("follows the sidebar's sections: pinned, inbox newest first, working, then settled", () => {
    const threads = [
      {
        ...thread("done-old"),
        settledOverride: "settled" as const,
        settledAt: "2026-03-09T09:00:00.000Z",
      },
      { ...thread("older"), createdAt: "2026-03-09T10:01:00.000Z" },
      { ...thread("pinned-b"), pinnedAt: NOW, pinOrderKey: "b" },
      { ...thread("busy"), createdAt: "2026-03-09T10:05:00.000Z" },
      {
        ...thread("done-new"),
        settledOverride: "settled" as const,
        settledAt: "2026-03-09T09:30:00.000Z",
      },
      { ...thread("newest"), createdAt: "2026-03-09T10:03:00.000Z" },
      { ...thread("pinned-a"), pinnedAt: NOW, pinOrderKey: "a" },
    ];
    const activeOrder: LobbyActiveOrder = {
      kind: "inbox",
      isWorking: (candidate) => candidate.id === "busy",
      returnedAt: () => undefined,
    };
    expect(entryIds(select(threads, { activeOrder, added: ["done-old", "done-new"] }))).toEqual([
      "pinned-a",
      "pinned-b",
      "newest",
      "older",
      "busy",
      "done-new",
      "done-old",
    ]);
  });

  it.each([
    { order: "manual", expected: ["keyless", "key-a", "key-b"] },
    { order: "send", expected: ["key-b", "keyless", "key-a"] },
    { order: "inbox", expected: ["key-a", "keyless", "key-b"] },
  ] as const)("orders active threads as the sidebar's $order mode does", ({ order, expected }) => {
    const threads = [
      {
        ...thread("key-b"),
        createdAt: "2026-03-09T10:01:00.000Z",
        activeOrderKey: "b",
        latestUserAuthoredMessageAt: "2026-03-09T10:05:00.000Z",
      },
      {
        ...thread("key-a"),
        createdAt: "2026-03-09T10:02:00.000Z",
        activeOrderKey: "a",
        latestUserAuthoredMessageAt: "2026-03-09T10:03:00.000Z",
      },
      {
        ...thread("keyless"),
        createdAt: "2026-03-09T10:03:00.000Z",
        latestUserAuthoredMessageAt: "2026-03-09T10:04:00.000Z",
      },
    ];
    const activeOrder: LobbyActiveOrder =
      order === "inbox"
        ? {
            kind: "inbox",
            isWorking: () => false,
            // Coming back from work counts as fresh activity, as in the sidebar's inbox.
            returnedAt: (candidate) =>
              candidate.id === "key-a" ? Date.parse("2026-03-09T10:10:00.000Z") : undefined,
          }
        : { kind: order };
    expect(entryIds(select(threads, { activeOrder }))).toEqual(expected);
  });

  it("leaves out working threads unless showWorking or added, keeping ones that need the user", () => {
    const runtime = (status: "running" | "preparing" | "idle" | "completed" | "failed") => ({
      status,
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: "Codex",
      lastError: null,
      updatedAt: NOW,
    });
    const threads = [
      { ...thread("running"), runtime: runtime("running") },
      { ...thread("preparing"), runtime: runtime("preparing") },
      { ...thread("background"), runtime: runtime("idle") },
      { ...thread("child-wait"), runtime: runtime("running"), blockedOnThreadWait: true },
      { ...thread("approval"), runtime: runtime("running"), hasPendingApprovals: true },
      { ...thread("completed"), runtime: runtime("completed") },
      { ...thread("failed"), runtime: runtime("failed") },
      thread("fresh"),
    ];
    const shown = (showWorking: boolean, added: ReadonlyArray<string> = []) =>
      entryIds(select(threads, { showWorking, added })).toSorted();
    expect(shown(false)).toEqual(["approval", "completed", "failed", "fresh"]);
    expect(shown(false, ["running"])).toEqual([
      "approval",
      "completed",
      "failed",
      "fresh",
      "running",
    ]);
    expect(shown(true)).toHaveLength(threads.length);
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
    expect(clampLobbyCardWidth(10)).toBe(200);
    expect(clampLobbyCardWidth(5000)).toBe(1500);
    expect(clampLobbyCardWidth(Number.NaN)).toBe(380);
  });
});

describe("isRepeatSettlePress", () => {
  const last = { x: 100, y: 50, at: 1_000 };
  it.each([
    { name: "no earlier Settle click", last: null, press: last, expected: false },
    { name: "same pixel within a second", last, press: { ...last, at: 1_999 }, expected: true },
    { name: "same pixel a second later", last, press: { ...last, at: 2_000 }, expected: false },
    { name: "subpixel jitter", last, press: { x: 100.5, y: 50.5, at: 1_200 }, expected: true },
    { name: "moved a pixel across", last, press: { x: 101, y: 50, at: 1_200 }, expected: false },
    { name: "moved a pixel down", last, press: { x: 100, y: 49, at: 1_200 }, expected: false },
  ])("$name", ({ last: previous, press, expected }) => {
    expect(isRepeatSettlePress(previous, press)).toBe(expected);
  });
});
