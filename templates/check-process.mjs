#!/usr/bin/env node
// Pull-request process contract.
//
// Every PR body must carry the sections in process-contract.json, a Task line,
// verification evidence, universal mutation proof and an independent reviewer.
// A docs/process-only PR may use `Task: none — <reason>`.
//
// Usage:
//   node scripts/check-process.mjs --pr 123 [--repo owner/name]
//   node scripts/check-process.mjs --body-file body.md --files src/a.js,docs/b.md
//   node scripts/check-process.mjs --stdin
//   node scripts/check-process.mjs --self-test
//
// Exit 0: the contract is satisfied. Exit 1: at least one violation.
// Exit 2: the checker could not run (bad config, gh error, no body).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  requiredSections: [
    { id: "summary", heading: "Summary", minChars: 20 },
    { id: "task", heading: "Task" },
    { id: "verification", heading: "Verification" },
    { id: "mutation", heading: "Mutation proof" },
    { id: "risk", heading: "Risk and rollback", minChars: 10 },
    { id: "review", heading: "Review" },
  ],
  task: {
    keyPattern: "^[A-Z][A-Z0-9]*-[0-9]+$",
    requireClosingReference: true,
    closingKeywords: ["Closes", "Fixes", "Resolves"],
    docsOnlyGlobs: ["docs/**", "specs/**", "templates/**", "scripts/**", ".github/**", "**/*.md"],
  },
  verification: { allowNotApplicable: true, requireCommand: true },
  mutation: {
    passTokens: ["PROVEN", "NOT-APPLICABLE"],
    failTokens: ["NOT-CAUGHT", "BASELINE-RED", "ERROR", "FAILED", "MISSING-TOOL"],
  },
  review: {
    requireAuthorAndReviewer: true,
    selfReviewTokens: ["self", "same", "author", "none", "n/a"],
  },
  placeholders: ["<command>", "<output>", "<n>", "<reason>", "<path>", "<...>", "TODO", "TBD"],
};

