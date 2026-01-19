import path from "node:path";
import * as fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import type { HashAlgorithm } from "./meta.js";

export interface FileIndexEntry {
  path: string;
  size: number;
  mtimeMs: number;
  hash: string | null;
}

export interface FileIndex {
  repoRoot: string;
  hashAlgorithm: HashAlgorithm;
  files: FileIndexEntry[];
}

export interface FileChangeSet {
  hashAlgorithm: HashAlgorithm;
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface BuildFileIndexOptions {
  repoRoot: string;
  files: Iterable<string>;
  hashAlgorithm?: HashAlgorithm;
  concurrency?: number;
  onError?: (err: NodeJS.ErrnoException, path: string) => void;
}

const DEFAULT_CONCURRENCY = 8;

const compareNames = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const normalizePosixPath = (value: string) => {
  let normalized = value.replace(/\\/g, "/").trim();
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.endsWith("/") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.length === 0 ? "." : normalized;
};

const reportError = (
  err: unknown,
  targetPath: string,
  onError?: BuildFileIndexOptions["onError"]
) => {
  if (!onError) return;
  const error = err as NodeJS.ErrnoException;
  if (error?.code === "ENOENT") return;
  onError(error, targetPath);
};

const resolveAbsPath = (repoRoot: string, filePath: string) => {
  const segments = filePath === "." ? [] : filePath.split("/");
  return path.resolve(repoRoot, ...segments);
};

const hashFile = (
  absPath: string,
  algorithm: HashAlgorithm,
  onError?: BuildFileIndexOptions["onError"]
) =>
  new Promise<string | null>((resolve) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(absPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (err) => {
      reportError(err, absPath, onError);
      resolve(null);
    });
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });

const buildEntry = async (
  repoRoot: string,
  filePath: string,
  algorithm: HashAlgorithm,
  onError?: BuildFileIndexOptions["onError"]
): Promise<FileIndexEntry | null> => {
  const absPath = resolveAbsPath(repoRoot, filePath);
  try {
    const stats = await fs.stat(absPath);
    const hash = await hashFile(absPath, algorithm, onError);
    return {
      path: filePath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      hash
    };
  } catch (err) {
    reportError(err, absPath, onError);
    return null;
  }
};

export const buildFileIndex = async (
  options: BuildFileIndexOptions
): Promise<FileIndex> => {
  const repoRoot = path.resolve(options.repoRoot);
  const hashAlgorithm = options.hashAlgorithm ?? "sha256";
  const concurrency = Math.max(
    1,
    options.concurrency ?? DEFAULT_CONCURRENCY
  );
  const files = Array.isArray(options.files)
    ? options.files.map(normalizePosixPath)
    : Array.from(options.files, normalizePosixPath);
  const onError = options.onError;

  const entries: FileIndexEntry[] = [];
  let index = 0;

  const worker = async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= files.length) break;
      const filePath = files[current];
      if (!filePath || filePath === ".") continue;
      const entry = await buildEntry(repoRoot, filePath, hashAlgorithm, onError);
      if (entry) entries.push(entry);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    () => worker()
  );
  await Promise.all(workers);
  entries.sort((a, b) => compareNames(a.path, b.path));

  return {
    repoRoot,
    hashAlgorithm,
    files: entries
  };
};

const entryChanged = (
  prev: FileIndexEntry,
  next: FileIndexEntry,
  useHash: boolean
) => {
  if (useHash && prev.hash && next.hash) {
    return prev.hash !== next.hash;
  }
  return prev.size !== next.size || prev.mtimeMs !== next.mtimeMs;
};

export const diffFileIndex = (
  previous: FileIndex,
  current: FileIndex
): FileChangeSet => {
  const prevMap = new Map(previous.files.map((entry) => [entry.path, entry]));
  const nextMap = new Map(current.files.map((entry) => [entry.path, entry]));
  const useHash = previous.hashAlgorithm === current.hashAlgorithm;

  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const entry of current.files) {
    const prevEntry = prevMap.get(entry.path);
    if (!prevEntry) {
      added.push(entry.path);
      continue;
    }
    if (entryChanged(prevEntry, entry, useHash)) {
      modified.push(entry.path);
    }
  }

  for (const entry of previous.files) {
    if (!nextMap.has(entry.path)) {
      deleted.push(entry.path);
    }
  }

  added.sort(compareNames);
  modified.sort(compareNames);
  deleted.sort(compareNames);

  return {
    hashAlgorithm: current.hashAlgorithm,
    added,
    modified,
    deleted
  };
};
