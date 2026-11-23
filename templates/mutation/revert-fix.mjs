#!/usr/bin/env node
// Universal mutation proof: revert the non-test part of a change, run the test
// command, and require the test to fail. This proves that the tests detect the
// change without any language-specific mutation tooling.
//
// Usage:
//   node mutation/revert-fix.mjs --base origin/main
//   node mutation/revert-fix.mjs --base HEAD~1 --repo-root . --config mutation/config.json
//   node mutation/revert-fix.mjs --base origin/main --dry-run
//
// The working tree must be clean. The script applies the diff base...HEAD,
// reverses only the file sections whose path does not match testGlobs, runs
// testCommand, restores the tree, and reports:
//
//   universal-mutation: PROVEN          the test failed after the revert
//   universal-mutation: NOT-CAUGHT      the test stayed green
//   universal-mutation: NOT-APPLICABLE  only test files changed
//   universal-mutation: BASELINE-RED    the test was already failing
//   universal-mutation: ERROR           the proof could not run
//
// Tier 1 is coarse: it runs one test command, not a per-test mutation run. It
// complements, and does not replace, a language-specific adapter.
//
// Exit 0: PROVEN, NOT-APPLICABLE or DRY-RUN. Exit 1: NOT-CAUGHT or
// BASELINE-RED. Exit 2: ERROR.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  testCommand: null,
  testGlobs: [
    "**/*.test.mjs",
    "**/*-test.mjs",
    "**/test_*.py",
    "**/*_test.py",
    "tests/**",
    "test/**",
  ],
  ignoreGlobs: ["docs/**", "specs/**", "**/*.md", ".github/**"],
  timeoutMs: 120000,
  allowDirty: false,
  env: {},
};

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

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function loadConfig(root, explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
        path.join(root, "mutation", "config.json"),
        path.join(root, "mutation.config.json"),
        path.join(SCRIPT_DIR, "config.json"),
      ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  }
  return DEFAULT_CONFIG;
}

