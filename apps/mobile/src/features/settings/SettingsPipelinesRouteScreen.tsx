import { AuthSettingsWriteScope } from "@t3tools/contracts";
import type { EnvironmentId, ModelSelection, Pipeline, PipelinePhase } from "@t3tools/contracts";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useGT } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import Reanimated, { ReduceMotion, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { ListToggleRow } from "../../components/ui/ListToggleRow";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SymbolView } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import { buildModelOptions, groupByProvider } from "../../lib/modelOptions";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentsWithScope } from "../../state/session";
import {
  examplePipeline,
  firstPipelineDraftIssue,
  MAX_PHASE_PROMPT_LENGTH,
  MAX_PIPELINE_NAME_LENGTH,
  newPhase,
  newPipeline,
  removePhase,
  replacePhase,
  reorderPhase,
  trimPipelineNames,
} from "@t3tools/client-runtime/pipeline-draft";
import { SettingsDragHandle } from "./components/SettingsDragHandle";
import { useSettingsEnvironmentMenu } from "./components/SettingsEnvironmentFilterHeader";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { type SettingsRowDrag, useSettingsDragOrder } from "./components/settingsDragOrder";
import { useSettingsEnvironmentFilter, type SettingsTarget } from "./settings-environment-filter";
import { resolveMobileSettingsTargets } from "./settings-scoped-server";
import { useSettingsWriter } from "./useSettingsWriter";

