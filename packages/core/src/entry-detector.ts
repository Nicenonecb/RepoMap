import path from "node:path";
import type { ModuleInfo } from "./module-detector.js";

export type EntryType =
  | "web-route"
  | "controller"
  | "cli-entry"
  | "job"
  | "worker"
  | "unknown-entry";

export interface EntryInfo {
  path: string;
  type: EntryType;
}

export interface ModuleEntries {
  path: string;
  entries: EntryInfo[];
}

export interface EntryMap {
  modules: ModuleEntries[];
}

export interface EntryDetectorOptions {
  files: Iterable<string>;
  modules: ModuleInfo[];
  includeUnknown?: boolean;
  maxEntriesPerModule?: number;
}

const CODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".go"
]);

const WEB_ROUTE_SEGMENTS = new Set([
  "routes",
  "route",
  "router",
  "routing",
  "routers",
  "endpoints",
  "endpoint",
  "pages",
  "api"
]);

const CONTROLLER_SEGMENTS = new Set(["controller", "controllers"]);
const CLI_SEGMENTS = new Set(["cli", "bin", "cmd", "command", "commands"]);
const WORKER_SEGMENTS = new Set(["worker", "workers", "queue", "queues"]);
const JOB_SEGMENTS = new Set(["job", "jobs", "cron", "scheduler", "schedule", "task", "tasks"]);

const TEST_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "spec",
  "specs",
  "__specs__",
  "fixture",
  "fixtures",
  "mock",
  "mocks",
  "__mocks__"
]);

const ENTRY_TYPE_ORDER: EntryType[] = [
  "web-route",
  "controller",
  "cli-entry",
  "worker",
  "job",
  "unknown-entry"
];

const ENTRY_TYPE_RANK = new Map<EntryType, number>(
  ENTRY_TYPE_ORDER.map((type, index) => [type, index])
);

const normalizePosixPath = (value: string) => {
  let normalized = value.replace(/\\/g, "/").trim();
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  while (normalized.endsWith("/") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.length === 0 ? "." : normalized;
};

const compareNames = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
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

const hasSegment = (segments: string[], set: Set<string>) =>
  segments.some((segment) => set.has(segment));

const isTestFile = (segments: string[], baseName: string) => {
  if (hasSegment(segments, TEST_SEGMENTS)) return true;
  return baseName.includes(".test") || baseName.includes(".spec");
};

const detectEntryType = (filePath: string): EntryType | null => {
  const ext = path.posix.extname(filePath);
  if (!CODE_EXTENSIONS.has(ext)) return null;

  const segments = filePath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  const baseName = path.posix.basename(filePath, ext).toLowerCase();

  if (isTestFile(segments, baseName)) return null;

  const baseHas = (needle: string) => baseName.includes(needle);

  const webRouteMatch =
    hasSegment(segments, WEB_ROUTE_SEGMENTS) ||
    baseHas("route") ||
    baseHas("router") ||
    baseHas("routing");
  if (webRouteMatch) return "web-route";

  const controllerMatch =
    hasSegment(segments, CONTROLLER_SEGMENTS) || baseHas("controller");
  if (controllerMatch) return "controller";

  const cliMatch =
    hasSegment(segments, CLI_SEGMENTS) ||
    baseHas("cli") ||
    baseName === "main";
  if (cliMatch) return "cli-entry";

  const workerMatch =
    hasSegment(segments, WORKER_SEGMENTS) || baseHas("worker") || baseHas("queue");
  if (workerMatch) return "worker";

  const jobMatch =
    hasSegment(segments, JOB_SEGMENTS) || baseHas("job") || baseHas("cron");
  if (jobMatch) return "job";

  return null;
};

const addEntry = (
  map: Map<string, EntryInfo[]>,
  entryKeys: Map<string, Set<string>>,
  modulePath: string,
  entry: EntryInfo,
  maxEntriesPerModule: number
) => {
  const entries = map.get(modulePath) ?? [];
  if (entries.length >= maxEntriesPerModule) return;
  const keySet = entryKeys.get(modulePath) ?? new Set<string>();
  const key = `${entry.type}:${entry.path}`;
  if (keySet.has(key)) return;
  entries.push(entry);
  keySet.add(key);
  map.set(modulePath, entries);
  entryKeys.set(modulePath, keySet);
};

export const detectEntries = (
  options: EntryDetectorOptions
): EntryMap => {
  const includeUnknown = options.includeUnknown ?? true;
  const maxEntriesPerModule = options.maxEntriesPerModule ?? 200;

  const files = Array.isArray(options.files)
    ? options.files.map(normalizePosixPath)
    : Array.from(options.files, normalizePosixPath);

  const moduleRoots = new Set(
    options.modules.map((module) => normalizePosixPath(module.path))
  );
  if (!moduleRoots.has(".")) moduleRoots.add(".");

  const moduleMap = new Map<string, EntryInfo[]>();
  const entryKeys = new Map<string, Set<string>>();
  const dirCache = new Map<string, string>();

  for (const filePath of files) {
    if (!filePath || filePath === ".") continue;
    const entryType = detectEntryType(filePath);
    if (!entryType) continue;
    const moduleRoot = resolveModuleRoot(filePath, moduleRoots, dirCache);
    addEntry(
      moduleMap,
      entryKeys,
      moduleRoot,
      { path: filePath, type: entryType },
      maxEntriesPerModule
    );
  }

  const modules = Array.from(moduleRoots).sort(compareNames);
  const entries: ModuleEntries[] = [];

  for (const modulePath of modules) {
    const moduleEntries = moduleMap.get(modulePath) ?? [];
    moduleEntries.sort((a, b) => {
      const rankA = ENTRY_TYPE_RANK.get(a.type) ?? 999;
      const rankB = ENTRY_TYPE_RANK.get(b.type) ?? 999;
      if (rankA !== rankB) return rankA - rankB;
      return compareNames(a.path, b.path);
    });

    if (moduleEntries.length === 0 && includeUnknown) {
      entries.push({
        path: modulePath,
        entries: [{ path: "", type: "unknown-entry" }]
      });
      continue;
    }

    entries.push({ path: modulePath, entries: moduleEntries });
  }

  return { modules: entries };
};
