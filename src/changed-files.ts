import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs/promises";
import * as path from "path";

const EMPTY_SHA = /^0+$/;

function isMarkdownPost(relativePath: string, postsDirectory: string): boolean {
  if (!relativePath.toLowerCase().endsWith(".md")) return false;
  if (path.basename(relativePath).toLowerCase() === "readme.md") return false;
  const normalizedDir = postsDirectory === "." ? "" : postsDirectory.replace(/\/+$/, "") + "/";
  return relativePath.startsWith(normalizedDir);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function walkForMarkdown(root: string, dir: string, found: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForMarkdown(root, absolute, found);
    } else if (entry.isFile()) {
      found.push(path.relative(root, absolute));
    }
  }
}

async function diffChangedFiles(before: string, after: string): Promise<string[] | null> {
  let stdout = "";
  try {
    const exitCode = await exec.exec(
      "git",
      ["diff", "--name-only", "--diff-filter=AM", before, after],
      {
        silent: true,
        ignoreReturnCode: true,
        listeners: { stdout: (data) => (stdout += data.toString()) },
      }
    );
    if (exitCode !== 0) return null;
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

export interface ChangedFilesContext {
  eventName: string;
  before?: string;
  after?: string;
}

export interface ChangedFilesResult {
  files: string[];
  truncated: string[];
}

/**
 * Returns repository-relative paths of markdown posts to process.
 * On push events, diffs the pushed range (requires fetch-depth >= 2);
 * otherwise, or when the diff is unavailable, scans posts-directory.
 */
export async function detectChangedFiles(
  workspace: string,
  postsDirectory: string,
  maxFiles: number,
  context: ChangedFilesContext
): Promise<ChangedFilesResult> {
  let candidates: string[] | null = null;

  if (
    context.eventName === "push" &&
    context.before &&
    context.after &&
    !EMPTY_SHA.test(context.before)
  ) {
    candidates = await diffChangedFiles(context.before, context.after);
    if (candidates === null) {
      core.warning(
        "Could not diff the pushed commit range (is fetch-depth at least 2?). Falling back to scanning the posts directory."
      );
    }
  }

  if (candidates === null) {
    const scanRoot =
      postsDirectory === "." ? workspace : path.join(workspace, postsDirectory);
    const found: string[] = [];
    try {
      await walkForMarkdown(workspace, scanRoot, found);
    } catch {
      throw new Error(`posts-directory "${postsDirectory}" does not exist in the repository.`);
    }
    candidates = found;
  }

  const posts: string[] = [];
  for (const candidate of candidates) {
    if (!isMarkdownPost(candidate, postsDirectory)) continue;
    if (await fileExists(path.join(workspace, candidate))) {
      posts.push(candidate);
    }
  }
  posts.sort();

  return {
    files: posts.slice(0, maxFiles),
    truncated: posts.slice(maxFiles),
  };
}
