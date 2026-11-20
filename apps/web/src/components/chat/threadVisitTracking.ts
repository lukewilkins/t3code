import { createContext } from "react";

/** False for hosts that show a thread without the user opening it, so it records no open or visit. */
export const ThreadVisitTrackingContext = createContext(true);
