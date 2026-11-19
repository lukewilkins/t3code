import {
  isPipelineRunActive,
  type Pipeline,
  type PipelineRun,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useMessages } from "gt-react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentQuery } from "../../state/query";
import { pipelineEnvironment } from "../../state/pipeline";

const NO_PIPELINES: ReadonlyArray<Pipeline> = [];

/**
 * The environment's pipelines and this thread's run. The run stream opens only while a component
 * using this hook is mounted, and only when `subscribe` is true.
 */
export function useThreadPipeline(threadRef: ScopedThreadRef, subscribe: boolean) {
  const messages = useMessages();
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const live = useEnvironmentQuery(
    subscribe
      ? pipelineEnvironment.live({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId },
        })
      : null,
    messages,
  );
  const run: PipelineRun | null = live.data?.run ?? null;
  return {
    pipelines: settings.pipelines.length === 0 ? NO_PIPELINES : settings.pipelines,
    run,
    activeRun: isPipelineRunActive(run) ? run : null,
  };
}

export function usePipelineWritePermission(threadRef: ScopedThreadRef): boolean {
  return useAtomValue(pipelineEnvironment.advance.permissionAtom(threadRef.environmentId));
}
