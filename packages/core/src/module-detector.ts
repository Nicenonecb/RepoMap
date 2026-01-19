import path from "node:path";
import * as fs from "node:fs/promises";

export type ModuleLanguage = "node" | "go" | "python" | "mixed" | "unknown";

export interface ModuleInfo {
  name: string;
  path: string;
  language: ModuleLanguage;
  fileCount: number;
}

export interface ModuleDetectorOptions {
  repoRoot: string;
  files: Iterable<string>;
  useWorkspaceConfig?: boolean;
  workspacePatterns?: string[];
  fallbackWorkspacePatterns?: string[];
  onError?: (err: NodeJS.ErrnoException, path: string) => void;
}

type KnownLanguage = "node" | "go" | "python";

interface ModuleAggregate {
  path: string;
  fileCount: number;
  extCounts: Record<KnownLanguage, number>;
}

interface WorkspaceConfig {
  globs: string[];
  roots: string[];
}

const DEFAULT_WORKSPACE_PATTERNS = ["packages/*", "apps/*", "services/*", "libs/*"];

const NODE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts"
]);

const PYTHON_EXTENSIONS = new Set([".py", ".pyw"]);
const GO_EXTENSIONS = new Set([".go"]);

const PYPROJECT_FILES = new Set([
  "pyproject.toml",
  "pyproject.yaml",
  "pyproject.yml"
]);

const normalizePosixPath = (value: string) => {
  let normalized = value.replace(/\\/g, "/").trim();
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  while (normalized.endsWith("/") && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
};

const normalizeDirPath = (value: string) => {
  const normalized = normalizePosixPath(value);
  if (normalized.length === 0 || normalized === ".") return ".";
  return normalized;
};

const compareNames = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const reportError = (
  err: unknown,
  targetPath: string,
  onError?: ModuleDetectorOptions["onError"]
) => {
  if (!onError) return;
  const error = err as NodeJS.ErrnoException;
  if (error?.code === "ENOENT") return;
  onError(error, targetPath);
};

const readTextFile = async (
  targetPath: string,
  onError?: ModuleDetectorOptions["onError"]
) => {
  try {
    let content = await fs.readFile(targetPath, "utf8");
    if (content.startsWith("\uFEFF")) {
      content = content.slice(1);
    }
    return content;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error?.code === "ENOENT") return null;
    reportError(err, targetPath, onError);
    return null;
  }
};

const readJsonFile = async <T>(
  targetPath: string,
  onError?: ModuleDetectorOptions["onError"]
) => {
  const content = await readTextFile(targetPath, onError);
  if (content === null) return null;
  try {
    return JSON.parse(content) as T;
  } catch (err) {
    reportError(err, targetPath, onError);
    return null;
  }
};

const extractWorkspaces = (pkg: Record<string, unknown>) => {
  const workspaces = pkg.workspaces;
  if (Array.isArray(workspaces)) return workspaces.filter(isString);
  if (
    workspaces &&
    typeof workspaces === "object" &&
    Array.isArray((workspaces as Record<string, unknown>).packages)
  ) {
    const packages = (workspaces as Record<string, unknown>).packages;
    return Array.isArray(packages) ? packages.filter(isString) : [];
  }
  return [];
};

