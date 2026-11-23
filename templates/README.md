# Templates

Copy these files into an adopting repository. Paths on the right are the
destinations the workflows expect.

## Mapping

| Source | Destination | Notes |
|---|---|---|
| `pull_request_template.md` | `.github/pull_request_template.md` | Keep the section headings; the checker depends on them. |
| `ISSUE_TEMPLATE/*.yml` | `.github/ISSUE_TEMPLATE/` | Edit `OWNER/REPO` in `config.yml`. |
| `workflows/process-contract.yml` | `.github/workflows/` | Runs the PR body contract and forbidden-literal guard. |
| `workflows/mutation.yml` | `.github/workflows/` | Tier 1 always; tier 2 when adapters are enabled. Add your runtime setup. |
| `workflows/security-alerts-sync.yml` | `.github/workflows/` | Needs `security-events: read` and `issues: write`. |
| `workflows/board-sync.yml` | `.github/workflows/` | Needs `BOARD_SYNC_TOKEN` with `repo` + `project`. |
| `workflows/steward.yml` | `.github/workflows/` | Weekly; needs `issues: write`. |
| `check-process.mjs` | `scripts/` | PR body, task key, evidence, reviewer. |
| `check-forbidden-literals.mjs` | `scripts/` | Configurable literal guard. |
| `sync-board.mjs` | `scripts/` | Idempotent board sync. |
| `security-alerts-sync.mjs` | `scripts/` | Routes alerts to issues. |
| `steward.mjs` | `scripts/` | Rolling relevance report. |
| `lib/project-api.mjs` | `scripts/lib/` | `gh` wrapper; keep the relative path. |
| `mutation/revert-fix.mjs` | `mutation/` | Universal tier. |
| `mutation/run-adapters.mjs` | `mutation/` | Optional adapter runner. |
| `mutation/config.json` | `mutation/` | **Edit** `testCommand` and `testGlobs`. |
| `mutation/adapters.json` | `mutation/` | Enable only the adapters you install. |
| `process-contract.json` | `.github/` | **Edit** the task prefix, docs-only and product paths. |
| `forbidden-literals.json` | `.github/` | **Edit** the rules; no project secrets. |
| `board-sync.json` | `.github/` | **Edit** repo, project, key prefix, areas, milestones. |
| `security-alerts.json` | `.github/` | **Edit** sources, severity map, area rules. |
| `steward.json` | `.github/` | **Edit** stale window, hold labels, changes dir. |
| `data/milestones.json` | `data/` | Release milestones; every entry needs `title` and `due`. |

## Configure

1. **Repository.** Set `repo` to `OWNER/REPO` in `board-sync.json` and
   `security-alerts.json`, or leave it empty and let `GITHUB_REPOSITORY`
   provide it. Set `project.owner` and `project.number` if you use Projects v2.
2. **Task key.** `keyPrefix` in `board-sync.json` and `task.keyPattern` in
   `process-contract.json` must agree. The key is `<prefix>-<issue number>`.
3. **Change folder.** `changesDir` is `specs/changes` by default. If you use
   OpenSpec, set it to `openspec/changes`; the parser reads the same `tasks.md`
   headings and checkboxes.
4. **Mutation tier 1.** `mutation/config.json`:
   - `testCommand`: an argv array, for example `["npm", "test", "--silent"]`.
   - `testGlobs`: the paths that are tests. These are kept while non-test paths
     are reverted.
   - `timeoutMs`: the test timeout.
   - `allowDirty`: leave `false` in CI.
5. **Mutation tier 2.** `mutation/adapters.json`: enable only what your CI
   installs. Every adapter is optional.
6. **Milestones.** Copy `data/milestones.json` and set real dates. The board
   sync refuses a milestone without `due`.
7. **Docs/process paths.** In `process-contract.json`, `task.docsOnlyGlobs`
   decides which PRs may use `Task: none`. Everything else needs a task key.
8. **Labels.** Create the `needs-triage` label used by the issue forms, or
   change the forms to a label your repository already has. The board sync
   creates `epic`, `change:*` and `area:*`; the security script creates
   `security`, `security-alert`, `severity:*`, `source:*` and `area:*`.

## Tokens and permissions

- `process-contract.yml` uses the default `GITHUB_TOKEN` (read-only).
- `mutation.yml` uses the default token (contents read).
- `board-sync.yml` needs `BOARD_SYNC_TOKEN`: a personal token with `repo` and
  `project` scopes (classic), or issues/pull-requests write plus user-project
  access (fine-grained). Store it as a repository secret; never commit it.
- `security-alerts-sync.yml` uses `SECURITY_ALERTS_TOKEN` if set, otherwise
  `GITHUB_TOKEN` with `security-events: read` and `issues: write`.
- `steward.yml` uses the default token with `issues: write`.

## Branch protection

Make the following checks required after the first successful run:

- `process contract`
- `mutation tier 1 (universal)`
- your project's test and build checks

Tier 2 is required only when an adapter is enabled.

## First run

```sh
node scripts/check-process.mjs --self-test
node scripts/check-forbidden-literals.mjs --self-test
node scripts/sync-board.mjs --dry-run
node scripts/security-alerts-sync.mjs --dry-run
node scripts/steward.mjs --dry-run
node mutation/revert-fix.mjs --base origin/main --dry-run
```

Start with dry runs. Only the mutation tier and the PR contract belong in
branch protection on day one; enable the scheduled writers after their dry runs
are clean.
