export interface ActionInputs {
  accessToken: string;
  publicationId?: string;
  publicationHost?: string;
  postsDirectory: string;
  gqlEndpoint: string;
  dryRun: boolean;
  maxFiles: number;
}

export interface PostFrontmatter {
  title: string;
  slug: string;
  slugProvided: boolean;
  subtitle?: string;
  tags: string[];
  cover?: string;
  canonical?: string;
  seriesSlug?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogImage?: string;
  enableToc?: boolean;
  disableComments?: boolean;
  publishAs?: string;
  coAuthors: string[];
  publishedAt?: string;
  saveAsDraft: boolean;
  ignorePost: boolean;
  hideFromCommunity?: boolean;
  domain?: string;
}

export type FileAction =
  | "published"
  | "updated"
  | "drafted"
  | "skipped"
  | "error"
  | "would-publish"
  | "would-update"
  | "would-draft";

export interface FileResult {
  file: string;
  action: FileAction;
  slug?: string;
  url?: string;
  message?: string;
}

export interface RunResult {
  published: FileResult[];
  updated: FileResult[];
  drafted: FileResult[];
  skipped: FileResult[];
  errors: FileResult[];
}
