import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GqlRequester } from "../src/gql";
import {
  findLocalImagePaths,
  isRemoteUrl,
  resolveImagePath,
  rewriteImagePath,
  uploadImage,
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

describe("uploadImage", () => {
  let tmpDir: string;
  let imagePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upload-image-test-"));
    imagePath = path.join(tmpDir, "cover.png");
    await fs.writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("uses presignedPut when available: PUTs the file, then confirms", async () => {
    const client: GqlRequester = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          createImageUploadURL: {
            presignedPost: { url: "https://storage.invalid/post", fields: { key: "legacy/key.png" } },
            presignedPut: {
              url: "https://storage.invalid/put",
              cdnUrl: "https://cdn.hashnode.com/uploads/gql/u/key.png",
              key: "uploads/gql/u/key.png",
            },
          },
        })
        .mockResolvedValueOnce({
          confirmImageUpload: { ok: true, cdnUrl: "https://cdn.hashnode.com/uploads/gql/u/key.png" },
        }),
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

    const result = await uploadImage(client, imagePath);

    expect(result).toBe("https://cdn.hashnode.com/uploads/gql/u/key.png");
    expect(fetch).toHaveBeenCalledWith(
      "https://storage.invalid/put",
      expect.objectContaining({ method: "PUT" })
    );
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("throws if confirmImageUpload reports the file was rejected", async () => {
    const client: GqlRequester = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          createImageUploadURL: {
            presignedPost: { url: "https://storage.invalid/post", fields: { key: "legacy/key.png" } },
            presignedPut: {
              url: "https://storage.invalid/put",
              cdnUrl: "https://cdn.hashnode.com/uploads/gql/u/key.png",
              key: "uploads/gql/u/key.png",
            },
          },
        })
        .mockResolvedValueOnce({ confirmImageUpload: { ok: false, cdnUrl: null } }),
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

    await expect(uploadImage(client, imagePath)).rejects.toThrow(/8 MB limit/);
  });

  it("falls back to presignedPost when presignedPut is null", async () => {
    const client: GqlRequester = {
      request: vi.fn().mockResolvedValueOnce({
        createImageUploadURL: {
          presignedPost: { url: "https://storage.invalid/post", fields: { key: "legacy/key.png" } },
          presignedPut: null,
        },
      }),
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

    const result = await uploadImage(client, imagePath);

    expect(result).toBe("https://cdn.hashnode.com/legacy/key.png");
    expect(fetch).toHaveBeenCalledWith(
      "https://storage.invalid/post",
      expect.objectContaining({ method: "POST" })
    );
    expect(client.request).toHaveBeenCalledTimes(1);
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
