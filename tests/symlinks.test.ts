import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GqlRequester } from "../src/gql";
import { processImages } from "../src/images";
import { realPathInsideWorkspace } from "../src/paths";
import { processFile } from "../src/sync";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const OTHER = "not an image";

let root: string;
let workspace: string;
let outside: string;

function uploadClient(): GqlRequester {
  return {
    request: vi.fn(async (query: string) => {
      if (query.includes("createImageUploadURL")) {
        return {
          createImageUploadURL: {
            presignedPut: {
              url: "https://storage.invalid/put",
              cdnUrl: "https://cdn.hashnode.com/k.png",
              key: "k.png",
            },
          },
        };
      }
      if (query.includes("confirmImageUpload")) {
        return { confirmImageUpload: { ok: true, cdnUrl: "https://cdn.hashnode.com/k.png" } };
      }
      throw new Error(`Unexpected query: ${query}`);
    }) as GqlRequester["request"],
  };
}

function uploadedBodies(): Buffer[] {
  return (fetch as ReturnType<typeof vi.fn>).mock.calls.map(
    ([, init]) => (init as { body: Buffer }).body
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "symlink-test-"));
  workspace = path.join(root, "repo");
  outside = path.join(root, "outside");
  await fs.mkdir(path.join(workspace, "posts"), { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "other.txt"), OTHER);
  await fs.writeFile(path.join(workspace, "posts", "real.png"), PNG);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(root, { recursive: true, force: true });
});

describe("realPathInsideWorkspace", () => {
  it("returns the real path for a normal file", async () => {
    const file = path.join(workspace, "posts", "real.png");
    expect(await realPathInsideWorkspace(workspace, file, "x")).toBe(await fs.realpath(file));
  });

  it("rejects a symlink even when it stays inside the repository", async () => {
    const link = path.join(workspace, "posts", "alias.png");
    await fs.symlink("real.png", link);
    await expect(realPathInsideWorkspace(workspace, link, "Image")).rejects.toThrow(
      /is a symlink/
    );
  });

  it("rejects a symlink to .git/config inside the repository", async () => {
    await fs.mkdir(path.join(workspace, ".git"));
    await fs.writeFile(path.join(workspace, ".git", "config"), `x = ${OTHER}`);
    const link = path.join(workspace, "posts", "x.png");
    await fs.symlink("../.git/config", link);
    await expect(realPathInsideWorkspace(workspace, link, "Image")).rejects.toThrow(
      /is a symlink/
    );
  });

  it("rejects a file under a symlinked directory inside the repository", async () => {
    await fs.mkdir(path.join(workspace, "assets"));
    await fs.writeFile(path.join(workspace, "assets", "pic.png"), PNG);
    await fs.symlink("../assets", path.join(workspace, "posts", "media"));
    await expect(
      realPathInsideWorkspace(workspace, path.join(workspace, "posts", "media", "pic.png"), "x")
    ).rejects.toThrow(/is a symlink/);
  });

  it("accepts a path whose case differs from disk on case-insensitive systems", async () => {
    if (process.platform !== "darwin" && process.platform !== "win32") return;
    const file = path.join(workspace, "posts", "REAL.png");
    expect(await realPathInsideWorkspace(workspace, file, "x")).toBe(
      await fs.realpath(path.join(workspace, "posts", "real.png"))
    );
  });

  it("rejects a symlink pointing outside", async () => {
    const link = path.join(workspace, "posts", "link.png");
    await fs.symlink(path.join(outside, "other.txt"), link);
    await expect(realPathInsideWorkspace(workspace, link, "Image")).rejects.toThrow(
      /outside the repository/
    );
  });

  it("rejects a file under a symlinked directory pointing outside", async () => {
    await fs.symlink(outside, path.join(workspace, "posts", "assets"));
    await expect(
      realPathInsideWorkspace(workspace, path.join(workspace, "posts", "assets", "other.txt"), "x")
    ).rejects.toThrow(/outside the repository/);
  });

  it("rejects a symlink to the workspace's sibling with a shared prefix", async () => {
    const sibling = `${workspace}-sibling`;
    await fs.mkdir(sibling);
    await fs.writeFile(path.join(sibling, "x.png"), OTHER);
    const link = path.join(workspace, "posts", "x.png");
    await fs.symlink(path.join(sibling, "x.png"), link);
    await expect(realPathInsideWorkspace(workspace, link, "x")).rejects.toThrow(
      /outside the repository/
    );
  });

  it("accepts a file whose name starts with two dots", async () => {
    const file = path.join(workspace, "..cover.png");
    await fs.writeFile(file, PNG);
    expect(await realPathInsideWorkspace(workspace, file, "x")).toBe(await fs.realpath(file));
    const out = await processImages(uploadClient(), workspace, "posts/a.md", "body", "/..cover.png");
    expect(out.uploaded).toBe(1);
  });

  it("rejects the workspace's parent directory", async () => {
    await expect(realPathInsideWorkspace(workspace, root, "x")).rejects.toThrow(
      /outside the repository/
    );
  });

  it("rejects a lexical path outside the workspace", async () => {
    await expect(
      realPathInsideWorkspace(workspace, path.join(outside, "other.txt"), "x")
    ).rejects.toThrow(/outside the repository/);
  });

  it("reports a dangling symlink as not found", async () => {
    const link = path.join(workspace, "posts", "gone.png");
    await fs.symlink(path.join(outside, "missing.png"), link);
    await expect(realPathInsideWorkspace(workspace, link, "Image")).rejects.toThrow(/not found/);
  });

  it("works when the workspace path itself is a symlink", async () => {
    const linkedWorkspace = path.join(root, "linked-repo");
    await fs.symlink(workspace, linkedWorkspace);
    const file = path.join(linkedWorkspace, "posts", "real.png");
    expect(await realPathInsideWorkspace(linkedWorkspace, file, "x")).toBe(
      await fs.realpath(file)
    );
  });
});

