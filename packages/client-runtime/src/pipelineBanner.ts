import type { PipelineRun } from "@t3tools/contracts";
import { pipelineNextPhaseIndex } from "@t3tools/shared/pipeline";

export type PipelineBannerStatus = "running" | "ready" | "awaiting_approval";

export interface PipelineBannerState {
  readonly pipelineName: string;
  readonly phaseNumber: number;
  readonly phaseCount: number;
  readonly phaseName: string;
  readonly status: PipelineBannerStatus;
  /** The phase Continue starts, an earlier one when a handoff sent the work back; null when Continue finishes. */
  readonly nextPhaseName: string | null;
  /** Continue is the main action once the phase has handed off. */
  readonly continuePrimary: boolean;
}

/** Null when the run is over or has no such phase, so nothing is shown. */
export function derivePipelineBanner(run: PipelineRun | null): PipelineBannerState | null {
  if (
    run === null ||
    (run.status !== "running" && run.status !== "ready" && run.status !== "awaiting_approval")
  ) {
    return null;
  }
  const phase = run.phases[run.phaseIndex];
  if (phase === undefined) return null;
  return {
    pipelineName: run.pipelineName,
    phaseNumber: run.phaseIndex + 1,
    phaseCount: run.phases.length,
    phaseName: phase.name,
    status: run.status,
    nextPhaseName: run.phases[pipelineNextPhaseIndex(run)]?.name ?? null,
    continuePrimary: run.status !== "running",
  };
}