function unquotePath(value) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function splitPatch(patch) {
  const sections = [];
  let current = null;
  for (const line of String(patch).split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = { lines: [line] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.map((section) => {
    let file = null;
    for (const line of section.lines) {
      if (line.startsWith("+++ b/")) {
        file = unquotePath(line.slice(6));
        break;
      }
      if (line.startsWith("+++ ")) {
        const value = unquotePath(line.slice(4));
        if (value !== "/dev/null") file = value.replace(/^b\//, "");
      }
    }
    if (!file) {
      for (const line of section.lines) {
        if (line.startsWith("--- a/")) {
          file = unquotePath(line.slice(6));
          break;
        }
      }
    }
    return { file: file ? file.replace(/\\/g, "/") : null, text: section.lines.join("\n") };
  });
}

function runCommand(command, { root, timeoutMs, env }) {
  if (!Array.isArray(command) || command.length === 0) {
    return {
      status: null,
      timedOut: false,
      error: new Error("testCommand must be a non-empty array, for example [\"node\", \"test/all.test.mjs\"]"),
      output: "",
    };
  }
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, ...env, HARNESS_MUTATION: "revert-fix" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    timedOut: result.error?.code === "ETIMEDOUT" || result.signal === "SIGTERM",
    error: result.error ?? null,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function short(output, lines = 6) {
  return String(output ?? "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-lines)
    .join("\n");
}

function printResult(token, details) {
  console.log(`universal-mutation: ${token}`);
  for (const [key, value] of Object.entries(details)) {
    if (value === undefined || value === null || value === "") continue;
    const text = String(value);
    const indent = text.includes("\n") ? "\n  " : " ";
    console.log(`  ${key}:${indent}${text.replace(/\n/g, "\n  ")}`);
  }
}

function parseArgs(argv) {
  const args = { timeoutMs: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--allow-dirty") {
      args.allowDirty = true;
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
    "  node mutation/revert-fix.mjs --base <git-ref> [--repo-root <dir>] [--config <path>]",
    "      [--timeout <ms>] [--allow-dirty] [--dry-run]",
    "",
    "Reverts the non-test file sections of <base>...HEAD, runs testCommand and",
    "requires the test to fail. Restores the tree in a finally block.",
    "",
    "Tier 1 needs a clean working tree and a configured test command. It does",
    "not provide per-test granularity; use an adapter for that.",
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
  const testCommand = config.testCommand;
  const timeoutMs = Number(args.timeout ?? args.timeoutMs ?? config.timeoutMs ?? 120000);
  const allowDirty = args.allowDirty || config.allowDirty;
  const base = args.base;

  if (!base) throw new Error("--base is required, for example --base origin/main");

  if (!fs.existsSync(path.join(root, ".git"))) {
    printResult("ERROR", { reason: `${root} is not a git repository` });
    process.exitCode = 2;
    return;
  }

  const dirty = git(root, ["status", "--porcelain"]);
  if (dirty && !allowDirty) {
    printResult("ERROR", {
      reason: "the working tree is not clean; tier 1 must run on a committed tree",
      detail: short(dirty, 4),
    });
    process.exitCode = 2;
    return;
  }

  try {
    git(root, ["rev-parse", "--verify", `${base}^{commit}`]);
  } catch {
    printResult("ERROR", { reason: `base ref does not resolve: ${base}` });
    process.exitCode = 2;
    return;
  }

  if (!Array.isArray(testCommand) || testCommand.length === 0) {
    printResult("ERROR", {
      reason: "testCommand is not configured",
      detail: "Set `testCommand` in mutation/config.json, for example [\"node\", \"test/all.test.mjs\"].",
    });
    process.exitCode = 2;
    return;
  }

  const patch = git(root, ["diff", "--no-color", "--binary", "--full-index", `${base}...HEAD`]);
  if (!patch) {
    printResult("NOT-APPLICABLE", { base, reason: "the diff is empty" });
    return;
  }

  const sections = splitPatch(patch);
  const testFiles = sections.filter((section) => section.file && matchesAny(section.file, config.testGlobs));
  const ignored = sections.filter(
    (section) =>
      section.file &&
      !matchesAny(section.file, config.testGlobs) &&
      matchesAny(section.file, config.ignoreGlobs ?? []),
  );
  const nonTest = sections.filter(
    (section) =>
      section.file &&
      !matchesAny(section.file, config.testGlobs) &&
      !matchesAny(section.file, config.ignoreGlobs ?? []),
  );

  if (nonTest.length === 0) {
    printResult("NOT-APPLICABLE", {
      base,
      reason:
        ignored.length > 0
          ? "only test or docs/process paths changed; there is no product hunk to revert"
          : "only test paths changed; there is no non-test hunk to revert",
      tests: testFiles.map((section) => section.file).join(", ") || "(none)",
      ignored: ignored.map((section) => section.file).join(", ") || "(none)",
    });
    return;
  }

  if (args.dryRun) {
    printResult("DRY-RUN", {
      base,
      reverted: nonTest.map((section) => section.file).join(", "),
      kept: testFiles.map((section) => section.file).join(", ") || "(none)",
      test: testCommand.join(" "),
    });
    return;
  }

  const baseline = runCommand(testCommand, { root, timeoutMs, env: config.env ?? {} });
  if (baseline.error) {
    printResult("ERROR", { reason: `could not run the test command: ${baseline.error.message}` });
    process.exitCode = 2;
    return;
  }
  if (baseline.status !== 0) {
    printResult("BASELINE-RED", {
      base,
      test: testCommand.join(" "),
      "baseline exit": baseline.status,
      output: short(baseline.output),
    });
    process.exitCode = 1;
    return;
  }

  const patchFile = path.join(os.tmpdir(), `revert-fix-${process.pid}.diff`);
  const nonTestPatch = `${nonTest.map((section) => section.text).join("\n")}\n`;
  fs.writeFileSync(patchFile, nonTestPatch, "utf8");

  let reverted = false;
  let revertedOk = false;
  try {
    try {
      git(root, ["apply", "-R", "--whitespace=nowarn", "--binary", patchFile]);
      reverted = true;
      revertedOk = true;
    } catch (error) {
      printResult("ERROR", {
        base,
        reason: "could not reverse-apply the non-test diff",
        detail: short(`${error.stderr ?? ""}${error.stdout ?? ""}`),
        patch: patchFile,
      });
      process.exitCode = 2;
      return;
    }

    const after = runCommand(testCommand, { root, timeoutMs, env: config.env ?? {} });
    if (after.error) {
      printResult("ERROR", {
        base,
        reason: `could not run the test command after the revert: ${after.error.message}`,
      });
      process.exitCode = 2;
      return;
    }

    if (after.status === 0) {
      printResult("NOT-CAUGHT", {
        base,
        reverted: nonTest.map((section) => section.file).join(", "),
        kept: testFiles.map((section) => section.file).join(", ") || "(none)",
        test: testCommand.join(" "),
        "after revert": "exit 0 (the test stayed green)",
        output: short(after.output),
      });
      process.exitCode = 1;
      return;
    }

    printResult("PROVEN", {
      base,
      reverted: nonTest.map((section) => section.file).join(", "),
      kept: testFiles.map((section) => section.file).join(", ") || "(none)",
      test: testCommand.join(" "),
      "baseline exit": baseline.status,
      "after revert": `${after.status}${after.timedOut ? " (timed out)" : ""} (expected failure)`,
      output: short(after.output),
    });
  } finally {
    if (reverted) {
      let restored = false;
      try {
        git(root, ["apply", "--whitespace=nowarn", "--binary", patchFile]);
        restored = true;
      } catch {
        restored = false;
      }
      // Line-ending normalization can leave a forward-applied file "modified"
      // even though its content is correct. Only a tree that was clean at the
      // start may be reset to HEAD; a dirty tree is never destroyed.
      if (!allowDirty) {
        const dirtyAfterApply = git(root, ["status", "--porcelain"]);
        if (dirtyAfterApply) {
          git(root, ["checkout", "--", "."]);
          restored = true;
        }
      }
      if (!restored && !allowDirty) {
        console.error("error: could not restore the non-test files after the mutation run");
        process.exitCode = 2;
      }
      const remaining = git(root, ["status", "--porcelain"]);
      if (remaining && !allowDirty) {
        console.error(`error: the working tree was not restored cleanly:\n${remaining}`);
        process.exitCode = 2;
      }
      try {
        fs.unlinkSync(patchFile);
      } catch {
        // Best effort; the OS temp directory is not part of the repository.
      }
    }
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`universal-mutation: ERROR\n  reason: ${error.message}`);
    process.exit(2);
  }
}

export { globToRegExp, matchesAny, splitPatch, runCommand };
