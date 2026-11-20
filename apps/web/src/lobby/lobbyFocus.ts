export const LOBBY_PROMPT_SELECTOR = '[data-testid="composer-editor"]';
/** Sent to a `[data-lobby-card]` to mount its thread view if needed and focus its prompt. */
export const LOBBY_FOCUS_REQUEST_EVENT = "lobby:focus-request";

/** Whether keyboard navigation can land on a card: an unmounted card mounts on request. */
export function lobbyCardCanTakeFocus(card: Element) {
  return (
    !card.hasAttribute("data-lobby-mounted") || card.querySelector(LOBBY_PROMPT_SELECTOR) !== null
  );
}
