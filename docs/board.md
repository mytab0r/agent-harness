# Board

The board mirrors the spec folder so delivery is visible without opening
`specs/`. The source of truth is `specs/changes/<id>/tasks.md`; the board is a
mirror, not a second plan.

The template is config-driven: no issue numbers, key prefixes or area names are
hard-coded. `templates/board-sync.json` is the starting point.

## One key per task

A task key is `<PREFIX>-<issue number>`, for example `TASK-42`. The number is
the only identifier every provider preserves. It appears in:

- the sub-issue title: `TASK-42 — Parser cache`;
- the commit trailer: `Task: TASK-42`;
- the PR body: `Task: TASK-42` and `Closes #42`.

A local counter drifts after a provider migration or a deleted issue. A UUID
does not fit a commit trailer. The issue number does.

The branch name does not need the key. A fork cannot guarantee that a
contributor has an issue number before pushing. Use
`<type>/<change-id>-<slug>` and put the key in the PR body.

## What the sync creates

- **One epic per change folder** that has at least one checkbox in `tasks.md`.
  Title: `[<change-id>] <first heading>`. Labels: `epic`,
  `change:<change-id>`, `area:<area>`.
- **One sub-issue per task section** that still has an unchecked box, or already
  has a sub-issue. A fully checked section that never had one is historical and
  is not retroactively opened.
- **Native sub-issue links** through the GraphQL `addSubIssue` mutation.
- **Native dependencies** through `addBlockedBy`, derived from the section's
  `(blocked by: ...)` line. The text line stays for humans.
- **Milestones** from `data/milestones.json`, matched by epic first, then area.
- **Project fields**: Area, Priority, Severity, Start date, Target date,
  Actual start, Actual end, Progress and Status, when a Project v2 is
  configured.
- **Native issue types** (`Feature`, `Task`, `Bug`) when the repository exposes
  them. The script warns and continues if the API does not.
- **Hidden markers** for idempotency:
  `<!-- harness-change: <id> -->` and
  `<!-- harness-task: <id>/<slug> -->`.

The sync never closes an issue. A person or the provider closes a finished
issue.

## Configuration

```json
{
  "repo": "OWNER/REPO",
  "keyPrefix": "TASK",
  "changesDir": "specs/changes",
  "project": { "owner": "OWNER", "number": 1 },
  "defaultArea": "app",
  "areas": ["app", "infra", "docs", "design"],
  "areaRules": [
    { "area": "infra", "keywords": ["ci", "deploy", "security"] },
    { "area": "docs", "keywords": ["docs", "readme"] }
  ],
  "milestonesFile": "data/milestones.json"
}
```

- `changesDir` may be `openspec/changes` if you use OpenSpec; the parser reads
  the same `tasks.md` headings and checkboxes.
- `project.number: 0` disables project fields; issues, labels and milestones
  still sync.
- `repo` may be empty in CI; `GITHUB_REPOSITORY` supplies it.

## Issue types, priority and severity

Use the native issue type (`Task`, `Bug`, `Feature`) and do not duplicate it
with a label. Labels carry the OpenSpec grouping (`epic`, `change:<id>`) and the
area; they do not carry the type.

Priority and severity are project single-select fields:

- `Priority`: `P0`–`P3`.
- `Severity`: `S1`–`S4` plus `S-` ("no severity").

An issue declares its own value with a body line:

```text
Priority: P2
Severity: S3
```

The sync preserves those lines when it regenerates the body. Defaults:
priority `P2`, severity `S-`. A bug usually starts at `S2`; adjust it during
triage, not in the script.

## Milestones are releases

`data/milestones.json` is the single source for release milestones:

```json
[
  {
    "title": "Release 1",
    "due": "2026-12-31",
    "description": "Planning default, not a promise.",
    "match": { "epics": ["parser-cache"], "areas": ["app"] }
  }
]
```

Every entry needs `title` and `due`. The sync refuses a milestone without a due
date because the roadmap needs both ends of the bar. Matching order is epic
first, then area, so every issue of one change shares the epic's milestone.

Change a date in the file, never in the project UI.

## Plan vs actual

| Field | Kind | Value |
|---|---|---|
| `Start date` | plan start | Issue creation date, or the first In Progress transition when exposed. |
| `Target date` | plan end | The milestone due date. |
| `Actual start` | fact | The first In Progress transition when exposed, otherwise the creation date. |
| `Actual end` | fact | The native `closedAt` date; empty while the issue is open. |

The roadmap bar reads the plan pair. The fact pair stays separate, so a slipped
issue remains visible after it closes and the original commitment is not
rewritten.

The template derives `Actual end` from the closed issue and `Target date` from
the milestone. If your provider exposes transition timestamps, extend
`project-api.mjs` and populate `Actual start` from them.

## Verification

```sh
node scripts/sync-board.mjs --dry-run   # print the plan, change nothing
node scripts/sync-board.mjs --apply --verify
```

`--verify` checks that every managed issue has a milestone (when milestones are
configured) and, when a project is configured, a project item with Area,
Priority, Start date and Target date; a closed issue must also have Actual end.
A missing field is an error, not a warning.

## Tokens and permissions

- Local dry runs use the owner's `gh` login.
- `board-sync.yml` needs `BOARD_SYNC_TOKEN`: a personal token with `repo` and
  `project` scopes (classic), or issues/pull-requests write plus user-project
  access (fine-grained). Store it as a repository secret; never commit it.
- The workflow fails with an explicit error when the secret is missing.

## First run

1. Edit `board-sync.json` and `data/milestones.json`.
2. Run `--dry-run` and check the plan.
3. Run `--apply --verify`.
4. Mark `board-sync` green before enabling the daily schedule.
5. Do not create a second issue outside the marker. The sync owns its epics and
   sub-issues.
