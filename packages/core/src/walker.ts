import path from "node:path";
import * as fs from "node:fs/promises";
import type { Dir, Dirent } from "node:fs";
import ignoreModule from "ignore";
import type { Ignore, Options } from "ignore";

type IgnoreFactory = (options?: Options) => Ignore;

const ignoreFactory = ignoreModule as unknown as IgnoreFactory;

export type SymlinkPolicy = "skip" | "follow-file" | "follow-all";
export type PathStyle = "posix" | "native";

export interface WalkOptions {
  root: string;
  cwd?: string;
  ignoreGlobs?: string[];
  useGitignore?: boolean;
  defaultIgnores?: string[];
  symlinkPolicy?: SymlinkPolicy;
  maxDepth?: number;
  pathStyle?: PathStyle;
  onError?: (err: NodeJS.ErrnoException, path: string) => void;
}

export const DEFAULT_IGNORES = [
  ".git/",
  ".hg/",
  ".svn/",
  ".repomap/",
  "node_modules/",
  "dist/",
  "build/",
  "out/",
  ".next/",
  ".nuxt/",
  ".cache/",
  ".turbo/",
  ".yarn/",
  ".pnpm/",
  "coverage/"
];

interface IgnoreMatcher {
  baseRel: string;
  matcher: Ignore;
}

interface WalkFrameEnter {
  type: "enter";
  dirPath: string;
  dirRel: string;
  depth: number;
  ignoreStack: IgnoreMatcher[];
}

interface WalkFrameIterate {
  type: "iterate";
  dirPath: string;
  dirRel: string;
  depth: number;
  ignoreStack: IgnoreMatcher[];
  entries: Dirent[];
  index: number;
}

type WalkFrame = WalkFrameEnter | WalkFrameIterate;

const isWindows = process.platform === "win32";
const EXTENDED_PATH_PREFIX = "\\\\?\\";

const normalizePathStyle = (pathStyle?: PathStyle): PathStyle =>
  pathStyle ?? "posix";

const normalizePattern = (pattern: string) => pattern.replace(/\\/g, "/");

const normalizeIgnoreList = (patterns: string[] | undefined) =>
  (patterns ?? []).map(normalizePattern);

const toPosixPath = (value: string) => value.replace(/\\/g, "/");

const compareNames = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const normalizeCase = (value: string) =>
  isWindows ? value.toLowerCase() : value;

const isPathInside = (base: string, target: string) => {
  const normalizedBase = normalizeCase(path.resolve(base));
  const normalizedTarget = normalizeCase(path.resolve(target));
  if (normalizedBase === normalizedTarget) return true;
  const relativePath = path.relative(normalizedBase, normalizedTarget);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
};

const toExtendedPath = (value: string) => {
  if (!isWindows) return value;
  if (!path.isAbsolute(value)) return value;
  if (value.startsWith(EXTENDED_PATH_PREFIX)) return value;
  if (value.length < 260) return value;
  if (value.startsWith("\\\\")) {
    return `${EXTENDED_PATH_PREFIX}UNC\\${value.slice(2)}`;
  }
  return `${EXTENDED_PATH_PREFIX}${value}`;
};

const reportError = (
  err: unknown,
  targetPath: string,
  onError?: WalkOptions["onError"]
) => {
  if (!onError) return;
  const error = err as NodeJS.ErrnoException;
  if (error?.code === "ENOENT") return;
  onError(error, targetPath);
};

const loadGitignore = async (
  dirPath: string,
  dirRel: string,
  onError?: WalkOptions["onError"]
) => {
  const gitignorePath = path.join(dirPath, ".gitignore");
  try {
    let content = await fs.readFile(toExtendedPath(gitignorePath), "utf8");
    if (content.startsWith("\uFEFF")) {
      content = content.slice(1);
    }
    if (content.trim().length === 0) return null;
    const matcher = ignoreFactory().add(content);
    return { baseRel: dirRel, matcher } satisfies IgnoreMatcher;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error?.code === "ENOENT") return null;
    reportError(err, gitignorePath, onError);
    return null;
  }
};

const createMatcher = (patterns: string[], baseRel: string) => {
  if (patterns.length === 0) return null;
  const matcher = ignoreFactory().add(patterns);
  return { baseRel, matcher } satisfies IgnoreMatcher;
};

const toMatchPath = (relativePath: string, isDir: boolean) => {
  if (!relativePath) return relativePath;
  if (!isDir) return relativePath;
  return relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
};

const relativeToBase = (relPosix: string, baseRel: string) => {
  if (baseRel.length === 0) return relPosix;
  if (relPosix === baseRel) return "";
  const prefix = `${baseRel}/`;
  if (!relPosix.startsWith(prefix)) return null;
  return relPosix.slice(prefix.length);
};

const isIgnored = (
  relPosix: string,
  isDir: boolean,
  stack: IgnoreMatcher[],
  overrideMatcher: IgnoreMatcher | null
) => {
  if (relPosix.length === 0) return false;
  let ignored = false;
  for (const { baseRel, matcher } of stack) {
    const relToBase = relativeToBase(relPosix, baseRel);
    if (relToBase === null) continue;
    const result = matcher.test(toMatchPath(relToBase, isDir));
    if (result.ignored) ignored = true;
    if (result.unignored) ignored = false;
  }
  if (overrideMatcher) {
    const relToBase = relativeToBase(relPosix, overrideMatcher.baseRel);
    if (relToBase !== null) {
      const result = overrideMatcher.matcher.test(
        toMatchPath(relToBase, isDir)
      );
      if (result.ignored) ignored = true;
      if (result.unignored) ignored = false;
    }
  }
  return ignored;
};

