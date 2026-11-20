import { createFileRoute } from "@tanstack/react-router";

import { LobbyPage } from "../lobby/LobbyPage";

export const Route = createFileRoute("/_chat/lobby")({
  component: LobbyPage,
});
