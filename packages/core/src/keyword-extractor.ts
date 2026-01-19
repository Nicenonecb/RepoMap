import path from "node:path";
import * as fs from "node:fs/promises";
import type { ModuleInfo } from "./module-detector.js";

export interface ModuleKeywords {
  path: string;
  keywords: string[];
}

export interface KeywordExtractorOptions {
  repoRoot: string;
  files: Iterable<string>;
  modules: ModuleInfo[];
  minKeywords?: number;
  maxKeywords?: number;
  maxContentBytes?: number;
  maxContentFiles?: number;
  includeFileNames?: boolean;
  includeExports?: boolean;
  includeRoutes?: boolean;
  includeInterfaces?: boolean;
  onError?: (err: NodeJS.ErrnoException, path: string) => void;
}

type KeywordCountMap = Map<string, number>;

const DEFAULT_MIN_KEYWORDS = 3;
const DEFAULT_MAX_KEYWORDS = 12;
const DEFAULT_MAX_CONTENT_BYTES = 512 * 1024;
const DEFAULT_MAX_CONTENT_FILES = 200;

const CONTENT_EXTENSIONS = new Set([
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

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "by",
  "with",
  "at",
  "from",
  "as",
  "is",
  "are",
  "be",
  "src",
  "lib",
  "test",
  "tests",
  "spec",
  "specs",
  "util",
  "utils",
  "common",
  "core",
  "app",
  "apps",
  "service",
  "services",
  "module",
  "modules",
  "component",
  "components",
  "config",
  "configs",
  "type",
  "types",
  "interface",
  "interfaces",
  "model",
  "models",
  "data",
  "db",
  "database",
  "api",
  "router",
  "routes",
  "controller",
  "controllers",
  "handler",
  "handlers",
  "impl",
  "impls",
  "internal",
  "pkg",
  "bin",
  "dist",
  "build",
  "tmp",
  "temp",
  "example",
  "examples",
  "doc",
  "docs",
  "readme",
  "mock",
  "fixture",
  "fixtures",
  "vendor",
  "node",
  "nodejs",
  "python",
  "go"
]);

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
  onError?: KeywordExtractorOptions["onError"]
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

const splitIdentifier = (value: string) => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, "$1 $2");
  return sanitized.split(/\s+/).filter(Boolean);
};

const tokenize = (value: string) => {
  const lower = value.toLowerCase();
  const parts = splitIdentifier(lower);
  return parts.filter((token) => {
    if (token.length < 2) return false;
    if (/^\d+$/.test(token)) return false;
    return !STOP_WORDS.has(token);
  });
};

const addTokens = (counts: KeywordCountMap, tokens: string[], weight: number) => {
  for (const token of tokens) {
    const current = counts.get(token) ?? 0;
    counts.set(token, current + weight);
  }
};

const addFromValue = (counts: KeywordCountMap, value: string, weight: number) => {
  if (!value) return;
  addTokens(counts, tokenize(value), weight);
};

const addFromIdentifiers = (
  counts: KeywordCountMap,
  identifiers: string[],
  weight: number
) => {
  for (const identifier of identifiers) {
    addTokens(counts, tokenize(identifier), weight);
  }
};

const addFromFileName = (counts: KeywordCountMap, filePath: string) => {
  const base = path.posix.basename(filePath);
  const withoutExt = base.replace(/\.[^.]+$/, "");
  const parts = withoutExt.split(".");
  for (const part of parts) {
    addFromValue(counts, part, 1);
  }
};

