#!/usr/bin/env node
// Polyglot self-test for the universal mutation tier.
//
// Each fixture is a tiny git repository with a base commit and a change commit.
// The base code contains a bug and a test that passes. The change fixes the bug
// and adds a test. The universal tier must revert the non-test file, keep the
// test file, and report PROVEN. A "green" fixture changes the code and adds a
// test that does not assert the change; the same run must report NOT-CAUGHT.
//
// Usage:
//   node examples/mutation/run-selftest.mjs
//
// Exit 0 when every fixture reports the expected token and leaves a clean tree.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const REVERT = path.join(ROOT, "templates", "mutation", "revert-fix.mjs");
const FIXTURES = path.join(HERE, "fixtures");
const PYTHON = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");

function copyDir(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function git(cwd, args) {
  return execFileSync(
    "git",
    ["-c", "user.name=Harness Self Test", "-c", "user.email=harness@example.test", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}

function runFixture(name) {
  const directory = path.join(FIXTURES, name);
  const expected = JSON.parse(fs.readFileSync(path.join(directory, "expected.json"), "utf8"));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `mutation-${name}-`));

  try {
    git(temp, ["init"]);
    copyDir(path.join(directory, "base"), temp);
    fs.writeFileSync(path.join(temp, ".gitignore"), "__pycache__/\n*.pyc\n", "utf8");

    const testCommand = expected.testCommand.map((part) =>
      part === "<python>" ? PYTHON : part,
    );
    fs.mkdirSync(path.join(temp, "mutation"), { recursive: true });
    fs.writeFileSync(
      path.join(temp, "mutation", "config.json"),
      JSON.stringify(
        {
          testCommand,
          testGlobs: expected.testGlobs,
          timeoutMs: 30000,
          allowDirty: false,
        },
        null,
        2,
      ),
      "utf8",
    );

    git(temp, ["add", "-A"]);
    git(temp, ["commit", "-m", "base"]);

    copyDir(path.join(directory, "change"), temp);
    git(temp, ["add", "-A"]);
    git(temp, ["commit", "-m", "change"]);

    const result = spawnSync(
      process.execPath,
      [REVERT, "--base", "HEAD~1", "--repo-root", temp],
      { cwd: temp, encoding: "utf8", timeout: 60000 },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const status = result.status;
    const clean = git(temp, ["status", "--porcelain"]) === "";

    const ok =
      status === expected.expectExit &&
      output.includes(expected.expectOutput) &&
      clean;

    console.log(
      `${ok ? "ok" : "FAIL"}  ${name}: exit ${status} (expected ${expected.expectExit}), ` +
        `token ${output.includes(expected.expectOutput) ? "present" : "missing"}, ` +
        `tree ${clean ? "clean" : "DIRTY"}`,
    );
    if (!ok) {
      console.log(
        output
          .split(/\r?\n/)
          .map((line) => `      ${line}`)
          .join("\n"),
      );
    }
    return ok;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function main() {
  if (!fs.existsSync(REVERT)) {
    console.error(`error: missing ${REVERT}`);
    process.exitCode = 2;
    return;
  }
  const probe = spawnSync(PYTHON, ["--version"], { encoding: "utf8" });
  if (probe.error) {
    console.error(`error: Python is required for the polyglot fixtures (${PYTHON}): ${probe.error.message}`);
    process.exitCode = 2;
    return;
  }

  const fixtures = fs
    .readdirSync(FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let failed = 0;
  for (const fixture of fixtures) {
    if (!runFixture(fixture)) failed += 1;
  }
  if (failed > 0) {
    console.error(`mutation self-test: FAIL (${failed}/${fixtures.length})`);
    process.exitCode = 1;
    return;
  }
  console.log(`mutation self-test: PASS (${fixtures.length}/${fixtures.length})`);
}

main();
