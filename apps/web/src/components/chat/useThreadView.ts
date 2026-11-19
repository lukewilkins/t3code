import type { ScopedThreadRef } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { buildThreadRouteParams } from "../../threadRoutes";
import { threadViewFromSearch, threadViewSearch, type ThreadView } from "./threadView.logic";

/** The thread route's `?view=` search: linkable, survives reload, and a new thread starts on the transcript. */
export function useThreadView(threadRef: ScopedThreadRef | null) {
  const navigate = useNavigate();
  const view = useLocation({
    select: (location) => (threadRef === null ? "thread" : threadViewFromSearch(location.search)),
  });
  const setView = (next: ThreadView) => {
    if (threadRef === null || next === view) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: threadViewSearch(next),
    });
  };
  return { view, setView };
}
