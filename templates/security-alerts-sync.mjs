#!/usr/bin/env node
// Route code-scanning, dependency and secret-scanning alerts into owned issues.
//
// Every open alert becomes one issue with a hidden marker. A later run updates
// the same issue, reopens it if the alert comes back, and closes the issue when
// no open alert matches. The script never pastes a secret value into an issue.
//
// Usage:
//   node scripts/security-alerts-sync.mjs --dry-run
//   node scripts/security-alerts-sync.mjs --apply [--enforce-sla]
//   node scripts/security-alerts-sync.mjs --self-test
//
// Unavailable sources (403/404, for example secret scanning disabled) are
// reported and skipped; at least one source must be readable. An SLA breach is
// reported and, with --enforce-sla, fails the run.
//
// Exit 0: success. Exit 1: SLA breach with --enforce-sla, or a write failure.
// Exit 2: no source could be read or the configuration is invalid.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGitHub } from "./lib/project-api.mjs";

const DEFAULT_CONFIG = {
  repo: "",
  labels: { issue: "security", managed: "security-alert", resolved: "security-resolved" },
  holdLabels: ["owner-decision", "pinned"],
  sources: ["code-scanning", "dependabot", "secret-scanning"],
  severity: {
    critical: { priority: "P0", severity: "S1", slaDays: 1 },
    high: { priority: "P1", severity: "S2", slaDays: 7 },
    medium: { priority: "P2", severity: "S3", slaDays: 30 },
    low: { priority: "P3", severity: "S4", slaDays: 90 },
  },
  areaRules: [],
  defaultArea: "infra",
};

function loadConfig(root, explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [path.join(root, ".github", "security-alerts.json"), path.join(root, "security-alerts.json")];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  const parsed = found ? JSON.parse(fs.readFileSync(found, "utf8")) : {};
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    labels: { ...DEFAULT_CONFIG.labels, ...(parsed.labels ?? {}) },
    severity: { ...DEFAULT_CONFIG.severity, ...(parsed.severity ?? {}) },
  };
}

function areaFor(text, config) {
  const haystack = String(text ?? "").toLowerCase();
  for (const rule of config.areaRules ?? []) {
    if ((rule.keywords ?? []).some((keyword) => haystack.includes(String(keyword).toLowerCase()))) {
      return rule.area;
    }
  }
  return config.defaultArea;
}

function normalizeSeverity(value) {
  const text = String(value ?? "medium").toLowerCase();
  if (["critical", "high", "medium", "low"].includes(text)) return text;
  if (text === "error") return "high";
  if (text === "warning") return "medium";
  if (text === "note") return "low";
  return "medium";
}

function markerFor(source, id) {
  return `<!-- security-alert: ${source}:${id} -->`;
}

export function normalizeAlert(source, alert) {
  if (source === "code-scanning") {
    const location = alert.most_recent_instance?.location ?? {};
    const severity = normalizeSeverity(
      alert.rule?.security_severity_level ?? alert.rule?.severity ?? alert.most_recent_instance?.message?.text,
    );
    return {
      source,
      id: String(alert.number),
      severity,
      title: `${alert.rule?.id ?? "code-scanning"} in ${location.path ?? "unknown location"}`,
      detail: alert.most_recent_instance?.message?.text ?? alert.rule?.description ?? "",
      location: location.path ? `${location.path}:${location.start_line ?? "?"}` : null,
      url: alert.html_url,
      createdAt: alert.created_at,
      areaText: location.path ?? "",
      secret: false,
    };
  }
  if (source === "dependabot") {
    const advisory = alert.security_advisory ?? {};
    const dependency = alert.dependency ?? {};
    return {
      source,
      id: String(alert.number),
      severity: normalizeSeverity(advisory.severity),
      title: `dependency ${dependency.package?.name ?? "unknown"} — ${advisory.summary ?? "vulnerability"}`,
      detail: advisory.description ?? "",
      location: dependency.manifest_path ?? null,
      url: alert.html_url,
      createdAt: alert.created_at,
      areaText: dependency.manifest_path ?? "",
      secret: false,
    };
  }
  if (source === "secret-scanning") {
    const locations = alert.locations ?? [];
    return {
      source,
      id: String(alert.number),
      severity: "critical",
      title: `secret detected: ${alert.secret_type_display_name ?? alert.secret_type ?? "unknown type"}`,
      detail: "A credential was detected. Do not paste the value into the issue.",
      location: locations.map((entry) => entry.details?.path).filter(Boolean).join(", ") || null,
      url: alert.html_url,
      createdAt: alert.created_at,
      areaText: locations.map((entry) => entry.details?.path).filter(Boolean).join(" "),
      secret: true,
    };
  }
  throw new Error(`unknown alert source: ${source}`);
}

