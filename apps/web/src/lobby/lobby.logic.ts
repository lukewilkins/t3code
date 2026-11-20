import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

import {
  filterSidebarV2VisibleThreads,
  resolveSidebarThreadStatus,
} from "../components/Sidebar.logic";

export const LOBBY_CARD_WIDTH_MIN = 200;
export const LOBBY_CARD_WIDTH_MAX = 1500;
export const LOBBY_CARD_WIDTH_DEFAULT = 380;
/** A4 portrait: height over width. */
export const LOBBY_CARD_ASPECT = Math.SQRT2;

/**
 * Listed top-level threads that are not archived, deleted, settled, snoozed or (unless
 * `showWorking`) working. Pinned threads lead in pin order; the rest follow oldest first so a new
 * thread joins at the end and no card moves while someone types in one.
 */
export function selectLobbyThreads<T extends EnvironmentThreadShell>(input: {
  readonly threads: readonly T[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly now: string;
  readonly showWorking: boolean;
}): T[] {
  const open = filterSidebarV2VisibleThreads(
    input.threads,
    null,
    input.delegatedUnderParent,
  ).filter(
    (thread) =>
      thread.deletedAt == null &&
      thread.settledOverride !== "settled" &&
      !effectiveSnoozed(thread, { now: input.now }) &&
      (input.showWorking || !isLobbyThreadWorking(thread)),
  );
  return open.toSorted((left, right) => {
    const leftPinned = left.pinnedAt != null;
    const rightPinned = right.pinnedAt != null;
    if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
    if (leftPinned) {
      const order = comparePlain(left.pinOrderKey ?? "", right.pinOrderKey ?? "");
      if (order !== 0) return order;
    }
    return (
      comparePlain(left.createdAt, right.createdAt) ||
      comparePlain(lobbyThreadKey(left), lobbyThreadKey(right))
    );
  });
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

function comparePlain(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
