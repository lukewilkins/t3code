import type { EnvironmentId, ModelSelection, ThreadId } from "@t3tools/contracts";
import { planPipelineFirstMessage } from "@t3tools/shared/pipeline";
import type { AsyncResult } from "effect/reactivity";

import { pipelineEnvironment } from "../../state/pipeline";
import { useAtomCommand } from "../../state/use-atom-command";

export interface PipelineStart {
  /** The first phase's message, replacing the user's text. */
  readonly text: string;
  readonly modelSelection: ModelSelection;
}

/** Attaches an armed pipeline before the composer sends its first phase, and undoes it if that send fails. */
export function usePipelineSend(environmentId: EnvironmentId) {
  const attach = useAtomCommand(pipelineEnvironment.attach, { reportFailure: false });
  const cancel = useAtomCommand(pipelineEnvironment.cancel, { reportFailure: false });
  return {
    async start(input: {
      readonly threadId: ThreadId;
      readonly pipelineId: string;
      readonly text: string;
      readonly selectedModelSelection: ModelSelection;
    }): Promise<
      | { readonly _tag: "Started"; readonly start: PipelineStart }
      | { readonly _tag: "Failure"; readonly failure: AsyncResult.Failure<unknown, unknown> }
    > {
      const result = await attach({
        environmentId,
        input: {
          threadId: input.threadId,
          pipelineId: input.pipelineId,
          baseModelSelection: input.selectedModelSelection,
        },
      });
      if (result._tag === "Failure") return { _tag: "Failure", failure: result };
      const run = result.value;
      return {
        _tag: "Started",
        start: planPipelineFirstMessage({
          run,
          text: input.text,
          selectedModel: input.selectedModelSelection,
        }),
      };
    },
    abort: (threadId: ThreadId) => cancel({ environmentId, input: { threadId } }),
  };
}
