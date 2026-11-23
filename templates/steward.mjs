#!/usr/bin/env node
// Scheduled relevance steward.
//
// Produces a compact, evidence-backed list of questions about open work:
// stale issues and pull requests, missing acceptance criteria, blockers that
// are already closed, overdue milestones, likely duplicates, and spec changes
// that no longer say what "done" means.
//
// The script never closes, merges or reprioritizes anything. It writes one
// rolling issue (or prints the report) so a person or the steward agent can
// decide. Judgment stays with the owner.
//
// Usage:
//   node scripts/steward.mjs --dry-run
//   node scripts/steward.mjs --apply
//   node scripts/steward.mjs --self-test
//
// Exit 0: report produced. Exit 1: a write failed. Exit 2: the report could not
// be produced.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGitHub } from "./lib/project-api.mjs";

const DEFAULT_CONFIG = {
  repo: "",
  staleDays: 30,
  maxQuestions: 25,
  issueTitle: "Steward review",
  labels: { steward: "steward", hold: ["owner-decision", "pinned"] },
  acceptanceExemptLabels: ["bug", "security", "security-alert"],
  changesDir: "specs/changes",
  duplicateThreshold: 0.8,
};

const REPORT_MARKER = "<!-- steward-report -->";

function loadConfig(root, explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [path.join(root, ".github", "steward.json"), path.join(root, "steward.json")];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  const parsed = found ? JSON.parse(fs.readFileSync(found, "utf8")) : {};
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    labels: { ...DEFAULT_CONFIG.labels, ...(parsed.labels ?? {}) },
  };
}

function labelNames(issue) {
  return (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name));
}

function daysSince(value, now = Date.now()) {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((now - then) / 86400000);
}

