import { resolveShownThreadSpecRevision } from "@t3tools/client-runtime/state/thread-spec";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  ScopedThreadRef,
  ServerProviderSkill,
  ThreadSpecRevisionAuthor,
} from "@t3tools/contracts";
import type { CodexArtifactTemplate } from "@t3tools/shared/codexArtifactTemplates";
import { threadSpecBlockDiff, type ThreadSpecDiffChunk } from "@t3tools/shared/threadSpec";
import { msg, useGT, useMessages } from "gt-react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { threadSpecEnvironment } from "../../state/threadSpec";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { THREAD_DETAILS_CARD_GAP } from "./threadDetailsCardLayout";

type ChatMarkdownProps = Parameters<typeof ChatMarkdown>[0];

const THREAD_SPEC_BAR_HEIGHT = 44;
/** Space the floating thread details card leaves for the revision bar. */
export const THREAD_SPEC_BAR_RESERVED_HEIGHT = THREAD_SPEC_BAR_HEIGHT + THREAD_DETAILS_CARD_GAP;

const AUTHOR_LABELS = {
  agent: msg("Agent"),
  user: msg("You"),
  system: msg("System"),
} satisfies Record<ThreadSpecRevisionAuthor, ReturnType<typeof msg>>;

interface ThreadSpecViewProps {
  readonly threadRef: ScopedThreadRef;
  readonly markdownCwd: string | undefined;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly onUseArtifactTemplate: (template: CodexArtifactTemplate) => void;
  readonly onRunShellCommand?: ((command: string) => void) | undefined;
  readonly onImageExpand: ChatMarkdownProps["onImageExpand"];
  /** Height of the composer overlaying the bottom of the pane. */
  readonly bottomInset: number;
}

