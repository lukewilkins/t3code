import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/**
 * Per-environment pipeline atoms. `live` streams a thread's `PipelineThreadSnapshot` and re-sends
 * it after each change; mounting it opens the stream, so read it only while the thread is on screen.
 */
export function createPipelineEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    live: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:pipeline:live",
      tag: WS_METHODS.pipelineSubscribe,
      idleTtlMs: 30_000,
    }),
    attach: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pipeline:attach",
      tag: WS_METHODS.pipelineAttach,
    }),
    advance: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pipeline:advance",
      tag: WS_METHODS.pipelineAdvance,
    }),
    cancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pipeline:cancel",
      tag: WS_METHODS.pipelineCancel,
    }),
  };
}

export type PipelineEnvironmentAtoms = ReturnType<typeof createPipelineEnvironmentAtoms>;
