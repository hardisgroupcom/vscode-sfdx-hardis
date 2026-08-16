import * as fs from "fs";
import * as path from "path";

// Tiny local replacement for the "which" dependency.
// Scans process.env.PATH for the first matching executable, applying the
// PATHEXT extensions on Windows (case-insensitively), and rejects when not found,
// matching node-which's default (non-nothrow) behavior.

const DEFAULT_WIN32_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function isExecutableFile(candidatePath: string): boolean {
  try {
    if (!fs.statSync(candidatePath).isFile()) {
      return false;
    }
  } catch {
    return false;
  }
  // On POSIX, matching "which"/"isexe" behavior, the file must also have an
  // executable permission bit. On Windows, file existence with a PATHEXT
  // extension is enough (there is no executable permission bit).
  if (process.platform === "win32") {
    return true;
  }
  try {
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function stripSurroundingQuotes(dir: string): string {
  if (
    process.platform === "win32" &&
    dir.length >= 2 &&
    dir.startsWith('"') &&
    dir.endsWith('"')
  ) {
    return dir.slice(1, -1);
  }
  return dir;
}

export async function findExecutable(name: string): Promise<string> {
  const pathDirs = (process.env.PATH || process.env.Path || "")
    .split(path.delimiter)
    .map(stripSurroundingQuotes);
  const isWindows = process.platform === "win32";
  // On Windows, an already-qualified name (with a known extension) is checked as-is;
  // otherwise every extension in PATHEXT is tried.
  const extensions = isWindows
    ? (process.env.PATHEXT || DEFAULT_WIN32_PATHEXT)
        .split(path.delimiter)
        .filter((ext) => ext.length > 0)
    : [""];

  for (const dir of pathDirs) {
    if (!dir) {
      continue;
    }
    if (isWindows && path.extname(name) !== "") {
      const candidatePath = path.join(dir, name);
      if (isExecutableFile(candidatePath)) {
        return candidatePath;
      }
      continue;
    }
    for (const ext of extensions) {
      const candidatePath = path.join(dir, `${name}${ext}`);
      if (isExecutableFile(candidatePath)) {
        return candidatePath;
      }
    }
  }
  throw new Error(`not found: ${name}`);
}
