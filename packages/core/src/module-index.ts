import type { ModuleInfo } from "./module-detector.js";
import type { ModuleKeywords } from "./keyword-extractor.js";

export interface ModuleIndexEntry extends ModuleInfo {
  keywords: string[];
}

export interface ModuleIndex {
  modules: ModuleIndexEntry[];
}

const compareNames = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

export const buildModuleIndex = (
  modules: ModuleInfo[],
  keywords: ModuleKeywords[]
): ModuleIndex => {
  const keywordMap = new Map<string, string[]>();
  for (const entry of keywords) {
    keywordMap.set(entry.path, entry.keywords);
  }

  const entries = modules.map((module) => ({
    ...module,
    keywords: keywordMap.get(module.path) ?? []
  }));

  entries.sort((a, b) => compareNames(a.path, b.path));
  return { modules: entries };
};
