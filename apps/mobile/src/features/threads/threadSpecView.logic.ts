import { fencedDiffMarkdown, threadSpecUnifiedDiff } from "@t3tools/shared/threadSpec";

/** Which request a Retry button in the spec pane re-runs. */
export type ThreadSpecRetry = "live" | "shown" | "previous";

export type ThreadSpecContent =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string; readonly retry: ThreadSpecRetry }
  | { readonly kind: "empty" }
  | { readonly kind: "unchanged" }
  | { readonly kind: "markdown"; readonly text: string };

/**
 * What the spec pane shows. `shown` and `previous` are revision numbers (null when there is none);
 * a body is null until its fetch lands, with `*Error` set when it failed.
 */
export function resolveThreadSpecContent(input: {
  readonly snapshotLoaded: boolean;
  readonly liveError: string | null;
  readonly shown: number | null;
  readonly previous: number | null;
  readonly showChanges: boolean;
  readonly shownBody: string | null;
  readonly shownError: string | null;
  readonly previousBody: string | null;
  readonly previousError: string | null;
}): ThreadSpecContent {
  if (!input.snapshotLoaded) {
    return input.liveError === null
      ? { kind: "loading" }
      : { kind: "error", message: input.liveError, retry: "live" };
  }
  if (input.shown === null) return { kind: "empty" };
  if (input.shownBody === null) {
    return input.shownError === null
      ? { kind: "loading" }
      : { kind: "error", message: input.shownError, retry: "shown" };
  }
  if (!input.showChanges || input.previous === null) {
    return { kind: "markdown", text: input.shownBody };
  }
  if (input.previousBody === null) {
    return input.previousError === null
      ? { kind: "loading" }
      : { kind: "error", message: input.previousError, retry: "previous" };
  }
  const diff = threadSpecUnifiedDiff(
    input.previousBody,
    input.shownBody,
    `r${input.previous}`,
    `r${input.shown}`,
  );
  return diff === "" ? { kind: "unchanged" } : { kind: "markdown", text: fencedDiffMarkdown(diff) };
}