function hasAcceptance(body) {
  const text = String(body ?? "");
  const heading = /^#{2,6}\s+(.+)$/gm;
  let match;
  while ((match = heading.exec(text)) !== null) {
    if (/acceptance|done when|success criteria/i.test(match[1])) {
      const rest = text.slice(match.index + match[0].length);
      const next = rest.search(/^#{2,6}\s+/m);
      const section = (next === -1 ? rest : rest.slice(0, next)).trim();
      return section.length >= 10 && !/\b(TODO|TBD|CHANGEME)\b/i.test(section);
    }
  }
  return false;
}

function tokenize(title) {
  const stop = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "for", "on", "with", "is", "are"]);
  return new Set(
    String(title ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stop.has(word)),
  );
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / union.size;
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function parseBlockers(body) {
  const numbers = [];
  const pattern = /blocked by[^\n]*/gi;
  let match;
  while ((match = pattern.exec(String(body ?? ""))) !== null) {
    for (const number of match[0].matchAll(/#(\d+)/g)) numbers.push(Number(number[1]));
  }
  return [...new Set(numbers)];
}

function specChanges(root, changesDir, staleDays, now) {
  const directory = path.resolve(root, changesDir);
  if (!fs.existsSync(directory)) return [];
  const changes = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(directory, entry.name);
    const proposal = path.join(folder, "proposal.md");
    const stat = fs.statSync(folder);
    changes.push({
      id: entry.name,
      path: path.join(changesDir, entry.name),
      proposal: fs.existsSync(proposal) ? fs.readFileSync(proposal, "utf8") : null,
      ageDays: Math.floor((now - stat.mtimeMs) / 86400000),
      staleDays,
    });
  }
  return changes;
}

export function analyze({ issues, pulls = [], changes = [], config = DEFAULT_CONFIG, now = Date.now() }) {
  const questions = [];
  const hold = new Set(config.labels.hold ?? []);
  const exempt = new Set(config.acceptanceExemptLabels ?? []);
  const openIssues = issues.filter((issue) => issue.state === "OPEN" || issue.state === undefined);
  const closedNumbers = new Set(
    issues.filter((issue) => issue.state === "CLOSED").map((issue) => issue.number),
  );

  for (const issue of openIssues) {
    const labels = labelNames(issue);
    if (labels.some((label) => hold.has(label))) continue;
    const stale = daysSince(issue.updatedAt ?? issue.createdAt, now);
    if (stale > config.staleDays) {
      questions.push({
        rank: 3,
        item: `[#${issue.number}](${issue.url ?? ""})`,
        title: issue.title,
        question: `No activity for ${stale} days. Is this still relevant?`,
        evidence: `last activity ${issue.updatedAt ?? issue.createdAt}`,
        recommendation: "keep / reprioritize / close",
      });
    }
    if (!labels.some((label) => exempt.has(label)) && !hasAcceptance(issue.body)) {
      questions.push({
        rank: 4,
        item: `[#${issue.number}](${issue.url ?? ""})`,
        title: issue.title,
        question: "What observable result means done?",
        evidence: "no Acceptance / Done when section with content",
        recommendation: "add acceptance criteria",
      });
    }
    if (issue.milestone?.dueOn && new Date(issue.milestone.dueOn).getTime() < now) {
      questions.push({
        rank: 1,
        item: `[#${issue.number}](${issue.url ?? ""})`,
        title: issue.title,
        question: "The milestone due date has passed while this is open.",
        evidence: `milestone ${issue.milestone.title} due ${String(issue.milestone.dueOn).slice(0, 10)}`,
        recommendation: "keep / move milestone / close",
      });
    }
    for (const blocker of parseBlockers(issue.body)) {
      if (closedNumbers.has(blocker)) {
        questions.push({
          rank: 2,
          item: `[#${issue.number}](${issue.url ?? ""})`,
          title: issue.title,
          question: `The blocker #${blocker} is closed. Can this start now?`,
          evidence: `body says blocked by #${blocker}; that issue is closed`,
          recommendation: "start / re-block / close",
        });
      }
    }
  }

  // Likely duplicates by title substance.
  for (let left = 0; left < openIssues.length; left += 1) {
    for (let right = left + 1; right < openIssues.length; right += 1) {
      const a = openIssues[left];
      const b = openIssues[right];
      const score = jaccard(tokenize(a.title), tokenize(b.title));
      if (score >= (config.duplicateThreshold ?? 0.8)) {
        questions.push({
          rank: 5,
          item: `[#${a.number}](${a.url ?? ""}) / [#${b.number}](${b.url ?? ""})`,
          title: `${a.title} / ${b.title}`,
          question: "These look like the same problem in different words. Merge?",
          evidence: `title similarity ${score.toFixed(2)}`,
          recommendation: "merge / keep both",
        });
      }
    }
  }

  for (const pull of pulls) {
    if (pull.isDraft) continue;
    const stale = daysSince(pull.updatedAt, now);
    const failing = (pull.statusCheckRollup ?? []).filter((check) =>
      ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(
        String(check.conclusion ?? check.state ?? "").toUpperCase(),
      ),
    );
    if (stale > config.staleDays || failing.length > 0) {
      questions.push({
        rank: stale > config.staleDays * 2 ? 2 : 3,
        item: `[PR #${pull.number}](${pull.url ?? ""})`,
        title: pull.title,
        question:
          failing.length > 0
            ? `${failing.length} check(s) are not green. Is this still moving?`
            : `No activity for ${stale} days. Is this still relevant?`,
        evidence:
          failing.length > 0
            ? failing.map((check) => check.name ?? check.context ?? "check").join(", ")
            : `last activity ${pull.updatedAt}`,
        recommendation: "continue / close / ask for status",
      });
    }
  }

  for (const change of changes) {
    if (!change.proposal) {
      questions.push({
        rank: 4,
        item: `\`${change.path}\``,
        title: change.id,
        question: "This change has no proposal.md. What problem is it solving?",
        evidence: `age ${change.ageDays} days`,
        recommendation: "write proposal / archive",
      });
      continue;
    }
    const hasScope = /^#{2,6}\s+.*out of scope/im.test(change.proposal);
    const hasAcceptanceText = /^#{2,6}\s+.*acceptance/im.test(change.proposal) && hasAcceptance(change.proposal);
    if (!hasScope || !hasAcceptanceText) {
      questions.push({
        rank: 4,
        item: `\`${change.path}\``,
        title: change.id,
        question: "The proposal is missing an explicit out-of-scope or acceptance section.",
        evidence: [!hasScope ? "no out-of-scope" : null, !hasAcceptanceText ? "no acceptance" : null]
          .filter(Boolean)
          .join(", "),
        recommendation: "complete the proposal",
      });
    }
    if (change.ageDays > (change.staleDays ?? config.staleDays)) {
      questions.push({
        rank: 3,
        item: `\`${change.path}\``,
        title: change.id,
        question: `The change folder is ${change.ageDays} days old. Is it still the current plan?`,
        evidence: `folder mtime age ${change.ageDays} days`,
        recommendation: "keep / update / archive",
      });
    }
  }

  questions.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
  return {
    questions: questions.slice(0, config.maxQuestions),
    total: questions.length,
    counts: {
      issues: openIssues.length,
      pulls: pulls.length,
      changes: changes.length,
    },
  };
}

function reportBody(result, config, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const lines = [
    REPORT_MARKER,
    `# ${config.issueTitle} — ${date}`,
    "",
    `Open: ${result.counts.issues} issue(s), ${result.counts.pulls} pull request(s), ${result.counts.changes} spec change(s).`,
    `Questions: ${result.total} (showing up to ${config.maxQuestions}). Nothing was closed or reprioritized automatically.`,
    "",
    "| Item | Question | Evidence | Recommendation |",
    "|---|---|---|---|",
  ];
  if (result.questions.length === 0) {
    lines.push("| — | Nothing stale or unclear. | — | keep |");
  } else {
    for (const question of result.questions) {
      lines.push(
        `| ${escapeCell(question.item)} | ${escapeCell(question.question)} | ${escapeCell(question.evidence)} | ${escapeCell(question.recommendation)} |`,
      );
    }
  }
  lines.push(
    "",
    "## How to use this",
    "",
    "The steward asks; a person decides. For each row, either add the missing evidence, reprioritize, or close with a reason. Do not close a row just because it is old.",
    "",
  );
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--apply") {
      args.dryRun = false;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
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
    "  node scripts/steward.mjs --dry-run [--config path] [--repo owner/name]",
    "  node scripts/steward.mjs --apply",
    "  node scripts/steward.mjs --self-test",
    "",
    "Produces one rolling issue with evidence-backed relevance questions.",
    "Never closes, merges or reprioritizes anything.",
  ].join("\n");
}

