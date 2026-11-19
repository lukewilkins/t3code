import { useGT } from "gt-react";

import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { ThreadView } from "./threadView.logic";

export function ThreadViewSwitch({
  value,
  onValueChange,
}: {
  readonly value: ThreadView;
  readonly onValueChange: (view: ThreadView) => void;
}) {
  const gt = useGT();
  return (
    <ToggleGroup
      className="shrink-0"
      variant="segmented"
      aria-label={gt("Thread view")}
      value={[value]}
      onValueChange={(next) => {
        // Pressing the shown option clears the group; keep the view.
        const view = next[0];
        if (view === "thread" || view === "spec") onValueChange(view);
      }}
    >
      <Toggle value="thread">{gt("Thread")}</Toggle>
      <Toggle value="spec">{gt("Spec")}</Toggle>
    </ToggleGroup>
  );
}
