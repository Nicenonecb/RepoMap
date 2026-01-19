#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  buildModuleIndex,
  buildFileIndex,
  collectFiles,
  createMeta,
  detectEntries,
  detectModules,
  diffFileIndex,
  extractModuleKeywords,
  buildSummary,
  queryModules
} from "@repo-map/core";
import type {
  EntryMap,
  FileChangeSet,
  FileIndex,
  ModuleInfo,
  ModuleIndex,
  ModuleKeywords,
  QueryResult,
  RepoMapMeta
} from "@repo-map/core";
const VERSION = "0.1.0";

const LARGE_CHANGE_RATIO = 0.25;
const LARGE_CHANGE_COUNT = 5000;
const WORKSPACE_CONFIG_FILES = new Set([
  "pnpm-workspace.yaml",
  "lerna.json",
  "rush.json",
  "nx.json",
  "workspace.json"
]);

const program = new Command();

const collectIgnore = (value: string, previous: string[]) => {
  const next = (previous ?? []).slice();
  next.push(value);
  return next;
};

const readGitRoot = (cwd: string) => {
  try {
    const output = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
};

const readGitCommit = (repoRoot: string) => {
  try {
    const output = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
};

const writeMetaFile = (outDir: string, meta: RepoMapMeta) => {
  mkdirSync(outDir, { recursive: true });
  const metaPath = path.join(outDir, "meta.json");
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
};

const writeModuleIndexFile = (outDir: string, moduleIndex: ModuleIndex) => {
  mkdirSync(outDir, { recursive: true });
  const moduleIndexPath = path.join(outDir, "module_index.json");
  writeFileSync(moduleIndexPath, `${JSON.stringify(moduleIndex, null, 2)}\n`);
};

const writeEntryMapFile = (outDir: string, entryMap: EntryMap) => {
  mkdirSync(outDir, { recursive: true });
  const entryMapPath = path.join(outDir, "entry_map.json");
  writeFileSync(entryMapPath, `${JSON.stringify(entryMap, null, 2)}\n`);
};

const writeFileIndexFile = (outDir: string, fileIndex: FileIndex) => {
  mkdirSync(outDir, { recursive: true });
  const fileIndexPath = path.join(outDir, "file_index.json");
  writeFileSync(fileIndexPath, `${JSON.stringify(fileIndex, null, 2)}\n`);
};

const writeFileChangesFile = (outDir: string, changes: FileChangeSet) => {
  mkdirSync(outDir, { recursive: true });
  const changesPath = path.join(outDir, "file_changes.json");
  writeFileSync(changesPath, `${JSON.stringify(changes, null, 2)}\n`);
};

const readFileIndexFile = (outDir: string) => {
  const fileIndexPath = path.join(outDir, "file_index.json");
  try {
    const raw = readFileSync(fileIndexPath, "utf8");
    return JSON.parse(raw) as FileIndex;
  } catch {
    return null;
  }
};

const readModuleIndexFile = (outDir: string) => {
  const moduleIndexPath = path.join(outDir, "module_index.json");
  try {
    const raw = readFileSync(moduleIndexPath, "utf8");
    return JSON.parse(raw) as ModuleIndex;
  } catch {
    return null;
  }
};

const readEntryMapFile = (outDir: string) => {
  const entryMapPath = path.join(outDir, "entry_map.json");
  try {
    const raw = readFileSync(entryMapPath, "utf8");
    return JSON.parse(raw) as EntryMap;
  } catch {
    return null;
  }
};

const writeSummaryFile = (outDir: string, summary: string) => {
  mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "summary.md");
  writeFileSync(summaryPath, summary);
};

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

const resolveModuleRoot = (
  filePath: string,
  moduleRoots: Set<string>,
  cache: Map<string, string>
) => {
  let dir = path.posix.dirname(filePath);
  if (dir === ".") dir = ".";
  const visited: string[] = [];
  while (true) {
    const cached = cache.get(dir);
    if (cached) {
      for (const entry of visited) cache.set(entry, cached);
      return cached;
    }
    visited.push(dir);
    if (moduleRoots.has(dir)) {
      for (const entry of visited) cache.set(entry, dir);
      return dir;
    }
    if (dir === ".") {
      for (const entry of visited) cache.set(entry, ".");
      return ".";
    }
    dir = path.posix.dirname(dir);
  }
};

const isWorkspaceConfigChange = (filePath: string) => {
  const normalized = normalizePosixPath(filePath);
  if (normalized === "package.json") return true;
  if (!normalized.includes("/")) {
    return WORKSPACE_CONFIG_FILES.has(normalized);
  }
  return false;
};

const buildKeywordsMap = (keywords: ModuleKeywords[]) => {
  const map = new Map<string, string[]>();
  for (const entry of keywords) {
    map.set(entry.path, entry.keywords);
  }
  return map;
};

const modulePathSet = (modules: ModuleInfo[]) =>
  new Set(modules.map((module) => normalizePosixPath(module.path)));

const mergeModuleKeywords = (
  modules: ModuleInfo[],
  previous: ModuleIndex | null,
  updatedKeywords: ModuleKeywords[]
) => {
  const previousKeywords = previous
    ? new Map(previous.modules.map((module) => [module.path, module.keywords]))
    : new Map<string, string[]>();
  const updatedMap = buildKeywordsMap(updatedKeywords);

  return modules.map((module) => ({
    path: module.path,
    keywords: updatedMap.get(module.path) ?? previousKeywords.get(module.path) ?? []
  }));
};

const logCommand = <T extends object>(
  command: Command,
  name: string,
  meta?: T
) => {
  const payload = {
    command: name,
    options: command.optsWithGlobals(),
    ...(meta ? { meta } : {})
  };

  console.log(JSON.stringify(payload, null, 2));
};

const formatQueryResult = (result: QueryResult) => {
  const lines: string[] = [];
  lines.push(`Query: "${result.query}"`);
  lines.push(
    `Tokens: ${result.tokens.length > 0 ? result.tokens.join(", ") : "-"}`
  );
  lines.push(`Results: ${result.results.length}`);
  for (const [index, entry] of result.results.entries()) {
    lines.push(
      `${index + 1}. ${entry.path} (${entry.name}) score=${entry.score} files=${entry.fileCount} lang=${entry.language}`
    );
    if (entry.matches.length > 0) {
      const matchText = entry.matches
        .map((match) => `${match.field}:${match.value}`)
        .join(", ");
      lines.push(`   matches: ${matchText}`);
    }
  }
  return `${lines.join("\n")}\n`;
};

program
  .name("repomap")
  .description("Generate a stable map of a repository")
  .version(VERSION)
  .option("--out <path>", "output directory", ".repomap")
  .option("--format <name>", "output format", "json")
  .option("--ignore <pattern>", "ignore pattern (repeatable)", collectIgnore, []);

program.configureHelp({ showGlobalOptions: true });

program
  .command("build")
  .description("Build a RepoMap for the current repository")
  .action(async (_options, command) => {
    const cwd = process.cwd();
    const repoRoot = readGitRoot(cwd) ?? cwd;
    const options = command.optsWithGlobals();
    const outDir = path.resolve(repoRoot, String(options.out ?? ".repomap"));
    const meta = createMeta({
      toolVersion: VERSION,
      repoRoot,
      gitCommit: readGitCommit(repoRoot)
    });

    const files = await collectFiles({
      root: ".",
      cwd: repoRoot,
      ignoreGlobs: Array.isArray(options.ignore) ? options.ignore : [],
      pathStyle: "posix"
    });
    const fileIndex = await buildFileIndex({
      repoRoot,
      files,
      hashAlgorithm: meta.hashAlgorithm
    });
    const modules = await detectModules({ repoRoot, files });
    const keywords = await extractModuleKeywords({ repoRoot, files, modules });
    const moduleIndex = buildModuleIndex(modules, keywords);
    const entryMap = detectEntries({ files, modules });
    const summary = buildSummary({ repoRoot, moduleIndex, entryMap });

    writeMetaFile(outDir, meta);
    writeFileIndexFile(outDir, fileIndex);
    writeModuleIndexFile(outDir, moduleIndex);
    writeEntryMapFile(outDir, entryMap);
    writeSummaryFile(outDir, summary);
    logCommand(command, "build", meta);
  });

program
  .command("update")
  .description("Update an existing RepoMap output")
  .action(async (_options, command) => {
    const cwd = process.cwd();
    const repoRoot = readGitRoot(cwd) ?? cwd;
    const options = command.optsWithGlobals();
    const outDir = path.resolve(repoRoot, String(options.out ?? ".repomap"));

    const previousIndex = readFileIndexFile(outDir);
    const hashAlgorithm = previousIndex?.hashAlgorithm ?? "sha256";
    const meta = createMeta({
      toolVersion: VERSION,
      repoRoot,
      gitCommit: readGitCommit(repoRoot),
      hashAlgorithm
    });
    const previousModuleIndex = readModuleIndexFile(outDir);
    const files = await collectFiles({
      root: ".",
      cwd: repoRoot,
      ignoreGlobs: Array.isArray(options.ignore) ? options.ignore : [],
      pathStyle: "posix"
    });
    const currentIndex = await buildFileIndex({
      repoRoot,
      files,
      hashAlgorithm
    });

    const changes = previousIndex
      ? diffFileIndex(previousIndex, currentIndex)
      : {
          hashAlgorithm: currentIndex.hashAlgorithm,
          added: currentIndex.files.map((entry) => entry.path),
          modified: [],
          deleted: []
        };

    const changedPaths = new Set([
      ...changes.added,
      ...changes.modified,
      ...changes.deleted
    ]);
    const changedCount = changedPaths.size;
    const totalFiles = currentIndex.files.length || 1;
    const largeChange =
      changedCount >= LARGE_CHANGE_COUNT ||
      changedCount / totalFiles >= LARGE_CHANGE_RATIO;
    const workspaceChanged = Array.from(changedPaths).some((value) =>
      isWorkspaceConfigChange(value)
    );

    const modules = await detectModules({ repoRoot, files });
    const modulePaths = modulePathSet(modules);
    modulePaths.add(".");

    let moduleIndex: ModuleIndex | null = null;
    let entryMap: EntryMap | null = null;
    let summary: string | null = null;
    let mode: "full" | "incremental" = "incremental";

    if (!previousModuleIndex || workspaceChanged || largeChange) {
      mode = "full";
      const keywords = await extractModuleKeywords({ repoRoot, files, modules });
      moduleIndex = buildModuleIndex(modules, keywords);
    } else {
      const previousModulePaths = modulePathSet(previousModuleIndex.modules);
      previousModulePaths.add(".");
      const changedModules = new Set<string>();
      const missingKeywords = new Set<string>();
      const previousKeywordMap = new Map(
        previousModuleIndex.modules.map((module) => [module.path, module.keywords])
      );

      for (const module of modules) {
        if (!previousModulePaths.has(module.path)) {
          changedModules.add(module.path);
        }
        if (!previousKeywordMap.has(module.path)) {
          missingKeywords.add(module.path);
        }
      }

      const cacheCurrent = new Map<string, string>();
      const cachePrevious = new Map<string, string>();
      for (const filePath of changedPaths) {
        const currentRoot = resolveModuleRoot(
          normalizePosixPath(filePath),
          modulePaths,
          cacheCurrent
        );
        changedModules.add(currentRoot);

        if (previousModulePaths.size > 0) {
          const previousRoot = resolveModuleRoot(
            normalizePosixPath(filePath),
            previousModulePaths,
            cachePrevious
          );
          changedModules.add(previousRoot);
        }
      }

      for (const modulePath of missingKeywords) {
        changedModules.add(modulePath);
      }

      for (const modulePath of Array.from(changedModules)) {
        if (!modulePaths.has(modulePath)) {
          changedModules.delete(modulePath);
        }
      }

      const updatedKeywords =
        changedModules.size > 0
          ? await extractModuleKeywords({
              repoRoot,
              files,
              modules,
              includeModules: Array.from(changedModules).sort(compareNames)
            })
          : [];

      const keywordEntries = mergeModuleKeywords(
        modules,
        previousModuleIndex,
        updatedKeywords
      );
      moduleIndex = buildModuleIndex(modules, keywordEntries);
    }

    if (moduleIndex) {
      entryMap = detectEntries({ files, modules });
      summary = buildSummary({ repoRoot, moduleIndex, entryMap });
    }

    writeMetaFile(outDir, meta);
    writeFileIndexFile(outDir, currentIndex);
    writeFileChangesFile(outDir, changes);
    if (moduleIndex) writeModuleIndexFile(outDir, moduleIndex);
    if (entryMap) writeEntryMapFile(outDir, entryMap);
    if (summary) writeSummaryFile(outDir, summary);

    logCommand(command, "update", {
      mode,
      added: changes.added.length,
      modified: changes.modified.length,
      deleted: changes.deleted.length
    });
  });

program
  .command("query [text]")
  .description("Query an existing RepoMap output")
  .option("--limit <count>", "max results", "50")
  .option("--min-score <score>", "minimum score", "1")
  .action((text, _options, command) => {
    const queryText = String(text ?? "").trim();
    if (!queryText) {
      console.error("Query text is required.");
      command.help({ error: true });
      return;
    }

    const cwd = process.cwd();
    const repoRoot = readGitRoot(cwd) ?? cwd;
    const options = command.optsWithGlobals();
    const outDir = path.resolve(repoRoot, String(options.out ?? ".repomap"));

    const moduleIndex = readModuleIndexFile(outDir);
    if (!moduleIndex) {
      console.error(
        `module_index.json not found. Run "repomap build" first in ${outDir}.`
      );
      process.exitCode = 1;
      return;
    }

    const entryMap = readEntryMapFile(outDir);
    const maxResults = Number(options.limit ?? "50");
    const minScore = Number(options.minScore ?? "1");
    const result = queryModules({
      query: queryText,
      moduleIndex,
      entryMap,
      maxResults: Number.isFinite(maxResults)
        ? Math.max(0, Math.floor(maxResults))
        : 50,
      minScore: Number.isFinite(minScore)
        ? Math.max(0, Math.floor(minScore))
        : 1
    });

    if (String(options.format).toLowerCase() === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(formatQueryResult(result));
  });

program.showHelpAfterError();
program.showSuggestionAfterError();

if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
