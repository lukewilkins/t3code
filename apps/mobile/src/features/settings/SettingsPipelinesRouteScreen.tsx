import { AuthSettingsWriteScope } from "@t3tools/contracts";
import type { ModelSelection, Pipeline, PipelinePhase } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SymbolView } from "../../components/ui/AppSymbol";
import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentsWithScope } from "../../state/session";
import {
  examplePipeline,
  firstPipelineDraftIssue,
  MAX_PHASE_PROMPT_LENGTH,
  MAX_PIPELINE_NAME_LENGTH,
  movePhase,
  newPhase,
  trimPipelineNames,
} from "@t3tools/client-runtime/pipeline-draft";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { resolveMobileSettingsTargets } from "./settings-scoped-server";
import { useSettingsWriter } from "./useSettingsWriter";

export function SettingsPipelinesRouteScreen() {
  const gt = useGT();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const target = selectedTargets.length === 1 ? selectedTargets[0] : undefined;
  return (
    <SettingsScreen title={gt("Pipelines")} menus={[environmentMenu]}>
      {target ? (
        <PipelinesEditor key={target.environmentId} target={target} />
      ) : (
        <Text className="px-7 pt-4 text-base text-foreground-muted">
          {selectedTargets.length === 0
            ? gt("Use the filter above to select a connected environment.")
            : gt("Pipelines belong to one environment. Select a single environment above.")}
        </Text>
      )}
    </SettingsScreen>
  );
}

function PipelinesEditor(props: { readonly target: SettingsTarget }) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { target } = props;
  const saved = target.serverConfig.settings.pipelines;
  const [draft, setDraft] = useState<ReadonlyArray<Pipeline>>(saved);
  const [saving, setSaving] = useState(false);
  const writeSettings = useSettingsWriter();
  const writable = useEnvironmentsWithScope([target], AuthSettingsWriteScope).has(
    target.environmentId,
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const issue = firstPipelineDraftIssue(draft);

  const updatePipeline = (id: string, update: (pipeline: Pipeline) => Pipeline) =>
    setDraft((current) => current.map((entry) => (entry.id === id ? update(entry) : entry)));

  const save = async () => {
    const pipelines = trimPipelineNames(draft);
    setDraft(pipelines);
    setSaving(true);
    await writeSettings(resolveMobileSettingsTargets([target], null), [
      { environmentId: target.environmentId, patch: { pipelines } },
    ]).finally(() => setSaving(false));
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className="flex-1"
      contentContainerClassName="gap-6 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      <Text className="px-2 text-sm text-foreground-muted">
        {gt(
          "A pipeline runs ordered phases inside one thread. Each phase hands off to the next in a fresh session. Pick one in the composer before you send.",
        )}
      </Text>
      {draft.map((pipeline) => (
        <PipelineEditor
          key={pipeline.id}
          pipeline={pipeline}
          target={target}
          disabled={!writable || saving}
          onChange={(update) => updatePipeline(pipeline.id, update)}
          onDelete={() =>
            setDraft((current) => current.filter((entry) => entry.id !== pipeline.id))
          }
        />
      ))}
      <SettingsSection>
        <ListActionRow
          icon="plus"
          label={gt("Add pipeline")}
          disabled={!writable || saving}
          onPress={() =>
            setDraft((current) => [
              ...current,
              {
                id: uuidv4(),
                name: gt("New pipeline"),
                phases: [newPhase(uuidv4, gt("Plan")), newPhase(uuidv4, gt("Build"))],
              },
            ])
          }
        />
        <ListActionRow
          icon="star.fill"
          label={gt("Add example: Plan, Work, Review")}
          disabled={!writable || saving}
          onPress={() => setDraft((current) => [...current, examplePipeline(uuidv4)])}
        />
      </SettingsSection>
      {issue !== null ? (
        <Text className="px-2 text-sm text-danger-foreground">
          {issue.kind === "pipeline-name"
            ? gt("Give every pipeline a name.")
            : issue.kind === "no-phases"
              ? gt("Every pipeline needs at least one phase.")
              : gt("Give every phase a name.")}
        </Text>
      ) : null}
      <Button
        tone="primary"
        label={gt("Save pipelines")}
        loading={saving}
        disabled={!dirty || issue !== null || !writable}
        onPress={() => void save()}
      />
    </ScrollView>
  );
}

function PipelineEditor(props: {
  readonly pipeline: Pipeline;
  readonly target: SettingsTarget;
  readonly disabled: boolean;
  readonly onChange: (update: (pipeline: Pipeline) => Pipeline) => void;
  readonly onDelete: () => void;
}) {
  const gt = useGT();
  const { pipeline, disabled, onChange } = props;
  const updatePhase = (id: string, update: (phase: PipelinePhase) => PipelinePhase) =>
    onChange((current) => ({
      ...current,
      phases: current.phases.map((phase) => (phase.id === id ? update(phase) : phase)),
    }));
  return (
    <SettingsSection
      title={gt("Pipeline")}
      trailing={
        <Button
          size="compact"
          tone="text"
          label={gt("Delete pipeline")}
          disabled={disabled}
          onPress={props.onDelete}
        />
      }
    >
      <View className="gap-1 px-4 py-3">
        <Text className="text-sm text-foreground-muted">{gt("Name")}</Text>
        <AppTextInput
          accessibilityLabel={gt("Pipeline name")}
          value={pipeline.name}
          maxLength={MAX_PIPELINE_NAME_LENGTH}
          editable={!disabled}
          onChangeText={(name) => onChange((current) => ({ ...current, name }))}
          className="min-h-10 rounded-xl text-base text-foreground"
        />
      </View>
      {pipeline.phases.map((phase, index) => (
        <PhaseEditor
          key={phase.id}
          phase={phase}
          index={index}
          count={pipeline.phases.length}
          target={props.target}
          disabled={disabled}
          onChange={(update) => updatePhase(phase.id, update)}
          onMove={(delta) =>
            onChange((current) => ({
              ...current,
              phases: movePhase(current, phase.id, delta).phases,
            }))
          }
          onDelete={() =>
            onChange((current) => ({
              ...current,
              phases: current.phases.filter((entry) => entry.id !== phase.id),
            }))
          }
        />
      ))}
      <ListActionRow
        icon="plus"
        label={gt("Add phase")}
        disabled={disabled}
        onPress={() =>
          onChange((current) => ({
            ...current,
            phases: [...current.phases, newPhase(uuidv4, gt("New phase"))],
          }))
        }
      />
    </SettingsSection>
  );
}