const readDirEntries = async (
  dirPath: string,
  onError?: WalkOptions["onError"]
) => {
  let dir: Dir | null = null;
  try {
    dir = await fs.opendir(toExtendedPath(dirPath));
  } catch (err) {
    reportError(err, dirPath, onError);
    return [];
  }

  const entries: Dirent[] = [];
  try {
    for await (const entry of dir) {
      entries.push(entry);
    }
  } catch (err) {
    reportError(err, dirPath, onError);
  } finally {
    try {
      await dir.close();
    } catch {
      // ignore close errors
    }
  }
  entries.sort((left, right) => compareNames(left.name, right.name));
  return entries;
};

const safeStat = async (
  targetPath: string,
  onError?: WalkOptions["onError"]
) => {
  try {
    return await fs.stat(toExtendedPath(targetPath));
  } catch (err) {
    reportError(err, targetPath, onError);
    return null;
  }
};

const safeRealpath = async (
  targetPath: string,
  onError?: WalkOptions["onError"]
) => {
  try {
    return await fs.realpath(toExtendedPath(targetPath));
  } catch (err) {
    reportError(err, targetPath, onError);
    return null;
  }
};

export async function* walkFiles(options: WalkOptions): AsyncGenerator<string> {
  const cwd = options.cwd ?? process.cwd();
  const root = path.resolve(cwd, options.root);
  const pathStyle = normalizePathStyle(options.pathStyle);
  const defaultIgnores = normalizeIgnoreList(
    options.defaultIgnores ?? DEFAULT_IGNORES
  );
  const customIgnores = normalizeIgnoreList(options.ignoreGlobs);
  const useGitignore = options.useGitignore ?? true;
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const symlinkPolicy = options.symlinkPolicy ?? "skip";
  const onError = options.onError;

  const baseMatcher = createMatcher(defaultIgnores, "");
  const overrideMatcher = createMatcher(customIgnores, "");
  const rootIgnoreStack = baseMatcher ? [baseMatcher] : [];

  const seenRealPaths = new Set<string>();
  let realRoot: string | null = null;
  if (symlinkPolicy === "follow-all") {
    realRoot = await safeRealpath(root, onError);
  }

  const stack: WalkFrame[] = [
    {
      type: "enter",
      dirPath: root,
      dirRel: "",
      depth: 0,
      ignoreStack: rootIgnoreStack
    }
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) continue;

    if (frame.type === "enter") {
      if (frame.depth > maxDepth) continue;
      if (symlinkPolicy === "follow-all") {
        const dirRealPath =
          frame.depth === 0 && realRoot
            ? realRoot
            : await safeRealpath(frame.dirPath, onError);
        if (dirRealPath) {
          if (realRoot && !isPathInside(realRoot, dirRealPath)) continue;
          if (seenRealPaths.has(dirRealPath)) continue;
          seenRealPaths.add(dirRealPath);
        }
      }

      let ignoreStack = frame.ignoreStack;
      if (useGitignore) {
        const gitignoreMatcher = await loadGitignore(
          frame.dirPath,
          frame.dirRel,
          onError
        );
        if (gitignoreMatcher) {
          ignoreStack = ignoreStack.concat(gitignoreMatcher);
        }
      }

      const entries = await readDirEntries(frame.dirPath, onError);
      stack.push({
        type: "iterate",
        dirPath: frame.dirPath,
        dirRel: frame.dirRel,
        depth: frame.depth,
        ignoreStack,
        entries,
        index: 0
      });
      continue;
    }

    if (frame.index >= frame.entries.length) continue;
    const entry = frame.entries[frame.index];
    stack.push({
      ...frame,
      index: frame.index + 1
    });

    const fullPath = path.join(frame.dirPath, entry.name);
    const relPath = path.relative(root, fullPath);
    const relPosix = toPosixPath(relPath);
    const isDir = entry.isDirectory();
    const isFile = entry.isFile();
    const isSymlink = entry.isSymbolicLink();

    if (isDir) {
      if (isIgnored(relPosix, true, frame.ignoreStack, overrideMatcher)) {
        continue;
      }
      if (frame.depth + 1 > maxDepth) continue;
      stack.push({
        type: "enter",
        dirPath: fullPath,
        dirRel: relPosix,
        depth: frame.depth + 1,
        ignoreStack: frame.ignoreStack
      });
      continue;
    }

    if (isFile) {
      if (isIgnored(relPosix, false, frame.ignoreStack, overrideMatcher)) {
        continue;
      }
      yield pathStyle === "native" ? relPath : relPosix;
      continue;
    }

    if (isSymlink) {
      if (symlinkPolicy === "skip") continue;
      const stats = await safeStat(fullPath, onError);
      if (!stats) continue;
      if (stats.isDirectory()) {
        if (symlinkPolicy !== "follow-all") continue;
        if (isIgnored(relPosix, true, frame.ignoreStack, overrideMatcher)) {
          continue;
        }
        if (frame.depth + 1 > maxDepth) continue;
        stack.push({
          type: "enter",
          dirPath: fullPath,
          dirRel: relPosix,
          depth: frame.depth + 1,
          ignoreStack: frame.ignoreStack
        });
        continue;
      }
      if (stats.isFile()) {
        if (isIgnored(relPosix, false, frame.ignoreStack, overrideMatcher)) {
          continue;
        }
        yield pathStyle === "native" ? relPath : relPosix;
      }
    }
  }
}

export const collectFiles = async (options: WalkOptions) => {
  const files: string[] = [];
  for await (const file of walkFiles(options)) {
    files.push(file);
  }
  return files;
};
