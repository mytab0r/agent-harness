#!/usr/bin/env node
// Config-driven board sync for a spec-first repository.
//
// One epic issue per change folder and one sub-issue per task section. The
// script is idempotent: it finds its own issues by hidden body markers and
// updates them instead of creating duplicates. It never closes an issue.
//
// Usage:
//   node scripts/sync-board.mjs --dry-run
//   node scripts/sync-board.mjs --apply [--verify]
//   node scripts/sync-board.mjs --self-test
//
// Configuration: .github/board-sync.json (or --config). The key in every
// sub-issue title is `<keyPrefix>-<issue number>`, so the number is the only
// identifier a provider must preserve.
//
// Exit 0: success. Exit 1: verification failed. Exit 2: the sync could not run.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createGitHub } from "./lib/project-api.mjs";

const DEFAULT_CONFIG = {
  repo: "",
  keyPrefix: "TASK",
  changesDir: "specs/changes",
  project: { owner: "", number: 0 },
  labels: { epic: "epic", changePrefix: "change:", areaPrefix: "area:" },
  areas: ["app", "infra", "docs", "design"],
  areaRules: [],
  defaultArea: "app",
  defaultPriority: "P2",
  defaultSeverity: "S-",
  milestonesFile: "data/milestones.json",
  fieldNames: {
    area: "Area",
    priority: "Priority",
    severity: "Severity",
    start: "Start date",
    target: "Target date",
    actualStart: "Actual start",
    actualEnd: "Actual end",
    progress: "Progress",
    status: "Status",
  },
  statusOptions: { todo: "Todo", inProgress: "In Progress", done: "Done" },
  markers: {
    epic: "<!-- harness-change: {id} -->",
    task: "<!-- harness-task: {id}/{slug} -->",
  },
};

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadConfig(root, explicit) {
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
        path.join(root, ".github", "board-sync.json"),
        path.join(root, "board-sync.json"),
      ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  const parsed = found ? JSON.parse(fs.readFileSync(found, "utf8")) : {};
  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    project: { ...DEFAULT_CONFIG.project, ...(parsed.project ?? {}) },
    labels: { ...DEFAULT_CONFIG.labels, ...(parsed.labels ?? {}) },
    fieldNames: { ...DEFAULT_CONFIG.fieldNames, ...(parsed.fieldNames ?? {}) },
    statusOptions: { ...DEFAULT_CONFIG.statusOptions, ...(parsed.statusOptions ?? {}) },
    markers: { ...DEFAULT_CONFIG.markers, ...(parsed.markers ?? {}) },
  };
}

function loadMilestones(root, config) {
  const file = path.resolve(root, config.milestonesFile);
  const entries = loadJson(file, []);
  if (!Array.isArray(entries)) throw new Error(`${config.milestonesFile} must be a JSON array`);
  return entries;
}

function slugify(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "task";
}

function marker(config, kind, values) {
  return config.markers[kind].replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function areaFor(id, title, config) {
  const haystack = `${id} ${title}`.toLowerCase();
  for (const rule of config.areaRules ?? []) {
    if ((rule.keywords ?? []).some((keyword) => haystack.includes(String(keyword).toLowerCase()))) {
      return rule.area;
    }
  }
  return config.defaultArea;
}

function milestoneFor(id, area, milestones) {
  const byEpic = milestones.find((entry) => (entry.match?.epics ?? []).includes(id));
  if (byEpic) return byEpic;
  return milestones.find((entry) => (entry.match?.areas ?? []).includes(area)) ?? null;
}

function resolveBlockers(raw, sections) {
  const refs = [];
  const unresolved = [];
  for (const token of String(raw ?? "").split(/[,;]/).map((value) => value.trim()).filter(Boolean)) {
    const range = /^T?(\d+)\s*[-–]\s*T?(\d+)$/i.exec(token);
    if (range) {
      for (let index = Number(range[1]); index <= Number(range[2]); index += 1) refs.push(index);
      continue;
    }
    const single = /^T?(\d+)[.)]?$/i.exec(token);
    if (single) {
      refs.push(Number(single[1]));
      continue;
    }
    const matches = sections.filter(
      (section) =>
        section.slug === slugify(token) ||
        section.title.toLowerCase().includes(token.toLowerCase()),
    );
    if (matches.length === 1) refs.push(matches[0].index);
    else unresolved.push(token);
  }
  return { refs: [...new Set(refs)].sort((a, b) => a - b), unresolved };
}

