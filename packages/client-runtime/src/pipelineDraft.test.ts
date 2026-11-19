import { Pipeline } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  examplePipeline,
  firstPipelineDraftIssue,
  movePhase,
  newPhase,
  newPipeline,
  normalizeName,
  removePhase,
  trimPipelineNames,
} from "./pipelineDraft.ts";

const phase = (id: string, name: string) => newPhase(() => id, name);

const pipeline = (overrides: Partial<Pipeline> = {}): Pipeline => ({
  id: "p1",
  name: "Ship",
  phases: [phase("a", "Plan"), phase("b", "Build")],
  ...overrides,
});

const threePhases = () => pipeline({ phases: [phase("a", "A"), phase("b", "B"), phase("c", "C")] });
const names = (value: Pipeline) => value.phases.map((entry) => entry.name);

describe("pipeline draft edits", () => {
  it("builds a pipeline whose ids come from the factory", () => {
    let next = 0;
    const created = newPipeline(() => `id-${next++}`, "P", "A");
    expect(created).toMatchObject({ id: "id-0", name: "P" });
    expect(created.phases).toEqual([
      { id: "id-1", name: "A", prompt: "", autoAdvance: false, modelSelection: null },
    ]);
  });

  it("moves a phase by id and stops at the ends", () => {
    const three = threePhases();
    expect(names(movePhase(three, "b", 1))).toEqual(["A", "C", "B"]);
    expect(names(movePhase(three, "b", -1))).toEqual(["B", "A", "C"]);
    expect(movePhase(three, "a", -1)).toBe(three);
    expect(movePhase(three, "c", 1)).toBe(three);
    expect(movePhase(three, "missing", 1)).toBe(three);
  });

  it("keeps the last phase", () => {
    const single = pipeline({ phases: [phase("a", "A")] });
    expect(removePhase(single, "a")).toBe(single);
    expect(names(removePhase(threePhases(), "b"))).toEqual(["A", "C"]);
  });

  it("rejects blank names", () => {
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName(" Plan ")).toBe("Plan");
  });
});

describe("firstPipelineDraftIssue", () => {
  it("accepts a named pipeline with named phases", () => {
    expect(firstPipelineDraftIssue([pipeline()])).toBeNull();
  });

  it("flags blank names and empty pipelines in list order", () => {
    expect(firstPipelineDraftIssue([pipeline({ name: "  " })])).toEqual({
      kind: "pipeline-name",
      pipelineId: "p1",
    });
    expect(firstPipelineDraftIssue([pipeline({ phases: [] })])).toEqual({
      kind: "no-phases",
      pipelineId: "p1",
    });
    expect(
      firstPipelineDraftIssue([pipeline({ phases: [phase("a", "Plan"), phase("b", " ")] })]),
    ).toEqual({ kind: "phase-name", pipelineId: "p1", phaseId: "b" });
  });
});

describe("trimPipelineNames", () => {
  it("trims pipeline and phase names but leaves prompts alone", () => {
    const [trimmed] = trimPipelineNames([
      pipeline({
        name: " Ship ",
        phases: [{ ...phase("a", " Plan "), prompt: "  keep  " }],
      }),
    ]);
    expect(trimmed?.name).toBe("Ship");
    expect(trimmed?.phases[0]).toMatchObject({ name: "Plan", prompt: "  keep  " });
  });
});

const decodePipeline = Schema.decodeSync(Pipeline);

describe("examplePipeline", () => {
  it("is a pipeline the settings patch accepts, with an id per entry", () => {
    let next = 0;
    const example = examplePipeline(() => `id-${next++}`);
    expect(() => decodePipeline(example)).not.toThrow();
    const ids = [example.id, ...example.phases.map((phase) => phase.id)];
    expect(new Set(ids).size).toBe(ids.length);
    // Planning waits for approval; work moves straight to review, and review's returns to work run on their own.
    expect(example.phases.map((phase) => [phase.name, phase.autoAdvance])).toEqual([
      ["Plan", false],
      ["Work", true],
      ["Review", true],
    ]);
  });
});