const parsePnpmWorkspace = (content: string) => {
  const lines = content.split(/\r?\n/);
  const patterns: string[] = [];
  let packagesIndent: number | null = null;

  for (const line of lines) {
    if (line.trim().length === 0 || line.trim().startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const trimmed = line.trim();

    if (trimmed.startsWith("packages:")) {
      packagesIndent = indent;
      continue;
    }

    if (packagesIndent !== null) {
      if (indent <= packagesIndent) {
        packagesIndent = null;
        continue;
      }
      if (trimmed.startsWith("-")) {
        let value = trimmed.slice(1).trim();
        if (value.startsWith("-")) value = value.slice(1).trim();
        value = value.replace(/^['"]|['"]$/g, "");
        if (value.length > 0) patterns.push(value);
      }
    }
  }

  return patterns;
};

const normalizeGlobPattern = (value: string) => {
  let pattern = value.trim();
  if (pattern.length === 0) return "";
  const negated = pattern.startsWith("!");
  if (negated) pattern = pattern.slice(1);
  pattern = normalizePosixPath(pattern);
  if (pattern === ".") pattern = "";
  return negated ? `!${pattern}` : pattern;
};

const normalizeGlobList = (patterns: string[]) => {
  const normalized = patterns
    .map(normalizeGlobPattern)
    .filter((pattern) => pattern.length > 0);
  return Array.from(new Set(normalized));
};

const normalizeRootList = (roots: string[]) => {
  const normalized = roots
    .map((root) => normalizeDirPath(root))
    .filter((root) => root.length > 0);
  return Array.from(new Set(normalized));
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globToRegExp = (pattern: string) => {
  let regex = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      const next = pattern[index + 1];
      if (next === "*") {
        while (pattern[index + 1] === "*") index += 1;
        regex += ".*";
      } else {
        regex += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      regex += "[^/]";
      continue;
    }
    regex += escapeRegExp(char);
  }
  regex += "$";
  return new RegExp(regex);
};

const compileGlobMatchers = (patterns: string[]) =>
  patterns.map((pattern) => {
    const negated = pattern.startsWith("!");
    const value = negated ? pattern.slice(1) : pattern;
    return {
      negated,
      regex: globToRegExp(value)
    };
  });

const matchesPatterns = (
  value: string,
  matchers: ReturnType<typeof compileGlobMatchers>
) => {
  if (matchers.length === 0) return false;
  let included = false;
  for (const matcher of matchers) {
    if (matcher.regex.test(value)) {
      included = !matcher.negated;
    }
  }
  return included;
};

const resolveModuleRoot = (
  filePath: string,
  candidateRoots: Set<string>,
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
    if (candidateRoots.has(dir)) {
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

const countLanguageFromExt = (ext: string): KnownLanguage | null => {
  if (NODE_EXTENSIONS.has(ext)) return "node";
  if (PYTHON_EXTENSIONS.has(ext)) return "python";
  if (GO_EXTENSIONS.has(ext)) return "go";
  return null;
};

const resolveLanguage = (
  aggregate: ModuleAggregate,
  markers: Set<KnownLanguage> | undefined
): ModuleLanguage => {
  if (markers && markers.size > 1) return "mixed";
  if (markers && markers.size === 1) return Array.from(markers)[0];

  const total =
    aggregate.extCounts.node +
    aggregate.extCounts.python +
    aggregate.extCounts.go;
  if (total === 0) return "unknown";
  const entries: [KnownLanguage, number][] = [
    ["node", aggregate.extCounts.node],
    ["python", aggregate.extCounts.python],
    ["go", aggregate.extCounts.go]
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const [topLang, topCount] = entries[0];
  if (topCount / total >= 0.6) return topLang;
  return "mixed";
};

const resolveAbsolutePath = (repoRoot: string, posixPath: string) => {
  const segments = posixPath === "." ? [] : posixPath.split("/");
  return path.resolve(repoRoot, ...segments);
};

const readModuleName = async (
  repoRoot: string,
  modulePath: string,
  onError?: ModuleDetectorOptions["onError"]
) => {
  const packagePath = resolveAbsolutePath(
    repoRoot,
    path.posix.join(modulePath, "package.json")
  );
  const pkg = await readJsonFile<Record<string, unknown>>(packagePath, onError);
  if (pkg && typeof pkg.name === "string") {
    return pkg.name;
  }
  return null;
};

const isString = (value: unknown): value is string => typeof value === "string";

const getWorkspaceConfig = async (
  repoRoot: string,
  onError?: ModuleDetectorOptions["onError"]
): Promise<WorkspaceConfig> => {
  const globs: string[] = [];
  const roots: string[] = [];

  const pkg = await readJsonFile<Record<string, unknown>>(
    path.resolve(repoRoot, "package.json"),
    onError
  );
  if (pkg) {
    globs.push(...extractWorkspaces(pkg));
  }

  const pnpmWorkspace = await readTextFile(
    path.resolve(repoRoot, "pnpm-workspace.yaml"),
    onError
  );
  if (pnpmWorkspace) {
    globs.push(...parsePnpmWorkspace(pnpmWorkspace));
  }

  const lerna = await readJsonFile<Record<string, unknown>>(
    path.resolve(repoRoot, "lerna.json"),
    onError
  );
  if (lerna && Array.isArray(lerna.packages)) {
    globs.push(...lerna.packages.filter(isString));
  }

  const rush = await readJsonFile<Record<string, unknown>>(
    path.resolve(repoRoot, "rush.json"),
    onError
  );
  if (rush && Array.isArray(rush.projects)) {
    for (const project of rush.projects) {
      const projectFolder = (project as Record<string, unknown>).projectFolder;
      if (typeof projectFolder === "string") roots.push(projectFolder);
    }
  }

  const nx = await readJsonFile<Record<string, unknown>>(
    path.resolve(repoRoot, "nx.json"),
    onError
  );
  if (nx) {
    const workspaceLayout = nx.workspaceLayout as
      | Record<string, unknown>
      | undefined;
    const appsDir = workspaceLayout?.appsDir;
    const libsDir = workspaceLayout?.libsDir;
    if (typeof appsDir === "string") globs.push(`${appsDir}/*`);
    if (typeof libsDir === "string") globs.push(`${libsDir}/*`);
  }

  const workspaceJson = await readJsonFile<Record<string, unknown>>(
    path.resolve(repoRoot, "workspace.json"),
    onError
  );
  if (workspaceJson && typeof workspaceJson.projects === "object") {
    for (const project of Object.values(
      workspaceJson.projects as Record<string, unknown>
    )) {
      const root = (project as Record<string, unknown>)?.root;
      if (typeof root === "string") roots.push(root);
    }
  }

  return {
    globs: normalizeGlobList(globs),
    roots: normalizeRootList(roots)
  };
};

export async function detectModules(
  options: ModuleDetectorOptions
): Promise<ModuleInfo[]> {
  const repoRoot = path.resolve(options.repoRoot);
  const onError = options.onError;
  const fileList = Array.isArray(options.files)
    ? options.files.map(normalizePosixPath)
    : Array.from(options.files, normalizePosixPath);

  const dirSet = new Set<string>();
  const topLevelDirs = new Set<string>();
  const markerMap = new Map<string, Set<KnownLanguage>>();

  for (const filePath of fileList) {
    if (!filePath || filePath === ".") continue;
    const dirPath = normalizeDirPath(path.posix.dirname(filePath));

    let current = dirPath;
    while (true) {
      if (dirSet.has(current)) break;
      dirSet.add(current);
      if (current === ".") break;
      current = path.posix.dirname(current);
    }

    if (filePath.includes("/")) {
      const topLevel = filePath.split("/")[0];
      if (topLevel) topLevelDirs.add(topLevel);
    }

    const baseName = path.posix.basename(filePath);
    if (baseName === "package.json") {
      const marker = markerMap.get(dirPath) ?? new Set<KnownLanguage>();
      marker.add("node");
      markerMap.set(dirPath, marker);
      continue;
    }
    if (baseName === "go.mod") {
      const marker = markerMap.get(dirPath) ?? new Set<KnownLanguage>();
      marker.add("go");
      markerMap.set(dirPath, marker);
      continue;
    }
    if (PYPROJECT_FILES.has(baseName)) {
      const marker = markerMap.get(dirPath) ?? new Set<KnownLanguage>();
      marker.add("python");
      markerMap.set(dirPath, marker);
    }
  }

  const useWorkspaceConfig = options.useWorkspaceConfig ?? true;
  const workspaceConfig = useWorkspaceConfig
    ? await getWorkspaceConfig(repoRoot, onError)
    : { globs: [], roots: [] };
  const fallbackWorkspacePatterns =
    options.fallbackWorkspacePatterns ?? DEFAULT_WORKSPACE_PATTERNS;
  const workspaceGlobs =
    options.workspacePatterns && options.workspacePatterns.length > 0
      ? normalizeGlobList(options.workspacePatterns)
      : workspaceConfig.globs.length > 0
        ? workspaceConfig.globs
        : normalizeGlobList(fallbackWorkspacePatterns);

  const candidateRoots = new Set<string>(markerMap.keys());
  const explicitRoots = new Set(workspaceConfig.roots);
  for (const root of explicitRoots) {
    candidateRoots.add(root);
  }

  if (workspaceGlobs.length > 0) {
    const matchers = compileGlobMatchers(workspaceGlobs);
    for (const dirPath of dirSet) {
      if (matchesPatterns(dirPath, matchers)) {
        candidateRoots.add(dirPath);
      }
    }
  }

  const hasNonRootMarkers = Array.from(markerMap.keys()).some(
    (root) => root !== "."
  );
  const hasWorkspaceHints = workspaceGlobs.length > 0 || explicitRoots.size > 0;
  if (!hasNonRootMarkers && !hasWorkspaceHints && topLevelDirs.size > 0) {
    for (const dir of topLevelDirs) candidateRoots.add(dir);
  }

  candidateRoots.add(".");

  const moduleMap = new Map<string, ModuleAggregate>();
  const dirCache = new Map<string, string>();

  for (const filePath of fileList) {
    if (!filePath || filePath === ".") continue;
    const moduleRoot = resolveModuleRoot(filePath, candidateRoots, dirCache);
    const aggregate =
      moduleMap.get(moduleRoot) ??
      ({
        path: moduleRoot,
        fileCount: 0,
        extCounts: { node: 0, python: 0, go: 0 }
      } satisfies ModuleAggregate);

    aggregate.fileCount += 1;
    const ext = path.posix.extname(filePath);
    const language = countLanguageFromExt(ext);
    if (language) aggregate.extCounts[language] += 1;

    moduleMap.set(moduleRoot, aggregate);
  }

  const repoName = path.basename(repoRoot);
  const modules: ModuleInfo[] = [];
  const sortedPaths = Array.from(moduleMap.keys()).sort(compareNames);

  for (const modulePath of sortedPaths) {
    const aggregate = moduleMap.get(modulePath);
    if (!aggregate) continue;
    const markers = markerMap.get(modulePath);
    const language = resolveLanguage(aggregate, markers);
    let name: string | null = null;
    if (markers?.has("node")) {
      name = await readModuleName(repoRoot, modulePath, onError);
    }
    if (!name) {
      name = modulePath === "." ? repoName : path.posix.basename(modulePath);
    }
    modules.push({
      name,
      path: modulePath,
      language,
      fileCount: aggregate.fileCount
    });
  }

  return modules;
}
