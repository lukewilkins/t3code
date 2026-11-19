import { EnvironmentId, type Pipeline } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { PipelineDetail } from "./PipelinesSettings";

const phase = (id: string, name: string) => ({
  id,
  name,
  prompt: `${name} prompt`,
  autoAdvance: false,
  modelSelection: null,
});

function Detail() {
  const [pipeline, setPipeline] = useState<Pipeline>({
    id: "p1",
    name: "Ship",
    phases: [phase("a", "Plan"), phase("b", "Work"), phase("c", "Review")],
  });
  return (
    <PipelineDetail
      environmentId={EnvironmentId.make("environment-1")}
      pipeline={pipeline}
      readOnly={false}
      onChange={(update) => setPipeline(update)}
      onDelete={() => undefined}
    />
  );
}

it("reorders phases from the keyboard and keeps them folded", async () => {
  await using screen = await render(<Detail />);
  await expect.element(screen.getByText("Plan prompt")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Phase 1 prompt" }).elements()).toHaveLength(0);

  await userEvent.click(screen.getByRole("button", { name: "Reorder Plan, position 1" }));
  await userEvent.keyboard(" ");
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard(" ");
  await expect
    .element(screen.getByRole("button", { name: "Reorder Plan, position 2" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Reorder Work, position 1" }))
    .toBeVisible();
});
