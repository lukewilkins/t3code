import { type ScopedThreadRef } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { WorkflowIcon } from "lucide-react";
import { useState } from "react";

import { pipelineEnvironment } from "../../state/pipeline";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import {
  derivePipelineBanner,
  type PipelineBannerStatus,
} from "@t3tools/client-runtime/pipeline-banner";
import { disarmPipeline, useArmedPipelineId } from "./pipelineArms";
import { usePipelineWritePermission, useThreadPipeline } from "./useThreadPipeline";

const PHASE_STATUS = {
  running: msg("Working"),
  ready: msg("Handed off"),
  awaiting_approval: msg("Waiting for your approval"),
} satisfies Record<PipelineBannerStatus, unknown>;

/** Composer banners for an armed pipeline and for a thread's running one. */
export function usePipelineBannerItems(
  threadRef: ScopedThreadRef,
  subscribe: boolean,
): ComposerBannerStackItem[] {
  const gt = useGT();
  const messages = useMessages();
  const threadKey = scopedThreadKey(threadRef);
  const { pipelines, run, activeRun } = useThreadPipeline(threadRef, subscribe);
  const armedId = useArmedPipelineId(threadKey);
  const canWrite = usePipelineWritePermission(threadRef);
  const [busy, setBusy] = useState(false);
  const advance = useAtomCommand(pipelineEnvironment.advance);
  const cancel = useAtomCommand(pipelineEnvironment.cancel);

  const banner = derivePipelineBanner(activeRun);
  if (banner !== null && run !== null) {
    const act = async (action: "advance" | "cancel") => {
      if (busy) return;
      setBusy(true);
      const sent =
        action === "advance"
          ? advance({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, phaseIndex: run.phaseIndex },
            })
          : cancel({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId },
            });
      await sent.finally(() => setBusy(false));
    };
    const status = PHASE_STATUS[banner.status];
    return [
      {
        id: "pipeline-run",
        variant: "info",
        icon: <WorkflowIcon />,
        title: gt("{pipeline} · Phase {number} of {count} · {phase}", {
          pipeline: banner.pipelineName,
          number: banner.phaseNumber,
          count: banner.phaseCount,
          phase: banner.phaseName,
        }),
        description: messages(status),
        actions: (
          <>
            <Button
              size="xs"
              variant={banner.continuePrimary ? "default" : "outline"}
              disabled={!canWrite || busy}
              onClick={() => void act("advance")}
            >
              {banner.nextPhaseName === null
                ? gt("Finish pipeline")
                : gt("Continue to {phase}", { phase: banner.nextPhaseName })}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!canWrite || busy}
              onClick={() => void act("cancel")}
            >
              {gt("Cancel")}
            </Button>
          </>
        ),
      },
    ];
  }

  const armed = armedId === undefined ? undefined : pipelines.find((entry) => entry.id === armedId);
  if (armed === undefined || activeRun !== null) return [];
  return [
    {
      id: "pipeline-armed",
      variant: "info",
      icon: <WorkflowIcon />,
      title: gt("Your next message starts the {pipeline} pipeline", { pipeline: armed.name }),
      description: gt(
        "The first phase runs with your message; later phases follow from its handoff.",
      ),
      dismissLabel: gt("Don't start a pipeline"),
      onDismiss: () => disarmPipeline(threadKey),
    },
  ];
}