export function parseTasksFile(text, { id, config = DEFAULT_CONFIG, milestones = [] }) {
  const source = String(text ?? "");
  const epicTitle =
    source
      .split(/\r?\n/)
      .find((line) => /^#\s+/.test(line))
      ?.replace(/^#\s+/, "")
      .trim() ?? id;

  const chunks = source.split(/^##\s+/m).slice(1);
  const sections = [];
  for (const chunk of chunks) {
    const [headingLine, ...bodyLines] = chunk.split(/\r?\n/);
    const heading = headingLine.trim();
    if (!heading) continue;
    const body = bodyLines.join("\n");
    const blockedRaw =
      /\(blocked by:\s*([^)]+)\)/i.exec(heading)?.[1] ??
      /^\s*\(blocked by:\s*([^)]+)\)/im.exec(body)?.[1] ??
      "";
    const title = heading
      .replace(/\(blocked by:[^)]*\)/i, "")
      .replace(/^T?\d+[.)]?\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const checkboxes = [...body.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/gm)].map((match) => ({
      checked: match[1].toLowerCase() === "x",
      text: match[2].trim(),
    }));
    const checked = checkboxes.filter((box) => box.checked).length;
    const area = areaFor(id, title, config);
    const priority = /^\s*Priority:\s*(P[0-3])\s*$/im.exec(body)?.[1] ?? config.defaultPriority;
    const severity = /^\s*Severity:\s*(S[1-4-])\s*$/im.exec(body)?.[1] ?? null;
    const usedSlugs = new Set(sections.map((section) => section.slug));
    let slug = slugify(title);
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${slugify(title)}-${suffix}`;
      suffix += 1;
    }
    sections.push({
      index: sections.length + 1,
      heading,
      title,
      slug,
      body,
      checkboxes,
      checked,
      total: checkboxes.length,
      hasUnchecked: checkboxes.some((box) => !box.checked),
      blockedRaw,
      blockedRefs: [],
      unresolvedBlockers: [],
      area,
      priority,
      severity,
      milestone: milestoneFor(id, area, milestones),
    });
  }

  for (const section of sections) {
    const resolved = resolveBlockers(section.blockedRaw, sections);
    section.blockedRefs = resolved.refs;
    section.unresolvedBlockers = resolved.unresolved;
  }

  return {
    id,
    title: epicTitle,
    area: areaFor(id, epicTitle, config),
    milestone: milestoneFor(id, areaFor(id, epicTitle, config), milestones),
    sections,
  };
}

function taskKey(config, number) {
  return `${config.keyPrefix}-${number}`;
}

function progressOf(sections) {
  const total = sections.length;
  const checked = sections.reduce((sum, section) => sum + section.checked, 0);
  const boxes = sections.reduce((sum, section) => sum + section.total, 0);
  return { total, checked, boxes, percent: boxes === 0 ? 0 : Math.round((checked / boxes) * 100) };
}

function epicBody(change, taskEntries, config) {
  const lines = [
    marker(config, "epic", { id: change.id }),
    "",
    `Change: \`${config.changesDir}/${change.id}\``,
    "",
    `Progress: ${taskEntries.filter((entry) => entry.issue?.state === "CLOSED").length}/${taskEntries.length} sub-issues closed`,
    `Priority: ${config.defaultPriority}`,
    "",
    "## Sub-issues",
    "",
  ];
  if (taskEntries.length === 0) {
    lines.push("No sub-issues yet.");
  } else {
    for (const entry of taskEntries) {
      const checked = entry.issue?.state === "CLOSED" ? "x" : " ";
      const number = entry.issue?.number ?? "?";
      lines.push(`- [${checked}] #${number} ${taskKey(config, number)} — ${entry.section.title}`);
    }
  }
  lines.push("", "## Source of truth", "", `\`${config.changesDir}/${change.id}/tasks.md\``, "");
  return lines.join("\n");
}

