import { resolveShownThreadSpecRevision } from "@t3tools/client-runtime/state/thread-spec";
import type { EnvironmentId, ThreadId, ThreadSpecRevisionAuthor } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react-native";
import { useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { RelativeTime } from "../../components/RelativeTime";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { IconButton } from "../../components/ui/IconButton";
import { useEnvironmentQuery } from "../../state/query";
import { threadSpecEnvironment } from "../../state/threadSpec";
import { resolveThreadSpecContent } from "./threadSpecView.logic";

const AUTHOR_LABELS = {
  agent: msg("Agent"),
  user: msg("You"),
  system: msg("System"),
} satisfies Record<ThreadSpecRevisionAuthor, ReturnType<typeof msg>>;

/** The thread's spec: revision bar over the markdown, rendered by the caller like an assistant reply. */
export function ThreadSpecView(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** Clears the header and the Thread / Spec switch above the pane. */
  readonly topInset: number;
  /** Clears the composer overlaying the bottom of the pane. */
  readonly bottomInset: number;
  readonly horizontalPadding: number;
  readonly renderMarkdown: (markdown: string) => ReactNode;
}) {
  const { environmentId, threadId } = props;
  const gt = useGT();
  const messages = useMessages();
  // The caller keys this view by thread, so a pin never carries over to another thread.
  const [pinned, setPinned] = useState<number | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  const live = useEnvironmentQuery(
    threadSpecEnvironment.live({ environmentId, input: { threadId } }),
  );
  const snapshot = live.data;
  const revisions = snapshot?.revisions ?? [];
  const { shown, latest, previous, isLatest } = resolveShownThreadSpecRevision(revisions, pinned);

  // The newest body rides the live snapshot; only earlier ones are fetched.
  const revisionAtom = (revision: number) =>
    threadSpecEnvironment.revision({ environmentId, input: { threadId, revision } });
  const shownQuery = useEnvironmentQuery(shown !== null && !isLatest ? revisionAtom(shown) : null);
  const previousQuery = useEnvironmentQuery(
    showChanges && previous !== null ? revisionAtom(previous) : null,
  );

  const content = resolveThreadSpecContent({
    snapshotLoaded: snapshot !== null,
    liveError: live.error,
    shown,
    previous,
    showChanges,
    shownBody: isLatest ? (snapshot?.current?.body ?? null) : (shownQuery.data?.body ?? null),
    shownError: shownQuery.error,
    previousBody: previousQuery.data?.body ?? null,
    previousError: previousQuery.error,
  });

  const shownInfo = revisions.find((entry) => entry.revision === shown);
  const index = revisions.findIndex((entry) => entry.revision === shown);
  const goTo = (revision: number) => setPinned(revision === latest ? null : revision);
  const retry = {
    live: live.refresh,
    shown: shownQuery.refresh,
    previous: previousQuery.refresh,
  };

  return (
    <View className="flex-1">
      {shown !== null && shownInfo ? (
        <View className="gap-1 px-2 pb-2" style={{ paddingTop: props.topInset }}>
          <View className="flex-row items-center">
            <IconButton
              accessibilityLabel={gt("Earlier revision")}
              icon="chevron.left"
              disabled={index <= 0}
              onPress={() => goTo(revisions[index - 1]!.revision)}
            />
            <Text className="font-t3-medium text-sm">
              {gt("Revision {revision} of {total}", { revision: shown, total: latest })}
            </Text>
            <IconButton
              accessibilityLabel={gt("Later revision")}
              icon="chevron.right"
              disabled={isLatest}
              onPress={() => goTo(revisions[index + 1]!.revision)}
            />
            {isLatest ? null : (
              <Button label={gt("Latest")} size="compact" onPress={() => setPinned(null)} />
            )}
            <View className="flex-1" />
            <Chip
              label={gt("Show changes")}
              selected={showChanges && previous !== null}
              disabled={previous === null}
              onPress={() => setShowChanges((current) => !current)}
            />
          </View>
          <Text className="px-2 text-xs text-foreground-muted" numberOfLines={1}>
            {[messages(AUTHOR_LABELS[shownInfo.author]), shownInfo.note.trim()]
              .filter((part) => part !== "")
              .join(" · ")}
            {" · "}
            <RelativeTime timestamp={shownInfo.createdAt} />
          </Text>
        </View>
      ) : (
        <View style={{ height: props.topInset }} />
      )}
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="none"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: props.horizontalPadding,
          paddingTop: 8,
          paddingBottom: props.bottomInset,
        }}
      >
        {content.kind === "markdown" ? (
          props.renderMarkdown(content.text)
        ) : (
          <View className="flex-1 items-center justify-center gap-3 px-6 py-10">
            {content.kind === "loading" ? (
              <AppActivityIndicator colorClassName="accent-foreground-muted" />
            ) : (
              <Text className="text-center text-sm text-foreground-muted">
                {content.kind === "empty"
                  ? gt("No spec yet. The agent writes it as it works.")
                  : content.kind === "unchanged"
                    ? gt("This revision made no changes.")
                    : content.message}
              </Text>
            )}
            {content.kind === "error" ? (
              <Button label={gt("Retry")} size="compact" onPress={retry[content.retry]} />
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
