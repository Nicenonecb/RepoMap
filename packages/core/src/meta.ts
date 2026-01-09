export type HashAlgorithm = "sha256" | "sha1";

export interface RepoMapMeta {
  toolVersion: string;
  repoRoot: string;
  gitCommit: string | null;
  generatedAt: string;
  hashAlgorithm: HashAlgorithm;
}

export interface CreateMetaInput {
  toolVersion: string;
  repoRoot: string;
  gitCommit?: string | null;
  generatedAt?: string;
  hashAlgorithm?: HashAlgorithm;
}

export function createMeta(input: CreateMetaInput): RepoMapMeta {
  return {
    toolVersion: input.toolVersion,
    repoRoot: input.repoRoot,
    gitCommit: input.gitCommit ?? null,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    hashAlgorithm: input.hashAlgorithm ?? "sha256"
  };
}
