import {
  type ModelSelection,
  type Pipeline,
  type PipelinePhase,
  type PipelineRun,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decideAfterRunCompleted, findPipeline, planAdvance, planStart } from "./pipelineLogic.ts";

const model = (name: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model: name,
});

const phase = (id: string, overrides: Partial<PipelinePhase> = {}): PipelinePhase => ({
  id,
  name: id,
  prompt: "",
  autoAdvance: false,
  modelSelection: null,
  ...overrides,
});

const makeRun = (overrides: Partial<PipelineRun> = {}): PipelineRun => ({
  threadId: ThreadId.make("thread-1"),
  runKey: "rk",
  pipelineId: "pl",
  pipelineName: "Flow",
  phases: [phase("Plan"), phase("Build"), phase("Ship")],
  phaseIndex: 0,
  step: 0,
  status: "ready",
  handoff: "old",
  returnTo: null,
  returnCount: 0,
  baseModelSelection: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("decideAfterRunCompleted", () => {
  const auto = [phase("Plan", { autoAdvance: true }), phase("Build")];
  const reviewLoop = [phase("Work", { autoAdvance: true }), phase("Review", { autoAdvance: true })];
  it.each([
    { name: "no run", run: null, busy: false, expected: "none" },
    ...(["running", "awaiting_approval", "completed", "cancelled"] as const).map((status) => ({
      name: status,
      run: makeRun({ status }),
      busy: false,
      expected: "none",
    })),
    {
      name: "ready with outstanding work",
      run: makeRun({ phases: auto }),
      busy: true,
      expected: "wait",
    },
    {
      name: "last phase completes even with autoAdvance",
      run: makeRun({ phases: [phase("A"), phase("B", { autoAdvance: true })], phaseIndex: 1 }),
      busy: false,
      expected: "complete",
    },
    {
      name: "auto phase advances",
      run: makeRun({ phases: auto }),
      busy: false,
      expected: "advance",
    },
    {
      name: "manual phase awaits approval",
      run: makeRun({ phases: [phase("Plan"), phase("Build")] }),
      busy: false,
      expected: "await_approval",
    },
    {
      name: "last phase sending work back goes back instead of completing",
      run: makeRun({ phases: reviewLoop, phaseIndex: 1, returnTo: 0 }),
      busy: false,
      expected: "advance",
    },
    {
      name: "a return waits for approval once the automatic returns run out",
      run: makeRun({ phases: reviewLoop, phaseIndex: 1, returnTo: 0, returnCount: 3 }),
      busy: false,
      expected: "await_approval",
    },
    {
      name: "a manual phase's return waits for approval",
      run: makeRun({ phases: [phase("Work"), phase("Review")], phaseIndex: 1, returnTo: 0 }),
      busy: false,
      expected: "await_approval",
    },
  ])("$name -> $expected", ({ run, busy, expected }) => {
    expect(decideAfterRunCompleted(run, busy)).toBe(expected);
  });
});

describe("planAdvance", () => {
  it("returns null past the last phase", () => {
    expect(planAdvance(makeRun({ phaseIndex: 2 }), "h", "now", true)).toBeNull();
  });

  it("moves to the next phase with a fresh-context send carrying the handoff", () => {
    const plan = planAdvance(makeRun(), "the notes", "2026-02-02T00:00:00.000Z", true);
    expect(plan?.run).toMatchObject({
      phaseIndex: 1,
      status: "running",
      handoff: null,
      updatedAt: "2026-02-02T00:00:00.000Z",
    });
    expect(plan?.send).toMatchObject({ key: "pipeline:rk:1", freshContext: true });
    expect(plan?.send.text).toContain("## Handoff from Plan\n\nthe notes");
  });

  it("sends the work back to an earlier phase under a new message id and counts the return", () => {
    const run = makeRun({
      phases: [phase("Work"), phase("Review", { modelSelection: model("fable") })],
      phaseIndex: 1,
      step: 1,
      returnTo: 0,
      baseModelSelection: model("opus"),
    });
    const plan = planAdvance(run, "fix the retry path", "now", true);
    expect(plan?.run).toMatchObject({ phaseIndex: 0, step: 2, returnTo: null, returnCount: 1 });
    // Work was first sent at step 1, so revisiting it must not reuse that id.
    expect(plan?.send.key).toBe("pipeline:rk:2");
    expect(plan?.send.text).toContain("## Handoff from Review\n\nfix the retry path");
    // Review ran on its own model, so Work goes back to the thread's.
    expect(plan?.send.modelSelection).toEqual(model("opus"));
  });

  const own = model("own");
  const base = model("base");
  it.each([
    {
      name: "next phase's own model wins",
      phases: [phase("A", { modelSelection: model("prev") }), phase("B", { modelSelection: own })],
      base,
      expected: own,
    },
    {
      name: "previous overrode, so return to base",
      phases: [phase("A", { modelSelection: model("prev") }), phase("B")],
      base,
      expected: base,
    },
    {
      name: "previous overrode but base is null",
      phases: [phase("A", { modelSelection: model("prev") }), phase("B")],
      base: null,
      expected: undefined,
    },
    {
      name: "neither overrides, base is ignored",
      phases: [phase("A"), phase("B")],
      base,
      expected: undefined,
    },
  ])("model selection: $name", ({ phases, base: baseModelSelection, expected }) => {
    const plan = planAdvance(makeRun({ phases, baseModelSelection }), "h", "now", true);
    expect(plan?.send.modelSelection).toEqual(expected);
  });
});

describe("planStart", () => {
  it.each([
    { handoff: undefined, fresh: false },
    { handoff: "   ", fresh: false },
    { handoff: " context ", fresh: true },
  ])("handoff $handoff -> freshContext $fresh", ({ handoff, fresh }) => {
    const send = planStart(makeRun(), handoff);
    expect(send.freshContext).toBe(fresh);
    expect(send.key).toBe("pipeline:rk:0");
    if (fresh) expect(send.text).toContain("## Handoff from the conversation so far\n\ncontext");
    else expect(send.text).not.toContain("## Handoff");
  });

  it("uses the first phase's own model", () => {
    const own = model("own");
    const run = makeRun({ phases: [phase("A", { modelSelection: own })] });
    expect(planStart(run, undefined).modelSelection).toEqual(own);
  });
});

describe("findPipeline", () => {
  const pipelines: ReadonlyArray<Pipeline> = [
    { id: "x", name: "Review", phases: [phase("p")] },
    { id: "review", name: "Other", phases: [phase("p")] },
  ];
  it.each([
    { ref: "review", expected: "review", note: "id beats a name match" },
    { ref: "  review  ", expected: "review", note: "trimmed id still beats a same-named pipeline" },
    { ref: "REVIEW", expected: "x", note: "ids are case-sensitive, so this falls to the name" },
    { ref: "Other", expected: "review", note: "name match" },
    { ref: " oTHer ", expected: "review", note: "name is case-insensitive and trimmed" },
    { ref: "missing", expected: undefined, note: "absent" },
  ])("$note", ({ ref, expected }) => {
    expect(findPipeline(pipelines, ref)?.id).toBe(expected);
  });
});