function selfTest() {
  const now = new Date("2026-11-24T00:00:00Z").getTime();
  const issues = [
    {
      number: 1,
      title: "Add parser cache",
      body: "No acceptance here.",
      state: "OPEN",
      labels: [],
      updatedAt: "2026-08-01T00:00:00Z",
      createdAt: "2026-08-01T00:00:00Z",
      url: "https://example.test/issues/1",
    },
    {
      number: 2,
      title: "Add parser cache layer",
      body: "## Acceptance\n\nA second call returns the cached result.",
      state: "OPEN",
      labels: [],
      updatedAt: "2026-11-20T00:00:00Z",
      createdAt: "2026-11-20T00:00:00Z",
      url: "https://example.test/issues/2",
    },
    {
      number: 3,
      title: "Old work",
      body: "Blocked by #9",
      state: "OPEN",
      labels: [],
      updatedAt: "2026-11-20T00:00:00Z",
      createdAt: "2026-11-20T00:00:00Z",
      url: "https://example.test/issues/3",
    },
    { number: 9, title: "Blocker", body: "", state: "CLOSED", labels: [], updatedAt: "2026-11-01T00:00:00Z" },
  ];
  const pulls = [
    {
      number: 10,
      title: "Stale pull request",
      updatedAt: "2026-09-01T00:00:00Z",
      statusCheckRollup: [],
      url: "https://example.test/pull/10",
    },
  ];
  const result = analyze({
    issues,
    pulls,
    changes: [],
    config: { ...DEFAULT_CONFIG, staleDays: 30, maxQuestions: 50, duplicateThreshold: 0.7 },
    now,
  });
  const text = result.questions.map((question) => question.question).join("\n");
  const problems = [];
  if (!/No activity/.test(text)) problems.push("stale issue");
  if (!/observable result/.test(text)) problems.push("missing acceptance");
  if (!/blocker #9 is closed/.test(text)) problems.push("closed blocker");
  if (!/same problem/.test(text)) problems.push("duplicate");
  if (!/pull request|still moving|No activity/.test(text)) problems.push("stale pull request");
  if (problems.length > 0) {
    console.error(`steward self-test: FAIL (${problems.join(", ")})`);
    process.exitCode = 1;
    return;
  }
  console.log("steward self-test: PASS (stale, acceptance, blocker, duplicate, pull request)");
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

  const root = path.resolve(process.cwd());
  const config = loadConfig(root, args.config);
  const api = createGitHub({ cwd: root });
  const repo =
    args.repo ||
    config.repo ||
    process.env.GITHUB_REPOSITORY ||
    api.repoView().nameWithOwner;
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`cannot resolve repository: ${repo}`);

  const issues = api.issueList({ state: "all", limit: 1000 });
  const pulls = api.ghJson([
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "200",
    "--json",
    "number,title,updatedAt,statusCheckRollup,isDraft,url",
  ]) ?? [];
  const changes = specChanges(root, config.changesDir, config.staleDays, Date.now());
  const result = analyze({ issues, pulls, changes, config });
  const body = reportBody(result, config);

  console.log(
    `steward: ${result.counts.issues} issue(s), ${result.counts.pulls} pull request(s), ${result.counts.changes} change(s); ${result.total} question(s), showing ${result.questions.length}`,
  );
  for (const question of result.questions) {
    console.log(`  ${question.item} — ${question.question} [${question.evidence}]`);
  }

  if (args.dryRun) {
    console.log("\nsteward: dry-run (no issue written)");
    return;
  }

  const existing = issues.find((issue) => String(issue.body ?? "").includes(REPORT_MARKER));
  try {
    api.labelCreate(config.labels.steward, { color: "5319e7", description: "Scheduled relevance review" });
    if (existing) {
      api.issueEdit(existing.number, { title: `${config.issueTitle} — ${new Date().toISOString().slice(0, 10)}`, body });
      if (existing.state === "CLOSED") api.issueReopen(existing.number);
      console.log(`steward: updated #${existing.number}`);
    } else {
      const created = api.issueCreate({
        title: `${config.issueTitle} — ${new Date().toISOString().slice(0, 10)}`,
        body,
        labels: [config.labels.steward],
      });
      console.log(`steward: created #${created.number}`);
    }
  } catch (error) {
    console.error(`steward: ERROR\n  ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Steward review\n\n${result.total} question(s), ${result.questions.length} shown. Nothing was closed automatically.\n`,
    );
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`steward: ERROR\n  ${error.message}`);
    process.exitCode = 2;
  }
}

export { reportBody, hasAcceptance, parseBlockers, specChanges };