function taskBody(change, section, epicNumber, blocked, config, existingBody = "") {
  const lines = [
    marker(config, "task", { id: change.id, slug: section.slug }),
    "",
    `Epic: #${epicNumber}`,
    "",
    `Source: \`${config.changesDir}/${change.id}/tasks.md\` -> \`## ${section.heading}\``,
    "",
    `Checkboxes: ${section.checked}/${section.total}`,
    `Priority: ${section.priority}`,
  ];
  if (section.severity) lines.push(`Severity: ${section.severity}`);
  else if (/^\s*Severity:\s*S[1-4-]\s*$/im.test(existingBody)) {
    lines.push(`Severity: ${/^\s*Severity:\s*(S[1-4-])\s*$/im.exec(existingBody)[1]}`);
  }
  if (blocked.length > 0) {
    lines.push(`Blocked by: ${blocked.map((entry) => `${entry.key} (#${entry.number})`).join(", ")}`);
  }
  if (section.unresolvedBlockers.length > 0) {
    lines.push(`Blocked by (unresolved): ${section.unresolvedBlockers.join(", ")}`);
  }
  lines.push("", "This issue is generated from the spec. Update `tasks.md`, then re-run the sync.", "");
  return lines.join("\n");
}

function findIssue(issues, bodyMarker) {
  return issues.find((issue) => String(issue.body ?? "").includes(bodyMarker)) ?? null;
}

function milestoneTitle(issue) {
  return issue?.milestone?.title ?? issue?.milestone ?? null;
}

function dateOnly(value) {
  if (!value) return null;
  const text = String(value);
  const match = /^\d{4}-\d{2}-\d{2}/.exec(text);
  return match ? match[0] : null;
}

function fieldKind(field) {
  if (Array.isArray(field.options) && field.options.length > 0) return "single-select";
  const type = `${field.type ?? ""} ${field.dataType ?? ""} ${field.data_type ?? ""}`.toLowerCase();
  if (type.includes("number")) return "number";
  if (type.includes("date")) return "date";
  return "text";
}

function itemValue(item, name) {
  const key = Object.keys(item ?? {}).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? item[key] : null;
}

function colorFor(value) {
  let hash = 0;
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash & 0xffffff).toString(16).padStart(6, "0");
}

function changeFolders(root, config) {
  const directory = path.resolve(root, config.changesDir);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(directory, id, "tasks.md")))
    .sort();
}