/** The thread's spec, rendered like an assistant reply, with revision history and diffs. */
export function ThreadSpecView(props: ThreadSpecViewProps) {
  const { threadRef } = props;
  const gt = useGT();
  const messages = useMessages();
  const threadKey = scopedThreadKey(threadRef);
  // Stepping back and "show changes" belong to one thread; another thread starts on its latest.
  const [state, setState] = useState<{
    readonly key: string;
    readonly pinned: number | null;
    readonly showChanges: boolean;
  }>({ key: threadKey, pinned: null, showChanges: false });
  const { pinned, showChanges } =
    state.key === threadKey ? state : { pinned: null, showChanges: false };
  const update = (next: { pinned?: number | null; showChanges?: boolean }) =>
    setState({ key: threadKey, pinned, showChanges, ...next });

  const target = {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  };
  const live = useEnvironmentQuery(threadSpecEnvironment.live(target), messages);
  const snapshot = live.data;
  const revisions = snapshot?.revisions ?? [];
  const { shown, latest, previous, isLatest } = resolveShownThreadSpecRevision(revisions, pinned);

  // The newest body arrives with the live snapshot; only earlier ones are fetched.
  const revisionAtom = (revision: number) =>
    threadSpecEnvironment.revision({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, revision },
    });
  const shownQuery = useEnvironmentQuery(
    shown !== null && !isLatest ? revisionAtom(shown) : null,
    messages,
  );
  const previousQuery = useEnvironmentQuery(
    showChanges && previous !== null ? revisionAtom(previous) : null,
    messages,
  );
  const shownBody = isLatest ? (snapshot?.current?.body ?? null) : (shownQuery.data?.body ?? null);
  const previousBody = previousQuery.data?.body ?? null;

  const diff =
    showChanges &&
    previous !== null &&
    shown !== null &&
    shownBody !== null &&
    previousBody !== null
      ? threadSpecBlockDiff(previousBody, shownBody)
      : null;

  const shownInfo = revisions.find((entry) => entry.revision === shown);
  const index = revisions.findIndex((entry) => entry.revision === shown);
  const goTo = (revision: number) => update({ pinned: revision === latest ? null : revision });

  let content;
  if (snapshot === null) {
    content =
      live.error === null ? (
        <CenteredNote>
          <Spinner />
        </CenteredNote>
      ) : (
        <CenteredNote
          action={
            <Button size="sm" variant="outline" onClick={live.refresh}>
              {gt("Retry")}
            </Button>
          }
        >
          <EmptyDescription>{live.error}</EmptyDescription>
        </CenteredNote>
      );
  } else if (shown === null) {
    content = (
      <CenteredNote>
        <EmptyDescription>{gt("No spec yet. The agent writes it as it works.")}</EmptyDescription>
      </CenteredNote>
    );
  } else if (shownBody === null) {
    content =
      shownQuery.error === null ? (
        <CenteredNote>
          <Spinner />
        </CenteredNote>
      ) : (
        <CenteredNote
          action={
            <Button size="sm" variant="outline" onClick={shownQuery.refresh}>
              {gt("Retry")}
            </Button>
          }
        >
          <EmptyDescription>{shownQuery.error}</EmptyDescription>
        </CenteredNote>
      );
  } else if (showChanges && previous !== null) {
    content =
      previousBody === null ? (
        previousQuery.error === null ? (
          <CenteredNote>
            <Spinner />
          </CenteredNote>
        ) : (
          <CenteredNote
            action={
              <Button size="sm" variant="outline" onClick={previousQuery.refresh}>
                {gt("Retry")}
              </Button>
            }
          >
            <EmptyDescription>{previousQuery.error}</EmptyDescription>
          </CenteredNote>
        )
      ) : diff === null || diff.length === 0 ? (
        <CenteredNote>
          <EmptyDescription>{gt("This revision made no changes.")}</EmptyDescription>
        </CenteredNote>
      ) : (
        <SpecDiff {...props} chunks={diff} />
      );
  } else {
    content = <SpecMarkdown {...props} text={shownBody} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-chat-spec-view>
      {/* Always mounted: the canvas measures it to keep the floating details card below it. */}
      <div
        data-details-card-top-bar
        className="flex min-w-0 shrink-0 items-center gap-3 border-b border-border/60 px-4"
        style={{ height: THREAD_SPEC_BAR_HEIGHT }}
      >
        {shown !== null && shownInfo ? (
          <>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost-muted"
                size="icon-sm"
                aria-label={gt("Earlier revision")}
                disabled={index <= 0}
                onClick={() => goTo(revisions[index - 1]!.revision)}
              >
                <ChevronLeftIcon />
              </Button>
              <Select
                value={String(shown)}
                onValueChange={(value) => {
                  if (value !== null) goTo(Number(value));
                }}
              >
                <SelectTrigger
                  size="sm"
                  variant="ghost"
                  aria-label={gt("Spec revision")}
                  className="w-auto min-w-0"
                >
                  <SelectValue>
                    {gt("Revision {revision} of {total}", { revision: shown, total: latest })}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {[...revisions].reverse().map((entry) => (
                    <SelectItem key={entry.revision} value={String(entry.revision)}>
                      {gt("Revision {revision}", { revision: entry.revision })}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button
                variant="ghost-muted"
                size="icon-sm"
                aria-label={gt("Later revision")}
                disabled={isLatest}
                onClick={() => goTo(revisions[index + 1]!.revision)}
              >
                <ChevronRightIcon />
              </Button>
              {isLatest ? null : (
                <Button variant="outline" size="xs" onClick={() => update({ pinned: null })}>
                  {gt("Latest")}
                </Button>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger
                render={<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" />}
              >
                {[
                  messages(AUTHOR_LABELS[shownInfo.author]),
                  shownInfo.note.trim(),
                  formatRelativeTimeLabel(shownInfo.createdAt, undefined, messages),
                ]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {new Date(shownInfo.createdAt).toLocaleString()}
              </TooltipPopup>
            </Tooltip>
            <Toggle
              variant="outline"
              size="sm"
              pressed={showChanges && previous !== null}
              disabled={previous === null}
              onPressedChange={(pressed) => update({ showChanges: pressed })}
            >
              {gt("Show changes")}
            </Toggle>
          </>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-both">
        <div
          className="mx-auto flex min-h-full w-full max-w-(--chat-content-max-width) flex-col px-4 pt-6 sm:px-6"
          style={{ paddingBottom: props.bottomInset + 16 }}
        >
          {content}
        </div>
      </div>
    </div>
  );
}

function CenteredNote({
  children,
  action,
}: {
  readonly children: React.ReactNode;
  readonly action?: React.ReactNode;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader>{children}</EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

const DIFF_CHUNK_STYLES = {
  added: {
    Tag: "ins",
    sign: "+",
    className: "border-diff-addition bg-diff-addition/8 dark:bg-diff-addition/14",
    signClassName: "text-diff-addition-foreground",
  },
  removed: {
    Tag: "del",
    sign: "−",
    className: "border-diff-deletion bg-diff-deletion/8 dark:bg-diff-deletion/16",
    signClassName: "text-diff-deletion-foreground",
  },
} as const;

/** The change rendered in place: unchanged blocks as usual, removed and added ones tinted with a gutter sign. */
function SpecDiff({
  chunks,
  ...props
}: ThreadSpecViewProps & { readonly chunks: ReadonlyArray<ThreadSpecDiffChunk> }) {
  return (
    <div className="flex flex-col gap-3" data-chat-spec-diff>
      {chunks.map((chunk) => {
        if (chunk.kind === "same") {
          return (
            <SpecMarkdown key={`${chunk.kind}:${chunk.line}`} {...props} text={chunk.markdown} />
          );
        }
        const style = DIFF_CHUNK_STYLES[chunk.kind];
        return (
          <style.Tag
            key={`${chunk.kind}:${chunk.line}`}
            data-spec-diff-chunk={chunk.kind}
            className={cn(
              "relative block rounded-r-md border-l-2 py-2 pr-3 pl-7 no-underline",
              style.className,
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-2 left-2.5 font-mono text-sm leading-6 select-none",
                style.signClassName,
              )}
            >
              {style.sign}
            </span>
            <SpecMarkdown {...props} text={chunk.markdown} />
          </style.Tag>
        );
      })}
    </div>
  );
}

function SpecMarkdown({
  threadRef,
  markdownCwd,
  skills,
  onUseArtifactTemplate,
  onRunShellCommand,
  onImageExpand,
  text,
}: ThreadSpecViewProps & { readonly text: string }) {
  return (
    <ChatMarkdown
      text={text}
      renderInsights
      cwd={markdownCwd}
      threadRef={threadRef}
      environmentId={threadRef.environmentId}
      skills={skills}
      onUseArtifactTemplate={onUseArtifactTemplate}
      onRunShellCommand={onRunShellCommand}
      onImageExpand={onImageExpand}
    />
  );
}
