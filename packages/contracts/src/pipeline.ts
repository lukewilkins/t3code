import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const PipelineId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
export type PipelineId = typeof PipelineId.Type;

export const PipelinePhase = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  prompt: Schema.String.check(Schema.isMaxLength(50_000)),
  /** Start the next phase as soon as this one hands off, instead of waiting for approval. */
  autoAdvance: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** Null runs the phase on the thread's own model. */
  modelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type PipelinePhase = typeof PipelinePhase.Type;

export const Pipeline = Schema.Struct({
  id: PipelineId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  phases: Schema.Array(PipelinePhase).check(Schema.isMinLength(1)),
});
export type Pipeline = typeof Pipeline.Type;

/**
 * `ready`: the phase handed off and its run is still going. `awaiting_approval`: it handed off,
 * its run ended, and the next phase waits for the user.
 */
export const PipelineRunStatus = Schema.Literals([
  "running",
  "ready",
  "awaiting_approval",
  "completed",
  "cancelled",
]);
export type PipelineRunStatus = typeof PipelineRunStatus.Type;

/** A pipeline attached to one thread. `phases` is a snapshot, so editing settings never moves a run. */
export const PipelineRun = Schema.Struct({
  threadId: ThreadId,
  /** Changes on every attach, so message ids from an earlier run of the same thread never collide. */
  runKey: TrimmedNonEmptyString,
  pipelineId: PipelineId,
  pipelineName: Schema.String,
  phases: Schema.Array(PipelinePhase),
  phaseIndex: NonNegativeInt,
  /** Counts phase starts, so a phase visited again gets a new message id. */
  step: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  status: PipelineRunStatus,
  handoff: Schema.NullOr(Schema.String),
  /** An earlier phase the latest handoff sends the work back to, such as review returning to work. */
  returnTo: Schema.NullOr(NonNegativeInt).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  /** How many times the run has gone back to an earlier phase. */
  returnCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  /** The thread's model when the run began; a default phase after an overriding one returns to it. */
  baseModelSelection: Schema.NullOr(ModelSelection),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PipelineRun = typeof PipelineRun.Type;

/** Automatic returns allowed per run; after these, going back waits for the user so a loop can't run forever. */
export const MAX_AUTO_PIPELINE_RETURNS = 3;

export const isPipelineRunActive = (run: Pick<PipelineRun, "status"> | null | undefined): boolean =>
  run != null && run.status !== "completed" && run.status !== "cancelled";

export const PipelineThreadInput = Schema.Struct({ threadId: ThreadId });
export type PipelineThreadInput = typeof PipelineThreadInput.Type;

export const PipelineThreadSnapshot = Schema.Struct({
  threadId: ThreadId,
  run: Schema.NullOr(PipelineRun),
});
export type PipelineThreadSnapshot = typeof PipelineThreadSnapshot.Type;

/**
 * Attaches a pipeline before the composer sends phase 1 itself, so it also works for a draft
 * thread the server has not created yet.
 */
export const PipelineAttachInput = Schema.Struct({
  threadId: ThreadId,
  pipelineId: PipelineId,
  baseModelSelection: Schema.optionalKey(ModelSelection),
});
export type PipelineAttachInput = typeof PipelineAttachInput.Type;

/** `phaseIndex` is the phase the caller saw; a stale one is refused, so a double click advances once. */
export const PipelineAdvanceInput = Schema.Struct({
  threadId: ThreadId,
  phaseIndex: Schema.optionalKey(NonNegativeInt),
});
export type PipelineAdvanceInput = typeof PipelineAdvanceInput.Type;

export class PipelineError extends Schema.TaggedError<PipelineError>()("PipelineError", {
  reason: Schema.Literals(["not-found", "invalid-state", "storage", "dispatch"]),
  message: Schema.String,
}) {}