function createProjectSync(api, config) {
  if (!config.project?.number || !config.project?.owner) return null;
  const project = api.projectView(config.project.owner, config.project.number);
  const fields = api.projectFields(config.project.owner, config.project.number);
  const items = api.projectItems(config.project.owner, config.project.number);
  const fieldByName = new Map(fields.map((field) => [field.name.toLowerCase(), field]));
  const itemByNumber = new Map(
    items
      .filter((item) => Number.isInteger(Number(item.content?.number)))
      .map((item) => [Number(item.content.number), item]),
  );
  const warned = new Set();

  function warnMissing(name) {
    if (warned.has(name)) return;
    warned.add(name);
    console.warn(`warning: project field "${name}" is missing; skipped`);
  }

  function itemFor(issue) {
    let item = itemByNumber.get(issue.number);
    if (!item) {
      item = api.projectAddItem(config.project.owner, config.project.number, issue.url);
      itemByNumber.set(issue.number, item);
    }
    return item;
  }

  function set(issue, name, value) {
    if (value === null || value === undefined || value === "") return;
    const field = fieldByName.get(name.toLowerCase());
    if (!field) {
      warnMissing(name);
      return;
    }
    const kind = fieldKind(field);
    let fieldValue = value;
    if (kind === "single-select") {
      const option = (field.options ?? []).find(
        (candidate) => String(candidate.name).toLowerCase() === String(value).toLowerCase(),
      );
      if (!option) {
        warnMissing(`${name} option ${value}`);
        return;
      }
      fieldValue = option.id;
    }
    const item = itemFor(issue);
    api.projectEditField({
      projectId: project.id,
      itemId: item.id,
      fieldId: field.id,
      value: fieldValue,
      kind,
    });
  }

  function sync(issue, { area, priority, severity, progress, status, targetDate, actualEnd }) {
    set(issue, config.fieldNames.area, area);
    set(issue, config.fieldNames.priority, priority);
    set(issue, config.fieldNames.severity, severity);
    set(issue, config.fieldNames.progress, progress);
    set(issue, config.fieldNames.status, status);
    set(issue, config.fieldNames.start, dateOnly(issue.createdAt) ?? dateOnly(new Date().toISOString()));
    set(issue, config.fieldNames.target, targetDate);
    set(issue, config.fieldNames.actualStart, dateOnly(issue.createdAt));
    set(issue, config.fieldNames.actualEnd, actualEnd);
  }

  function get(issue, name) {
    const item = itemByNumber.get(issue.number);
    return item ? itemValue(item, name) : null;
  }

  return { sync, get, itemByNumber };
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
    if (token === "--verify") {
      args.verify = true;
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
    "  node scripts/sync-board.mjs --dry-run [--config path] [--repo-root dir]",
    "  node scripts/sync-board.mjs --apply [--verify] [--config path]",
    "  node scripts/sync-board.mjs --self-test",
    "",
    "Creates or updates one epic per spec change and one sub-issue per task",
    "section. Finds its own issues by hidden body markers. Never closes issues.",
  ].join("\n");
}

