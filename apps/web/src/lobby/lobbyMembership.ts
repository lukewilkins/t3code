import * as Schema from "effect/Schema";

import {
  readLocalStorageValue,
  useLocalStorage,
  writeLocalStorageValue,
} from "~/hooks/useLocalStorage";

// Per browser, like the lobby's other view settings: which threads someone pulled in by hand.
const LOBBY_ADDED_KEY = "t3code:lobby:added";
const LobbyAddedKeys = Schema.Array(Schema.String);
const NO_KEYS: ReadonlyArray<string> = [];

export function useLobbyAddedKeys(): ReadonlySet<string> {
  const [keys] = useLocalStorage(LOBBY_ADDED_KEY, NO_KEYS, LobbyAddedKeys);
  return new Set(keys);
}

export function isThreadAddedToLobby(key: string): boolean {
  return readLocalStorageValue(LOBBY_ADDED_KEY, NO_KEYS, LobbyAddedKeys).includes(key);
}

export function addThreadsToLobby(keys: ReadonlyArray<string>) {
  if (keys.length === 0) return;
  writeLocalStorageValue(
    LOBBY_ADDED_KEY,
    (current) => [...current, ...keys.filter((key) => !current.includes(key))],
    NO_KEYS,
    LobbyAddedKeys,
  );
}

export function removeThreadsFromLobby(keys: ReadonlyArray<string>) {
  if (keys.length === 0) return;
  writeLocalStorageValue(
    LOBBY_ADDED_KEY,
    (current) => current.filter((key) => !keys.includes(key)),
    NO_KEYS,
    LobbyAddedKeys,
  );
}
