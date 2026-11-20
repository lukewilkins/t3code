import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { CheckIcon } from "lucide-react";

import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
} from "~/components/Sidebar.logic";
import { resolveThreadTopStatus, TopStatusIcon } from "~/components/sidebar/threadTopStatus";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { useEnvironmentScope } from "~/state/session";
import { useUiStateStore } from "~/uiStateStore";

/**
 * The card's status, as its sidebar row words it; hovering or focusing it offers Settle instead.
 * A finished thread reads Done even after it was seen, since lobby cards never mark visits.
 */
export function LobbyCardStatus(props: {
  readonly thread: EnvironmentThreadShell;
  readonly onSettle: (threadRef: ScopedThreadRef) => void;
}) {
  const { thread, onSettle } = props;
  const gt = useGT();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const canOperate = useEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope);
  const localLastVisitedAt = useUiStateStore(
    (state) => state.threadLastVisitedAtById[scopedThreadKey(threadRef)],
  );
  const now = useNowMinute();
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const status = resolveSidebarRowStatus({ ...thread, lastVisitedAt });
  const wokeAt = threadWokeAt(thread, { now });
  const isWoke =
    wokeAt !== null &&
    (lastVisitedAt === undefined || Date.parse(lastVisitedAt) < Date.parse(wokeAt));
  const isUnread = hasUnseenCompletion({ ...thread, lastVisitedAt });
  const topStatus =
    resolveThreadTopStatus(
      { status, isWoke, isUnread, goalActive: thread.goal?.status === "active" },
      gt,
    ) ??
    (status === "ready" && thread.latestRun?.completedAt != null
      ? {
          label: gt("Done", { $context: "thread status" }),
          icon: "done" as const,
          className: "text-muted-foreground",
        }
      : null);
  if (topStatus === null) return null;

  const label = (
    <span className={cn("inline-flex items-center gap-1 font-medium", topStatus.className)}>
      <TopStatusIcon icon={topStatus.icon} className="size-4" />
      {topStatus.label}
    </span>
  );
  // A settled thread is here because someone added it; there is nothing left to settle.
  if (!canOperate || thread.settledOverride === "settled") {
    return <span className="shrink-0 px-1.5 text-xs">{label}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-lobby-card-action
            aria-label={gt("Settle thread")}
            onClick={() => onSettle(threadRef)}
            className="group/lobby-status inline-grid shrink-0 cursor-pointer items-center rounded-md px-1.5 py-0.5 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        <span className="col-start-1 row-start-1 group-hover/lobby-status:invisible group-focus-visible/lobby-status:invisible">
          {label}
        </span>
        <span className="invisible col-start-1 row-start-1 inline-flex items-center justify-end gap-1 text-muted-foreground group-hover/lobby-status:visible group-hover/lobby-status:text-foreground group-focus-visible/lobby-status:visible">
          <CheckIcon aria-hidden className="size-3.5" />
          <T>Settle</T>
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <T>Settle thread</T>
      </TooltipPopup>
    </Tooltip>
  );
}
