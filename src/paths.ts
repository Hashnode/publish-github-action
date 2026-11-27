import * as fs from "fs/promises";
import * as path from "path";

// macOS and Windows file systems are case-insensitive by default, so a
// reference whose case differs from the file on disk still names that file.
const caseInsensitive = process.platform === "darwin" || process.platform === "win32";

function samePath(a: string, b: string): boolean {
  return caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Returns the real path of a file inside the repository. Symlinks aren't
 * supported, for the file itself or any directory above it.
 */
export async function realPathInsideWorkspace(
  workspace: string,
  absolutePath: string,
  label: string
): Promise<string> {
  const realWorkspace = await fs.realpath(workspace);
  const relative = path.relative(workspace, absolutePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} points outside the repository.`);
  }

  let real: string;
  try {
    real = await fs.realpath(absolutePath);
  } catch {
    throw new Error(`${label} not found.`);
  }

  if (!real.startsWith(realWorkspace + path.sep)) {
    throw new Error(`${label} points outside the repository.`);
  }
  if (!samePath(real, path.join(realWorkspace, relative))) {
    throw new Error(`${label} is a symlink, which isn't supported.`);
  }
  return real;
}
