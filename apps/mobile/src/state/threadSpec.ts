import { createThreadSpecEnvironmentAtoms } from "@t3tools/client-runtime/state/thread-spec";

import { connectionAtomRuntime } from "../connection/runtime";

export const threadSpecEnvironment = createThreadSpecEnvironmentAtoms(connectionAtomRuntime);
