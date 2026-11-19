import type { EnvironmentId, ModelSelection, PipelineRun, ThreadId } from "@t3tools/contracts";

import { pipelineEnvironment } from "../../state/pipeline";
import { useAtomCommand } from "../../state/use-atom-command";

export function usePipelineAttach() {
  const attach = useAtomCommand(pipelineEnvironment.attach, {
    label: "pipeline attach",
    reportFailure: true,
  });
  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly pipelineId: string;
    readonly baseModelSelection: ModelSelection;
  }): Promise<PipelineRun | null> => {
    const result = await attach({
      environmentId: input.environmentId,
      input: {
        threadId: input.threadId,
        pipelineId: input.pipelineId,
        baseModelSelection: input.baseModelSelection,
      },
    });
    return result._tag === "Success" ? result.value : null;
  };
}

export function usePipelineCancel(options: { readonly reportFailure: boolean }) {
  const cancel = useAtomCommand(pipelineEnvironment.cancel, {
    label: "pipeline cancel",
    reportFailure: options.reportFailure,
  });
  return (input: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId }) =>
    cancel({ environmentId: input.environmentId, input: { threadId: input.threadId } });
}
