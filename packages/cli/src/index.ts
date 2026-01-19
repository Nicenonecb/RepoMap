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
  buildSummary
} from "@repomap/core";
import type {
  EntryMap,
  FileChangeSet,
  FileIndex,
  ModuleIndex,
  RepoMapMeta
} from "@repomap/core";
const VERSION = "0.1.0";

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

const writeSummaryFile = (outDir: string, summary: string) => {
  mkdirSync(outDir, { recursive: true });
  const summaryPath = path.join(outDir, "summary.md");
  writeFileSync(summaryPath, summary);
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
    const files = await collectFiles({
      root: ".",
      cwd: repoRoot,
      ignoreGlobs: Array.isArray(options.ignore) ? options.ignore : [],
      pathStyle: "posix"
    });
    const currentIndex = await buildFileIndex({ repoRoot, files });

    const changes = previousIndex
      ? diffFileIndex(previousIndex, currentIndex)
      : {
          baseGeneratedAt: null,
          currentGeneratedAt: currentIndex.generatedAt,
          hashAlgorithm: currentIndex.hashAlgorithm,
          added: currentIndex.files.map((entry) => entry.path),
          modified: [],
          deleted: []
        };

    writeFileIndexFile(outDir, currentIndex);
    writeFileChangesFile(outDir, changes);

    logCommand(command, "update", {
      added: changes.added.length,
      modified: changes.modified.length,
      deleted: changes.deleted.length
    });
  });

program
  .command("query [text]")
  .description("Query an existing RepoMap output")
  .action((_options, command) => {
    logCommand(command, "query");
  });

program.showHelpAfterError();
program.showSuggestionAfterError();

if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  program.parse(process.argv);
}
