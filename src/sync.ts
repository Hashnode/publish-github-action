import * as fs from "fs/promises";
import * as path from "path";
import { MUTATIONS, QUERIES, type GqlRequester } from "./gql";
import { parsePostFile } from "./frontmatter";
import { processImages } from "./images";
import type { FileResult, PostFrontmatter } from "./types";

export interface SyncContext {
  client: GqlRequester;
  workspace: string;
  defaultPublicationId: string;
  dryRun: boolean;
  hostCache: Map<string, string>;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as T;
}

export async function resolvePublicationId(
  client: GqlRequester,
  idOrHost: { id?: string; host?: string }
): Promise<string> {
  if (idOrHost.id) {
    const data = await client.request<{ publication: { id: string } | null }>(
      QUERIES.publicationById,
      { id: idOrHost.id }
    );
    if (!data.publication) throw new Error(`Publication "${idOrHost.id}" not found.`);
    return data.publication.id;
  }
  const data = await client.request<{ publication: { id: string } | null }>(
    QUERIES.publicationByHost,
    { host: idOrHost.host }
  );
  if (!data.publication) throw new Error(`Publication host "${idOrHost.host}" not found.`);
  return data.publication.id;
}

async function publicationForPost(
  ctx: SyncContext,
  frontmatter: PostFrontmatter
): Promise<string> {
  if (!frontmatter.domain) return ctx.defaultPublicationId;
  const cached = ctx.hostCache.get(frontmatter.domain);
  if (cached) return cached;
  const id = await resolvePublicationId(ctx.client, { host: frontmatter.domain });
  ctx.hostCache.set(frontmatter.domain, id);
  return id;
}

async function findExistingPost(
  client: GqlRequester,
  publicationId: string,
  slug: string
): Promise<{ id: string; slug: string; url: string } | null> {
  const data = await client.request<{
    publication: { post: { id: string; slug: string; url: string } | null } | null;
  }>(QUERIES.postBySlug, { id: publicationId, slug });
  return data.publication?.post ?? null;
}

async function resolveSeriesId(
  client: GqlRequester,
  publicationId: string,
  seriesSlug: string
): Promise<string> {
  const data = await client.request<{
    publication: { series: { id: string } | null } | null;
  }>(QUERIES.seriesBySlug, { id: publicationId, slug: seriesSlug });
  const series = data.publication?.series;
  if (!series) {
    throw new Error(
      `Series "${seriesSlug}" was not found in the publication. Create it in the dashboard first.`
    );
  }
  return series.id;
}

async function resolveUserId(client: GqlRequester, username: string): Promise<string> {
  const data = await client.request<{ user: { id: string } | null }>(
    QUERIES.userByUsername,
    { username: username.replace(/^@/, "") }
  );
  if (!data.user) throw new Error(`User "${username}" was not found.`);
  return data.user.id;
}

interface ResolvedRefs {
  seriesId?: string;
  publishAsId?: string;
  coAuthorIds?: string[];
}

async function resolveReferences(
  ctx: SyncContext,
  publicationId: string,
  frontmatter: PostFrontmatter
): Promise<ResolvedRefs> {
  const refs: ResolvedRefs = {};
  if (frontmatter.seriesSlug) {
    refs.seriesId = await resolveSeriesId(ctx.client, publicationId, frontmatter.seriesSlug);
  }
  if (frontmatter.publishAs) {
    refs.publishAsId = await resolveUserId(ctx.client, frontmatter.publishAs);
  }
  if (frontmatter.coAuthors.length > 0) {
    refs.coAuthorIds = [];
    for (const username of frontmatter.coAuthors) {
      refs.coAuthorIds.push(await resolveUserId(ctx.client, username));
    }
  }
  return refs;
}

function buildPublishInput(
  publicationId: string,
  frontmatter: PostFrontmatter,
  markdown: string,
  cover: string | undefined,
  refs: ResolvedRefs
): Record<string, unknown> {
  return omitUndefined({
    publicationId,
    title: frontmatter.title,
    subtitle: frontmatter.subtitle,
    contentMarkdown: markdown,
    coverImage: cover,
    slug: frontmatter.slug,
    tags: frontmatter.tags.map((slug) => ({ slug })),
    originalArticleURL: frontmatter.canonical,
    metaTitle: frontmatter.seoTitle,
    metaDescription: frontmatter.seoDescription,
    ogImage: frontmatter.ogImage,
    disableComments: frontmatter.disableComments,
    isDelisted: frontmatter.hideFromCommunity,
    enableToc: frontmatter.enableToc,
    publishAs: refs.publishAsId,
    coAuthors: refs.coAuthorIds,
    seriesId: refs.seriesId,
    publishedAt: frontmatter.publishedAt,
  });
}

