import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useGT } from "gt-react";
import { LayoutGridIcon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";

import { cn } from "../lib/utils";
import { useSidebar } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import {
  threadContextDropTargetProps,
  useThreadDropListener,
} from "../components/chat/threadContextDrag";
import { addThreadsToLobby } from "./lobbyMembership";

/**
 * The lobby's row under thread search, drawn like a thread row so it reads as one more view.
 * Threads dragged onto it join the lobby.
 */
export function LobbySidebarEntry() {
  const gt = useGT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = useLocation({ select: (location) => location.pathname === "/lobby" });
  const buttonRef = useRef<HTMLButtonElement>(null);
  useThreadDropListener(buttonRef, (refs) => {
    addThreadsToLobby(refs.map(scopedThreadKey));
    if (active) return;
    toastManager.add({
      type: "success",
      title: gt(
        "{count, plural, one {Added {count} thread to the lobby} other {Added {count} threads to the lobby}}",
        { count: refs.length },
      ),
      actionProps: {
        children: gt("Open lobby"),
        onClick: () => void navigate({ to: "/lobby" }),
      },
    });
  });
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={() => {
        if (isMobile) setOpenMobile(false);
        void navigate({ to: "/lobby" });
      }}
      {...threadContextDropTargetProps()}
      className={cn(
        "flex w-full cursor-pointer items-center gap-1.5 rounded-md px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-start text-sm font-medium text-sidebar-foreground outline-none select-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active
          ? "bg-sidebar-row-active light:ring-1 light:ring-inset light:ring-sidebar-border/70"
          : "bg-transparent hover:bg-sidebar-row-hover",
        "data-[thread-context-over]:bg-accent/45 data-[thread-context-over]:ring-1 data-[thread-context-over]:ring-primary/70 data-[thread-context-over]:ring-inset",
      )}
    >
      <LayoutGridIcon aria-hidden className="size-4 shrink-0 text-(--sidebar-icon-color)" />
      <span className="min-w-0 flex-1 truncate">
        {gt("Lobby", { $context: "sidebar link to the grid of active threads" })}
      </span>
    </button>
  );
}
