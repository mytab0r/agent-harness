#!/usr/bin/env node
// Optional mutation adapter tier.
//
// The universal tier (revert-fix.mjs) always runs. This script runs only the
// enabled language-specific adapters whose globs match changed files. An
// adapter is a command plus the files it should mutate; the command gets a
// temporary diff file and the changed paths.
//
// Usage:
//   node mutation/run-adapters.mjs --base origin/main
//   node mutation/run-adapters.mjs --base origin/main --list
//   node mutation/run-adapters.mjs --base origin/main --only rust-cargo-mutants
//   node mutation/run-adapters.mjs --base origin/main --dry-run
//
// Placeholders in an adapter command:
//   {diff}      path to a temporary diff of the matched files
//   {files}     comma-separated matched paths
//   {base}      the base ref
//   {repoRoot}  the repository root
//
// Reporting:
//   adapter-mutation: NONE-MATCHED          no enabled adapter matched
//   adapter-mutation: <id> PASS|FAIL|MISSING-TOOL|ERROR
//   adapter-mutation: PASSED|FAILED
//
// Exit 0: no adapter matched, or every matched adapter passed. Exit 1: an
// adapter failed, was missing, or could not run. Exit 2: bad configuration.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(file, globs) {
  const normalized = String(file).replace(/\\/g, "/").replace(/^\.\//, "");
  return (globs ?? []).some((glob) => globToRegExp(glob).test(normalized));
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function loadConfig(root, explicit) {
  const candidate = explicit
    ? path.resolve(explicit)
    : path.join(root, "mutation", "adapters.json");
  if (!fs.existsSync(candidate)) return { timeoutMs: 900000, adapters: [] };
  return JSON.parse(fs.readFileSync(candidate, "utf8"));
}

function runAdapter(adapter, context) {
  const command = adapter.command.map((part) =>
    String(part)
      .replaceAll("{diff}", context.diffFile)
      .replaceAll("{files}", context.files.join(","))
      .replaceAll("{base}", context.base)
      .replaceAll("{repoRoot}", context.root),
  );
  const result = spawnSync(command[0], command.slice(1), {
    cwd: context.root,
    encoding: "utf8",
    timeout: context.timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HARNESS_MUTATION: `adapter:${adapter.id}` },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error?.code === "ENOENT") {
    return { status: "MISSING-TOOL", command, output, install: adapter.install };
  }
  if (result.error) {
    return { status: "ERROR", command, output: `${result.error.message}\n${output}`.trim() };
  }
  if (result.status !== 0) {
    return { status: "FAIL", command, output };
  }
  return { status: "PASS", command, output };
}

function short(output, lines = 8) {
  return String(output ?? "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lines)
    .join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--list") {
      args.list = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${token} needs a value`);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node mutation/run-adapters.mjs --base <git-ref> [--repo-root <dir>]",
    "      [--config <path>] [--only <id>] [--list] [--dry-run]",
    "",
    "Runs only enabled adapters whose globs match the changed files. The",
    "universal tier is separate and always authoritative; adapters add",
    "per-language, per-mutant evidence.",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const root = path.resolve(args["repo-root"] ?? process.cwd());
  const config = loadConfig(root, args.config);
  const adapters = Array.isArray(config.adapters) ? config.adapters : [];

  if (args.list) {
    for (const adapter of adapters) {
      console.log(
        `${adapter.id}\tenabled=${Boolean(adapter.enabled)}\t${(adapter.globs ?? []).join(",")}\t${adapter.proves ?? ""}`,
      );
    }
    return;
  }

  const base = args.base;
  if (!base) throw new Error("--base is required, for example --base origin/main");

  let changed;
  try {
    changed = git(root, ["diff", "--name-only", `${base}...HEAD`])
      .split(/\r?\n/)
      .filter(Boolean);
  } catch (error) {
    console.error(`adapter-mutation: ERROR\n  reason: could not read the diff: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  if (changed.length === 0) {
    console.log("adapter-mutation: NONE-MATCHED");
    console.log("  reason: the diff is empty");
    return;
  }

  const selected = adapters
    .filter((adapter) => adapter.enabled)
    .filter((adapter) => !args.only || adapter.id === args.only)
    .map((adapter) => {
      const files = changed.filter((file) => matchesAny(file, adapter.globs ?? []));
      return { adapter, files };
    })
    .filter((entry) => entry.files.length > 0);

  if (selected.length === 0) {
    console.log("adapter-mutation: NONE-MATCHED");
    console.log(
      "  reason: no enabled adapter matches the changed files; the universal tier is the only mutation proof",
    );
    return;
  }

  const timeoutMs = Number(config.timeoutMs ?? 900000);
  const extraFiles = [];

  if (args.dryRun) {
    for (const entry of selected) {
      console.log(`adapter-mutation: ${entry.adapter.id} DRY-RUN`);
      console.log(`  files: ${entry.files.join(", ")}`);
      console.log(`  command: ${entry.adapter.command.join(" ")}`);
    }
    return;
  }

  let failed = 0;
  for (const entry of selected) {
    const adapter = entry.adapter;
    if (!Array.isArray(adapter.command) || adapter.command.length === 0) {
      console.error(`adapter-mutation: ${adapter.id} ERROR\n  reason: command is missing`);
      failed += 1;
      continue;
    }
    const diffFile = path.join(os.tmpdir(), `adapter-${adapter.id.replace(/[^a-z0-9-]/gi, "-")}-${process.pid}.diff`);
    const diff = git(root, ["diff", "--no-color", "--binary", `${base}...HEAD`, "--", ...entry.files]);
    fs.writeFileSync(diffFile, `${diff}\n`, "utf8");
    extraFiles.push(diffFile);

    const result = runAdapter(adapter, {
      root,
      base,
      files: entry.files,
      diffFile,
      timeoutMs,
    });

    console.log(`adapter-mutation: ${adapter.id} ${result.status}`);
    console.log(`  proves: ${adapter.proves ?? "language-specific mutation evidence"}`);
    console.log(`  files: ${entry.files.join(", ")}`);
    console.log(`  command: ${result.command.join(" ")}`);
    if (result.output) console.log(`  output:\n    ${short(result.output).replace(/\n/g, "\n    ")}`);
    if (result.install) console.log(`  install: ${result.install}`);
    if (result.status !== "PASS") failed += 1;
  }

  for (const file of extraFiles) {
    try {
      fs.unlinkSync(file);
    } catch {
      // Temp files are outside the repository.
    }
  }

  if (failed > 0) {
    console.log(`adapter-mutation: FAILED (${failed} adapter(s))`);
    process.exitCode = 1;
    return;
  }
  console.log("adapter-mutation: PASSED");
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`adapter-mutation: ERROR\n  reason: ${error.message}`);
    process.exit(2);
  }
}

export { globToRegExp, matchesAny, loadConfig };
