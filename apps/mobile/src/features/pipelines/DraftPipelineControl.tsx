import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { ComposerInlineControl } from "../../components/ComposerToolbar";
import { Menu } from "../../components/ui/Menu";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useEnvironmentServerConfig } from "../../state/entities";
import { setPipelineSelection, usePipelineSelection } from "./pipelineSelection";

/** Picks the pipeline a new thread starts in, beside the checkout and branch controls. */
export function DraftPipelineControl(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly disabled: boolean;
}) {
  const gt = useGT();
  const threadKey = scopedThreadKey(props.environmentId, props.threadId);
  const pipelines = useEnvironmentServerConfig(props.environmentId)?.settings?.pipelines ?? [];
  const selectedId = usePipelineSelection(threadKey);
  if (pipelines.length === 0) return null;
  const selected = pipelines.find((pipeline) => pipeline.id === selectedId);
  const label = selected ? selected.name : gt("No pipeline");
  return (
    // Shrinks with the branch control, but capped lower so a long pipeline name never hides the branch.
    <View className="min-w-0 shrink">
      <Menu
        title={gt("Pipeline")}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Pipeline: {pipeline}", { pipeline: label })}
          className="min-w-0 shrink"
          disabled={props.disabled}
        >
          <ComposerInlineControl
            static
            disabled={props.disabled}
            icon="flowchart"
            label={label}
            iconOnly={selected === undefined}
            selected={selected !== undefined}
            maxWidth={150}
          />
        </Pressable>
      </Menu>
    </View>
  );
}
