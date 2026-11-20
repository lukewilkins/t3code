import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../rpc/atomRegistry";

/** Threads whose next message starts a pipeline, keyed by thread, valued by the pipeline's id. */
const pipelineArmsAtom = Atom.make<Readonly<Record<string, string>>>({}).pipe(Atom.keepAlive);

export function armPipeline(threadKey: string, pipelineId: string): void {
  appAtomRegistry.set(pipelineArmsAtom, {
    ...appAtomRegistry.get(pipelineArmsAtom),
    [threadKey]: pipelineId,
  });
}

/** With `pipelineId`, clears only that arm, so a send never consumes one made while it was in flight. */
export function disarmPipeline(threadKey: string, pipelineId?: string): void {
  const current = appAtomRegistry.get(pipelineArmsAtom);
  if (current[threadKey] === undefined) return;
  if (pipelineId !== undefined && current[threadKey] !== pipelineId) return;
  const { [threadKey]: _removed, ...rest } = current;
  appAtomRegistry.set(pipelineArmsAtom, rest);
}

/** Only a new thread starts in a pipeline, so an arm left on an existing thread never fires. */
export function readPipelineArm(
  threadKey: string,
  input: { readonly isNewThread: boolean },
): string | undefined {
  return input.isNewThread ? appAtomRegistry.get(pipelineArmsAtom)[threadKey] : undefined;
}

export function useArmedPipelineId(threadKey: string): string | undefined {
  return useAtomValue(pipelineArmsAtom)[threadKey];
}
