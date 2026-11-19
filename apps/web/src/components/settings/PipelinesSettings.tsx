import {
  DndContext,
  type DragEndEvent,
  type UniqueIdentifier,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  type EnvironmentId,
  type Pipeline,
  type PipelinePhase,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { Link, useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  LayoutTemplateIcon,
  PlusIcon,
  Trash2Icon,
  WorkflowIcon,
} from "lucide-react";
import { useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import { cn } from "~/lib/utils";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { serverEnvironment, EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { randomUUID } from "../../lib/utils";
import { scheduledTaskDefaultModel } from "./scheduledTasksSettings.logic";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  newPhase,
  examplePipeline,
  newPipeline,
  normalizeName,
  removePhase,
  reorderPhase,
  replacePhase,
  replacePipeline,
} from "@t3tools/client-runtime/pipeline-draft";

export function validatePipelinesSearch(raw: Record<string, unknown>) {
  return typeof raw.pipelineId === "string" && raw.pipelineId.trim()
    ? { pipelineId: raw.pipelineId }
    : {};
}

/** The environment's pipelines, then one pipeline's editor when the search names it. */
export function PipelinesSettings({ pipelineId }: { readonly pipelineId?: string }) {
  const setting = useSearchableSetting();
  const gt = useGT();
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const canWrite = useEnvironmentScope(environmentId, AuthSettingsWriteScope);

  return (
    <SettingsPageContainer>
      {environmentId === null ? (
        <SettingsSection {...setting("pipelines")}>
          <SettingsRow
            title={gt("Choose an environment")}
            description={gt("Pipelines belong to one environment. Select it to edit them.")}
          />
        </SettingsSection>
      ) : (
        <PipelinesEditor
          key={environmentId}
          environmentId={environmentId}
          pipelineId={pipelineId}
          readOnly={!canWrite}
        />
      )}
    </SettingsPageContainer>
  );
}

function PipelinesEditor({
  environmentId,
  pipelineId,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipelineId: string | undefined;
  readonly readOnly: boolean;
}) {
  const setting = useSearchableSetting();
  const gt = useGT();
  const navigate = useNavigate({ from: "/settings/pipelines" });
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
  const open = (id: string | undefined) =>
    void navigate({
      to: "/settings/pipelines",
      search: ({ pipelineId: _previous, ...rest }) =>
        id === undefined ? rest : { ...rest, pipelineId: id },
    });
  const add = (pipeline: Pipeline) => {
    commit([...pipelines, pipeline]);
    open(pipeline.id);
  };

  const selected = pipelines.find((pipeline) => pipeline.id === pipelineId);
  if (selected) {
    return (
      <PipelineDetail
        environmentId={environmentId}
        pipeline={selected}
        readOnly={readOnly}
        onChange={(update) => commit(replacePipeline(pipelines, selected.id, update))}
        onDelete={() => {
          commit(pipelines.filter((entry) => entry.id !== selected.id));
          open(undefined);
        }}
      />
    );
  }

  return (
    <SettingsSection
      {...setting("pipelines")}
      headerAction={
        !readOnly ? (
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => add(examplePipeline(randomUUID))}
            >
              <LayoutTemplateIcon className="size-3" aria-hidden />
              <T>Add example: Plan, Work, Review</T>
            </Button>
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => add(newPipeline(randomUUID, gt("New pipeline"), gt("Phase 1")))}
            >
              <PlusIcon className="size-3" aria-hidden />
              <T>Add pipeline</T>
            </Button>
          </div>
        ) : null
      }
    >
      {pipelines.length === 0 ? (
        <SettingsRow
          title={gt("No pipelines yet")}
          description={gt(
            "A pipeline runs a thread through ordered phases. Each phase starts in a fresh session with the previous phase's handoff.",
          )}
        />
      ) : (
        pipelines.map((pipeline) => (
          <Link
            key={pipeline.id}
            to="/settings/pipelines"
            search={(previous) => ({ ...previous, pipelineId: pipeline.id })}
            className="flex items-center gap-3 px-3 py-3 outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
          >
            <WorkflowIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {pipeline.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {pipeline.phases.map((phase) => phase.name).join(" → ")}
              </span>
            </span>
            <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))
      )}
    </SettingsSection>
  );
}

export function PipelineDetail({
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
  // Phases start folded so the list is short enough to drag; a phase added here opens.
  const [openPhaseIds, setOpenPhaseIds] = useState<ReadonlySet<string>>(() => new Set());
  const setPhaseOpen = (phaseId: string, isOpen: boolean) =>
    setOpenPhaseIds((current) => {
      const next = new Set(current);
      if (isOpen) next.add(phaseId);
      else next.delete(phaseId);
      return next;
    });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over === null || event.active.id === event.over.id) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    onChange((current) => reorderPhase(current, activeId, overId));
  };
  // dnd-kit announces ids by default; phase ids are UUIDs, so speak names and positions.
  const phaseName = (id: UniqueIdentifier) =>
    pipeline.phases.find((phase) => phase.id === id)?.name ?? "";
  const phasePosition = (id: UniqueIdentifier) =>
    pipeline.phases.findIndex((phase) => phase.id === id) + 1;
  const confirmDelete = async () => {
    const confirmed = await requestConfirmDialog(
      gt("Delete the {name} pipeline?", { name: pipeline.name }),
      { variant: "destructive" },
    );
    if (confirmed === true) onDelete();
  };

  return (
    <>
      <div className="-mb-4 px-1.5 sm:px-2.5">
        <Button
          size="xs"
          variant="ghost-muted"
          render={
            <Link to="/settings/pipelines" search={({ pipelineId: _closed, ...rest }) => rest} />
          }
        >
          <ArrowLeftIcon className="size-3" aria-hidden />
          <T>All pipelines</T>
        </Button>
      </div>
      <SettingsSection
        title={pipeline.name}
        headerAction={
          !readOnly ? (
            <Button size="xs" variant="ghost-destructive" onClick={() => void confirmDelete()}>
              <Trash2Icon className="size-3" aria-hidden />
              <T>Delete pipeline</T>
            </Button>
          ) : null
        }
      >
        <SettingsRow
          title={gt("Name")}
          control={
            <Input
              key={pipeline.name}
              className="sm:w-64"
              aria-label={gt("Pipeline name")}
              disabled={readOnly}
              defaultValue={pipeline.name}
              onBlur={(event) => {
                const name = normalizeName(event.target.value);
                if (name === null) event.target.value = pipeline.name;
                else if (name !== pipeline.name) onChange((current) => ({ ...current, name }));
              }}
            />
          }
        />
      </SettingsSection>
      <SettingsSection
        title={gt("Phases")}
        headerAction={
          !readOnly ? (
            <Button
              size="xs"
              variant="ghost-muted"
              onClick={() => {
                const phase = newPhase(
                  randomUUID,
                  gt("Phase {number}", { number: pipeline.phases.length + 1 }),
                );
                setPhaseOpen(phase.id, true);
                onChange((current) => ({ ...current, phases: [...current.phases, phase] }));
              }}
            >
              <PlusIcon className="size-3" aria-hidden />
              <T>Add phase</T>
            </Button>
          ) : null
        }
      >
        <DndContext
          accessibility={{
            screenReaderInstructions: {
              draggable: gt(
                "To reorder, press Space or Enter, move with the arrow keys, then press Space or Enter to drop. Escape cancels.",
              ),
            },
            announcements: {
              onDragStart: ({ active }) => gt("Picked up {name}.", { name: phaseName(active.id) }),
              onDragOver: ({ active, over }) =>
                over === null
                  ? undefined
                  : gt("{name} is over position {position}.", {
                      name: phaseName(active.id),
                      position: phasePosition(over.id),
                    }),
              onDragEnd: ({ active, over }) =>
                over === null
                  ? gt("{name} was dropped.", { name: phaseName(active.id) })
                  : gt("{name} moved to position {position}.", {
                      name: phaseName(active.id),
                      position: phasePosition(over.id),
                    }),
              onDragCancel: ({ active }) =>
                gt("Moving {name} was cancelled.", { name: phaseName(active.id) }),
            },
          }}
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={pipeline.phases.map((phase) => phase.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol
              aria-label={gt("Phases of {name}, in order", { name: pipeline.name })}
              className="divide-y divide-border/50"
            >
              {pipeline.phases.map((phase, index) => (
                <PhaseEditor
                  key={phase.id}
                  environmentId={environmentId}
                  phase={phase}
                  index={index}
                  count={pipeline.phases.length}
                  readOnly={readOnly}
                  open={openPhaseIds.has(phase.id)}
                  onOpenChange={(isOpen) => setPhaseOpen(phase.id, isOpen)}
                  onPatch={(patch) => onChange((current) => replacePhase(current, phase.id, patch))}
                  onRemove={() => onChange((current) => removePhase(current, phase.id))}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      </SettingsSection>
    </>
  );
}

function PhaseEditor({
  environmentId,
  phase,
  index,
  count,
  readOnly,
  open,
  onOpenChange,
  onPatch,
  onRemove,
}: {
  readonly environmentId: EnvironmentId;
  readonly phase: PipelinePhase;
  readonly index: number;
  readonly count: number;
  readonly readOnly: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onPatch: (patch: Partial<Omit<PipelinePhase, "id">>) => void;
  readonly onRemove: () => void;
}) {
  const gt = useGT();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: phase.id, disabled: readOnly });
  const summary = phase.prompt.trim().split("\n")[0] ?? "";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "first:rounded-t-xl last:rounded-b-xl",
        isDragging && "relative z-10 rounded-xl bg-background shadow-md",
      )}
    >
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="flex items-center gap-1 px-1.5 sm:px-2.5">
          {!readOnly ? (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={gt("Reorder {name}, position {position}", {
                name: phase.name,
                position: index + 1,
              })}
              className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
            >
              <GripVerticalIcon className="size-3.5" />
            </button>
          ) : null}
          <CollapsibleTrigger className="group flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
            />
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}</span>
            <span className="shrink-0 text-sm font-medium text-foreground">{phase.name}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {open ? null : summary}
            </span>
            {phase.autoAdvance ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                <T>Continues automatically</T>
              </span>
            ) : null}
          </CollapsibleTrigger>
          {!readOnly ? (
            <Button
              size="icon-sm"
              variant="ghost-destructive"
              disabled={count <= 1}
              aria-label={gt("Delete phase {name}", { name: phase.name })}
              onClick={onRemove}
            >
              <Trash2Icon aria-hidden />
            </Button>
          ) : null}
        </div>
        <CollapsiblePanel>
          <PhaseFields
            environmentId={environmentId}
            phase={phase}
            index={index}
            readOnly={readOnly}
            onPatch={onPatch}
          />
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

function PhaseFields({
  environmentId,
  phase,
  index,
  readOnly,
  onPatch,
}: {
  readonly environmentId: EnvironmentId;
  readonly phase: PipelinePhase;
  readonly index: number;
  readonly readOnly: boolean;
  readonly onPatch: (patch: Partial<Omit<PipelinePhase, "id">>) => void;
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
    <div className="space-y-3 px-3 pb-4 sm:px-4">
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
      <Textarea
        key={phase.prompt}
        aria-label={gt("Phase {number} prompt", { number: index + 1 })}
        disabled={readOnly}
        rows={6}
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
