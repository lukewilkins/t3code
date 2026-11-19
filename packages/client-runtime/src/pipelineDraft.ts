import type { Pipeline, PipelinePhase } from "@t3tools/contracts";

export const MAX_PIPELINE_NAME_LENGTH = 120;
export const MAX_PHASE_PROMPT_LENGTH = 50_000;

/** Ids come from the caller because web and mobile each have their own UUID source. */
export function newPhase(createId: () => string, name: string): PipelinePhase {
  return { id: createId(), name, prompt: "", autoAdvance: false, modelSelection: null };
}

export function newPipeline(
  createId: () => string,
  name: string,
  firstPhaseName: string,
): Pipeline {
  return { id: createId(), name, phases: [newPhase(createId, firstPhaseName)] };
}

export function replacePipeline(
  pipelines: readonly Pipeline[],
  id: string,
  update: (pipeline: Pipeline) => Pipeline,
): Pipeline[] {
  return pipelines.map((pipeline) => (pipeline.id === id ? update(pipeline) : pipeline));
}

export function replacePhase(
  pipeline: Pipeline,
  phaseId: string,
  patch: Partial<Omit<PipelinePhase, "id">>,
): Pipeline {
  return {
    ...pipeline,
    phases: pipeline.phases.map((phase) => (phase.id === phaseId ? { ...phase, ...patch } : phase)),
  };
}

/** A pipeline needs at least one phase, so the last one stays. */
export function removePhase(pipeline: Pipeline, phaseId: string): Pipeline {
  if (pipeline.phases.length <= 1) return pipeline;
  return { ...pipeline, phases: pipeline.phases.filter((phase) => phase.id !== phaseId) };
}

export function movePhase(pipeline: Pipeline, phaseId: string, direction: -1 | 1): Pipeline {
  const from = pipeline.phases.findIndex((phase) => phase.id === phaseId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= pipeline.phases.length) return pipeline;
  const phases = [...pipeline.phases];
  const [moved] = phases.splice(from, 1);
  phases.splice(to, 0, moved!);
  return { ...pipeline, phases };
}

/** Names are required; a blank edit reverts instead of saving. */
export function normalizeName(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export type PipelineDraftIssue =
  | { readonly kind: "pipeline-name"; readonly pipelineId: string }
  | { readonly kind: "no-phases"; readonly pipelineId: string }
  | { readonly kind: "phase-name"; readonly pipelineId: string; readonly phaseId: string };

/** The first thing keeping the draft from saving, or null; the server rejects blank names and empty pipelines. */
export function firstPipelineDraftIssue(
  pipelines: ReadonlyArray<Pipeline>,
): PipelineDraftIssue | null {
  for (const pipeline of pipelines) {
    if (pipeline.name.trim().length === 0) {
      return { kind: "pipeline-name", pipelineId: pipeline.id };
    }
    if (pipeline.phases.length === 0) return { kind: "no-phases", pipelineId: pipeline.id };
    const unnamed = pipeline.phases.find((phase) => phase.name.trim().length === 0);
    if (unnamed) return { kind: "phase-name", pipelineId: pipeline.id, phaseId: unnamed.id };
  }
  return null;
}

export function trimPipelineNames(pipelines: ReadonlyArray<Pipeline>): Pipeline[] {
  return pipelines.map((pipeline) => ({
    ...pipeline,
    name: pipeline.name.trim(),
    phases: pipeline.phases.map((phase) => ({ ...phase, name: phase.name.trim() })),
  }));
}

const EXAMPLE_PLAN_PROMPT = `Turn the task into a plan a human can approve.
1. Investigate read-only: read files, search, and run non-destructive commands. Don't create, modify or delete files, and don't commit.
2. Write the thread spec with \`t3_spec_update\`: the Goal (the request in the user's words, as it now stands), the Plan (the approach, the areas to change, risks, and how the result will be verified: tests, builds, manual or browser checks), Status ("Not started"), and Open questions.
3. When the user replies with feedback, rewrite every part of the spec it changes, the Goal included, so it reads top to bottom as one current request and plan. Replace what the feedback supersedes instead of adding it below. Put unresolved questions under Open questions instead of guessing.
Don't start the work. The spec is the only plan: ignore any built-in plan mode or plan file. In your handoff, give the work phase what your investigation found: where things live, how they work, the approach and why.`;

const EXAMPLE_WORK_PROMPT = `Do the work in the spec, autonomously: read it with \`t3_spec_read\`, decide for yourself and keep going until it's done. Done means verified:
- A behaviour change or bug fix gets an automated test that would fail without it.
- Run the tests and the typecheck, and fix what fails. Say in your handoff what you ran (all tests or which subset), at which commit, and what you skipped and why, so the review builds on your checks instead of repeating them.
- A user-visible change gets screenshots (browser, app or simulator) in the spec's Status.
- A check that fails for an environmental reason (missing dependencies, a tool that won't start) is part of the work: fix it. If it truly can't run, stop and ask the user.
Commit in logical steps with clear messages. Don't switch branches, merge, rebase or push unless the task asks.
When the handoff comes from Review, it lists the changes Review requested: address every point, rerun the checks that cover what you touched, and hand off to Review again with what you changed for each point.
Before you hand off, update the spec's Status so it states what is now true, with no history of how it got there.`;

const EXAMPLE_REVIEW_PROMPT = `You are an independent reviewer with none of the author's context. Judge the work against the spec's Goal and acceptance criteria (read it with \`t3_spec_read\`); the author's Status and handoff are claims to verify.
1. Inspect the changes: \`git status\`, and \`git log\` and \`git diff\` against the base branch, plus uncommitted changes.
2. Check how the changes fit the codebase, not just the diff: search for existing code that already does what they add, and for where the codebase keeps that kind of logic. Duplicated logic, or logic that bypasses the module built for it, must change: name the existing code to reuse.
3. Build on the author's verification instead of repeating it. Run a check yourself only when the handoff doesn't claim it, the code changed after it, or the diff shows a case it would miss, and then only the tests that cover the gap. A behaviour change with no test, a visible change with no screenshot, or verification that was skipped must be fixed.
4. Check the spec: Goal changes the user didn't ask for, or a Status that doesn't match the work or reads as a log, must be fixed.
5. Don't modify files, commit or fix anything yourself: Work makes the fixes.
If anything must change, call \`t3_pipeline_handoff\` with \`returnTo\` "Work" and a handoff whose first line states the outcome ("Changes requested: two bugs in the retry path."), then each problem concretely (file, line or behaviour, and the fix). Work addresses them and hands back to you; on that round, confirm every point was addressed and check the rest only for regressions.
When the work meets the Goal, finish with a summary whose first line states the outcome ("Approved, with two nits."). Style preferences alone aren't grounds for changes.`;

/**
 * Plan, Work and Review, after Harness: planning waits for approval, work moves straight to review,
 * and review sends requested changes back to work until it approves.
 */
export function examplePipeline(createId: () => string): Pipeline {
  return {
    id: createId(),
    name: "Plan, Work, Review",
    phases: [
      { ...newPhase(createId, "Plan"), prompt: EXAMPLE_PLAN_PROMPT },
      { ...newPhase(createId, "Work"), prompt: EXAMPLE_WORK_PROMPT, autoAdvance: true },
      { ...newPhase(createId, "Review"), prompt: EXAMPLE_REVIEW_PROMPT, autoAdvance: true },
    ],
  };
}
