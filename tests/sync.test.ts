import { describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { GqlRequester } from "../src/gql";
import { processFile, type SyncContext } from "../src/sync";

interface RecordedCall {
  query: string;
  variables: Record<string, unknown>;
}

function makeMock(options: {
  existingPost?: { id: string; slug: string; url: string } | null;
  series?: { id: string } | null;
  users?: Record<string, string>;
}): { client: GqlRequester; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: GqlRequester = {
    async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
      calls.push({ query, variables });
      if (query.includes("post(slug:")) {
        return { publication: { post: options.existingPost ?? null } } as T;
      }
      if (query.includes("series(slug:")) {
        return { publication: { series: options.series ?? null } } as T;
      }
      if (query.includes("user(username:")) {
        const id = options.users?.[variables.username as string];
        return { user: id ? { id } : null } as T;
      }
      if (query.includes("publication(host:")) {
        return { publication: { id: "pub-from-host", url: "https://other.example" } } as T;
      }
      if (query.includes("publishPost")) {
        const input = variables.input as { slug: string };
        return {
          publishPost: { post: { id: "p1", slug: input.slug, url: `https://blog/${input.slug}` } },
        } as T;
      }
      if (query.includes("updatePost")) {
        return {
          updatePost: { post: { id: "p1", slug: "existing-slug", url: "https://blog/existing-slug" } },
        } as T;
      }
      if (query.includes("createDraft")) {
        return { createDraft: { draft: { id: "d1", slug: "draft-slug" } } } as T;
      }
      throw new Error(`Unexpected query: ${query}`);
    },
  };
  return { client, calls };
}

async function writeTempPost(content: string): Promise<{ workspace: string; file: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "pub-action-"));
  const file = "posts/test.md";
  await fs.mkdir(path.join(workspace, "posts"), { recursive: true });
  await fs.writeFile(path.join(workspace, file), content);
  return { workspace, file };
}

function contextFor(client: GqlRequester, workspace: string, dryRun = false): SyncContext {
  return { client, workspace, defaultPublicationId: "pub-1", dryRun, hostCache: new Map() };
}

const BASIC_POST = `---
title: Test Post
slug: test-post
tags: testing
---

Some body content.
`;

