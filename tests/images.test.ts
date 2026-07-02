import { describe, expect, it } from "vitest";
import {
  findLocalImagePaths,
  isRemoteUrl,
  resolveImagePath,
  rewriteImagePath,
} from "../src/images";

describe("isRemoteUrl", () => {
  it("detects remote and data URLs", () => {
    expect(isRemoteUrl("https://example.com/a.png")).toBe(true);
    expect(isRemoteUrl("http://example.com/a.png")).toBe(true);
    expect(isRemoteUrl("//example.com/a.png")).toBe(true);
    expect(isRemoteUrl("data:image/png;base64,xyz")).toBe(true);
    expect(isRemoteUrl("./images/a.png")).toBe(false);
    expect(isRemoteUrl("/images/a.png")).toBe(false);
  });
});

describe("findLocalImagePaths", () => {
  it("finds only local image references", () => {
    const markdown = [
      "![local](./images/one.png)",
      "![remote](https://cdn.example.com/two.png)",
      '![titled](images/three.jpg "A title")',
      '![aligned](/assets/four.webp align="center")',
      "![dupe](./images/one.png)",
    ].join("\n\n");
    expect(findLocalImagePaths(markdown)).toEqual([
      "./images/one.png",
      "images/three.jpg",
      "/assets/four.webp",
    ]);
  });
});

describe("resolveImagePath", () => {
  it("resolves relative to the markdown file", () => {
    expect(resolveImagePath("/repo", "posts/a.md", "./images/pic.png")).toBe(
      "/repo/posts/images/pic.png"
    );
  });

  it("resolves leading slash to the repository root", () => {
    expect(resolveImagePath("/repo", "posts/a.md", "/assets/pic.png")).toBe(
      "/repo/assets/pic.png"
    );
  });

  it("rejects paths escaping the repository", () => {
    expect(() => resolveImagePath("/repo", "posts/a.md", "../../etc/passwd")).toThrow(
      /outside the repository/
    );
  });
});

describe("rewriteImagePath", () => {
  it("rewrites the path and keeps title and align suffixes", () => {
    const markdown = '![a](./one.png)\n![b](./one.png "Title")\n![c](./one.png align="center")';
    const rewritten = rewriteImagePath(markdown, "./one.png", "https://cdn.hashnode.com/k.png");
    expect(rewritten).toBe(
      '![a](https://cdn.hashnode.com/k.png)\n![b](https://cdn.hashnode.com/k.png "Title")\n![c](https://cdn.hashnode.com/k.png align="center")'
    );
  });

  it("does not rewrite other paths sharing a prefix", () => {
    const markdown = "![a](./one.png)\n![b](./one.png.bak)";
    const rewritten = rewriteImagePath(markdown, "./one.png", "https://cdn.hashnode.com/k.png");
    expect(rewritten).toContain("![b](./one.png.bak)");
  });
});
