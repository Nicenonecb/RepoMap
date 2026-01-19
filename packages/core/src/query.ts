import type { EntryInfo, EntryMap } from "./entry-detector.js";
import type { ModuleIndex, ModuleIndexEntry } from "./module-index.js";

export type QueryMatchField = "name" | "path" | "keyword" | "entry" | "entry-type";

export interface QueryMatch {
  field: QueryMatchField;
  value: string;
}

export interface QueryResultEntry {
  name: string;
  path: string;
  language: string;
  fileCount: number;
  score: number;
  matches: QueryMatch[];
}

export interface QueryResult {
  query: string;
  tokens: string[];
  results: QueryResultEntry[];
}

export interface QueryOptions {
  query: string;
  moduleIndex: ModuleIndex;
  entryMap?: EntryMap | null;
  maxResults?: number;
  minScore?: number;
}

const DEFAULT_MAX_RESULTS = 50;
const DEFAULT_MIN_SCORE = 1;
const MAX_MATCHES = 24;
const MATCH_FIELD_ORDER: QueryMatchField[] = [
  "name",
  "path",
  "keyword",
  "entry",
  "entry-type"
];

const compareNames = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const normalizeForSearch = (value: string) => {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

const tokenizeQuery = (value: string) => {
  const normalized = normalizeForSearch(value);
  if (!normalized) return [];
  const parts = normalized.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of parts) {
    if (seen.has(part)) continue;
    seen.add(part);
    tokens.push(part);
  }
  return tokens;
};

const buildEntryMap = (entryMap?: EntryMap | null) => {
  const map = new Map<string, EntryInfo[]>();
  if (!entryMap) return map;
  for (const moduleEntry of entryMap.modules) {
    map.set(moduleEntry.path, moduleEntry.entries ?? []);
  }
  return map;
};

const flattenMatches = (matchMap: Map<QueryMatchField, Set<string>>) => {
  const matches: QueryMatch[] = [];
  for (const field of MATCH_FIELD_ORDER) {
    const values = Array.from(matchMap.get(field) ?? []).sort(compareNames);
    for (const value of values) {
      matches.push({ field, value });
      if (matches.length >= MAX_MATCHES) return matches;
    }
  }
  return matches;
};

const scoreModule = (
  module: ModuleIndexEntry,
  tokens: string[],
  entries: EntryInfo[]
) => {
  let score = 0;
  let matchCount = 0;
  const matchMap = new Map<QueryMatchField, Set<string>>();
  const addMatch = (field: QueryMatchField, value: string, weight: number) => {
    if (!value) return;
    const set = matchMap.get(field) ?? new Set<string>();
    if (set.has(value)) return;
    set.add(value);
    matchMap.set(field, set);
    score += weight;
    matchCount += 1;
  };

  const nameNormalized = normalizeForSearch(module.name);
  const pathNormalized = normalizeForSearch(module.path);
  const keywordNormalized = module.keywords.map((keyword) => ({
    value: keyword,
    normalized: normalizeForSearch(keyword)
  }));

  for (const token of tokens) {
    if (!token) continue;
    if (nameNormalized === token) addMatch("name", module.name, 12);
    else if (nameNormalized.includes(token)) addMatch("name", module.name, 8);

    if (pathNormalized === token) addMatch("path", module.path, 6);
    else if (pathNormalized.includes(token)) addMatch("path", module.path, 4);

    for (const keyword of keywordNormalized) {
      if (!keyword.normalized) continue;
      if (keyword.normalized === token) addMatch("keyword", keyword.value, 6);
      else if (keyword.normalized.includes(token))
        addMatch("keyword", keyword.value, 3);
    }
  }

  if (entries.length > 0 && matchCount < MAX_MATCHES) {
    for (const entry of entries) {
      const entryPathNormalized = normalizeForSearch(entry.path);
      const entryTypeNormalized = normalizeForSearch(entry.type);
      const entryTypeTokens = entryTypeNormalized
        ? entryTypeNormalized.split(/\s+/).filter(Boolean)
        : [];
      for (const token of tokens) {
        if (!token) continue;
        if (entryPathNormalized.includes(token)) {
          addMatch("entry", entry.path, 4);
        }
        if (entryTypeTokens.includes(token)) {
          addMatch("entry-type", entry.type, 2);
        }
      }
    }
  }

  return {
    score,
    matches: flattenMatches(matchMap)
  };
};

export const queryModules = (options: QueryOptions): QueryResult => {
  const query = options.query ?? "";
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return { query, tokens, results: [] };
  }

  const maxResults =
    options.maxResults === undefined ? DEFAULT_MAX_RESULTS : options.maxResults;
  const minScore =
    options.minScore === undefined ? DEFAULT_MIN_SCORE : options.minScore;
  const entryMap = buildEntryMap(options.entryMap);

  const results: QueryResultEntry[] = [];
  for (const module of options.moduleIndex.modules) {
    const entries = entryMap.get(module.path) ?? [];
    const scored = scoreModule(module, tokens, entries);
    if (scored.score < minScore) continue;
    results.push({
      name: module.name,
      path: module.path,
      language: module.language,
      fileCount: module.fileCount,
      score: scored.score,
      matches: scored.matches
    });
  }

  results.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return compareNames(a.path, b.path);
  });

  const limited =
    maxResults > 0 ? results.slice(0, maxResults) : results.slice();

  return {
    query,
    tokens,
    results: limited
  };
};
