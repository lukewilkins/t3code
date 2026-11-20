import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
import * as Schema from "effect/Schema";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { Checkbox } from "~/components/ui/checkbox";
import { SidebarInset } from "~/components/ui/sidebar";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { isElectron } from "~/env";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useThreadActions } from "~/hooks/useThreadActions";
import { resolveShortcutCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { useDelegatedUnderParent, useQuietThreadShells } from "~/state/entities";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { LobbyCard } from "./LobbyCard";
import { LOBBY_FOCUS_REQUEST_EVENT, lobbyCardCanTakeFocus } from "./lobbyFocus";
import {
  adjacentLobbyCardIndex,
  clampLobbyCardWidth,
  LOBBY_CARD_ASPECT,
  LOBBY_CARD_WIDTH_DEFAULT,
  LOBBY_CARD_WIDTH_MAX,
  LOBBY_CARD_WIDTH_MIN,
  isRepeatSettlePress,
  lobbyThreadKey,
  type LobbyPress,
  selectLobbyThreads,
} from "./lobby.logic";

const CARD_WIDTH_KEY = "t3code:lobby:card-width";
const WRAP_KEY = "t3code:lobby:wrap";
const SHOW_WORKING_KEY = "t3code:lobby:show-working";
// Matches the wrapper's duration-200. Settle drops the card at once, so it waits for the exit.
const LOBBY_SETTLE_EXIT_MS = 200;

/** Focuses the prompt of the card before or after the focused one, wrapping at the ends. */
function focusAdjacentLobbyCard(direction: "next" | "previous") {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-lobby-card]")];
  const active = document.activeElement;
  const currentIndex = active === null ? -1 : cards.findIndex((card) => card.contains(active));
  const index = adjacentLobbyCardIndex({
    count: cards.length,
    currentIndex,
    direction,
    canFocus: (candidate) => {
      const card = cards[candidate];
      return card !== undefined && lobbyCardCanTakeFocus(card);
    },
  });
  const card = index === null ? undefined : cards[index];
  if (!card) return false;
  // Instant: the card mounting mid-scroll cut a smooth scroll short. A card wider than the grid
  // has no "nearest" fit, so it aligns to its start.
  const grid = card.closest("[data-lobby-grid]");
  const tooWide = grid !== null && card.offsetWidth > grid.clientWidth;
  card.scrollIntoView({ block: "nearest", inline: tooWide ? "start" : "nearest" });
  card.dispatchEvent(new Event(LOBBY_FOCUS_REQUEST_EVENT));
  return true;
}

