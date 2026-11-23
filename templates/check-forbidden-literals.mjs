#!/usr/bin/env node
// Forbidden-literal guard.
//
// Scans git-tracked text files for configurable literals: donor/reference-site
// identities, internal hostnames, token shapes, or any other string a project
// must not publish. The rule list and its allowlist live in JSON.
//
// Usage:
//   node scripts/check-forbidden-literals.mjs [--config path] [--root dir]
//   node scripts/check-forbidden-literals.mjs --files a.js,b.md
//   node scripts/check-forbidden-literals.mjs --self-test
//
// Allowlist entries have a rule id, a path glob, a reason and an expiry date.
// An expired entry is an error. An unused entry is a warning: allowlists are
// shrink-only.
//
// Exit 0: no unallowlisted match. Exit 1: at least one match or expired entry.
// Exit 2: the checker could not run.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  caseInsensitive: true,
  excludeGlobs: ["node_modules/**", ".git/**", "dist/**", "target/**", "coverage/**"],
  maxFileBytes: 2 * 1024 * 1024,
  rules: [],
  allow: [],
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
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

function loadConfig(explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
        path.join(process.cwd(), ".github", "forbidden-literals.json"),
        path.join(process.cwd(), "forbidden-literals.json"),
        path.join(SCRIPT_DIR, "forbidden-literals.json"),
      ];
  const candidate = candidates.find((value) => fs.existsSync(value));
  if (!candidate) {
    throw new Error(`forbidden-literal config not found; tried: ${candidates.join(", ")}`);
  }
  const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
  return { ...DEFAULT_CONFIG, ...parsed };
}

function compiledRules(config) {
  const flags = config.caseInsensitive ? "i" : "";
  return (config.rules ?? []).map((rule) => {
    if (!rule.id || !rule.pattern) throw new Error("every forbidden-literal rule needs `id` and `pattern`");
    try {
      return { ...rule, regex: new RegExp(rule.pattern, flags) };
    } catch (error) {
      throw new Error(`invalid pattern for rule ${rule.id}: ${error.message}`);
    }
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function scan({ root, files, config }) {
  const errors = [];
  const warnings = [];
  const rules = compiledRules(config);
  const allow = (config.allow ?? []).map((entry) => ({ ...entry, used: false }));

  for (const entry of allow) {
    if (!entry.rule || !entry.path || !entry.reason || !entry.expires) {
      errors.push(`allowlist entry needs rule, path, reason and expires: ${JSON.stringify(entry)}`);
    } else if (entry.expires < today()) {
      errors.push(`allowlist entry expired on ${entry.expires} for rule ${entry.rule} at ${entry.path}`);
    }
  }

  const searchable = files
    .filter((file) => !matchesAny(file, config.excludeGlobs ?? []))
    .sort();

  if (searchable.length === 0) {
    return {
      ok: false,
      errors: ["no files were scanned; the repository has no tracked files or every path was excluded"],
      warnings,
      scanned: 0,
    };
  }

  for (const file of searchable) {
    const absolute = path.resolve(root, file);
    let buffer;
    try {
      const stat = fs.statSync(absolute);
      if (stat.size > (config.maxFileBytes ?? DEFAULT_CONFIG.maxFileBytes)) continue;
      buffer = fs.readFileSync(absolute);
    } catch {
      warnings.push(`could not read ${file}; skipped`);
      continue;
    }
    if (buffer.subarray(0, 8000).includes(0)) continue; // binary

    const lines = buffer.toString("utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const rule of rules) {
        rule.regex.lastIndex = 0;
        if (!rule.regex.test(line)) continue;
        const allowed = allow.find(
          (entry) =>
            entry.rule === rule.id &&
            entry.expires >= today() &&
            matchesAny(file, [entry.path]),
        );
        if (allowed) {
          allowed.used = true;
          continue;
        }
        errors.push(`${file}:${index + 1}: ${rule.id}: ${rule.reason ?? "forbidden literal"}`);
      }
    }
  }

  for (const entry of allow) {
    if (!entry.used) warnings.push(`allowlist entry unused: rule ${entry.rule} at ${entry.path} (${entry.reason})`);
  }

  return { ok: errors.length === 0, errors, warnings, scanned: searchable.length };
}

function gitFiles(root) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\0").filter(Boolean);
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forbidden-literals-"));
  const config = {
    caseInsensitive: true,
    excludeGlobs: [],
    maxFileBytes: 1024 * 1024,
    rules: [
      { id: "ref-site-a", pattern: "ref-site-a\\.example", reason: "reference identity" },
      { id: "internal", pattern: "\\.internal\\.example", reason: "internal host" },
    ],
    allow: [
      { rule: "ref-site-a", path: "docs/allowed.md", reason: "documented example", expires: "2999-12-31" },
    ],
  };
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  const referenceHost = ["ref-site-a", "example"].join(".");
  fs.writeFileSync(path.join(dir, "src", "ok.mjs"), "const value = 1;\n");
  fs.writeFileSync(path.join(dir, "src", "bad.mjs"), `const host = '${referenceHost}';\n`);
  fs.writeFileSync(path.join(dir, "docs", "allowed.md"), `The placeholder is ${referenceHost}.\n`);

  const result = scan({
    root: dir,
    files: ["src/ok.mjs", "src/bad.mjs", "docs/allowed.md"],
    config,
  });
  fs.rmSync(dir, { recursive: true, force: true });

  const expected = result.errors.some((line) => line.includes("src/bad.mjs"));
  const allowed = !result.errors.some((line) => line.includes("docs/allowed.md"));
  if (!expected || !allowed) {
    console.error("check-forbidden-literals self-test: FAIL");
    for (const error of result.errors) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("check-forbidden-literals self-test: PASS (one expected match, allowlist honored)");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--self-test") {
      args.selfTest = true;
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
    "  node scripts/check-forbidden-literals.mjs [--config path] [--root dir]",
    "  node scripts/check-forbidden-literals.mjs --files a.js,b.md [--config path] [--root dir]",
    "  node scripts/check-forbidden-literals.mjs --self-test",
    "",
    "Scans git-tracked files by default. Rules and the shrink-only allowlist",
    "live in forbidden-literals.json. Exit 1 on a match or an expired entry.",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.selfTest) {
    selfTest();
    return;
  }

  const root = path.resolve(args.root ?? process.cwd());
  const config = loadConfig(args.config);
  const files = args.files
    ? args.files.split(",").map((file) => file.trim()).filter(Boolean)
    : gitFiles(root);
  const result = scan({ root, files, config });

  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`error: ${error}`);
    console.error(`forbidden-literals FAILED (${result.errors.length} match(es) in ${result.scanned} file(s))`);
    process.exitCode = 1;
    return;
  }
  console.log(`forbidden-literals OK: ${result.scanned} file(s) scanned, no unallowlisted match`);
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }
}

export { scan, loadConfig, globToRegExp };
