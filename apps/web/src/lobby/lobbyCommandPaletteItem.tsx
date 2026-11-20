import { LayoutGridIcon } from "lucide-react";

import { type CommandPaletteActionItem, ITEM_ICON_CLASS } from "../components/CommandPalette.logic";

/** The command palette's "Open lobby" action. */
export function lobbyCommandPaletteItem(input: {
  readonly title: string;
  readonly open: () => Promise<unknown>;
}): CommandPaletteActionItem {
  return {
    kind: "action",
    value: "action:lobby",
    searchTerms: ["lobby", "grid", "cards", "active threads", "watch", "overview"],
    title: input.title,
    icon: <LayoutGridIcon className={ITEM_ICON_CLASS} />,
    run: async () => {
      await input.open();
    },
  };
}