export function LobbyPage() {
  const gt = useGT();
  const m = useMessages();
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [storedWidth, setCardWidth] = useLocalStorage(
    CARD_WIDTH_KEY,
    LOBBY_CARD_WIDTH_DEFAULT,
    Schema.Number,
  );
  // Off by default: one horizontally scrolling row of full-height cards.
  const [wrap, setWrap] = useLocalStorage(WRAP_KEY, false, Schema.Boolean);
  const [showWorking, setShowWorking] = useLocalStorage(SHOW_WORKING_KEY, true, Schema.Boolean);
  const cardWidth = clampLobbyCardWidth(storedWidth);
  const { settleThread } = useThreadActions();
  // Minute ticks are enough to let a snoozed thread back in when it wakes.
  const now = useNowMinute();

  const lobbyThreads = selectLobbyThreads({
    threads,
    delegatedUnderParent,
    now,
    showWorking,
  });

  const [leavingKeys, setLeavingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const setLeaving = (key: string, leaving: boolean) =>
    setLeavingKeys((current) => {
      if (current.has(key) === leaving) return current;
      const next = new Set(current);
      if (leaving) next.add(key);
      else next.delete(key);
      return next;
    });

  // The last Settle click, so a repeat press on the card that slides under it is ignored.
  const lastSettlePressRef = useRef<LobbyPress | null>(null);
  const guardRepeatSettlePress = (event: ReactPointerEvent | ReactMouseEvent) => {
    // Keyboard activation has no pointer position.
    if (event.detail === 0 && event.type === "click") return;
    const press = { x: event.clientX, y: event.clientY, at: event.timeStamp };
    if (isRepeatSettlePress(lastSettlePressRef.current, press)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.type === "click" &&
      event.target instanceof Element &&
      event.target.closest("[data-lobby-card-action]") !== null
    ) {
      lastSettlePressRef.current = press;
    }
  };

  const onSettle = useStableCallback((threadRef: ScopedThreadRef) => {
    const key = scopedThreadKey(threadRef);
    if (leavingKeys.has(key)) return;
    setLeaving(key, true);
    window.setTimeout(() => {
      void settleThread(threadRef).then((result) => {
        setLeaving(key, false);
        if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to settle thread"),
            description:
              thrownErrorMessage(squashAtomCommandFailure(result), m) ?? gt("An error occurred."),
          }),
        );
      });
    }, LOBBY_SETTLE_EXIT_MS);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens on window for the lobby focus keybindings while the lobby is mounted
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: { lobbyPageOpen: true },
      });
      if (command !== "lobby.focusNext" && command !== "lobby.focusPrevious") return;
      if (focusAdjacentLobbyCard(command === "lobby.focusNext" ? "next" : "previous")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Capture, so the focused composer's editor never sees the chord first.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="relative bg-background">
          <WorkspaceBreadcrumb ariaLabel={gt("Lobby breadcrumb")}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">
                <T context="page title, grid of active threads">Lobby</T>
              </h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>

        <div
          data-lobby-grid
          onPointerDownCapture={guardRepeatSettlePress}
          onClickCapture={guardRepeatSettlePress}
          style={{ "--lobby-card-width": `${cardWidth}px` } as CSSProperties}
          className={cn(
            "scrollbar-gutter-both flex min-h-0 flex-1 gap-4 p-4",
            wrap
              ? "flex-wrap content-start overflow-x-hidden overflow-y-auto"
              : "flex-nowrap items-center overflow-x-auto overflow-y-hidden py-0",
          )}
        >
          {lobbyThreads.length === 0 ? (
            <p className="m-auto text-sm text-muted-foreground">
              {showWorking ? (
                <T>No active threads.</T>
              ) : (
                <T context="lobby empty state while working threads are hidden">
                  No threads waiting on you.
                </T>
              )}
            </p>
          ) : (
            lobbyThreads.map((thread) => {
              const key = lobbyThreadKey(thread);
              const leaving = leavingKeys.has(key);
              return (
                <div
                  key={key}
                  data-lobby-leaving={leaving || undefined}
                  aria-hidden={leaving || undefined}
                  className={cn(
                    "w-(--lobby-card-width) flex-none overflow-hidden transition-[opacity,width,margin] duration-200 ease-out motion-reduce:transition-opacity",
                    leaving && "pointer-events-none -mr-4 w-0 opacity-0",
                  )}
                  style={{
                    height: wrap ? `calc(var(--lobby-card-width) * ${LOBBY_CARD_ASPECT})` : "95%",
                  }}
                >
                  {/* Fixed width, so collapsing the wrapper clips the card instead of reflowing it. */}
                  <div className="h-full w-(--lobby-card-width)">
                    <LobbyCard
                      environmentId={thread.environmentId}
                      threadId={thread.id}
                      onSettle={onSettle}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        <footer className="flex h-10 shrink-0 items-center gap-4 border-t border-border px-4 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <span>
              <T context="lobby card size slider label">Size</T>
            </span>
            <input
              type="range"
              min={LOBBY_CARD_WIDTH_MIN}
              max={LOBBY_CARD_WIDTH_MAX}
              step={10}
              value={cardWidth}
              onChange={(event) => setCardWidth(Number(event.currentTarget.value))}
              aria-label={gt("Card size")}
              className="w-40 accent-primary"
            />
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={wrap} onCheckedChange={(checked) => setWrap(checked === true)} />
            <T context="lobby checkbox that wraps cards onto new rows">Wrap threads</T>
          </label>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={showWorking}
              onCheckedChange={(checked) => setShowWorking(checked === true)}
            />
            <T context="lobby checkbox that shows threads an agent is still working on">
              Show working
            </T>
          </label>
        </footer>
      </div>
    </SidebarInset>
  );
}