function fetchSource(api, repo, source) {
  const endpoints = {
    "code-scanning": `repos/${repo}/code-scanning/alerts?state=open&per_page=100`,
    dependabot: `repos/${repo}/dependabot/alerts?state=open&per_page=100`,
    "secret-scanning": `repos/${repo}/secret-scanning/alerts?state=open&per_page=100`,
  };
  const endpoint = endpoints[source];
  if (!endpoint) return { source, ok: false, items: [], error: "unknown source" };
  try {
    const output = api.gh(["api", "--paginate", "--slurp", endpoint]);
    const pages = output ? JSON.parse(output) : [];
    return { source, ok: true, items: pages.flat() };
  } catch (error) {
    return { source, ok: false, items: [], error: error.message };
  }
}

function issueMarker(issue) {
  const match = /<!-- security-alert: ([^\s]+) -->/.exec(String(issue.body ?? ""));
  return match ? match[1] : null;
}

function labelNames(issue) {
  return (issue.labels ?? []).map((label) => (typeof label === "string" ? label : label.name));
}

function daysSince(value) {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.floor((Date.now() - then) / 86400000);
}

function severityConfig(config, severity) {
  return config.severity[severity] ?? config.severity.medium;
}

function alertBody(alert, config) {
  const severity = severityConfig(config, alert.severity);
  const due = new Date(new Date(alert.createdAt ?? Date.now()).getTime() + severity.slaDays * 86400000)
    .toISOString()
    .slice(0, 10);
  const lines = [
    markerFor(alert.source, alert.id),
    "",
    `Source: \`${alert.source}\``,
    `Severity: ${alert.severity} (triage target ${severity.slaDays} day(s), due ${due})`,
    `Priority: ${severity.priority}`,
    `Area: ${areaFor(alert.areaText, config)}`,
    "",
    "## Alert",
    "",
    alert.title,
    "",
    alert.location ? `Location: \`${alert.location}\`` : "Location: unknown",
    alert.url ? `Alert link: ${alert.url}` : null,
    "",
    "## Triage",
    "",
    "- [ ] Confirm the alert against the current default branch.",
    "- [ ] Fix the finding, or dismiss it with a written reason and evidence.",
    "- [ ] Add a regression check when the finding can recur.",
    "- [ ] Close this issue only after the alert is no longer open.",
    "",
    alert.secret
      ? "**Do not paste the secret value into this issue.** Rotate the credential and reference the alert link."
      : "Do not paste secrets, tokens or customer data into this issue.",
    "",
  ].filter((line) => line !== null);
  return lines.join("\n");
}

function alertTitle(alert) {
  const title = `[security][${alert.severity}] ${alert.title}`;
  return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

function colorFor(value) {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash & 0xffffff).toString(16).padStart(6, "0");
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
    if (token === "--enforce-sla") {
      args.enforceSla = true;
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
    "  node scripts/security-alerts-sync.mjs --dry-run [--config path] [--repo owner/name]",
    "  node scripts/security-alerts-sync.mjs --apply [--enforce-sla]",
    "  node scripts/security-alerts-sync.mjs --self-test",
    "",
    "Routes open code-scanning, Dependabot and secret-scanning alerts into",
    "issues with a hidden marker. Closes the generated issue when no open alert",
    "matches. Never prints a secret value.",
  ].join("\n");
}

