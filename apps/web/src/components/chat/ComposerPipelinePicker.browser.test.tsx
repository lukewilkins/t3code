import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { ComposerPipelinePicker } from "./ComposerPipelinePicker";

vi.mock("./useThreadPipeline", () => ({
  useThreadPipeline: () => ({
    pipelines: [{ id: "review", name: "Plan, Work, Review", phases: [] }],
    run: null,
    activeRun: null,
  }),
}));

it("opens the pipeline menu on a pointer click and closes it on a pick", async () => {
  const threadRef = {
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make("thread-1"),
  };
  await using _screen = await render(<ComposerPipelinePicker threadRef={threadRef} />, {
    router: false, // the picker reads no route
  });
  await userEvent.click(page.getByRole("button", { name: "Run a pipeline" }));
  const item = page.getByRole("menuitemradio", { name: "Plan, Work, Review" });
  await expect.element(item).toBeVisible();
  await userEvent.click(item);
  await expect.element(item).not.toBeInTheDocument();
});
