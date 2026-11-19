import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Menu } from "../../components/ui/Menu";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useEnvironmentServerConfig } from "../../state/entities";
import { pipelineEnvironment } from "../../state/pipeline";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  derivePipelineBanner,
  type PipelineBannerState,
} from "@t3tools/client-runtime/pipeline-banner";
import { setPipelineSelection, usePipelineSelection } from "./pipelineSelection";
import { usePipelineCancel } from "./usePipelineCommands";

/**
 * Sits in the composer: the active run's banner, or a picker for the next send's pipeline when the
 * environment has any. Subscribes to the run only while the thread screen is mounted.
 */
export function ComposerPipelineChrome(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly disabled: boolean;
}) {
  const { environmentId, threadId } = props;
  const live = useEnvironmentQuery(
    pipelineEnvironment.live({ environmentId, input: { threadId } }),
  );
  const banner = derivePipelineBanner(live.data?.run ?? null);
  if (banner !== null) {
    return (
      <PipelineBanner
        environmentId={environmentId}
        threadId={threadId}
        banner={banner}
        disabled={props.disabled}
      />
    );
  }
  return <PipelinePicker environmentId={environmentId} threadId={threadId} />;
}

function PipelinePicker(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const threadKey = scopedThreadKey(props.environmentId, props.threadId);
  const pipelines = useEnvironmentServerConfig(props.environmentId)?.settings?.pipelines ?? [];
  const selectedId = usePipelineSelection(threadKey);
  if (pipelines.length === 0) return null;
  const selected = pipelines.find((pipeline) => pipeline.id === selectedId);
  return (
    <View className="flex-row pb-1.5">
      <Menu
        accessibilityLabel={gt("Pipeline")}
        actions={[
          {
            id: "none",
            title: gt("No pipeline"),
            state: selected === undefined ? ("on" as const) : ("off" as const),
          },
          ...pipelines.map((pipeline) => ({
            id: `pipeline:${pipeline.id}`,
            title: pipeline.name,
            state: pipeline.id === selected?.id ? ("on" as const) : ("off" as const),
          })),
        ]}
        onPressAction={({ nativeEvent }) =>
          setPipelineSelection(
            threadKey,
            nativeEvent.event === "none" ? null : nativeEvent.event.slice("pipeline:".length),
          )
        }
      >
        <Chip
          label={selected ? selected.name : gt("Pipeline")}
          icon="arrow.triangle.branch"
          trailingIcon="chevron.down"
          selected={selected !== undefined}
        />
      </Menu>
    </View>
  );
}

const STATUS_LABELS = {
  running: (gt: ReturnType<typeof useGT>) => gt("Working"),
  ready: (gt: ReturnType<typeof useGT>) => gt("Handed off"),
  awaiting_approval: (gt: ReturnType<typeof useGT>) => gt("Waiting for your approval"),
} satisfies Record<PipelineBannerState["status"], (gt: ReturnType<typeof useGT>) => string>;

function PipelineBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly banner: PipelineBannerState;
  readonly disabled: boolean;
}) {
  const gt = useGT();
  const { banner } = props;
  const [pending, setPending] = useState(false);
  const advance = useAtomCommand(pipelineEnvironment.advance, {
    label: "pipeline advance",
    reportFailure: true,
  });
  const cancel = usePipelineCancel({ reportFailure: true });
  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    await action().finally(() => setPending(false));
  };
  return (
    <View className="mb-1.5 gap-2 rounded-2xl bg-subtle px-3 py-2.5">
      <View className="gap-0.5">
        <Text textRole="footnote" className="font-t3-medium text-foreground" numberOfLines={2}>
          {gt("{pipeline} · Phase {number} of {count} · {phase}", {
            pipeline: banner.pipelineName,
            number: banner.phaseNumber,
            count: banner.phaseCount,
            phase: banner.phaseName,
          })}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          {STATUS_LABELS[banner.status](gt)}
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button
          size="compact"
          tone={banner.continuePrimary ? "primary" : "secondary"}
          label={
            banner.nextPhaseName === null
              ? gt("Finish pipeline")
              : gt("Continue to {phase}", { phase: banner.nextPhaseName })
          }
          disabled={pending || props.disabled}
          onPress={() =>
            void run(() =>
              advance({
                environmentId: props.environmentId,
                input: { threadId: props.threadId, phaseIndex: banner.phaseNumber - 1 },
              }),
            )
          }
        />
        <Button
          size="compact"
          tone="text"
          label={gt("Cancel")}
          disabled={pending || props.disabled}
          onPress={() =>
            void run(() => cancel({ environmentId: props.environmentId, threadId: props.threadId }))
          }
        />
      </View>
    </View>
  );
}
