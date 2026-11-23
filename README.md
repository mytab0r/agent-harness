# Agent Harness

A small, project-agnostic delivery harness for teams that ship code with AI
agents. It turns a working process into files a repository can enforce:
specifications, role boundaries, mechanical pull-request contracts, mutation
proof, independent review, issue/board automation, security-alert routing, and a
scheduled steward that asks whether the work still matters.

It is not a framework and not a test runner. It is a set of contracts, scripts
and role prompts that you copy into a repository and wire into CI.

## Why

Four failure modes keep showing up when agents write code:

1. **Fake-green tests.** A test passes before and after the fix, or the author
   edits the assertion until it agrees with the implementation. A green suite
   proves execution, not detection.
2. **Self-review.** The agent that wrote the change also reviews it, reads its
   own reasoning, and approves. A gate the author can waive is not a gate.
3. **Spec-less code.** Work starts from a prompt, not from a problem statement
   with acceptance criteria and an explicit out-of-scope list. Nobody can say
   what "done" means, so every review argues about intent.
4. **Untracked delivery.** The work exists in a chat and a branch, but not in an
   issue, a spec folder or a board. Progress is invisible and duplicates grow.

Each counter in this repository is mechanical where it can be and explicitly
human where it cannot. The mutation layer, for example, proves that reverting a
non-test change makes the test fail; it does not pretend to judge test quality.
The review contract proves that two identities signed off; it cannot prove the
reviewer thought hard. The steward produces questions with evidence; a person
decides relevance.

## What is inside

| Path | Purpose |
|---|---|
| `docs/process.md` | The spec → tests → implementation → independent review → verification lifecycle. |
| `docs/roles.md` | Who may write, test, review and close; the author-never-edits-judging-tests rule. |
| `docs/gates.md` | What CI must check, the two-tier mutation contract, and what CI cannot prove. |
| `docs/anti-patterns.md` | Each failure mode with a mechanical counter. |
| `docs/board.md` | Issue types, priority/severity, release milestones, plan vs actual, native dependencies. |
| `docs/security-alerts.md` | How code-scanning, dependency and secret alerts become owned issues. |
| `docs/steward.md` | The scheduled relevance challenge and its limits. |
| `docs/working-rules.md` | A trimmed, project-neutral set of working rules for agents. |
| `agents/` | Role prompts: analyst, developer, tester, critic, pm, librarian, orchestrator, steward. |
| `skills/ui-self-review/` | A sanitized UI completion and independent-review method. |
| `skills/donor-reverse/` | A sanitized measurement-first reference-site comparison method. |
| `templates/` | PR template, issue forms, workflows, process/mutation/board/security scripts and configs. |
| `examples/` | A polyglot mutation self-test and an honest adoption case note. |
| `install.sh`, `install.ps1` | Copy agents and skills into `~/.claude`, verify prerequisites, print the plugin command. |

## Quickstart with Claude Code

```sh
git clone https://github.com/mytab0r/agent-harness.git
cd agent-harness
./install.sh          # macOS/Linux
# .\install.ps1       # Windows PowerShell
```

The installer:

- checks `node`, `git` and `gh`;
- copies `agents/*.md` to `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/agents/`;
- copies `skills/*` to `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills/`;
- prints the Superpowers plugin command.

Enable the plugin once:

```sh
claude plugin install superpowers@claude-plugins-official
```

Then copy the parts you want into your repository. `templates/README.md` maps
every file to its destination. The shortest path is:

```sh
mkdir -p .github/workflows .github/ISSUE_TEMPLATE scripts scripts/lib mutation
cp templates/pull_request_template.md .github/
cp templates/ISSUE_TEMPLATE/* .github/ISSUE_TEMPLATE/
cp templates/workflows/* .github/workflows/
cp templates/check-process.mjs templates/check-forbidden-literals.mjs \
   templates/sync-board.mjs templates/security-alerts-sync.mjs \
   templates/steward.mjs scripts/
cp templates/lib/project-api.mjs scripts/lib/
cp templates/mutation/* mutation/
cp templates/*.json .github/   # rename/merge; see templates/README.md
mkdir -p data
cp templates/data/milestones.json data/
```

