# Publish to Hashnode

Publish markdown files from a GitHub repository to your Hashnode publication. Push a `.md` file, get a published post. Edit the file, push again, and the post updates in place.

Publishing via the API requires a publication on **Hashnode Pro**.

## Setup

1. Generate a Personal Access Token in [Settings → Developer](https://hashnode.com/settings/developer).
2. In your repository, add it as a secret named `HASHNODE_PAT` (Settings → Secrets and variables → Actions).
3. Add the workflow below and set your publication host or id.

```yaml
name: Publish to Hashnode

on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: Hashnode/publish-github-action@v1
        with:
          access-token: ${{ secrets.HASHNODE_PAT }}
          publication-host: myblog.hashnode.dev
          posts-directory: posts
```

`fetch-depth: 2` matters. The action diffs the pushed commits to find changed files. With a shallow single-commit checkout it falls back to scanning the whole posts directory.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `access-token` | yes | none | Hashnode Personal Access Token |
| `publication-id` | one of the two | none | Target publication id |
| `publication-host` | one of the two | none | Target publication host, e.g. `myblog.hashnode.dev` |
| `posts-directory` | no | `.` | Directory containing the markdown posts |
| `gql-endpoint` | no | `https://gql-beta.hashnode.com` | API endpoint override |
| `dry-run` | no | `false` | Validate and report without publishing |
| `max-files` | no | `10` | Maximum files processed per run |

## Frontmatter

Every post needs YAML frontmatter. `title` is required; a stable `slug` is strongly recommended because it is how the action matches a file to an existing post on later pushes.

```yaml
---
title: How I built my blog
slug: how-i-built-my-blog
subtitle: A tour of the stack
tags: javascript, nextjs, web-dev
cover: ./images/cover.png
seriesSlug: building-in-public
canonical: https://example.com/original
seoTitle: How I built my blog with Next.js
seoDescription: A walkthrough of the stack behind my blog.
ogImage: https://example.com/og.png
enableToc: true
disableComments: false
publishedAt: 2026-07-01T09:00:00Z
saveAsDraft: false
ignorePost: false
hideFromCommunity: false
publishAs: someusername
coAuthors: user1, user2
domain: other-blog.hashnode.dev
---
```

| Field | Notes |
|-------|-------|
| `title` | Required |
| `slug` | Defaults to a slug of the title. Keep it stable. It is the update key |
| `tags` | Comma-separated or YAML list of tag slugs, max 15. Unknown tags are created |
| `cover` | Cover image URL, or a repo path that gets uploaded (alias: `coverImage`) |
| `seriesSlug` | Slug of an existing series in the publication |
| `canonical` | Canonical URL for republished articles (alias: `canonicalUrl`) |
| `seoTitle`, `seoDescription`, `ogImage` | SEO and Open Graph overrides |
| `enableToc` | Show a table of contents |
| `disableComments` | Disable comments |
| `publishedAt` | ISO 8601 date, backdates the post |
| `saveAsDraft` | Create a draft instead of publishing. Only applies to new posts |
| `ignorePost` | Skip this file entirely |
| `hideFromCommunity` | Delist the post from feeds (alias: `hideFromHashnodeCommunity`) |
| `publishAs` | Username of a publication member to publish as (team publications) |
| `coAuthors` | Usernames of publication members, max 4 |
| `domain` | Per-file publication override. Only needed when one repo feeds several publications |

## Images

Relative image paths in the body and in `cover` are uploaded to the Hashnode CDN and the references are rewritten. Paths resolve relative to the markdown file; a leading `/` resolves from the repository root. Supported: jpg, png, gif, webp, avif, up to 8 MB. SVG is not accepted by the API. Absolute `https://` URLs pass through untouched.

## Behavior details

- **Create vs update.** The action looks up `slug` in the publication. Found → the post is updated in place (content, tags, series, SEO). Not found → a new post is published.
- **Slug collisions.** If your slug is taken by another post at publish time, the API assigns a suffixed slug. The run summary warns you; update the frontmatter slug to keep future pushes in sync.
- **Drafts.** `saveAsDraft: true` creates a draft for new posts. Re-pushing the same file while it is still a draft creates another draft, so publish or remove the flag once done.
- **Deleted files are ignored.** Deleting a markdown file never deletes or delists the post. Manage that from your dashboard.
- **Per-file isolation.** One invalid file doesn't block the rest. The run fails only when every file fails.
- **Post size.** The API rejects request bodies over ~100 KB. The action skips oversized posts with a clear error.
- **README.md** at any level is never published.
- **Dollar signs.** `$...$` in a paragraph renders as inline LaTeX. Escape literal dollars in prose.

## Outputs

- `result`: JSON: `{ "processed": [{ "file", "action", "slug", "url", "message" }] }`
- `result_summary`: one-line summary

A results table is also written to the workflow step summary.

## Development

```
npm install
npm test
npm run build   # bundles src into dist/index.js; commit dist
```
