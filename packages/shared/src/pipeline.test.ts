import { describe, expect, it } from "vite-plus/test";

import type { ModelSelection } from "@t3tools/contracts";

import { planPipelineFirstMessage, renderPipelinePhaseMessage } from "./pipeline.ts";

const phases = [
  { name: "Plan", prompt: "Plan it.", autoAdvance: false },
  { name: "Build", prompt: "Build it.", autoAdvance: true },
  { name: "Ship", prompt: "", autoAdvance: false },
];

const render = (phaseIndex: number, body = "", bodyKind: "task" | "handoff" = "task") =>
  renderPipelinePhaseMessage({ pipelineName: "Flow", phases, phaseIndex, body, bodyKind });

describe("renderPipelinePhaseMessage", () => {
  it.each([
    {
      name: "manual phase waits for the user before the next",
      text: render(0, "do x"),
      has: [
        "Phase 1 of 3 · Plan",
        "Plan it.",
        "## Task\n\ndo x",
        "the user approves before Build starts",
      ],
      lacks: ["starts on its own", "last phase", "Handoff from", "returnTo"],
    },
    {
      name: "auto phase says the next starts on its own",
      text: render(1, "plan notes", "handoff"),
      has: [
        "## Handoff from Plan\n\nplan notes",
        "Ship starts on its own",
        "earlier phase should make (Plan)",
      ],
      lacks: ["user approves", "## Task"],
    },
    {
      name: "last phase finishes and names no next phase",
      text: render(2, "build notes", "handoff"),
      has: ["This is the last phase", "to finish the pipeline", "`returnTo`", "(Plan, Build)"],
      lacks: ["starts on its own", "user approves", "everything the next phase"],
    },
    {
      name: "blank body and blank prompt omit their sections",
      text: render(2, "   "),
      has: ["Phase 3 of 3 · Ship"],
      lacks: ["## Task", "## Handoff"],
    },
  ])("$name", ({ text, has, lacks }) => {
    for (const fragment of has) expect(text).toContain(fragment);
    for (const fragment of lacks) expect(text).not.toContain(fragment);
  });

  it("omits an all-whitespace prompt and refuses an out-of-range phase", () => {
    expect(render(2)).not.toMatch(/\n\n\n/);
    expect(() => render(3)).toThrow(RangeError);
    expect(() => render(-1)).toThrow(RangeError);
  });
});

describe("planPipelineFirstMessage", () => {
  const selected = { instanceId: "codex", model: "gpt" } as ModelSelection;
  const override = { instanceId: "claude", model: "opus" } as ModelSelection;
  const plan = (firstModel: ModelSelection | null) =>
    planPipelineFirstMessage({
      run: {
        pipelineName: "Flow",
        phases: [
          {
            id: "a",
            name: "Plan",
            prompt: "Plan it.",
            autoAdvance: false,
            modelSelection: firstModel,
          },
          { id: "b", name: "Build", prompt: "", autoAdvance: false, modelSelection: override },
        ],
      },
      text: "fix the bug",
      selectedModel: selected,
    });

  it.each([
    { name: "keeps the selected model for a Default first phase", model: null, expected: selected },
    { name: "uses the first phase's own model", model: override, expected: override },
  ])("wraps the task in phase 1 and $name", ({ model, expected }) => {
    const result = plan(model);
    expect(result.text).toContain("Phase 1 of 2 · Plan");
    expect(result.text).toContain("## Task\n\nfix the bug");
    expect(result.modelSelection).toBe(expected);
  });
});
