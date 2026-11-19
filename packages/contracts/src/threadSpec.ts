import * as Schema from "effect/Schema";

import { IsoDateTime, PositiveInt, ThreadId } from "./baseSchemas.ts";

export const ThreadSpecRevisionAuthor = Schema.Literals(["agent", "user", "system"]);
export type ThreadSpecRevisionAuthor = typeof ThreadSpecRevisionAuthor.Type;

export const ThreadSpecRevisionInfo = Schema.Struct({
  revision: PositiveInt,
  author: ThreadSpecRevisionAuthor,
  note: Schema.String,
  createdAt: IsoDateTime,
});
export type ThreadSpecRevisionInfo = typeof ThreadSpecRevisionInfo.Type;

export const ThreadSpecRevision = Schema.Struct({
  ...ThreadSpecRevisionInfo.fields,
  body: Schema.String,
});
export type ThreadSpecRevision = typeof ThreadSpecRevision.Type;

/** A thread's spec: the current revision with its text, and every revision's metadata, oldest first. */
export const ThreadSpecSnapshot = Schema.Struct({
  threadId: ThreadId,
  current: Schema.NullOr(ThreadSpecRevision),
  revisions: Schema.Array(ThreadSpecRevisionInfo),
});
export type ThreadSpecSnapshot = typeof ThreadSpecSnapshot.Type;

export const ThreadSpecInput = Schema.Struct({ threadId: ThreadId });
export type ThreadSpecInput = typeof ThreadSpecInput.Type;

export const ThreadSpecRevisionInput = Schema.Struct({
  threadId: ThreadId,
  revision: PositiveInt,
});
export type ThreadSpecRevisionInput = typeof ThreadSpecRevisionInput.Type;

export class ThreadSpecError extends Schema.TaggedError<ThreadSpecError>()("ThreadSpecError", {
  reason: Schema.Literals([
    "not-found",
    "forbidden",
    "conflict",
    "invalid-edit",
    "rejected",
    "storage",
  ]),
  message: Schema.String,
}) {}

/** One spec edit by exact text, like an Edit tool call. */
export const ThreadSpecStringEdit = Schema.Struct({
  old_string: Schema.String,
  new_string: Schema.String,
  replace_all: Schema.optionalKey(Schema.Boolean),
});
export type ThreadSpecStringEdit = typeof ThreadSpecStringEdit.Type;

/**
 * One spec edit by the base revision's line numbers (1-based, inclusive).
 * `end_line = start_line - 1` inserts before `start_line`.
 */
export const ThreadSpecLineEdit = Schema.Struct({
  start_line: PositiveInt,
  end_line: Schema.Int,
  new_text: Schema.String,
  expected: Schema.optionalKey(Schema.String),
});
export type ThreadSpecLineEdit = typeof ThreadSpecLineEdit.Type;

export const ThreadSpecEdit = Schema.Union([ThreadSpecStringEdit, ThreadSpecLineEdit]);
export type ThreadSpecEdit = typeof ThreadSpecEdit.Type;

/** A local media file a spec write copied into the thread's attachments; the spec now names `path`. */
export const ThreadSpecStoredMedia = Schema.Struct({ from: Schema.String, path: Schema.String });
export type ThreadSpecStoredMedia = typeof ThreadSpecStoredMedia.Type;

/** A local media path a spec write left as written, and why. */
export const ThreadSpecUnstoredMedia = Schema.Struct({
  path: Schema.String,
  reason: Schema.Literals(["not-found", "too-large", "not-allowed", "copy-failed"]),
});
export type ThreadSpecUnstoredMedia = typeof ThreadSpecUnstoredMedia.Type;
