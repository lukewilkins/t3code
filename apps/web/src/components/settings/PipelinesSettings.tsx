import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type Pipeline,
  type PipelinePhase,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { T, useGT } from "gt-react";
import { ArrowDownIcon, ArrowUpIcon, LayoutTemplateIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { serverEnvironment, EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME, SettingsRow, SettingsSection } from "./settingsLayout";
import { randomUUID } from "../../lib/utils";
import { scheduledTaskDefaultModel } from "./scheduledTasksSettings.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  movePhase,
  newPhase,
  examplePipeline,
  newPipeline,
  normalizeName,
  removePhase,
  replacePhase,
  replacePipeline,
} from "@t3tools/client-runtime/pipeline-draft";

/** Pipelines an environment offers in the composer; edits save the whole list. */
export function PipelinesSettingsSection() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);

  return (
    <SettingsSection {...setting("pipelines")}>
      {environmentId === null ? (
        <SettingsRow
          title={gt("Choose an environment")}
          description={gt("Pipelines belong to one environment. Select it to edit them.")}
        />
      ) : (
        <PipelinesEditor environmentId={environmentId} readOnly={!canWrite} />
      )}
    </SettingsSection>
  );
}

function PipelinesEditor({
  environmentId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly readOnly: boolean;
}) {
  const gt = useGT();
  const settings = useEnvironmentSettings(environmentId);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const saved = settings.pipelines;
  // Edits show at once and a failed save puts the server's list back.
  const [state, setState] = useState({ source: saved, draft: saved });
  if (state.source !== saved) setState({ source: saved, draft: saved });
  const pipelines = state.draft;

  const commit = (next: ReadonlyArray<Pipeline>) => {
    setState((current) => ({ ...current, draft: next }));
    void updateSettings(
      { pipelines: [...next] },
      { onFailed: () => setState((current) => ({ ...current, draft: current.source })) },
    );
  };
  const edit = (id: string, update: (pipeline: Pipeline) => Pipeline) =>
    commit(replacePipeline(pipelines, id, update));

  return (
    <>
      {pipelines.length === 0 ? (
        <SettingsRow
          title={gt("No pipelines yet")}
          description={gt(
            "A pipeline runs a thread through ordered phases. Each phase starts in a fresh session with the previous phase's handoff.",
          )}
        />
      ) : null}
      {pipelines.map((pipeline) => (
        <PipelineRow
          key={pipeline.id}
          environmentId={environmentId}
          pipeline={pipeline}
          readOnly={readOnly}
          onChange={(update) => edit(pipeline.id, update)}
          onDelete={() => commit(pipelines.filter((entry) => entry.id !== pipeline.id))}
        />
      ))}
      {!readOnly ? (
        <div className="flex flex-wrap gap-2 px-3 py-2 sm:px-4">
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              commit([...pipelines, newPipeline(randomUUID, gt("New pipeline"), gt("Phase 1"))])
            }
          >
            <PlusIcon className="size-3" aria-hidden />
            <T>Add pipeline</T>
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => commit([...pipelines, examplePipeline(randomUUID)])}
          >
            <LayoutTemplateIcon className="size-3" aria-hidden />
            <T>Add example: Plan, Work, Review</T>
          </Button>
        </div>
      ) : null}
    </>
  );
}

function PipelineRow({
  environmentId,
  pipeline,
  readOnly,
  onChange,
  onDelete,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: Pipeline;
  readonly readOnly: boolean;
  readonly onChange: (update: (pipeline: Pipeline) => Pipeline) => void;
  readonly onDelete: () => void;
}) {
  const gt = useGT();
  return (
    <SettingsRow
      title={pipeline.name}
      control={
        !readOnly ? (
          <Button
            size="icon-sm"
            variant="ghost-destructive"
            aria-label={gt("Delete pipeline {name}", { name: pipeline.name })}
            onClick={onDelete}
          >
            <Trash2Icon aria-hidden />
          </Button>
        ) : null
      }
    >
      <div className="mt-3 space-y-3 pb-3.5">
        <Input
          key={pipeline.name}
          aria-label={gt("Pipeline name")}
          disabled={readOnly}
          defaultValue={pipeline.name}
          onBlur={(event) => {
            const name = normalizeName(event.target.value);
            if (name === null) event.target.value = pipeline.name;
            else if (name !== pipeline.name) onChange((current) => ({ ...current, name }));
          }}
        />
        {pipeline.phases.map((phase, index) => (
          <PhaseEditor
            key={phase.id}
            environmentId={environmentId}
            phase={phase}
            index={index}
            count={pipeline.phases.length}
            readOnly={readOnly}
            onPatch={(patch) => onChange((current) => replacePhase(current, phase.id, patch))}
            onMove={(direction) => onChange((current) => movePhase(current, phase.id, direction))}
            onRemove={() => onChange((current) => removePhase(current, phase.id))}
          />
        ))}
        {!readOnly ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              onChange((current) => ({
                ...current,
                phases: [
                  ...current.phases,
                  newPhase(randomUUID, gt("Phase {number}", { number: current.phases.length + 1 })),
                ],
              }))
            }
          >
            <PlusIcon className="size-3" aria-hidden />
            <T>Add phase</T>
          </Button>
        ) : null}
      </div>
    </SettingsRow>
  );
}

