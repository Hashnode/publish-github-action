import * as core from "@actions/core";
import type { ActionInputs } from "./types";

export function readInputs(): ActionInputs {
  const accessToken = core.getInput("access-token", { required: true });
  const publicationId = core.getInput("publication-id") || undefined;
  const publicationHost = core.getInput("publication-host") || undefined;

  if (!publicationId && !publicationHost) {
    throw new Error(
      "Provide either the publication-id or the publication-host input."
    );
  }

  const maxFiles = parseInt(core.getInput("max-files") || "10", 10);
  if (!Number.isFinite(maxFiles) || maxFiles < 1) {
    throw new Error("max-files must be a positive integer.");
  }

  return {
    accessToken,
    publicationId,
    publicationHost,
    postsDirectory: core.getInput("posts-directory") || ".",
    gqlEndpoint: core.getInput("gql-endpoint") || "https://gql-beta.hashnode.com",
    dryRun: core.getBooleanInput("dry-run"),
    maxFiles,
  };
}