const extractExports = (content: string) => {
  const tokens: string[] = [];
  const patterns: RegExp[] = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+default\s+(?:class|function)\s+([A-Za-z_$][\w$]*)/g
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      tokens.push(match[1]);
    }
  }

  const exportList = /\bexport\s*\{([^}]+)\}/g;
  let listMatch: RegExpExecArray | null;
  while ((listMatch = exportList.exec(content))) {
    const items = listMatch[1].split(",");
    for (const item of items) {
      const cleaned = item.trim();
      if (!cleaned) continue;
      const parts = cleaned.split(/\s+as\s+/i);
      const name = (parts[1] ?? parts[0]).trim();
      if (name && name !== "default") tokens.push(name);
    }
  }

  const cjsExport = /\bexports\.([A-Za-z_$][\w$]*)/g;
  let cjsMatch: RegExpExecArray | null;
  while ((cjsMatch = cjsExport.exec(content))) {
    tokens.push(cjsMatch[1]);
  }

  const moduleExport = /\bmodule\.exports\s*=\s*\{([^}]+)\}/g;
  let moduleMatch: RegExpExecArray | null;
  while ((moduleMatch = moduleExport.exec(content))) {
    const items = moduleMatch[1].split(",");
    for (const item of items) {
      const name = item.split(":")[0]?.trim();
      if (name) tokens.push(name);
    }
  }

  return tokens;
};

const extractInterfaces = (content: string) => {
  const tokens: string[] = [];
  const patterns: RegExp[] = [
    /\binterface\s+([A-Za-z_$][\w$]*)/g,
    /\btype\s+([A-Za-z_$][\w$]*)\s*=/g,
    /\btype\s+([A-Za-z_$][\w$]*)\s+struct\b/g,
    /\btype\s+([A-Za-z_$][\w$]*)\s+interface\b/g
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      tokens.push(match[1]);
    }
  }
  return tokens;
};