function buildUpdateInput(
  postId: string,
  frontmatter: PostFrontmatter,
  markdown: string,
  cover: string | undefined,
  refs: ResolvedRefs
): Record<string, unknown> {
  // The slug is intentionally not sent: it is the idempotency key that
  // located the post, and updatePost rejects slug collisions.
  return omitUndefined({
    id: postId,
    title: frontmatter.title,
    subtitle: frontmatter.subtitle,
    contentMarkdown: markdown,
    coverImage: cover,
    tags: frontmatter.tags.map((slug) => ({ slug })),
    originalArticleURL: frontmatter.canonical,
    metaTitle: frontmatter.seoTitle,
    metaDescription: frontmatter.seoDescription,
    ogImage: frontmatter.ogImage,
    disableComments: frontmatter.disableComments,
    isDelisted: frontmatter.hideFromCommunity,
    enableToc: frontmatter.enableToc,
    publishAs: refs.publishAsId,
    coAuthors: refs.coAuthorIds,
    seriesId: refs.seriesId,
    publishedAt: frontmatter.publishedAt,
  });
}

function buildDraftInput(
  publicationId: string,
  frontmatter: PostFrontmatter,
  markdown: string,
  cover: string | undefined,
  refs: ResolvedRefs
): Record<string, unknown> {
  const metaTags = omitUndefined({
    title: frontmatter.seoTitle,
    description: frontmatter.seoDescription,
    image: frontmatter.ogImage,
  });
  const settings = omitUndefined({
    enableTableOfContent: frontmatter.enableToc,
    delist: frontmatter.hideFromCommunity,
    slugOverridden: frontmatter.slugProvided || undefined,
  });
  return omitUndefined({
    publicationId,
    title: frontmatter.title,
    subtitle: frontmatter.subtitle,
    contentMarkdown: markdown,
    slug: frontmatter.slug,
    tags: frontmatter.tags.map((slug) => ({ slug })),
    seriesId: refs.seriesId,
    disableComments: frontmatter.disableComments,
    originalArticleURL: frontmatter.canonical,
    publishedAt: frontmatter.publishedAt,
    settings: Object.keys(settings).length > 0 ? settings : undefined,
    metaTags: Object.keys(metaTags).length > 0 ? metaTags : undefined,
    coverImageOptions: cover ? { coverImageURL: cover } : undefined,
    publishAs: refs.publishAsId,
    coAuthors: refs.coAuthorIds,
  });
}

export async function processFile(ctx: SyncContext, relativePath: string): Promise<FileResult> {
  const absolutePath = path.join(ctx.workspace, relativePath);
  const raw = await fs.readFile(absolutePath, "utf8");

  const { post, errors } = parsePostFile(raw);
  if (!post) {
    return { file: relativePath, action: "error", message: errors.join(" ") };
  }
  const { frontmatter } = post;

  if (frontmatter.ignorePost) {
    return {
      file: relativePath,
      action: "skipped",
      slug: frontmatter.slug,
      message: "ignorePost is set.",
    };
  }

  const publicationId = await publicationForPost(ctx, frontmatter);
  const existing = await findExistingPost(ctx.client, publicationId, frontmatter.slug);

  if (ctx.dryRun) {
    const action = existing
      ? "would-update"
      : frontmatter.saveAsDraft
        ? "would-draft"
        : "would-publish";
    return { file: relativePath, action, slug: frontmatter.slug, url: existing?.url };
  }

  const images = await processImages(
    ctx.client,
    ctx.workspace,
    relativePath,
    post.markdown,
    frontmatter.cover
  );
  const refs = await resolveReferences(ctx, publicationId, frontmatter);

  if (existing) {
    const input = buildUpdateInput(existing.id, frontmatter, images.markdown, images.cover, refs);
    const data = await ctx.client.request<{ updatePost: { post: { slug: string; url: string } } }>(
      MUTATIONS.updatePost,
      { input }
    );
    return {
      file: relativePath,
      action: "updated",
      slug: data.updatePost.post.slug,
      url: data.updatePost.post.url,
      message: frontmatter.saveAsDraft
        ? "saveAsDraft was ignored because the post is already published."
        : undefined,
    };
  }

  if (frontmatter.saveAsDraft) {
    const input = buildDraftInput(publicationId, frontmatter, images.markdown, images.cover, refs);
    const data = await ctx.client.request<{ createDraft: { draft: { id: string; slug: string } } }>(
      MUTATIONS.createDraft,
      { input }
    );
    return { file: relativePath, action: "drafted", slug: data.createDraft.draft.slug };
  }

  const input = buildPublishInput(publicationId, frontmatter, images.markdown, images.cover, refs);
  const data = await ctx.client.request<{ publishPost: { post: { slug: string; url: string } } }>(
    MUTATIONS.publishPost,
    { input }
  );
  const returnedSlug = data.publishPost.post.slug;
  return {
    file: relativePath,
    action: "published",
    slug: returnedSlug,
    url: data.publishPost.post.url,
    message:
      returnedSlug !== frontmatter.slug
        ? `Slug "${frontmatter.slug}" was taken; the API assigned "${returnedSlug}". Update the frontmatter slug to keep future pushes in sync.`
        : undefined,
  };
}