function selfTest() {
  const cases = [
    [
      "code-scanning",
      {
        number: 1,
        rule: { id: "js/xss", security_severity_level: "high" },
        most_recent_instance: { location: { path: "src/page.js", start_line: 10 }, message: { text: "XSS" } },
        html_url: "https://example.test/alert/1",
        created_at: "2026-01-01T00:00:00Z",
      },
      "high",
    ],
    [
      "dependabot",
      {
        number: 2,
        security_advisory: { severity: "critical", summary: "RCE" },
        dependency: { package: { name: "pkg" }, manifest_path: "package.json" },
        html_url: "https://example.test/alert/2",
        created_at: "2026-01-01T00:00:00Z",
      },
      "critical",
    ],
    [
      "secret-scanning",
      {
        number: 3,
        secret_type_display_name: "token",
        locations: [{ details: { path: ".env" } }],
        html_url: "https://example.test/alert/3",
        created_at: "2026-01-01T00:00:00Z",
      },
      "critical",
    ],
  ];
  const problems = [];
  for (const [source, alert, expected] of cases) {
    const normalized = normalizeAlert(source, alert);
    if (normalized.severity !== expected) problems.push(`${source} severity`);
    if (!markerFor(source, alert.number).includes(`${source}:${alert.number}`)) problems.push(`${source} marker`);
    if (source === "secret-scanning" && !normalized.secret) problems.push("secret flag");
  }
  if (problems.length > 0) {
    console.error(`security-alerts self-test: FAIL (${problems.join(", ")})`);
    process.exitCode = 1;
    return;
  }
  console.log("security-alerts self-test: PASS (normalization, severity, marker, secret flag)");
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

  const sources = (config.sources ?? DEFAULT_CONFIG.sources).map((source) => fetchSource(api, repo, source));
  const available = sources.filter((source) => source.ok);
  for (const source of sources.filter((entry) => !entry.ok)) {
    console.warn(`warning: ${source.source} is unavailable: ${source.error}`);
  }
  if (available.length === 0) {
    console.error("security-alerts: ERROR no alert source could be read");
    process.exitCode = 2;
    return;
  }

  const alerts = available.flatMap((source) =>
    source.items.map((alert) => normalizeAlert(source.source, alert)),
  );
  const managedIssues = api.issueList({ state: "all" }).filter((issue) => issueMarker(issue));
  const byMarker = new Map(managedIssues.map((issue) => [issueMarker(issue), issue]));

  const breach = alerts.filter((alert) => {
    const severity = severityConfig(config, alert.severity);
    return daysSince(alert.createdAt) > severity.slaDays;
  });

  if (args.dryRun) {
    console.log(`security-alerts: dry-run (${alerts.length} open alert(s), ${available.length} source(s))`);
    for (const alert of alerts) {
      const issue = byMarker.get(`${alert.source}:${alert.id}`);
      console.log(
        `${issue ? "update" : "create"} ${alert.source}:${alert.id} [${alert.severity}] -> ${
          issue ? `#${issue.number}` : alertTitle(alert)
        }`,
      );
    }
    for (const alert of breach) {
      console.log(`SLA-BREACH ${alert.source}:${alert.id} [${alert.severity}] created ${alert.createdAt}`);
    }
    return;
  }

  // Labels.
  const labelNamesToEnsure = new Set([
    config.labels.issue,
    config.labels.managed,
    config.labels.resolved,
    ...alerts.flatMap((alert) => [
      `severity:${alert.severity}`,
      `source:${alert.source}`,
      `area:${areaFor(alert.areaText, config)}`,
    ]),
  ]);
  for (const label of labelNamesToEnsure) {
    try {
      api.labelCreate(label, { color: colorFor(label) });
    } catch (error) {
      console.warn(`warning: could not create label ${label}: ${error.message}`);
    }
  }

  let created = 0;
  let updated = 0;
  let closed = 0;
  const seen = new Set();

  for (const alert of alerts) {
    const key = `${alert.source}:${alert.id}`;
    seen.add(key);
    const existing = byMarker.get(key);
    const body = alertBody(alert, config);
    const labels = [
      config.labels.issue,
      config.labels.managed,
      `severity:${alert.severity}`,
      `source:${alert.source}`,
      `area:${areaFor(alert.areaText, config)}`,
    ];
    try {
      if (existing) {
        const oldManagedLabels = labelNames(existing).filter(
          (label) =>
            /^(severity|source|area):/.test(label) && !labels.includes(label),
        );
        api.issueEdit(existing.number, {
          title: alertTitle(alert),
          body,
          labels,
          removeLabels: oldManagedLabels,
        });
        if (existing.state === "CLOSED") {
          api.issueReopen(existing.number);
          api.issueComment(
            existing.number,
            `The alert is open again as of ${new Date().toISOString().slice(0, 10)}. Re-check the fix before closing.`,
          );
        }
        updated += 1;
      } else {
        api.issueCreate({ title: alertTitle(alert), body, labels });
        created += 1;
      }
    } catch (error) {
      console.error(`security-alerts: ERROR while routing ${key}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  for (const issue of managedIssues) {
    const key = issueMarker(issue);
    if (seen.has(key)) continue;
    if (issue.state === "CLOSED") continue;
    const held = labelNames(issue).filter((label) => (config.holdLabels ?? []).includes(label));
    if (held.length > 0) {
      console.log(`security-alerts: left #${issue.number} open (hold label: ${held.join(", ")})`);
      continue;
    }
    try {
      api.issueComment(
        issue.number,
        "No open security alert matches this issue. Closing it as resolved; reopen it if the alert returns.",
      );
      api.issueEdit(issue.number, { labels: [config.labels.resolved] });
      api.issueClose(issue.number, { reason: "completed" });
      closed += 1;
    } catch (error) {
      console.error(`security-alerts: ERROR while closing #${issue.number}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  for (const alert of breach) {
    console.log(`SLA-BREACH ${alert.source}:${alert.id} [${alert.severity}] created ${alert.createdAt}`);
  }
  const summary = `security-alerts: ${alerts.length} open alert(s): ${created} created, ${updated} updated, ${closed} closed, ${breach.length} SLA breach(es)`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Security alert routing\n\n${summary}\n\n${available
        .map((source) => `- ${source.source}: ${source.items.length} open`)
        .join("\n")}\n`,
    );
  }
  if (args.enforceSla && breach.length > 0) {
    console.error("security-alerts: SLA enforcement failed");
    process.exitCode = 1;
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`security-alerts: ERROR\n  ${error.message}`);
    process.exitCode = 2;
  }
}

export { markerFor, areaFor };
