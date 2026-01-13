#!/usr/bin/env node

import { Command } from "commander";
const VERSION = "0.1.0";

const program = new Command();

const collectIgnore = (value: string, previous: string[]) => {
  const next = (previous ?? []).slice();
  next.push(value);
  return next;
};

const logCommand = (
  command: Command,
  name: string,
  meta?: Record<string, unknown>
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
  .action((_options, command) => {
    const metaPreview = {
      toolVersion: VERSION,
      repoRoot: process.cwd(),
      gitCommit: null,
      generatedAt: new Date().toISOString(),
      hashAlgorithm: "sha256"
    };

    logCommand(command, "build", metaPreview);
  });

program
  .command("update")
  .description("Update an existing RepoMap output")
  .action((_options, command) => {
    logCommand(command, "update");
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
