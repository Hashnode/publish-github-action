import matter from "gray-matter";
import type { PostFrontmatter } from "./types";

const MAX_TAGS = 15;
const MAX_CO_AUTHORS = 4;

// Same normalization the API applies to tag slugs.
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-\s]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return undefined;
}

// Accepts "a, b, c" or a YAML list.
function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export interface ParsedPost {
  frontmatter: PostFrontmatter;
  markdown: string;
}

export interface ParseOutcome {
  post?: ParsedPost;
  errors: string[];
}

export function parsePostFile(content: string): ParseOutcome {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch (error) {
    return { errors: [`Invalid frontmatter: ${(error as Error).message}`] };
  }

  const data = parsed.data as Record<string, unknown>;
  const errors: string[] = [];

  const title = asString(data.title);
  if (!title) {
    errors.push('Missing required frontmatter field "title".');
  }

  const providedSlug = asString(data.slug);
  const slug = providedSlug ? slugify(providedSlug) : title ? slugify(title) : "";
  if (!slug) {
    errors.push("Could not derive a slug from the frontmatter.");
  }

  const tags = asList(data.tags).map(slugify).filter(Boolean);
  if (tags.length > MAX_TAGS) {
    errors.push(`Too many tags (${tags.length}). The API allows at most ${MAX_TAGS}.`);
  }

  const coAuthors = asList(data.coAuthors);
  if (coAuthors.length > MAX_CO_AUTHORS) {
    errors.push(
      `Too many coAuthors (${coAuthors.length}). The API allows at most ${MAX_CO_AUTHORS}.`
    );
  }

  const publishedAt = asString(data.publishedAt);
  if (publishedAt && Number.isNaN(Date.parse(publishedAt))) {
    errors.push(`Invalid publishedAt date: "${publishedAt}".`);
  }

  const markdown = parsed.content.trim();
  if (!markdown) {
    errors.push("The post body is empty.");
  }

  if (errors.length > 0) {
    return { errors };
  }

  const frontmatter: PostFrontmatter = {
    title: title!,
    slug,
    slugProvided: Boolean(providedSlug),
    subtitle: asString(data.subtitle),
    tags,
    cover: asString(data.cover) ?? asString(data.coverImage),
    canonical: asString(data.canonical) ?? asString(data.canonicalUrl),
    seriesSlug: asString(data.seriesSlug),
    seoTitle: asString(data.seoTitle),
    seoDescription: asString(data.seoDescription),
    ogImage: asString(data.ogImage),
    enableToc: asBoolean(data.enableToc),
    disableComments: asBoolean(data.disableComments),
    publishAs: asString(data.publishAs),
    coAuthors,
    publishedAt,
    saveAsDraft: asBoolean(data.saveAsDraft) ?? false,
    ignorePost: asBoolean(data.ignorePost) ?? false,
    hideFromCommunity:
      asBoolean(data.hideFromCommunity) ??
      asBoolean(data.hideFromHashnodeCommunity),
    domain: asString(data.domain),
  };

  return { post: { frontmatter, markdown }, errors: [] };
}