function PhaseEditor({
  environmentId,
  phase,
  index,
  count,
  readOnly,
  onPatch,
  onMove,
  onRemove,
}: {
  readonly environmentId: EnvironmentId;
  readonly phase: PipelinePhase;
  readonly index: number;
  readonly count: number;
  readonly readOnly: boolean;
  readonly onPatch: (patch: Partial<Omit<PipelinePhase, "id">>) => void;
  readonly onMove: (direction: -1 | 1) => void;
  readonly onRemove: () => void;
}) {
  const gt = useGT();
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, null);
  const selection = phase.modelSelection;
  const modelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId ?? null,
    selection?.model ?? null,
  );
  const fallbackSelection = scheduledTaskDefaultModel(settings, null, instanceEntries);

  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-sm text-muted-foreground">{index + 1}</span>
        <Input
          key={phase.name}
          aria-label={gt("Phase {number} name", { number: index + 1 })}
          disabled={readOnly}
          defaultValue={phase.name}
          onBlur={(event) => {
            const name = normalizeName(event.target.value);
            if (name === null) event.target.value = phase.name;
            else if (name !== phase.name) onPatch({ name });
          }}
        />
        {!readOnly ? (
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={index === 0}
              aria-label={gt("Move phase up")}
              onClick={() => onMove(-1)}
            >
              <ArrowUpIcon aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={index === count - 1}
              aria-label={gt("Move phase down")}
              onClick={() => onMove(1)}
            >
              <ArrowDownIcon aria-hidden />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost-destructive"
              disabled={count <= 1}
              aria-label={gt("Delete phase")}
              onClick={onRemove}
            >
              <Trash2Icon aria-hidden />
            </Button>
          </>
        ) : null}
      </div>
      <Textarea
        key={phase.prompt}
        aria-label={gt("Phase {number} prompt", { number: index + 1 })}
        disabled={readOnly}
        rows={4}
        defaultValue={phase.prompt}
        placeholder={gt("What should the agent do in this phase?")}
        onBlur={(event) => {
          if (event.target.value !== phase.prompt) onPatch({ prompt: event.target.value });
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            size="sm"
            disabled={readOnly}
            checked={phase.autoAdvance}
            onCheckedChange={(checked) => onPatch({ autoAdvance: Boolean(checked) })}
          />
          <T>Continue automatically after handoff</T>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selection === null ? "default" : "model"}
            disabled={readOnly}
            onValueChange={(value) => {
              if (value === "default") onPatch({ modelSelection: null });
              else if (fallbackSelection !== null) onPatch({ modelSelection: fallbackSelection });
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("Phase {number} model", { number: index + 1 })}>
              <SelectValue>
                {(value: string | null) =>
                  value === "model" ? gt("Specific model") : gt("Default (thread's model)")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="default">{gt("Default (thread's model)")}</SelectItem>
              <SelectItem value="model" disabled={fallbackSelection === null}>
                {gt("Specific model")}
              </SelectItem>
            </SelectPopup>
          </Select>
          {selection !== null ? (
            <ProviderModelPicker
              environmentId={environmentId}
              disabled={readOnly}
              activeInstanceId={selection.instanceId}
              model={selection.model}
              lockedProvider={null}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              isComposerOwned={false}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              onInstanceModelChange={(instanceId, model) =>
                onPatch({ modelSelection: createModelSelection(instanceId, model) })
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
