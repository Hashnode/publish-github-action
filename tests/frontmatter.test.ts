import { describe, expect, it } from "vitest";
import { parsePostFile, slugify } from "../src/frontmatter";

function post(frontmatter: string, body = "Hello world."): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe("slugify", () => {
  it("normalizes like the API", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  C++ & Rust  ")).toBe("c-rust");
    expect(slugify("already-a-slug")).toBe("already-a-slug");
  });
});

describe("parsePostFile", () => {
  it("parses a minimal valid post", () => {
    const { post: parsed, errors } = parsePostFile(post('title: "My Post"\ntags: javascript, web-dev'));
    expect(errors).toEqual([]);
    expect(parsed!.frontmatter.title).toBe("My Post");
    expect(parsed!.frontmatter.slug).toBe("my-post");
    expect(parsed!.frontmatter.slugProvided).toBe(false);
    expect(parsed!.frontmatter.tags).toEqual(["javascript", "web-dev"]);
    expect(parsed!.frontmatter.saveAsDraft).toBe(false);
    expect(parsed!.frontmatter.ignorePost).toBe(false);
    expect(parsed!.markdown).toBe("Hello world.");
  });

  it("requires a title", () => {
    const { post: parsed, errors } = parsePostFile(post("tags: a"));
    expect(parsed).toBeUndefined();
    expect(errors.join(" ")).toContain('"title"');
  });

  it("prefers an explicit slug and normalizes it", () => {
    const { post: parsed } = parsePostFile(post('title: T\nslug: "My Custom Slug"'));
    expect(parsed!.frontmatter.slug).toBe("my-custom-slug");
    expect(parsed!.frontmatter.slugProvided).toBe(true);
  });

  it("accepts tags as a YAML list", () => {
    const { post: parsed } = parsePostFile(post("title: T\ntags:\n  - JavaScript\n  - Web Dev"));
    expect(parsed!.frontmatter.tags).toEqual(["javascript", "web-dev"]);
  });

  it("rejects more than 15 tags", () => {
    const tags = Array.from({ length: 16 }, (_, index) => `tag${index}`).join(", ");
    const { errors } = parsePostFile(post(`title: T\ntags: ${tags}`));
    expect(errors.join(" ")).toContain("Too many tags");
  });

  it("supports legacy aliases", () => {
    const { post: parsed } = parsePostFile(
      post(
        "title: T\ncoverImage: ./img/cover.png\ncanonicalUrl: https://example.com/a\nhideFromHashnodeCommunity: true"
      )
    );
    expect(parsed!.frontmatter.cover).toBe("./img/cover.png");
    expect(parsed!.frontmatter.canonical).toBe("https://example.com/a");
    expect(parsed!.frontmatter.hideFromCommunity).toBe(true);
  });

  it("parses boolean strings", () => {
    const { post: parsed } = parsePostFile(post('title: T\nsaveAsDraft: "true"\nenableToc: "false"'));
    expect(parsed!.frontmatter.saveAsDraft).toBe(true);
    expect(parsed!.frontmatter.enableToc).toBe(false);
  });

  it("rejects an invalid publishedAt", () => {
    const { errors } = parsePostFile(post("title: T\npublishedAt: not-a-date"));
    expect(errors.join(" ")).toContain("publishedAt");
  });

  it("rejects an empty body", () => {
    const { errors } = parsePostFile(post("title: T", ""));
    expect(errors.join(" ")).toContain("body is empty");
  });

  it("rejects more than 4 co-authors", () => {
    const { errors } = parsePostFile(post("title: T\ncoAuthors: a, b, c, d, e"));
    expect(errors.join(" ")).toContain("coAuthors");
  });
});
