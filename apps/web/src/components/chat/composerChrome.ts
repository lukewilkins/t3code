import { createContext } from "react";

/**
 * "minimal" keeps only the prompt, attach, dictation and send, and sits the composer flush in its
 * host with a top rule; hosts such as lobby cards set it.
 */
export const ComposerChromeContext = createContext<"full" | "minimal">("full");