function selfTest() {
  const text = [
    "# Example change",
    "",
    "## 1. Parser",
    "- [ ] parse the input",
    "- [x] handle empty input",
    "(blocked by: 2)",
    "",
    "## 2. Board sync",
    "- [ ] update the board",
  ].join("\n");
  const parsed = parseTasksFile(text, { id: "example-change", config: DEFAULT_CONFIG, milestones: [] });
  const problems = [];
  if (parsed.title !== "Example change") problems.push("epic title");
  if (parsed.sections.length !== 2) problems.push("section count");
  if (parsed.sections[0]?.blockedRefs?.[0] !== 2) problems.push("blocker resolution");
  if (parsed.sections[0]?.title !== "Parser") problems.push("heading cleanup");
  if (parsed.sections[0]?.checked !== 1) problems.push("checkbox count");
  if (parsed.sections[0]?.area !== "app") problems.push("area fallback");
  if (problems.length > 0) {
    console.error(`sync-board self-test: FAIL (${problems.join(", ")})`);
    process.exitCode = 1;
    return;
  }
  console.log("sync-board self-test: PASS (epic, sections, blockers, checkboxes, area)");
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

  const root = path.resolve(args["repo-root"] ?? process.cwd());
  const config = loadConfig(root, args.config);
  const milestones = loadMilestones(root, config);
  for (const entry of milestones) {
    if (!entry.title || !entry.due) throw new Error("every milestone needs `title` and `due` (YYYY-MM-DD)");
  }

  const api = createGitHub({ cwd: root });
  const repo =
    args.repo ||
    config.repo ||
    process.env.GITHUB_REPOSITORY ||
    api.repoView().nameWithOwner;
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`cannot resolve repository: ${repo}`);

  const changes = changeFolders(root, config)
    .map((id) => {
      const text = fs.readFileSync(path.join(root, config.changesDir, id, "tasks.md"), "utf8");
      return parseTasksFile(text, { id, config, milestones });
    })
    .filter((change) => {
      if (change.sections.some((section) => section.total > 0)) return true;
      console.warn(`warning: ${config.changesDir}/${change.id}/tasks.md has no checkbox tasks; skipped`);
      return false;
    });
  if (changes.length === 0) {
    console.log(`sync-board: no change folders with tasks.md under ${config.changesDir}`);
    return;
  }

  const existingIssues = api.issueList({ state: "all" });
  const plan = [];
  for (const change of changes) {
    const epicMarker = marker(config, "epic", { id: change.id });
    const epic = findIssue(existingIssues, epicMarker);
    plan.push({ kind: "epic", change, existing: epic });
    for (const section of change.sections) {
      const taskMarker = marker(config, "task", { id: change.id, slug: section.slug });
      const issue = findIssue(existingIssues, taskMarker);
      if (!section.hasUnchecked && !issue) continue;
      plan.push({ kind: "task", change, section, existing: issue });
    }
  }

  if (args.dryRun) {
    console.log("sync-board: dry-run (no changes)");
    for (const item of plan) {
      if (item.kind === "epic") {
        console.log(
          `${item.existing ? "update" : "create"} epic ${item.change.id} -> ${item.existing ? `#${item.existing.number}` : "new issue"}`,
        );
      } else {
        const boxes = `${item.section.checked}/${item.section.total}`;
        console.log(
          `${item.existing ? "update" : "create"} task ${item.change.id}/${item.section.slug} [${boxes}] -> ${
            item.existing ? `#${item.existing.number}` : "new issue"
          }`,
        );
      }
    }
    return;
  }

  // Apply. Labels and milestones first.
  const labels = new Set();
  for (const item of plan) {
    labels.add(item.kind === "epic" ? config.labels.epic : config.labels.changePrefix + item.change.id);
    labels.add(config.labels.areaPrefix + (item.kind === "epic" ? item.change.area : item.section.area));
    if (item.kind === "task") labels.add(config.labels.changePrefix + item.change.id);
  }
  for (const label of labels) api.labelCreate(label, { color: colorFor(label) });

  const existingMilestones = new Map(api.milestones(repo).map((entry) => [entry.title, entry]));
  for (const entry of milestones) {
    if (!existingMilestones.has(entry.title)) {
      api.milestoneCreate(repo, { title: entry.title, due: entry.due, description: entry.description ?? "" });
    }
  }

  let issueTypes = [];
  try {
    issueTypes = api.issueTypes(owner, name);
  } catch (error) {
    console.warn(`warning: issue types are unavailable: ${error.message}`);
  }
  const typeId = (typeName) => issueTypes.find((type) => type.name === typeName)?.id ?? null;
  const typeWarned = new Set();
  function applyType(issueNumber, typeName) {
    const id = typeId(typeName);
    if (!id || typeWarned.has(typeName)) return;
    try {
      const nodeId = api.issueNodeId(owner, name, issueNumber);
      if (nodeId) api.setIssueType(nodeId, id);
    } catch (error) {
      typeWarned.add(typeName);
      console.warn(`warning: could not set issue type ${typeName}: ${error.message}`);
    }
  }

  let projectSync = null;
  try {
    projectSync = createProjectSync(api, config);
  } catch (error) {
    if (config.project?.number) {
      throw new Error(
        `project sync is configured but unavailable: ${error.message}. Fix the token scopes or set project.number to 0.`,
      );
    }
    console.warn(`warning: project sync is unavailable: ${error.message}`);
  }

  const epicByChange = new Map();
  for (const change of changes) {
    const item = plan.find((entry) => entry.kind === "epic" && entry.change.id === change.id);
    if (!item) continue;
    const taskEntries = plan
      .filter((entry) => entry.kind === "task" && entry.change.id === change.id)
      .map((entry) => ({ section: entry.section, issue: entry.existing }));
    const milestone = change.milestone?.title;
    const body = epicBody(change, taskEntries, config);
    const epicLabels = [
      config.labels.epic,
      config.labels.changePrefix + change.id,
      config.labels.areaPrefix + change.area,
    ];
    let issue;
    if (item.existing) {
      issue = item.existing;
      api.issueEdit(issue.number, {
        title: `[${change.id}] ${change.title}`,
        body,
        labels: epicLabels,
        milestone,
      });
      if (issue.state === "CLOSED" && change.sections.some((section) => section.hasUnchecked)) {
        api.issueReopen(issue.number);
        issue = { ...issue, state: "OPEN" };
      }
    } else {
      const created = api.issueCreate({
        title: `[${change.id}] ${change.title}`,
        body,
        labels: epicLabels,
        milestone,
      });
      issue = { ...created, state: "OPEN", labels: epicLabels.map((label) => ({ name: label })) };
      console.log(`epic: ${change.id} -> #${created.number}`);
    }
    epicByChange.set(change.id, issue);
    applyType(issue.number, "Feature");
    if (projectSync) {
      projectSync.sync(issue, {
        area: change.area,
        priority: config.defaultPriority,
        severity: config.defaultSeverity,
        progress: 0,
        status: config.statusOptions.todo,
        targetDate: change.milestone?.due ?? null,
        actualEnd: dateOnly(issue.closedAt),
      });
    }
  }

  const taskEntries = [];
  for (const item of plan.filter((entry) => entry.kind === "task")) {
    const { change, section } = item;
    const epic = epicByChange.get(change.id);
    const body = taskBody(change, section, epic.number, [], config, item.existing?.body ?? "");
    const labels = [
      config.labels.changePrefix + change.id,
      config.labels.areaPrefix + section.area,
    ];
    const milestone = section.milestone?.title ?? change.milestone?.title;
    let issue;
    if (item.existing) {
      issue = item.existing;
      api.issueEdit(issue.number, {
        title: `${taskKey(config, issue.number)} — ${section.title}`,
        body,
        labels,
        milestone,
      });
      if (issue.state === "CLOSED" && section.hasUnchecked) {
        api.issueReopen(issue.number);
        issue = { ...issue, state: "OPEN" };
      }
    } else {
      const created = api.issueCreate({
        title: `[${change.id}] ${section.title}`,
        body,
        labels,
        milestone,
      });
      issue = { ...created, state: "OPEN", labels: labels.map((label) => ({ name: label })) };
      api.issueEdit(created.number, { title: `${taskKey(config, created.number)} — ${section.title}` });
      console.log(`task: ${change.id}/${section.slug} -> #${created.number} (${taskKey(config, created.number)})`);
    }
    applyType(issue.number, "Task");
    if (projectSync) {
      projectSync.sync(issue, {
        area: section.area,
        priority: section.priority,
        severity: section.severity ?? config.defaultSeverity,
        progress: section.total === 0 ? 0 : Math.round((section.checked / section.total) * 100),
        status:
          section.checked === section.total
            ? config.statusOptions.done
            : section.checked === 0
              ? config.statusOptions.todo
              : config.statusOptions.inProgress,
        targetDate: section.milestone?.due ?? change.milestone?.due ?? null,
        actualEnd: dateOnly(issue.closedAt),
      });
    }
    taskEntries.push({ change, section, issue });
  }

  // Resolve blockers and native sub-issue links now that every key exists.
  const byChangeAndIndex = new Map();
  for (const entry of taskEntries) {
    byChangeAndIndex.set(`${entry.change.id}#${entry.section.index}`, entry);
  }
  const nodeIds = new Map();
  function nodeId(issueNumber) {
    if (!nodeIds.has(issueNumber)) nodeIds.set(issueNumber, api.issueNodeId(owner, name, issueNumber));
    return nodeIds.get(issueNumber);
  }

  for (const entry of taskEntries) {
    const blocked = entry.section.blockedRefs
      .map((index) => byChangeAndIndex.get(`${entry.change.id}#${index}`))
      .filter(Boolean)
      .map((candidate) => ({
        number: candidate.issue.number,
        key: taskKey(config, candidate.issue.number),
      }));
    const body = taskBody(entry.change, entry.section, epicByChange.get(entry.change.id).number, blocked, config, entry.issue.body ?? "");
    api.issueEdit(entry.issue.number, { body });
    const childNode = nodeId(entry.issue.number);
    const parentNode = nodeId(epicByChange.get(entry.change.id).number);
    if (childNode && parentNode) {
      try {
        api.addSubIssue(parentNode, childNode);
      } catch (error) {
        console.warn(`warning: could not link #${entry.issue.number} to its epic: ${error.message}`);
      }
    }
    for (const blocker of blocked) {
      const blockerNode = nodeId(blocker.number);
      if (childNode && blockerNode) {
        try {
          api.addBlockedBy(childNode, blockerNode);
          console.log(`blocked-by: #${entry.issue.number} <- #${blocker.number}`);
        } catch (error) {
          console.warn(`warning: could not add native dependency #${entry.issue.number} <- #${blocker.number}: ${error.message}`);
        }
      }
    }
  }

  // Refresh epic bodies with final sub-issue numbers.
  for (const change of changes) {
    const epic = epicByChange.get(change.id);
    if (!epic) continue;
    const entries = taskEntries
      .filter((entry) => entry.change.id === change.id)
      .map((entry) => ({ section: entry.section, issue: entry.issue }));
    api.issueEdit(epic.number, { body: epicBody(change, entries, config) });
  }

  if (projectSync) {
    for (const change of changes) {
      const epic = epicByChange.get(change.id);
      if (!epic) continue;
      const entries = taskEntries.filter((entry) => entry.change.id === change.id);
      const closed = entries.filter((entry) => entry.issue.state === "CLOSED").length;
      const percent = entries.length === 0 ? 0 : Math.round((closed / entries.length) * 100);
      projectSync.sync(epic, {
        area: change.area,
        priority: config.defaultPriority,
        severity: config.defaultSeverity,
        progress: percent,
        status:
          percent === 100
            ? config.statusOptions.done
            : percent === 0
              ? config.statusOptions.todo
              : config.statusOptions.inProgress,
        targetDate: change.milestone?.due ?? null,
        actualEnd: dateOnly(epic.closedAt),
      });
    }
  }

  if (args.verify) {
    const errors = [];
    const current = api.issueList({ state: "all" });
    const managed = [
      ...epicByChange.values(),
      ...taskEntries.map((entry) => entry.issue),
    ];
    for (const issue of managed) {
      const fresh = current.find((candidate) => candidate.number === issue.number) ?? issue;
      if (milestones.length > 0 && !milestoneTitle(fresh)) {
        errors.push(`#${fresh.number} has no milestone`);
      }
      if (projectSync) {
        const item = projectSync.itemByNumber.get(fresh.number);
        if (!item) {
          errors.push(`#${fresh.number} has no project item`);
          continue;
        }
        for (const fieldName of [
          config.fieldNames.area,
          config.fieldNames.priority,
          config.fieldNames.start,
          config.fieldNames.target,
        ]) {
          if (!itemValue(item, fieldName)) errors.push(`#${fresh.number} has no ${fieldName}`);
        }
        if (fresh.state === "CLOSED" && !itemValue(item, config.fieldNames.actualEnd)) {
          errors.push(`#${fresh.number} is closed but has no ${config.fieldNames.actualEnd}`);
        }
      }
    }
    if (errors.length > 0) {
      for (const error of errors) console.error(`error: ${error}`);
      console.error("sync-board: verify FAILED");
      process.exitCode = 1;
      return;
    }
    console.log("sync-board: verify OK");
  } else {
    console.log("sync-board: apply complete");
  }
}

const isEntryPoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  try {
    main();
  } catch (error) {
    console.error(`sync-board: ERROR\n  ${error.message}`);
    process.exitCode = 2;
  }
}

export { slugify, areaFor, milestoneFor };