describe("processFile decision matrix", () => {
  it("publishes a new post", async () => {
    const { client, calls } = makeMock({ existingPost: null });
    const { workspace, file } = await writeTempPost(BASIC_POST);
    const result = await processFile(contextFor(client, workspace), file);
    expect(result.action).toBe("published");
    expect(result.slug).toBe("test-post");
    const publish = calls.find((call) => call.query.includes("publishPost"))!;
    const input = publish.variables.input as Record<string, unknown>;
    expect(input.publicationId).toBe("pub-1");
    expect(input.tags).toEqual([{ slug: "testing" }]);
    expect(input).not.toHaveProperty("seriesId");
  });

  it("updates an existing post and does not send the slug", async () => {
    const { client, calls } = makeMock({
      existingPost: { id: "p1", slug: "test-post", url: "https://blog/test-post" },
    });
    const { workspace, file } = await writeTempPost(BASIC_POST);
    const result = await processFile(contextFor(client, workspace), file);
    expect(result.action).toBe("updated");
    const update = calls.find((call) => call.query.includes("updatePost"))!;
    const input = update.variables.input as Record<string, unknown>;
    expect(input.id).toBe("p1");
    expect(input).not.toHaveProperty("slug");
    expect(calls.some((call) => call.query.includes("publishPost"))).toBe(false);
  });

  it("creates a draft for a new post with saveAsDraft", async () => {
    const { client, calls } = makeMock({ existingPost: null });
    const { workspace, file } = await writeTempPost(BASIC_POST.replace("---\n\n", "saveAsDraft: true\n---\n\n"));
    const result = await processFile(contextFor(client, workspace), file);
    expect(result.action).toBe("drafted");
    const draft = calls.find((call) => call.query.includes("createDraft"))!;
    const input = draft.variables.input as Record<string, unknown>;
    expect(input.settings).toEqual({ slugOverridden: true });
  });

  it("updates (not drafts) an existing post even with saveAsDraft", async () => {
    const { client } = makeMock({
      existingPost: { id: "p1", slug: "test-post", url: "https://blog/test-post" },
    });
    const { workspace, file } = await writeTempPost(BASIC_POST.replace("---\n\n", "saveAsDraft: true\n---\n\n"));
    const result = await processFile(contextFor(client, workspace), file);
    expect(result.action).toBe("updated");
    expect(result.message).toContain("saveAsDraft was ignored");
  });

  it("skips when ignorePost is set", async () => {
    const { client, calls } = makeMock({ existingPost: null });
    const { workspace, file } = await writeTempPost(BASIC_POST.replace("---\n\n", "ignorePost: true\n---\n\n"));
    const result = await processFile(contextFor(client, workspace), file);
    expect(result.action).toBe("skipped");
    expect(calls).toEqual([]);
  });

  it("reports would-publish and would-update in dry-run without mutating", async () => {
    const newPost = makeMock({ existingPost: null });
    const { workspace, file } = await writeTempPost(BASIC_POST);
    const dryNew = await processFile(contextFor(newPost.client, workspace, true), file);
    expect(dryNew.action).toBe("would-publish");
    expect(newPost.calls.every((call) => !call.query.includes("mutation"))).toBe(true);

    const existing = makeMock({
      existingPost: { id: "p1", slug: "test-post", url: "https://blog/test-post" },
    });
    const dryExisting = await processFile(contextFor(existing.client, workspace, true), file);
    expect(dryExisting.action).toBe("would-update");
  });

  it("returns an error result for invalid frontmatter", async () => {
    const { client, calls } = makeMock({ existingPost: null });
    const { workspace, file } = await writeTempPost("---\ntags: a\n---\n\nBody.\n");
    const result = await processFile(contextFor(client, workspace), file);
    expect(result.action).toBe("error");
    expect(result.message).toContain("title");
    expect(calls).toEqual([]);
  });

  it("resolves seriesSlug to seriesId", async () => {
    const { client, calls } = makeMock({ existingPost: null, series: { id: "s9" } });
    const { workspace, file } = await writeTempPost(BASIC_POST.replace("---\n\n", "seriesSlug: my-series\n---\n\n"));
    await processFile(contextFor(client, workspace), file);
    const publish = calls.find((call) => call.query.includes("publishPost"))!;
    expect((publish.variables.input as Record<string, unknown>).seriesId).toBe("s9");
  });

  it("fails the file when the series does not exist", async () => {
    const { client } = makeMock({ existingPost: null, series: null });
    const { workspace, file } = await writeTempPost(BASIC_POST.replace("---\n\n", "seriesSlug: nope\n---\n\n"));
    await expect(processFile(contextFor(client, workspace), file)).rejects.toThrow(/Series "nope"/);
  });

  it("uses the domain frontmatter override for the target publication", async () => {
    const { client, calls } = makeMock({ existingPost: null });
    const { workspace, file } = await writeTempPost(BASIC_POST.replace("---\n\n", "domain: other.hashnode.dev\n---\n\n"));
    await processFile(contextFor(client, workspace), file);
    const publish = calls.find((call) => call.query.includes("publishPost"))!;
    expect((publish.variables.input as Record<string, unknown>).publicationId).toBe("pub-from-host");
  });

  it("warns when the API assigns a different slug", async () => {
    const calls: RecordedCall[] = [];
    const client: GqlRequester = {
      async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
        calls.push({ query, variables });
        if (query.includes("post(slug:")) return { publication: { post: null } } as T;
        if (query.includes("publishPost")) {
          return {
            publishPost: { post: { id: "p1", slug: "test-post-abc123", url: "https://blog/x" } },
          } as T;
        }
        throw new Error(`Unexpected query: ${query}`);
      },
    };
    const { workspace, file } = await writeTempPost(BASIC_POST);
    const result = await processFile(contextFor(client, workspace), file);
    expect(result.action).toBe("published");
    expect(result.message).toContain('assigned "test-post-abc123"');
  });
});
