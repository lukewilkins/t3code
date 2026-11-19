import { createFileRoute } from "@tanstack/react-router";

import { threadRouteSearchFromUrl } from "../components/chat/threadView.logic";

// The _chat layout owns ChatView so draft promotion keeps it mounted.
export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: threadRouteSearchFromUrl,
  component: () => null,
});