/** The environment's pipelines; each row opens that pipeline's editor. */
export function SettingsPipelinesRouteScreen() {
  const gt = useGT();
  const environmentMenu = useSettingsEnvironmentMenu();
  const { selectedTargets } = useSettingsEnvironmentFilter();
  const target = selectedTargets.length === 1 ? selectedTargets[0] : undefined;
  return (
    <SettingsScreen title={gt("Pipelines")} menus={[environmentMenu]}>
      {target ? (
        <PipelinesList key={target.environmentId} target={target} />
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

function usePipelinesWriter(target: SettingsTarget) {
  const writeSettings = useSettingsWriter();
  return (pipelines: ReadonlyArray<Pipeline>) =>
    writeSettings(resolveMobileSettingsTargets([target], null), [
      { environmentId: target.environmentId, patch: { pipelines: [...pipelines] } },
    ]);
}

function PipelinesList(props: { readonly target: SettingsTarget }) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { target } = props;
  const pipelines = target.serverConfig.settings.pipelines;
  const writable = useEnvironmentsWithScope([target], AuthSettingsWriteScope).has(
    target.environmentId,
  );
  const writePipelines = usePipelinesWriter(target);
  const [adding, setAdding] = useState(false);
  const open = (pipelineId: string) =>
    navigation.navigate("SettingsPipelineEdit", {
      environmentId: target.environmentId,
      pipelineId,
    });
  const add = async (pipeline: Pipeline) => {
    setAdding(true);
    const saved = await writePipelines([...pipelines, pipeline]).finally(() => setAdding(false));
    if (saved) open(pipeline.id);
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      className="flex-1"
      contentContainerClassName="gap-6 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      <Text className="px-2 text-sm text-foreground-muted">
        {gt(
          "A pipeline runs ordered phases inside one thread. Each phase hands off to the next in a fresh session. Pick one in the composer before you send.",
        )}
      </Text>
      {pipelines.length > 0 ? (
        <SettingsSection>
          {pipelines.map((pipeline) => (
            <SettingsRow
              key={pipeline.id}
              icon="arrow.triangle.branch"
              label={pipeline.name}
              value={pipeline.phases.map((phase) => phase.name).join(" → ")}
              valuePosition="below"
              onPress={() => open(pipeline.id)}
            />
          ))}
        </SettingsSection>
      ) : null}
      <SettingsSection>
        <ListActionRow
          icon="plus"
          label={gt("Add pipeline")}
          disabled={!writable || adding}
          onPress={() => void add(newPipeline(uuidv4, gt("New pipeline"), gt("Phase 1")))}
        />
        <ListActionRow
          icon="star.fill"
          label={gt("Add example: Plan, Work, Review")}
          disabled={!writable || adding}
          onPress={() => void add(examplePipeline(uuidv4))}
        />
      </SettingsSection>
    </ScrollView>
  );
}

export function SettingsPipelineEditRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: EnvironmentId; readonly pipelineId: string }>) {
  const gt = useGT();
  const { availableTargets } = useSettingsEnvironmentFilter();
  const target = availableTargets.find(
    (entry) => entry.environmentId === route.params.environmentId,
  );
  const pipeline = target?.serverConfig.settings.pipelines.find(
    (entry) => entry.id === route.params.pipelineId,
  );
  return (
    <SettingsScreen title={pipeline?.name ?? gt("Pipeline")}>
      {target && pipeline ? (
        <PipelineEditor key={pipeline.id} target={target} saved={pipeline} />
      ) : (
        <Text className="px-7 pt-4 text-base text-foreground-muted">
          {gt("This pipeline is no longer available.")}
        </Text>
      )}
    </SettingsScreen>
  );
}

function PipelineEditor(props: { readonly target: SettingsTarget; readonly saved: Pipeline }) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { target, saved } = props;
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  // Phases start folded so the list is short enough to drag; a phase added here opens.
  const [openPhaseIds, setOpenPhaseIds] = useState<ReadonlySet<string>>(() => new Set());
  const writePipelines = usePipelinesWriter(target);
  const writable = useEnvironmentsWithScope([target], AuthSettingsWriteScope).has(
    target.environmentId,
  );
  const disabled = !writable || saving;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const issue = firstPipelineDraftIssue([draft]);
  const phaseIds = draft.phases.map((phase) => phase.id);
  const dragOrder = useSettingsDragOrder(phaseIds, (from, to) =>
    setDraft((current) => reorderPhase(current, phaseIds[from]!, phaseIds[to]!)),
  );
  const togglePhase = (phaseId: string) =>
    setOpenPhaseIds((current) => {
      const next = new Set(current);
      if (!next.delete(phaseId)) next.add(phaseId);
      return next;
    });
  const latest = () => target.serverConfig.settings.pipelines;

  const save = async () => {
    const [pipeline] = trimPipelineNames([draft]);
    setDraft(pipeline!);
    setSaving(true);
    await writePipelines(
      latest().map((entry) => (entry.id === pipeline!.id ? pipeline! : entry)),
    ).finally(() => setSaving(false));
  };
  const confirmDelete = () =>
    Dialog.alert(gt("Delete the {name} pipeline?", { name: saved.name }), undefined, [
      { text: gt("Cancel"), style: "cancel" },
      {
        text: gt("Delete"),
        style: "destructive",
        onPress: async () => {
          setSaving(true);
          const deleted = await writePipelines(
            latest().filter((entry) => entry.id !== saved.id),
          ).finally(() => setSaving(false));
          if (deleted) navigation.goBack();
        },
      },
    ]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className="flex-1"
      contentContainerClassName="gap-6 px-5 pt-4"
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
    >
      <SettingsSection title={gt("Name")}>
        <View className="px-4 py-3">
          <AppTextInput
            accessibilityLabel={gt("Pipeline name")}
            value={draft.name}
            maxLength={MAX_PIPELINE_NAME_LENGTH}
            editable={!disabled}
            onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
            className="min-h-10 rounded-xl text-base text-foreground"
          />
        </View>
      </SettingsSection>
      <SettingsSection title={gt("Phases")}>
        {draft.phases.map((phase, index) => (
          <PhaseEditor
            key={dragOrder.rowKey(phase.id)}
            phase={phase}
            index={index}
            count={draft.phases.length}
            target={target}
            disabled={disabled}
            open={openPhaseIds.has(phase.id)}
            drag={dragOrder.rowDrag(phase.id, index)}
            onToggle={() => togglePhase(phase.id)}
            onChange={(patch) => setDraft((current) => replacePhase(current, phase.id, patch))}
            onDelete={() => setDraft((current) => removePhase(current, phase.id))}
          />
        ))}
        <ListActionRow
          icon="plus"
          label={gt("Add phase")}
          disabled={disabled}
          onPress={() => {
            const phase = newPhase(
              uuidv4,
              gt("Phase {number}", { number: draft.phases.length + 1 }),
            );
            setOpenPhaseIds((current) => new Set(current).add(phase.id));
            setDraft((current) => ({ ...current, phases: [...current.phases, phase] }));
          }}
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
        label={gt("Save pipeline")}
        loading={saving}
        disabled={!dirty || issue !== null || !writable}
        onPress={() => void save()}
      />
      <SettingsSection>
        <ListActionRow
          icon="trash"
          tone="danger"
          label={gt("Delete pipeline")}
          disabled={disabled}
          onPress={confirmDelete}
        />
      </SettingsSection>
    </ScrollView>
  );
}

