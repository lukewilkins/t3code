import { describe, expect, it } from "vite-plus/test";

import { armPipeline, disarmPipeline, readPipelineArm } from "./pipelineArms";

describe("readPipelineArm", () => {
  it("starts a new thread in its armed pipeline but never an existing thread", () => {
    armPipeline("env:thread-1", "review");
    expect(readPipelineArm("env:thread-1", { isNewThread: true })).toBe("review");
    expect(readPipelineArm("env:thread-1", { isNewThread: false })).toBeUndefined();
    disarmPipeline("env:thread-1");
  });

  it("keeps an arm made while a send was in flight", () => {
    armPipeline("env:thread-2", "plan");
    disarmPipeline("env:thread-2", "review");
    expect(readPipelineArm("env:thread-2", { isNewThread: true })).toBe("plan");
    disarmPipeline("env:thread-2");
    expect(readPipelineArm("env:thread-2", { isNewThread: true })).toBeUndefined();
  });
});
