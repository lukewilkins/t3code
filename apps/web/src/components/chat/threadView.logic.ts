export type ThreadView = "thread" | "spec";

export interface ThreadRouteSearch {
  /** Absent for the transcript, the default. */
  view?: "spec" | undefined;
}

// An own key even when undefined, like the other validated searches, so a stale `view` never
// survives a navigation that drops it.
export const threadRouteSearchFromUrl = (raw: Record<string, unknown>): ThreadRouteSearch => ({
  view: raw.view === "spec" ? "spec" : undefined,
});

export function threadViewFromSearch(search: unknown): ThreadView {
  return typeof search === "object" && search !== null && "view" in search && search.view === "spec"
    ? "spec"
    : "thread";
}

export function threadViewSearch(view: ThreadView): ThreadRouteSearch {
  return { view: view === "spec" ? "spec" : undefined };
}
