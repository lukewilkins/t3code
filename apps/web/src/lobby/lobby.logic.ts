import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";

import {
  filterSidebarV2VisibleThreads,
  firstValidTimestampMs,
  resolveSidebarThreadSection,
  resolveSidebarThreadStatus,
  type SidebarSection,
  sortInboxThreadsByReturn,
  sortPinnedThreadsForSidebar,
  sortThreadsForSidebar,
  sortWorkingThreadsBySend,
} from "../components/Sidebar.logic";

export const LOBBY_CARD_WIDTH_MIN = 200;
export const LOBBY_CARD_WIDTH_MAX = 1500;
export const LOBBY_CARD_WIDTH_DEFAULT = 380;
/** A4 portrait: height over width. */
export const LOBBY_CARD_ASPECT = Math.SQRT2;

/** How the sidebar orders its active threads, so the lobby can match it. */
export type LobbyActiveOrder =
  | { readonly kind: "manual" }
  /** Boring mode lists active threads by the user's latest message. */
  | { readonly kind: "send" }
  /** The Working shelf: threads still working sit below the inbox, which sorts by return. */
  | {
      readonly kind: "inbox";
      readonly isWorking: (thread: EnvironmentThreadShell) => boolean;
      readonly returnedAt: (thread: EnvironmentThreadShell) => number | undefined;
    };

export interface LobbyEntry<T> {
  readonly thread: T;
  /** Pulled in by hand, from the sidebar or a thread menu. */
  readonly added: boolean;
  /** Would be listed without being added: open, and not hidden as working. */
  readonly open: boolean;
}

/**
 * Listed top-level threads that are open (not settled, snoozed or, unless `showWorking`,
 * working), plus any thread added by hand. They follow the sidebar's order, so the newest sits at
 * the leading edge and settled threads at the trailing one.
 */
export function selectLobbyThreads<T extends EnvironmentThreadShell>(input: {
  readonly threads: readonly T[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly now: string;
  readonly showWorking: boolean;
  readonly addedKeys: ReadonlySet<string>;
  readonly activeOrder: LobbyActiveOrder;
}): LobbyEntry<T>[] {
  const { activeOrder } = input;
  const sections: Record<SidebarSection, T[]> = {
    pinned: [],
    active: [],
    working: [],
    snoozed: [],
    settled: [],
  };
  const entries = new Map<T, LobbyEntry<T>>();
  for (const thread of filterSidebarV2VisibleThreads(
    input.threads,
    null,
    input.delegatedUnderParent,
  )) {
    if (thread.deletedAt != null) continue;
    const snoozed = effectiveSnoozed(thread, { now: input.now });
    const settled = thread.settledOverride === "settled";
    const open = !snoozed && !settled && (input.showWorking || !isLobbyThreadWorking(thread));
    const added = input.addedKeys.has(lobbyThreadKey(thread));
    if (!open && !added) continue;
    const section = resolveSidebarThreadSection({
      snoozed,
      settled,
      pinned: thread.pinnedAt != null,
    });
    sections[
      section === "active" && activeOrder.kind === "inbox" && activeOrder.isWorking(thread)
        ? "working"
        : section
    ].push(thread);
    entries.set(thread, { thread, added, open });
  }
  const ordered = [
    ...sortPinnedThreadsForSidebar(sections.pinned),
    ...(activeOrder.kind === "inbox"
      ? sortInboxThreadsByReturn(sections.active, activeOrder.returnedAt)
      : activeOrder.kind === "send"
        ? sortWorkingThreadsBySend(sections.active)
        : sortThreadsForSidebar(sections.active)),
    ...sortWorkingThreadsBySend(sections.working),
    ...sections.snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    ...sortSettledThreads(sections.settled),
  ];
  return ordered.map((thread) => entries.get(thread)!);
}

/** Still running a turn, setting one up, or waiting on background work or a child thread. */
function isLobbyThreadWorking(thread: EnvironmentThreadShell): boolean {
  const status = resolveSidebarThreadStatus(thread);
  return status === "preparing" || status === "working" || status === "waiting";
}

export function lobbyThreadKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/**
 * The card to focus next, wrapping at both ends and skipping cards that cannot take focus (no
 * prompt yet); with no card focused it starts at an end.
 */
export function adjacentLobbyCardIndex(input: {
  readonly count: number;
  readonly currentIndex: number;
  readonly direction: "next" | "previous";
  readonly canFocus: (index: number) => boolean;
}): number | null {
  const { count, currentIndex, direction, canFocus } = input;
  const step = direction === "next" ? 1 : -1;
  const outside = currentIndex < 0 || currentIndex >= count;
  let index = outside ? (direction === "next" ? -1 : count) : currentIndex;
  for (let tried = 0; tried < count; tried += 1) {
    index = (index + step + count) % count;
    if (index === currentIndex) return null;
    if (canFocus(index)) return index;
  }
  return null;
}

export interface LobbyPress {
  readonly x: number;
  readonly y: number;
  /** Event timestamp in milliseconds. */
  readonly at: number;
}

const REPEAT_SETTLE_PRESS_MS = 1_000;

/**
 * A settled card leaves and the next one slides under a still pointer, so a press counts as a
 * repeat of the last Settle click until the pointer moves a pixel or a second passes.
 */
export function isRepeatSettlePress(last: LobbyPress | null, press: LobbyPress): boolean {
  if (last === null) return false;
  return (
    Math.abs(press.x - last.x) < 1 &&
    Math.abs(press.y - last.y) < 1 &&
    press.at - last.at < REPEAT_SETTLE_PRESS_MS
  );
}

export function clampLobbyCardWidth(width: number): number {
  if (!Number.isFinite(width)) return LOBBY_CARD_WIDTH_DEFAULT;
  return Math.min(LOBBY_CARD_WIDTH_MAX, Math.max(LOBBY_CARD_WIDTH_MIN, Math.round(width)));
}
