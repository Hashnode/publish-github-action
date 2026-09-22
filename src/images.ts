import * as fs from "fs/promises";
import * as path from "path";
import { GqlError, MUTATIONS, type GqlRequester } from "./gql";

const MAX_IMAGE_BYTES = 8_000_000;

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

// ![alt](path "title") or ![alt](path align="center") — path is the first
// token after the opening parenthesis.
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(\s*([^)\s]+)([^)]*)\)/g;

export function isRemoteUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value) || value.startsWith("data:");
}

export function findLocalImagePaths(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const imagePath = match[1];
    if (!isRemoteUrl(imagePath)) found.add(imagePath);
  }
  return [...found];
}

/**
 * Resolves an image reference from a markdown file to an absolute path on
 * disk. Leading "/" means repository root; anything else is relative to the
 * markdown file. Rejects paths that escape the repository.
 */
export function resolveImagePath(
  workspace: string,
  markdownFile: string,
  imagePath: string
): string {
  const decoded = decodeURI(imagePath);
  const absolute = decoded.startsWith("/")
    ? path.join(workspace, decoded)
    : path.resolve(workspace, path.dirname(markdownFile), decoded);
  if (!absolute.startsWith(workspace + path.sep)) {
    throw new Error(`Image path "${imagePath}" points outside the repository.`);
  }
  return absolute;
}

export async function uploadImage(
  client: GqlRequester,
  absolutePath: string
): Promise<string> {
  const extension = path.extname(absolutePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) {
    throw new Error(
      `Unsupported image type "${extension || "none"}" (${path.basename(absolutePath)}). ` +
        `Supported: ${Object.keys(CONTENT_TYPES).join(", ")}. SVG is not accepted by the API.`
    );
  }

  const buffer = await fs.readFile(absolutePath);
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image ${path.basename(absolutePath)} is ${Math.round(buffer.byteLength / 1_000_000)} MB; the API limit is 8 MB.`
    );
  }

  // The presigned URL expires shortly — upload immediately.
  const data = await client.request<{
    createImageUploadURL: {
      presignedPut: { url: string; cdnUrl: string; key: string };
    };
  }>(MUTATIONS.createImageUploadURL, { input: { contentType } });

  const { presignedPut } = data.createImageUploadURL;

  const response = await fetch(presignedPut.url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buffer,
  });
  if (!response.ok) {
    throw new GqlError(
      `Image upload for ${path.basename(absolutePath)} failed with HTTP ${response.status}.`
    );
  }

  // A PUT can't enforce the size cap the way the legacy POST flow did —
  // confirmImageUpload does that check after the fact and deletes the
  // object if it's over the limit. Our own MAX_IMAGE_BYTES check above
  // should already prevent this in practice.
  const confirmed = await client.request<{
    confirmImageUpload: { ok: boolean; cdnUrl: string | null };
  }>(MUTATIONS.confirmImageUpload, { input: { key: presignedPut.key } });

  if (!confirmed.confirmImageUpload.ok) {
    throw new GqlError(
      `Image ${path.basename(absolutePath)} was rejected after upload (exceeds the API's 8 MB limit).`
    );
  }

  return confirmed.confirmImageUpload.cdnUrl ?? presignedPut.cdnUrl;
}

export function rewriteImagePath(
  markdown: string,
  originalPath: string,
  cdnUrl: string
): string {
  return markdown.replaceAll(
    new RegExp(
      `(!\\[[^\\]]*\\]\\(\\s*)${originalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[)\\s])`,
      "g"
    ),
    `$1${cdnUrl}`
  );
}

export interface ImageUploadOutcome {
  markdown: string;
  cover?: string;
  uploaded: number;
}

/**
 * Uploads every local image referenced by the post (body + cover) to the
 * Hashnode CDN and rewrites the references.
 */
export async function processImages(
  client: GqlRequester,
  workspace: string,
  markdownFile: string,
  markdown: string,
  cover: string | undefined
): Promise<ImageUploadOutcome> {
  let resultMarkdown = markdown;
  let resultCover = cover;
  let uploaded = 0;

  for (const imagePath of findLocalImagePaths(markdown)) {
    const absolute = resolveImagePath(workspace, markdownFile, imagePath);
    const cdnUrl = await uploadImage(client, absolute);
    resultMarkdown = rewriteImagePath(resultMarkdown, imagePath, cdnUrl);
    uploaded += 1;
  }

  if (resultCover && !isRemoteUrl(resultCover)) {
    const absolute = resolveImagePath(workspace, markdownFile, resultCover);
    resultCover = await uploadImage(client, absolute);
    uploaded += 1;
  }

  return { markdown: resultMarkdown, cover: resultCover, uploaded };
}