const extractRoutes = (content: string) => {
  const tokens: string[] = [];
  const patterns: RegExp[] = [
    /\b(?:router|app|fastify|koa)\s*\.\s*(?:get|post|put|delete|patch|all|use)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\b(?:router|app|fastify|koa)\s*\.\s*route\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /@(?:Get|Post|Put|Delete|Patch|All)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\burl\s*:\s*['"`]([^'"`]+)['"`]/g,
    /@.*route\s*\(\s*['"`]([^'"`]+)['"`]/g
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      tokens.push(match[1]);
    }
  }
  return tokens;
};

const extractPythonSymbols = (content: string) => {
  const tokens: string[] = [];
  const patterns: RegExp[] = [
    /\bdef\s+([A-Za-z_][\w]*)\s*\(/g,
    /\bclass\s+([A-Za-z_][\w]*)\b/g
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      tokens.push(match[1]);
    }
  }
  return tokens;
};

const extractGoSymbols = (content: string) => {
  const tokens: string[] = [];
  const patterns: RegExp[] = [
    /\bfunc\s+([A-Za-z_][\w]*)\s*\(/g,
    /\btype\s+([A-Za-z_][\w]*)\s+(?:struct|interface)\b/g,
    /\bconst\s+([A-Za-z_][\w]*)\s*=/g,
    /\bvar\s+([A-Za-z_][\w]*)\s*=/g
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      tokens.push(match[1]);
    }
  }
  return tokens;
};

const extractRouteTokens = (routePath: string) => {
  const cleaned = routePath
    .replace(/\/\/+/g, "/")
    .replace(/[:*{}]/g, " ")
    .replace(/[()]/g, " ");
  const parts = cleaned.split("/").filter(Boolean);
  const tokens: string[] = [];
  for (const part of parts) {
    tokens.push(...tokenize(part));
  }
  return tokens;
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

const readFileContent = async (
  absPath: string,
  maxBytes: number,
  onError?: KeywordExtractorOptions["onError"]
) => {
  try {
    const stats = await fs.stat(absPath);
    if (stats.size > maxBytes) return null;
    let content = await fs.readFile(absPath, "utf8");
    if (content.startsWith("\uFEFF")) {
      content = content.slice(1);
    }
    return content;
  } catch (err) {
    reportError(err, absPath, onError);
    return null;
  }
};

const finalizeKeywords = (
  counts: KeywordCountMap,
  maxKeywords: number
) => {
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || compareNames(a[0], b[0]))
    .slice(0, maxKeywords)
    .map(([token]) => token);
  return sorted;
};

export async function extractModuleKeywords(
  options: KeywordExtractorOptions
): Promise<ModuleKeywords[]> {
  const repoRoot = path.resolve(options.repoRoot);
  const minKeywords = options.minKeywords ?? DEFAULT_MIN_KEYWORDS;
  const maxKeywords = options.maxKeywords ?? DEFAULT_MAX_KEYWORDS;
  const maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  const maxContentFiles = options.maxContentFiles ?? DEFAULT_MAX_CONTENT_FILES;
  const includeFileNames = options.includeFileNames ?? true;
  const includeExports = options.includeExports ?? true;
  const includeRoutes = options.includeRoutes ?? true;
  const includeInterfaces = options.includeInterfaces ?? true;
  const onError = options.onError;

  const files = Array.isArray(options.files)
    ? options.files.map(normalizePosixPath)
    : Array.from(options.files, normalizePosixPath);

  const modulePaths = options.modules.map((module) =>
    normalizePosixPath(module.path)
  );
  const moduleSet = new Set(modulePaths);
  if (!moduleSet.has(".")) moduleSet.add(".");

  const moduleFileMap = new Map<string, string[]>();
  const keywordMap = new Map<string, KeywordCountMap>();
  const dirCache = new Map<string, string>();

  const ensureModule = (modulePath: string) => {
    if (!moduleFileMap.has(modulePath)) moduleFileMap.set(modulePath, []);
    if (!keywordMap.has(modulePath)) keywordMap.set(modulePath, new Map());
  };

  for (const filePath of files) {
    if (!filePath || filePath === ".") continue;
    const moduleRoot = resolveModuleRoot(filePath, moduleSet, dirCache);
    ensureModule(moduleRoot);
    moduleFileMap.get(moduleRoot)?.push(filePath);

    if (includeFileNames) {
      const counts = keywordMap.get(moduleRoot);
      if (counts) addFromFileName(counts, filePath);
    }
  }

  for (const modulePath of modulePaths) {
    ensureModule(modulePath);
  }

  const results: ModuleKeywords[] = [];
  const sortedModulePaths = Array.from(moduleSet).sort(compareNames);

  for (const modulePath of sortedModulePaths) {
    const counts = keywordMap.get(modulePath);
    if (!counts) continue;

    const fileList = moduleFileMap.get(modulePath) ?? [];
    fileList.sort(compareNames);

    let processedFiles = 0;
    if (
      includeExports ||
      includeRoutes ||
      includeInterfaces
    ) {
      for (const filePath of fileList) {
        if (processedFiles >= maxContentFiles) break;
        if (counts.size >= maxKeywords) break;
        const ext = path.posix.extname(filePath);
        if (!CONTENT_EXTENSIONS.has(ext)) continue;
        const absPath = resolveAbsPath(repoRoot, filePath);
        const content = await readFileContent(absPath, maxContentBytes, onError);
    if (content === null) continue;

    if (ext === ".py") {
      if (includeExports || includeInterfaces) {
        addFromIdentifiers(counts, extractPythonSymbols(content), 2);
      }
    } else if (ext === ".go") {
      if (includeExports || includeInterfaces) {
        addFromIdentifiers(counts, extractGoSymbols(content), 2);
      }
    } else {
      if (includeExports) {
        addFromIdentifiers(counts, extractExports(content), 3);
      }
      if (includeInterfaces) {
        addFromIdentifiers(counts, extractInterfaces(content), 2);
      }
    }

    if (includeRoutes) {
      const routes = extractRoutes(content);
      for (const route of routes) {
        addTokens(counts, extractRouteTokens(route), 4);
      }
    }

        processedFiles += 1;
        if (counts.size >= maxKeywords && counts.size >= minKeywords) break;
      }
    }

    if (counts.size < minKeywords) {
      const fallback = tokenize(path.posix.basename(modulePath));
      addTokens(counts, fallback, 1);
    }

    results.push({
      path: modulePath,
      keywords: finalizeKeywords(counts, maxKeywords)
    });
  }

  return results;
}
