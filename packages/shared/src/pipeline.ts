import type { ModelSelection, PipelinePhase, PipelineRun } from "@t3tools/contracts";

const PIPELINE_HANDOFF_TOOL = "t3_pipeline_handoff";

type RenderablePhase = Pick<PipelinePhase, "name" | "prompt" | "autoAdvance">;

/**
 * The message that starts a phase. The server sends it for later phases and the composer for the
 * first, so both read the same. `body` is the user's task or the previous phase's handoff.
 */
export function renderPipelinePhaseMessage(input: {
  readonly pipelineName: string;
  readonly phases: ReadonlyArray<RenderablePhase>;
  readonly phaseIndex: number;
  readonly body: string;
  readonly bodyKind: "task" | "handoff";
  /** Who wrote the handoff; the previous phase unless the pipeline began from a thread's context. */
  readonly handoffFrom?: string;
}): string {
  const phase = input.phases[input.phaseIndex];
  if (phase === undefined) throw new RangeError(`No phase ${input.phaseIndex}`);
  const next = input.phases[input.phaseIndex + 1];
  const body = input.body.trim();
  const sections = [
    `**Pipeline: ${input.pipelineName} · Phase ${input.phaseIndex + 1} of ${input.phases.length} · ${phase.name}**`,
  ];
  if (phase.prompt.trim().length > 0) sections.push(phase.prompt.trim());
  if (body.length > 0) {
    sections.push(
      input.bodyKind === "task"
        ? `## Task\n\n${body}`
        : `## Handoff from ${input.handoffFrom ?? input.phases[input.phaseIndex - 1]?.name ?? "the previous phase"}\n\n${body}`,
    );
  }
  sections.push(`---\n${phaseInstructions(phase, next, input.phases.slice(0, input.phaseIndex))}`);
  return sections.join("\n\n");
}

function phaseInstructions(
  phase: RenderablePhase,
  next: RenderablePhase | undefined,
  earlier: ReadonlyArray<RenderablePhase>,
): string {
  const sendBack =
    earlier.length === 0
      ? ""
      : ` If the work needs changes an earlier phase should make (${earlier.map((entry) => entry.name).join(", ")}), call \`${PIPELINE_HANDOFF_TOOL}\` with \`returnTo\` set to that phase's name and list every change it must make.`;
  if (next === undefined) {
    return `This is the last phase. When its work is done, call \`${PIPELINE_HANDOFF_TOOL}\` with a short summary of the outcome to finish the pipeline.${sendBack}`;
  }
  const lines = [
    `When this phase's work is done, call \`${PIPELINE_HANDOFF_TOOL}\` with everything the next phase, ${next.name}, needs: the goal, the decisions made, the files involved, and what is still open. ${next.name} starts in a fresh session and sees only its own prompt and your handoff. If you revise the work afterwards, call it again; the latest handoff wins.`,
  ];
  lines.push(
    phase.autoAdvance
      ? `${next.name} starts on its own once you hand off and end your turn.`
      : `After the handoff, end your turn: the user approves before ${next.name} starts.`,
  );
  return lines.join(" ") + sendBack;
}

/**
 * The model to send phase `phaseIndex` with: its own, or the run's base model when the phase the run
 * comes from overrode the thread's; undefined keeps whatever the thread has.
 */
export function pipelinePhaseModelSelection(
  run: Pick<PipelineRun, "phases" | "baseModelSelection">,
  phaseIndex: number,
  fromIndex: number = phaseIndex - 1,
): ModelSelection | undefined {
  const phase = run.phases[phaseIndex];
  if (phase?.modelSelection != null) return phase.modelSelection;
  const from = run.phases[fromIndex];
  return from?.modelSelection != null ? (run.baseModelSelection ?? undefined) : undefined;
}

/** The phase Continue moves to: the one a handoff sent the work back to, else the next one. */
export function pipelineNextPhaseIndex(run: Pick<PipelineRun, "phaseIndex" | "returnTo">): number {
  return run.returnTo ?? run.phaseIndex + 1;
}

/** What the composer sends for a freshly attached run: phase 1's message on phase 1's model. */
export function planPipelineFirstMessage(input: {
  readonly run: Pick<PipelineRun, "pipelineName" | "phases">;
  readonly text: string;
  readonly selectedModel: ModelSelection;
}): { readonly text: string; readonly modelSelection: ModelSelection } {
  return {
    text: renderPipelinePhaseMessage({
      pipelineName: input.run.pipelineName,
      phases: input.run.phases,
      phaseIndex: 0,
      body: input.text,
      bodyKind: "task",
    }),
    modelSelection: input.run.phases[0]?.modelSelection ?? input.selectedModel,
  };
}