function normalizeHeading(value) {
  return String(value ?? "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseSections(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const match = /^(#{2,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      current = { heading: match[2].trim(), level: match[1].length, lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

function sectionText(sections, heading) {
  const wanted = normalizeHeading(heading);
  const found = sections.filter((section) => normalizeHeading(section.heading) === wanted);
  if (found.length === 0) return null;
  return found.map((section) => section.lines.join("\n")).join("\n");
}

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

function stripMarkdownValues(value) {
  return String(value ?? "")
    .replace(/[`*_]/g, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .replace(/^@/, "")
    .trim();
}

function findLine(text, label) {
  const pattern = new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, "im");
  const match = pattern.exec(text);
  return match ? stripMarkdownValues(match[1]) : null;
}

function hasCommandEvidence(text) {
  const fencePattern = /```[^\n]*\n([\s\S]*?)```/g;
  let match;
  while ((match = fencePattern.exec(text)) !== null) {
    const body = match[1].trim();
    if (body.length >= 3) return true;
  }
  return /^\s*(?:\$|>|Command:)\s+\S+/im.test(text);
}

function hasNotApplicableReason(text) {
  const pattern = /not applicable\s*(?:[—:-]\s*)(.+)/i;
  const match = pattern.exec(text);
  return Boolean(match && match[1].trim().length >= 5);
}

function checkProcess({ body, files = [], config = DEFAULT_CONFIG }) {
  const errors = [];
  const warnings = [];
  const sections = parseSections(body);

  if (!String(body ?? "").trim()) {
    return { ok: false, errors: ["the PR body is empty"], warnings, summary: null };
  }

  // Required headings, exactly once.
  for (const required of config.requiredSections) {
    const wanted = normalizeHeading(required.heading);
    const matches = sections.filter((section) => normalizeHeading(section.heading) === wanted);
    if (matches.length === 0) {
      errors.push(`missing required section: ## ${required.heading}`);
    } else if (matches.length > 1) {
      errors.push(`section appears more than once: ## ${required.heading}`);
    } else {
      const text = matches[0].lines.join("\n").trim();
      if (required.minChars && text.replace(/\s+/g, " ").length < required.minChars) {
        errors.push(`section ## ${required.heading} needs at least ${required.minChars} characters`);
      }
    }
  }

  // Placeholders anywhere in the body. A copied template must fail until filled.
  const lowerBody = String(body ?? "").toLowerCase();
  for (const placeholder of config.placeholders ?? []) {
    if (lowerBody.includes(String(placeholder).toLowerCase())) {
      errors.push(`unfilled placeholder: ${placeholder}`);
    }
  }

  // Task directive.
  const taskText = sectionText(sections, "Task") ?? body;
  const taskLine = findLine(taskText, "Task") ?? findLine(body, "Task");
  let directive = null;
  if (!taskLine) {
    errors.push("missing `Task:` line (or `Task: none — <reason>`)");
  } else if (/^none\b/i.test(taskLine)) {
    const reasonMatch = /^none\s*(?:[—:-]\s*)(.+)$/i.exec(taskLine);
    const reason = reasonMatch ? reasonMatch[1].trim() : "";
    if (reason.length < 5) {
      errors.push("`Task: none` needs a reason after a dash, for example `Task: none — docs: fix example`");
    }
    directive = { kind: "none", reason };
    if (files.length === 0) {
      warnings.push("`Task: none` was not checked against changed paths; pass --files in CI");
    } else {
      const productFiles = files.filter((file) => !matchesAny(file, config.task.docsOnlyGlobs));
      if (productFiles.length > 0) {
        errors.push(
          `\`Task: none\` is only for docs/process changes; product paths need a task key: ${productFiles.join(", ")}`,
        );
      }
    }
  } else {
    const key = taskLine.replace(/^Task:\s*/i, "").trim();
    let keyPattern;
    try {
      keyPattern = new RegExp(config.task.keyPattern);
    } catch (error) {
      return { ok: false, errors: [`invalid task.keyPattern in config: ${error.message}`], warnings, summary: null };
    }
    if (!keyPattern.test(key)) {
      errors.push(`task key does not match ${config.task.keyPattern}: ${key}`);
    }
    directive = { kind: "key", key };

    if (config.task.requireClosingReference) {
      const closing = new RegExp(
        `(?:${config.task.closingKeywords.join("|")})\\s+#(\\d+)`,
        "i",
      ).exec(body);
      if (!closing) {
        errors.push("missing closing reference: add `Closes #<issue>` for the keyed issue");
      } else {
        const keyNumber = /-(\d+)$/.exec(key)?.[1];
        if (keyNumber && keyNumber !== closing[1]) {
          errors.push(`closing reference #${closing[1]} does not match the task key ${key}`);
        }
      }
    }
  }

  // Verification.
  const verification = sectionText(sections, "Verification");
  if (verification === null) {
    // The missing-section error is already recorded.
  } else if (config.verification.allowNotApplicable && hasNotApplicableReason(verification)) {
    // Explicit not-applicable with a reason is accepted.
  } else if (config.verification.requireCommand && !hasCommandEvidence(verification)) {
    errors.push("## Verification needs a fenced command and its observed result, or `Not applicable — <reason>`");
  }

  // Mutation proof.
  const mutation = sectionText(sections, "Mutation proof");
  if (mutation !== null) {
    const universal = /universal-mutation:\s*([A-Z-]+)/i.exec(mutation);
    if (!universal) {
      errors.push("## Mutation proof needs the `universal-mutation:` line from `mutation/revert-fix.mjs`");
    } else {
      const token = universal[1].toUpperCase();
      if ((config.mutation.failTokens ?? []).includes(token)) {
        errors.push(`universal mutation proof reports ${token}; the tests did not catch the change`);
      } else if (!(config.mutation.passTokens ?? []).includes(token)) {
        errors.push(`unknown universal mutation token: ${token}`);
      }
    }
    for (const match of mutation.matchAll(/adapter-mutation:\s*([A-Z-]+)/gi)) {
      const token = match[1].toUpperCase();
      if (["FAILED", "ERROR", "MISSING-TOOL"].includes(token)) {
        errors.push(`adapter mutation proof reports ${token}`);
      }
    }
  }

  // Independent review.
  const review = sectionText(sections, "Review");
  if (review !== null && config.review.requireAuthorAndReviewer) {
    const author = findLine(review, "Author");
    const reviewer = findLine(review, "Reviewer");
    if (!author) errors.push("## Review needs an `Author:` line");
    if (!reviewer) errors.push("## Review needs a `Reviewer:` line");
    if (author && reviewer) {
      const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
      const normalizedAuthor = normalize(author);
      const normalizedReviewer = normalize(reviewer);
      if (
        normalizedAuthor === normalizedReviewer ||
        (config.review.selfReviewTokens ?? []).includes(String(reviewer).toLowerCase())
      ) {
        errors.push("the reviewer must be a different identity from the author; self-review is not a review");
      }
    }
  }

  const ok = errors.length === 0;
  const summary = ok
    ? `process-contract OK: ${sections.length} sections, ${directive?.kind ?? "no"} task directive`
    : null;
  return { ok, errors, warnings, summary, directive };
}

function loadConfig(explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
        path.join(SCRIPT_DIR, "process-contract.json"),
        path.join(process.cwd(), "process-contract.json"),
        path.join(process.cwd(), ".github", "process-contract.json"),
      ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  }
  return DEFAULT_CONFIG;
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function ghJson(args) {
  const output = gh(args);
  return output ? JSON.parse(output) : null;
}

function resolveRepo(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  return ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
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
    if (token === "--stdin") {
      args.stdin = true;
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
    "  node scripts/check-process.mjs --pr <number> [--repo owner/name] [--config path]",
    "  node scripts/check-process.mjs --body-file <path> --files <a,b> [--config path]",
    "  node scripts/check-process.mjs --stdin --files <a,b>",
    "  node scripts/check-process.mjs --self-test",
    "",
    "Required body sections: Summary, Task, Verification, Mutation proof,",
    "Risk and rollback, Review. The Task section needs `Task: KEY-<n>` and",
    "`Closes #<n>`; docs-only PRs may use `Task: none — <reason>`.",
  ].join("\n");
}

function selfTest() {
  const config = DEFAULT_CONFIG;
  const complete = [
    "## Summary",
    "Adds a deterministic parser and keeps the old behavior for empty input.",
    "",
    "## Task",
    "Task: TASK-12",
    "Closes #12",
    "",
    "## Verification",
    "```text",
    "$ node test/parser.test.mjs",
    "pass 4",
    "```",
    "",
    "## Mutation proof",
    "```text",
    "universal-mutation: PROVEN",
    "  reverted: 1 non-test file",
    "  after revert: exit 1",
    "adapter-mutation: NONE-MATCHED",
    "```",
    "",
    "## Risk and rollback",
    "Risk is limited to the parser. Roll back by reverting the commit.",
    "",
    "## Review",
    "Author: @alice",
    "Reviewer: @bob",
  ].join("\n");
  const missing = ["## Summary", "A short summary that is definitely long enough.", "", "## Task", "Task: TASK-12"].join("\n");
  const selfReview = complete.replace("Reviewer: @bob", "Reviewer: @alice");
  const docsNone = complete
    .replace("Task: TASK-12", "Task: none — docs: correct the example")
    .replace("Closes #12", "");

  const cases = [
    { name: "missing sections", body: missing, files: ["src/a.js"], expectOk: false },
    { name: "complete", body: complete, files: ["src/a.js"], expectOk: true },
    { name: "self review", body: selfReview, files: ["src/a.js"], expectOk: false },
    { name: "docs-only none", body: docsNone, files: ["docs/a.md"], expectOk: true },
    { name: "product none", body: docsNone, files: ["src/a.js"], expectOk: false },
  ];

  let failed = 0;
  for (const testCase of cases) {
    const result = checkProcess({ body: testCase.body, files: testCase.files, config });
    const pass = result.ok === testCase.expectOk;
    console.log(`${pass ? "ok" : "FAIL"}  ${testCase.name} -> ok=${result.ok} (expected ${testCase.expectOk})`);
    if (!pass) {
      failed += 1;
      for (const error of result.errors) console.log(`      ${error}`);
    }
  }
  if (failed > 0) {
    console.error(`check-process self-test: FAIL (${failed} case(s))`);
    process.exitCode = 1;
    return;
  }
  console.log("check-process self-test: PASS");
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

  const config = loadConfig(args.config);
  let body;
  let files = [];

  if (args.pr) {
    const number = Number(args.pr);
    if (!Number.isInteger(number) || number <= 0) throw new Error(`--pr needs a positive number, got ${args.pr}`);
    const repo = resolveRepo(args.repo);
    const view = ghJson([
      "pr",
      "view",
      String(number),
      "--repo",
      repo,
      "--json",
      "body,files",
    ]);
    body = view?.body ?? "";
    files = (view?.files ?? []).map((file) => file.path);
  } else if (args["body-file"]) {
    body = fs.readFileSync(path.resolve(args["body-file"]), "utf8");
    files = (args.files ?? "").split(",").map((file) => file.trim()).filter(Boolean);
  } else if (args.stdin) {
    body = fs.readFileSync(0, "utf8");
    files = (args.files ?? "").split(",").map((file) => file.trim()).filter(Boolean);
  } else {
    throw new Error(usage());
  }

  const result = checkProcess({ body, files, config });
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`error: ${error}`);
    console.error("process-contract FAILED");
    process.exitCode = 1;
    return;
  }
  console.log(result.summary);
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

export { checkProcess, parseSections, globToRegExp, DEFAULT_CONFIG };
