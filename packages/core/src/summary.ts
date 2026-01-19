import path from "node:path";
import type { EntryMap, EntryType } from "./entry-detector.js";
import type { ModuleIndex, ModuleIndexEntry } from "./module-index.js";

export interface SummaryOptions {
  repoRoot: string;
  moduleIndex: ModuleIndex;
  entryMap: EntryMap;
  maxLines?: number;
  maxModules?: number;
  maxEntriesPerType?: number;
  maxKeywordsPerModule?: number;
}

const DEFAULT_MAX_LINES = 300;
const DEFAULT_MAX_MODULES = 10;
const DEFAULT_MAX_ENTRIES_PER_TYPE = 8;
const DEFAULT_MAX_KEYWORDS = 5;

const ENTRY_TYPE_ORDER: EntryType[] = [
  "web-route",
  "controller",
  "service",
  "cli-entry",
  "worker",
  "job",
  "unknown-entry"
];

const compareNames = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const formatList = (items: string[], maxItems: number) => {
  if (items.length === 0) return "(none)";
  const list = items.slice(0, maxItems);
  const suffix = items.length > maxItems ? ", ..." : "";
  return `${list.join(", ")}${suffix}`;
};

const formatKeywords = (keywords: string[], maxKeywords: number) =>
  formatList(keywords, maxKeywords);

const formatLanguageSummary = (modules: ModuleIndexEntry[]) => {
  const counts = new Map<string, number>();
  for (const module of modules) {
    const value = counts.get(module.language) ?? 0;
    counts.set(module.language, value + 1);
  }
  const entries = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || compareNames(a[0], b[0])
  );
  if (entries.length === 0) return "(none)";
  return entries.map(([lang, count]) => `${lang}(${count})`).join(", ");
};

const sumFiles = (modules: ModuleIndexEntry[]) =>
  modules.reduce((total, module) => total + module.fileCount, 0);

const formatModuleLine = (
  module: ModuleIndexEntry,
  maxKeywords: number
) => {
  const keywordText = formatKeywords(module.keywords ?? [], maxKeywords);
  return `- ${module.path} (${module.language}, ${module.fileCount} files) keywords: ${keywordText}`;
};

const collectEntryPaths = (entryMap: EntryMap, type: EntryType) => {
  const paths: string[] = [];
  const unknownModules: string[] = [];
  for (const module of entryMap.modules) {
    for (const entry of module.entries) {
      if (entry.type !== type) continue;
      if (entry.type === "unknown-entry") {
        unknownModules.push(module.path);
      } else {
        if (entry.path) paths.push(entry.path);
      }
    }
  }
  paths.sort(compareNames);
  unknownModules.sort(compareNames);
  return { paths, unknownModules };
};

const buildEntrySection = (
  entryMap: EntryMap,
  maxEntriesPerType: number
) => {
  const lines: string[] = [];
  for (const type of ENTRY_TYPE_ORDER) {
    const { paths, unknownModules } = collectEntryPaths(entryMap, type);
    if (type === "unknown-entry") {
      const summary = unknownModules.length === 0
        ? "(none)"
        : formatList(unknownModules, maxEntriesPerType);
      lines.push(`- ${type}: ${summary}`);
      continue;
    }
    lines.push(`- ${type}: ${formatList(paths, maxEntriesPerType)}`);
  }
  return lines;
};

const buildReadingOrder = (
  entryMap: EntryMap,
  maxEntriesPerType: number
) => {
  const lines: string[] = [];
  const order: EntryType[] = [
    "web-route",
    "controller",
    "service",
    "cli-entry",
    "worker",
    "job"
  ];
  for (const type of order) {
    const { paths } = collectEntryPaths(entryMap, type);
    const list = formatList(paths, maxEntriesPerType);
    if (list === "(none)") continue;
    lines.push(`- Start with ${type}: ${list}`);
  }
  if (lines.length === 0) {
    lines.push("- No clear entry files detected; start from top modules.");
  }
  return lines;
};

export const buildSummary = (options: SummaryOptions) => {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxModules = options.maxModules ?? DEFAULT_MAX_MODULES;
  const maxEntriesPerType =
    options.maxEntriesPerType ?? DEFAULT_MAX_ENTRIES_PER_TYPE;
  const maxKeywordsPerModule =
    options.maxKeywordsPerModule ?? DEFAULT_MAX_KEYWORDS;

  const repoName = path.basename(path.resolve(options.repoRoot));
  const modules = options.moduleIndex.modules.slice();
  modules.sort((a, b) => compareNames(a.path, b.path));

  const lines: string[] = [];
  lines.push("# Repo Summary");
  lines.push("");
  lines.push("## Repository Overview");
  lines.push(`- Name: ${repoName}`);
  lines.push(`- Modules: ${modules.length}`);
  lines.push(`- Files: ${sumFiles(modules)}`);
  lines.push(`- Languages: ${formatLanguageSummary(modules)}`);
  lines.push("");
  lines.push("## Top Modules");

  if (modules.length === 0) {
    lines.push("- (none)");
  } else {
    const topModules = modules
      .slice()
      .sort(
        (a, b) =>
          b.fileCount - a.fileCount || compareNames(a.path, b.path)
      )
      .slice(0, maxModules);
    for (const module of topModules) {
      lines.push(formatModuleLine(module, maxKeywordsPerModule));
    }
  }

  lines.push("");
  lines.push("## Common Entries");
  lines.push(...buildEntrySection(options.entryMap, maxEntriesPerType));

  lines.push("");
  lines.push("## Suggested Reading Order");
  lines.push(...buildReadingOrder(options.entryMap, maxEntriesPerType));

  const trimmed = lines.slice(0, maxLines);
  if (trimmed.length < lines.length) {
    trimmed[trimmed.length - 1] = "- Output truncated to fit line limit.";
  }
  return `${trimmed.join("\n")}\n`;
};
