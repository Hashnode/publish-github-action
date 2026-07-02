import * as core from "@actions/core";
import * as github from "@actions/github";
import { readInputs } from "./inputs";
import { GqlClient, GqlError } from "./gql";
import { detectChangedFiles } from "./changed-files";
import { processFile, resolvePublicationId, type SyncContext } from "./sync";
import type { FileResult } from "./types";

const ACTION_LABELS: Record<string, string> = {
  published: "Published",
  updated: "Updated",
  drafted: "Draft created",
  skipped: "Skipped",
  error: "Error",
  "would-publish": "Would publish",
  "would-update": "Would update",
  "would-draft": "Would create draft",
};

function describeError(error: unknown): string {
  if (error instanceof GqlError && error.isProRequired) {
    return (
      "The publication does not have an active Hashnode Pro plan. " +
      "Publishing via the API is a Pro feature — upgrade in your dashboard and re-run. " +
      "The run was not retried."
    );
  }
  return error instanceof Error ? error.message : String(error);
}

async function run(): Promise<void> {
  const inputs = readInputs();
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

  const payload = github.context.payload as { before?: string; after?: string };
  const { files, truncated } = await detectChangedFiles(
    workspace,
    inputs.postsDirectory,
    inputs.maxFiles,
    {
      eventName: github.context.eventName,
      before: payload.before,
      after: payload.after,
    }
  );

  if (truncated.length > 0) {
    core.warning(
      `Processing ${files.length} files; ${truncated.length} more exceeded max-files (${inputs.maxFiles}) and were skipped: ${truncated.join(", ")}`
    );
  }

  if (files.length === 0) {
    core.info("No markdown posts to process in this push.");
    core.setOutput("result", JSON.stringify({ processed: [] }));
    core.setOutput("result_summary", "No markdown posts to process.");
    return;
  }

  core.info(`Processing ${files.length} file(s): ${files.join(", ")}`);
  if (inputs.dryRun) core.info("Dry run: nothing will be published.");

  const client = new GqlClient({ endpoint: inputs.gqlEndpoint, token: inputs.accessToken });
  const defaultPublicationId = await resolvePublicationId(client, {
    id: inputs.publicationId,
    host: inputs.publicationHost,
  });

  const ctx: SyncContext = {
    client,
    workspace,
    defaultPublicationId,
    dryRun: inputs.dryRun,
    hostCache: new Map(),
  };

  const results: FileResult[] = [];
  for (const file of files) {
    try {
      const result = await processFile(ctx, file);
      results.push(result);
      const note = result.message ? ` — ${result.message}` : "";
      core.info(`${ACTION_LABELS[result.action]}: ${file}${note}`);
      if (result.message) core.warning(`${file}: ${result.message}`);
    } catch (error) {
      const message = describeError(error);
      results.push({ file, action: "error", message });
      core.error(`${file}: ${message}`);
    }
  }

  const errors = results.filter((result) => result.action === "error");
  const summaryLine = `${results.length} file(s) processed, ${errors.length} error(s).`;

  core.setOutput("result", JSON.stringify({ processed: results }));
  core.setOutput("result_summary", summaryLine);

  await core.summary
    .addHeading("Publish to Hashnode", 2)
    .addTable([
      [
        { data: "File", header: true },
        { data: "Result", header: true },
        { data: "Slug", header: true },
        { data: "Notes", header: true },
      ],
      ...results.map((result) => [
        result.file,
        ACTION_LABELS[result.action],
        result.url ? `<a href="${result.url}">${result.slug ?? ""}</a>` : (result.slug ?? ""),
        result.message ?? "",
      ]),
    ])
    .write();

  if (errors.length === results.length) {
    core.setFailed(`Every file failed. ${summaryLine}`);
  } else if (errors.length > 0) {
    core.warning(summaryLine);
  } else {
    core.info(summaryLine);
  }
}

run().catch((error) => core.setFailed(describeError(error)));
