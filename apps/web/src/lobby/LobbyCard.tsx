import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import ChatView from "../components/ChatView";
import { ProjectFavicon } from "../components/ProjectFavicon";
import { BackgroundThreadContext } from "../components/chat/backgroundThread";
import { ComposerChromeContext } from "../components/chat/composerChrome";
import { ThreadVisitTrackingContext } from "../components/chat/threadVisitTracking";
import { ComposerHandleContext } from "../composerHandleContext";
import { cn } from "../lib/utils";
import { useProject, useQuietThreadShell } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { LOBBY_FOCUS_REQUEST_EVENT, LOBBY_PROMPT_SELECTOR } from "./lobbyFocus";

// The composer spans the card edge to edge and meets its bottom border; the minimal chrome
// draws its top rule.
const LOBBY_COMPOSER_FLUSH_CLASS =
  "[&_.chat-composer-lane]:px-0 [&_[data-chat-composer-stack]]:max-w-none [&_[data-slot=composer-shell]]:max-w-none [&_[data-chat-composer-bottom-spacer]]:hidden";
// A card's thread view (and its detail stream) mounts only within a screen of the viewport.
const LOBBY_MOUNT_MARGIN = "100%";
const LOBBY_FOCUS_REQUEST_TIMEOUT_MS = 5_000;

/** Whether the press or click lands on the card itself, not its composer or header link. */
function isCardSurfaceTarget(event: { target: EventTarget; currentTarget: HTMLElement }) {
  const { target, currentTarget } = event;
  // Portaled popovers bubble through React but sit outside the card's DOM.
  if (!(target instanceof Element) || !currentTarget.contains(target)) return false;
  return target.closest("form, [data-lobby-card-link]") === null;
}

/**
 * One thread in the lobby: the thread detail's own ChatView in its embedded mode, with the
 * composer trimmed. Every click outside the composer opens the thread.
 */
export const LobbyCard = memo(function LobbyCard(props: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const { environmentId, threadId } = props;
  const navigate = useNavigate();
  const threadRef = scopeThreadRef(environmentId, threadId);
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(shell ? scopeProjectRef(environmentId, shell.projectId) : null);
  const cardRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  // A focused card, or one keyboard navigation is moving to, stays mounted wherever it scrolls.
  const [focusWithin, setFocusWithin] = useState(false);
  const [focusRequested, setFocusRequested] = useState(false);
  const mounted = nearViewport || focusWithin || focusRequested;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the card's distance from the lobby viewport to mount its thread view only nearby
  useEffect(() => {
    const card = cardRef.current;
    if (card === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry) setNearViewport(entry.isIntersecting);
        // A focused editor removed from the DOM can skip its blur.
        if (!card.contains(document.activeElement)) setFocusWithin(false);
      },
      { root: card.closest("[data-lobby-grid]"), rootMargin: LOBBY_MOUNT_MARGIN },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for keyboard navigation's DOM focus request on this card
  useEffect(() => {
    const card = cardRef.current;
    if (card === null) return;
    const onRequest = () => setFocusRequested(true);
    card.addEventListener(LOBBY_FOCUS_REQUEST_EVENT, onRequest);
    return () => card.removeEventListener(LOBBY_FOCUS_REQUEST_EVENT, onRequest);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the prompt once the requested card's editor has mounted, which can follow its thread load
  useEffect(() => {
    const card = cardRef.current;
    if (!focusRequested || card === null) return;
    const tryFocus = () => {
      const editor = card.querySelector<HTMLElement>(LOBBY_PROMPT_SELECTOR);
      if (editor === null) return false;
      editor.focus({ preventScroll: true });
      setFocusRequested(false);
      return true;
    };
    if (tryFocus()) return;
    const observer = new MutationObserver(() => {
      if (tryFocus()) observer.disconnect();
    });
    observer.observe(card, { childList: true, subtree: true });
    // A thread with no composer never mounts an editor; focus moving elsewhere also ends the wait.
    const cancel = () => setFocusRequested(false);
    const timeout = window.setTimeout(cancel, LOBBY_FOCUS_REQUEST_TIMEOUT_MS);
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !card.contains(event.target)) cancel();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [focusRequested]);

  const onBlurCapture = (event: ReactFocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) setFocusWithin(false);
  };

  const routeParams = buildThreadRouteParams(threadRef);
  const openThread = () => void navigate({ to: "/$environmentId/$threadId", params: routeParams });
  // The timeline would act on its own links and buttons; in a card it only opens the thread.
  const parentPanel = { openToolDiff: openThread, runShellCommand: openThread };

  // Timeline menus and popovers open on press, before any click; keep the press from them.
  const onPressCapture = (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => {
    if (isCardSurfaceTarget(event)) event.stopPropagation();
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!isCardSurfaceTarget(event)) return;
    const selection = window.getSelection();
    if (
      selection !== null &&
      !selection.isCollapsed &&
      event.currentTarget.contains(selection.anchorNode)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openThread();
  };

  return (
    <article
      ref={cardRef}
      data-lobby-card
      data-lobby-mounted={mounted || undefined}
      data-side-chat-pane={threadId}
      aria-label={shell?.title}
      onPointerDownCapture={onPressCapture}
      onMouseDownCapture={onPressCapture}
      onClickCapture={onClickCapture}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={onBlurCapture}
      className={cn(
        "relative isolate flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xs",
        LOBBY_COMPOSER_FLUSH_CLASS,
        // The border plus a 1px overlay above the thread view, whose background would hide an inset ring.
        "after:pointer-events-none after:absolute after:inset-0 after:z-50 after:rounded-[inherit] after:border after:border-transparent has-[[data-testid=composer-editor]:focus]:border-ring has-[[data-testid=composer-editor]:focus]:after:border-ring",
      )}
    >
      <Link
        data-lobby-card-link
        to="/$environmentId/$threadId"
        params={routeParams}
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 outline-none focus-visible:bg-accent"
      >
        {project ? <ProjectFavicon project={project} className="size-4 shrink-0" /> : null}
        <span className="shrink-0 truncate text-sm font-medium">{project?.title}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {shell?.title}
        </span>
      </Link>
      <div className="flex min-h-0 flex-1 flex-col">
        {mounted ? (
          <BackgroundThreadContext value>
            <ThreadVisitTrackingContext value={false}>
              <ComposerHandleContext value={null}>
                <ComposerChromeContext value="minimal">
                  <ChatView
                    environmentId={environmentId}
                    threadId={threadId}
                    routeKind="server"
                    embedded={parentPanel}
                  />
                </ComposerChromeContext>
              </ComposerHandleContext>
            </ThreadVisitTrackingContext>
          </BackgroundThreadContext>
        ) : null}
      </div>
    </article>
  );
});