function PhaseEditor(props: {
  readonly phase: PipelinePhase;
  readonly index: number;
  readonly count: number;
  readonly target: SettingsTarget;
  readonly disabled: boolean;
  readonly onChange: (update: (phase: PipelinePhase) => PipelinePhase) => void;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onDelete: () => void;
}) {
  const gt = useGT();
  const { phase, index, disabled, onChange } = props;
  return (
    <View className="border-t border-border-subtle">
      <View className="flex-row items-center gap-2 px-4 pt-3">
        <Text className="flex-1 text-sm text-foreground-muted">
          {gt("Phase {number}", { number: index + 1 })}
        </Text>
        <Menu
          accessibilityLabel={gt("Phase actions")}
          actions={[
            { id: "up", title: gt("Move up"), attributes: { disabled: disabled || index === 0 } },
            {
              id: "down",
              title: gt("Move down"),
              attributes: { disabled: disabled || index === props.count - 1 },
            },
            {
              id: "delete",
              title: gt("Delete phase"),
              attributes: { destructive: true, disabled },
            },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (nativeEvent.event === "up") props.onMove(-1);
            else if (nativeEvent.event === "down") props.onMove(1);
            else props.onDelete();
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Phase actions")}
            hitSlop={8}
          >
            <SymbolView name="ellipsis" size={20} tintColorClassName="accent-icon-muted" />
          </Pressable>
        </Menu>
      </View>
      <View className="gap-3 px-4 py-3">
        <AppTextInput
          accessibilityLabel={gt("Phase name")}
          value={phase.name}
          maxLength={MAX_PIPELINE_NAME_LENGTH}
          editable={!disabled}
          onChangeText={(name) => onChange((current) => ({ ...current, name }))}
          className="min-h-10 rounded-xl text-base font-t3-medium text-foreground"
        />
        <AppTextInput
          accessibilityLabel={gt("Phase prompt")}
          value={phase.prompt}
          maxLength={MAX_PHASE_PROMPT_LENGTH}
          editable={!disabled}
          multiline
          textAlignVertical="top"
          placeholder={gt("What should the agent do in this phase?")}
          onChangeText={(prompt) => onChange((current) => ({ ...current, prompt }))}
          className="max-h-60 min-h-24 rounded-xl text-base text-foreground"
        />
      </View>
      <ListToggleRow
        label={gt("Advance automatically")}
        description={gt("Start the next phase without waiting for your approval.")}
        value={phase.autoAdvance}
        disabled={disabled}
        onValueChange={(autoAdvance) => onChange((current) => ({ ...current, autoAdvance }))}
      />
      <PhaseModelRow
        target={props.target}
        selection={phase.modelSelection}
        disabled={disabled}
        onSelect={(modelSelection) => onChange((current) => ({ ...current, modelSelection }))}
      />
    </View>
  );
}

function PhaseModelRow(props: {
  readonly target: SettingsTarget;
  readonly selection: ModelSelection | null;
  readonly disabled: boolean;
  readonly onSelect: (selection: ModelSelection | null) => void;
}) {
  const gt = useGT();
  const config = useEnvironmentServerConfig(props.target.environmentId);
  const options = buildModelOptions(config, props.selection, undefined, null);
  const groups = groupByProvider(options);
  const current = props.selection
    ? (options.find(
        (option) =>
          option.selection.instanceId === props.selection?.instanceId &&
          option.selection.model === props.selection.model,
      )?.label ?? props.selection.model)
    : gt("Default (thread's model)");
  return (
    <Menu
      accessibilityLabel={gt("Model")}
      actions={[
        {
          id: "default",
          title: gt("Default (thread's model)"),
          state: props.selection === null ? ("on" as const) : ("off" as const),
        },
        ...groups.map((group) => ({
          id: `group:${group.providerKey}`,
          title: group.providerLabel,
          subactions: group.models.map((option) => ({
            id: `model:${option.key}`,
            title: option.label,
            state:
              props.selection?.instanceId === option.selection.instanceId &&
              props.selection.model === option.selection.model
                ? ("on" as const)
                : ("off" as const),
          })),
        })),
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "default") return props.onSelect(null);
        const key = nativeEvent.event.slice("model:".length);
        const option = options.find((entry) => entry.key === key);
        if (option) props.onSelect(option.selection);
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt("Model, {value}", { value: current })}
        disabled={props.disabled}
        className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
      >
        <Text textRole="body" className="text-foreground">
          {gt("Model")}
        </Text>
        <Text
          textRole="body"
          className="min-w-0 flex-1 text-right text-foreground-muted"
          numberOfLines={1}
        >
          {current}
        </Text>
        <SymbolView
          name="chevron.down"
          size={14}
          tintColorClassName="accent-chevron"
          type="monochrome"
        />
      </Pressable>
    </Menu>
  );
}
