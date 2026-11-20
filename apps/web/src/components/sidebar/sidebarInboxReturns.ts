import { createInboxReturnTracker } from "@t3tools/client-runtime/state/thread-inbox";

/** The sidebar observes it; the lobby reads it to order threads the same way. */
export const sidebarInboxReturns = createInboxReturnTracker();