Edit the configs (repository, project, key prefix, test command, test globs),
then run the smoke tests:

```sh
node scripts/check-process.mjs --self-test
node scripts/check-forbidden-literals.mjs --self-test
node mutation/revert-fix.mjs --dry-run --base origin/main
```

## Quickstart for a generic agent

The roles are plain Markdown and the scripts are Node built-ins plus `gh`. Any
agent that can read files and run shell commands can use them:

1. Give the agent `docs/working-rules.md`, `docs/process.md` and
   `docs/roles.md`.
2. Give it the one role file it is playing, for example `agents/developer.md`.
3. Give it the current spec folder (`specs/changes/<id>/`) and the issue key.
4. Require the exit codes from `docs/gates.md` as the definition of done.

There is no Claude-specific API in the scripts. The `agents/` and `skills/`
directories are installed into `~/.claude` only because that is where Claude
Code looks for them; other tools can consume the same files directly.

## Prerequisites

- Node 20 or newer (the scripts use built-ins only; no `npm install`).
- `git` and a clean working tree for the universal mutation tier.
- `gh` authenticated with `repo` scope. Board sync needs `project` scope; the
  security workflow needs `security-events: read` and `issues: write`.
- Claude Code users: the Superpowers plugin
  (`claude plugin install superpowers@claude-plugins-official`). It supplies
  TDD, code-review and verification skills that the roles reference.
- Optional: `actionlint` for workflow linting, Python + PyYAML for the
  repository's own YAML self-check.

## 10-minute adoption path for an existing repository

1. **Copy the contract.** Add `templates/pull_request_template.md` and the
   issue forms. Do not customize the section headings yet; the checker depends
   on them.
2. **Configure the process.** Copy `templates/process-contract.json` to
   `.github/process-contract.json`. Set your task prefix, docs-only paths and
   product paths.
3. **Configure mutation tier 1.** Copy `templates/mutation/config.json` to
   `mutation/config.json`. Set `testCommand` to the command that runs the tests
   affected by a change and `testGlobs` to the paths that are tests. Run
   `node mutation/revert-fix.mjs --base origin/main` on one real PR.
4. **Turn on the gates.** Copy `process-contract.yml` and `mutation.yml` to
   `.github/workflows/`. Add your language setup to the mutation workflow, then
   mark both checks required in branch protection.
5. **Prove one change end to end.** Write a spec folder, let the tester write a
   failing acceptance test, let the developer implement without editing that
   test, run the universal mutation tier, and have a different agent review.
6. **Add the board.** Copy `board-sync.json` and `sync-board.mjs`, set your
   project and milestones, and dry-run the sync.
7. **Add security routing.** Copy `security-alerts-sync.mjs` and its workflow;
   run it with `--dry-run` first. It creates issues only with `--apply`.
8. **Schedule the steward.** Copy `steward.mjs` and its workflow. It opens one
   rolling issue with evidence-backed questions. It never closes anything.
9. **Tune allowlists with an expiry.** Every exception gets a rule id, a reason,
   an owner and an `expires` date. Expired entries fail.
10. **Keep the gates honest.** A new defect gets a detector before it gets a
    fix. A gate is weakened only by a reviewed change to the gate itself, never
    by an inline bypass.

## What this repository deliberately does not include

- Project-specific test commands, build steps, UI selectors or deployment
  targets. Those belong in the adopting repository.
- A hosted service, database or SaaS dependency.
- An LLM API key in CI. The steward's scheduled job produces deterministic
  evidence; judgment runs in an agent session with a human decision.
- Donor names, internal hostnames, credentials or company-specific wording.

## License

MIT. See `LICENSE`.
