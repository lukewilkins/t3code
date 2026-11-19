import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../../state/atom-registry";

// The pipeline picked for a thread's next send, by scoped thread key; cleared once that send lands.
const pipelineSelectionAtom = Atom.make<Readonly<Record<string, string>>>({}).pipe(Atom.keepAlive);

export function getPipelineSelection(threadKey: string): string | null {
  return appAtomRegistry.get(pipelineSelectionAtom)[threadKey] ?? null;
}

export function setPipelineSelection(threadKey: string, pipelineId: string | null): void {
  const { [threadKey]: current, ...rest } = appAtomRegistry.get(pipelineSelectionAtom);
  if ((current ?? null) === pipelineId) return;
  appAtomRegistry.set(
    pipelineSelectionAtom,
    pipelineId === null ? rest : { ...rest, [threadKey]: pipelineId },
  );
}

export function usePipelineSelection(threadKey: string): string | null {
  return useAtomValue(pipelineSelectionAtom)[threadKey] ?? null;
}
