import { createFileRoute } from "@tanstack/react-router";

import {
  PipelinesSettings,
  validatePipelinesSearch,
} from "../components/settings/PipelinesSettings";

function SettingsPipelinesRoute() {
  const { pipelineId } = Route.useSearch();
  return <PipelinesSettings {...(pipelineId === undefined ? {} : { pipelineId })} />;
}

export const Route = createFileRoute("/_chat/settings/pipelines")({
  validateSearch: validatePipelinesSearch,
  component: SettingsPipelinesRoute,
});
