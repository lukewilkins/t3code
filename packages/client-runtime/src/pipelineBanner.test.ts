import type { PipelineRun } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { derivePipelineBanner } from "./pipelineBanner.ts";

const phase = (name: string) => ({
  id: name,
  name,
  prompt: "",
  autoAdvance: false,
  modelSelection: null,
});

const run = (overrides: Partial<PipelineRun>) =>
  ({
    pipelineName: "Ship it",
    phases: [phase("Plan"), phase("Build"), phase("Review")],
    phaseIndex: 0,
    status: "running",
    ...overrides,
  }) as PipelineRun;

describe("derivePipelineBanner", () => {
  it("shows nothing without a run or once it is over", () => {
    expect(derivePipelineBanner(null)).toBeNull();
    expect(derivePipelineBanner(run({ status: "completed" }))).toBeNull();
    expect(derivePipelineBanner(run({ status: "cancelled" }))).toBeNull();
  });

  it("names the phase and the one after it", () => {
    expect(derivePipelineBanner(run({ phaseIndex: 1 }))).toMatchObject({
      phaseNumber: 2,
      phaseCount: 3,
      phaseName: "Build",
      nextPhaseName: "Review",
    });
  });

  it("has no next phase on the last one, unless a handoff sent the work back", () => {
    expect(derivePipelineBanner(run({ phaseIndex: 2 }))?.nextPhaseName).toBeNull();
    expect(derivePipelineBanner(run({ phaseIndex: 2, returnTo: 1 }))?.nextPhaseName).toBe("Build");
  });

  it("makes Continue primary only after the phase handed off", () => {
    expect(derivePipelineBanner(run({ status: "running" }))?.continuePrimary).toBe(false);
    expect(derivePipelineBanner(run({ status: "ready" }))?.continuePrimary).toBe(true);
    expect(derivePipelineBanner(run({ status: "awaiting_approval" }))?.continuePrimary).toBe(true);
  });

  it("returns null when the phase index points past the phases", () => {
    expect(derivePipelineBanner(run({ phaseIndex: 9 }))).toBeNull();
  });
});
