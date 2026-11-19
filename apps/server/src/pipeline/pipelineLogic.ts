import {
  MAX_AUTO_PIPELINE_RETURNS,
  type ModelSelection,
  type Pipeline,
  type PipelineRun,
} from "@t3tools/contracts";
import {
  pipelineNextPhaseIndex,
  pipelinePhaseModelSelection,
  renderPipelinePhaseMessage,
} from "@t3tools/shared/pipeline";

export type PipelineCompletionDecision =
  | "none"
  | "wait"
  | "complete"
  | "advance"
  | "await_approval";

/**
 * What a completed run means for the thread's pipeline. Only a phase that handed off moves on, and
 * only once nothing else is pending, so a phase that stopped to ask the user stays put.
 */
export function decideAfterRunCompleted(
  run: Pick<PipelineRun, "status" | "phaseIndex" | "phases" | "returnTo" | "returnCount"> | null,
  hasOutstandingWork: boolean,
): PipelineCompletionDecision {
  if (run === null || run.status !== "ready") return "none";
  if (hasOutstandingWork) return "wait";
  const auto = run.phases[run.phaseIndex]?.autoAdvance === true;
  if (run.returnTo !== null) {
    return auto && run.returnCount < MAX_AUTO_PIPELINE_RETURNS ? "advance" : "await_approval";
  }
  if (run.phaseIndex >= run.phases.length - 1) return "complete";
  return auto ? "advance" : "await_approval";
}

const pipelinePhaseMessageKey = (run: Pick<PipelineRun, "runKey">, step: number) =>
  `pipeline:${run.runKey}:${step}`;

export interface PipelinePhaseSend {
  readonly key: string;
  readonly text: string;
  readonly modelSelection: ModelSelection | undefined;
  readonly freshContext: boolean;
}

/** The send that moves `run` to its next phase, and the run after it. */
export function planAdvance(
  run: PipelineRun,
  handoff: string,
  now: string,
): { readonly run: PipelineRun; readonly send: PipelinePhaseSend } | null {
  const nextIndex = pipelineNextPhaseIndex(run);
  if (nextIndex >= run.phases.length) return null;
  const step = run.step + 1;
  return {
    run: {
      ...run,
      phaseIndex: nextIndex,
      step,
      status: "running",
      handoff: null,
      returnTo: null,
      returnCount: run.returnTo === null ? run.returnCount : run.returnCount + 1,
      updatedAt: now,
    },
    send: {
      key: pipelinePhaseMessageKey(run, step),
      text: renderPipelinePhaseMessage({
        pipelineName: run.pipelineName,
        phases: run.phases,
        phaseIndex: nextIndex,
        body: handoff,
        bodyKind: "handoff",
        handoffFrom: run.phases[run.phaseIndex]?.name ?? "the previous phase",
      }),
      modelSelection: pipelinePhaseModelSelection(run, nextIndex, run.phaseIndex),
      freshContext: true,
    },
  };
}

/**
 * The send that opens phase 1 for an agent that started the pipeline. With a handoff it starts
 * fresh like any later phase; without one it continues the thread's current context.
 */
export function planStart(run: PipelineRun, handoff: string | undefined): PipelinePhaseSend {
  const body = handoff?.trim() ?? "";
  return {
    key: pipelinePhaseMessageKey(run, 0),
    text: renderPipelinePhaseMessage({
      pipelineName: run.pipelineName,
      phases: run.phases,
      phaseIndex: 0,
      body,
      bodyKind: "handoff",
      handoffFrom: "the conversation so far",
    }),
    modelSelection: pipelinePhaseModelSelection(run, 0),
    freshContext: body.length > 0,
  };
}

/** A pipeline by id, or else by name, ignoring case. */
export function findPipeline(
  pipelines: ReadonlyArray<Pipeline>,
  ref: string,
): Pipeline | undefined {
  const needle = ref.trim();
  return (
    pipelines.find((pipeline) => pipeline.id === needle) ??
    pipelines.find((pipeline) => pipeline.name.toLowerCase() === needle.toLowerCase())
  );
}