describe("processImages with symlinks", () => {
  it("uploads a normal image", async () => {
    const out = await processImages(uploadClient(), workspace, "posts/a.md", "![a](./real.png)", undefined);
    expect(out.uploaded).toBe(1);
    expect(uploadedBodies()[0]).toEqual(PNG);
  });

  it("refuses a body image symlinked outside the repo and uploads nothing", async () => {
    await fs.symlink(path.join(outside, "other.txt"), path.join(workspace, "posts", "link.png"));
    await expect(
      processImages(uploadClient(), workspace, "posts/a.md", "![x](./link.png)", undefined)
    ).rejects.toThrow(/Image path "\.\/link\.png" points outside the repository/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a cover image symlinked outside the repo", async () => {
    await fs.symlink(path.join(outside, "other.txt"), path.join(workspace, "cover.png"));
    await expect(
      processImages(uploadClient(), workspace, "posts/a.md", "body", "/cover.png")
    ).rejects.toThrow(/Cover image "\/cover\.png" points outside the repository/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an image under a symlinked directory", async () => {
    await fs.writeFile(path.join(outside, "pic.png"), OTHER);
    await fs.symlink(outside, path.join(workspace, "posts", "assets"));
    await expect(
      processImages(uploadClient(), workspace, "posts/a.md", "![x](assets/pic.png)", undefined)
    ).rejects.toThrow(/outside the repository/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("processFile with a symlinked post", () => {
  it("returns an error and makes no API calls", async () => {
    await fs.writeFile(
      path.join(outside, "linked.md"),
      `---\ntitle: Linked\nslug: linked\ntags: x\n---\n\n${OTHER}\n`
    );
    await fs.symlink(path.join(outside, "linked.md"), path.join(workspace, "posts", "linked.md"));
    const client = uploadClient();
    const result = await processFile(
      { client, workspace, defaultPublicationId: "pub-1", dryRun: false, hostCache: new Map() },
      "posts/linked.md"
    );
    expect(result.action).toBe("error");
    expect(result.message).toMatch(/points outside the repository/);
    expect(result.message).not.toContain(OTHER);
    expect(client.request).not.toHaveBeenCalled();
  });
});
