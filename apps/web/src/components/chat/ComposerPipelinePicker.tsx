import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { WorkflowIcon } from "lucide-react";

import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useComposerMenuProps } from "./composerEventScope";
import { armPipeline, disarmPipeline, useArmedPipelineId } from "./pipelineArms";
import { useThreadPipeline } from "./useThreadPipeline";

/** Arms a pipeline for a new thread's first message; hidden when there is none to pick. */
export function ComposerPipelinePicker({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const threadKey = scopedThreadKey(threadRef);
  const { pipelines } = useThreadPipeline(threadRef, false);
  const armedId = useArmedPipelineId(threadKey);
  const composerMenuProps = useComposerMenuProps();
  if (pipelines.length === 0) return null;
  const armed = armedId !== undefined && pipelines.some((entry) => entry.id === armedId);
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant={armed ? "secondary" : "ghost"}
                  size="icon-sm"
                  aria-label={gt("Run a pipeline")}
                />
              }
            />
          }
        >
          <WorkflowIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup side="top">{gt("Run a pipeline")}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" side="top" {...composerMenuProps}>
        <MenuRadioGroup
          value={armed ? armedId : ""}
          onValueChange={(value) => {
            if (value === "") disarmPipeline(threadKey);
            else armPipeline(threadKey, value);
          }}
        >
          {pipelines.map((pipeline) => (
            <MenuRadioItem key={pipeline.id} value={pipeline.id} closeOnClick>
              {pipeline.name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        {armed ? (
          <>
            <MenuSeparator />
            <MenuItem onClick={() => disarmPipeline(threadKey)}>{gt("No pipeline")}</MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