function PhaseEditor(props: {
  readonly phase: PipelinePhase;
  readonly index: number;
  readonly count: number;
  readonly target: SettingsTarget;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly drag: SettingsRowDrag;
  readonly onToggle: () => void;
  readonly onChange: (patch: Partial<Omit<PipelinePhase, "id">>) => void;
  readonly onDelete: () => void;
}) {
  const gt = useGT();
  const { phase, index, disabled, onChange, open, drag } = props;
  const { lifted, offset } = drag;
  const summary = phase.prompt.trim().split("\n")[0] ?? "";
  const style = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: lifted
          ? offset
          : withTiming(offset, { duration: 160, reduceMotion: ReduceMotion.System }),
      },
    ],
    zIndex: lifted ? 1 : 0,
  }));
  return (
    <Reanimated.View
      style={style}
      onLayout={(event) => drag.onHeight(event.nativeEvent.layout.height)}
      className={cn(
        "bg-grouped-card",
        index > 0 && !lifted && "border-t border-border-subtle",
        lifted && "shadow-md",
      )}
    >
      <View className="flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={gt("Phase {number}, {name}", {
            number: index + 1,
            name: phase.name,
          })}
          onPress={props.onToggle}
          className="min-w-0 flex-1 flex-row items-center gap-3 py-3 pl-4 active:opacity-70"
        >
          <SymbolView
            name={open ? "chevron.down" : "chevron.right"}
            size={14}
            tintColorClassName="accent-chevron"
            type="monochrome"
          />
          <Text className="w-4 text-center text-sm text-foreground-muted">{index + 1}</Text>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text numberOfLines={1} className="text-base font-t3-medium text-foreground">
              {phase.name}
            </Text>
            {!open && (summary !== "" || phase.autoAdvance) ? (
              <Text numberOfLines={1} className="text-sm text-foreground-muted">
                {phase.autoAdvance
                  ? summary === ""
                    ? gt("Continues automatically")
                    : gt("Continues automatically · {summary}", { summary })
                  : summary}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {!disabled ? (
          <SettingsDragHandle
            title={phase.name}
            canMoveUp={index > 0}
            canMoveDown={index < props.count - 1}
            onStart={drag.onDragStart}
            onMove={drag.onDragMove}
            onEnd={drag.onDragEnd}
            onStep={drag.onStep}
          />
        ) : null}
      </View>
      {open ? (
        <>
          <View className="gap-3 px-4 pb-3">
            <AppTextInput
              accessibilityLabel={gt("Phase name")}
              value={phase.name}
              maxLength={MAX_PIPELINE_NAME_LENGTH}
              editable={!disabled}
              onChangeText={(name) => onChange({ name })}
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
              onChangeText={(prompt) => onChange({ prompt })}
              className="max-h-60 min-h-24 rounded-xl text-base text-foreground"
            />
          </View>
          <ListToggleRow
            label={gt("Advance automatically")}
            description={gt("Start the next phase without waiting for your approval.")}
            value={phase.autoAdvance}
            disabled={disabled}
            onValueChange={(autoAdvance) => onChange({ autoAdvance })}
          />
          <PhaseModelRow
            target={props.target}
            selection={phase.modelSelection}
            disabled={disabled}
            onSelect={(modelSelection) => onChange({ modelSelection })}
          />
          <ListActionRow
            icon="trash"
            tone="danger"
            label={gt("Delete phase")}
            disabled={disabled || props.count <= 1}
            onPress={props.onDelete}
          />
        </>
      ) : null}
    </Reanimated.View>
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
