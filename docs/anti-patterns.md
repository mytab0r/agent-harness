# Anti-patterns

Each row names an observable failure and a mechanical counter. If a counter is
missing, the failure is a review question, not a gate.

| # | Anti-pattern | Symptom | Mechanical counter | Enforced by |
|---|---|---|---|---|
| 1 | **Fake-green test** | The test passes before and after the change, or the author edits the assertion until it agrees with the code. | Revert the non-test change and require the test to fail. | `mutation/revert-fix.mjs`; `NOT-CAUGHT` fails the PR contract. |
| 2 | **Self-review** | The author reads its own diff and approves. | Require `Author:` and `Reviewer:` lines with different identities. | `check-process.mjs`. |
| 3 | **Spec-less code** | Work starts from a prompt; no acceptance criteria or out-of-scope. | Require a change folder and an issue with acceptance before implementation. | `docs/process.md`; issue forms; Gate 1. |
| 4 | **Untracked delivery** | Work exists in a chat and a branch, not on the board. | Require `Task:` and `Closes` in the PR; sync epics and sub-issues from `tasks.md`. | `check-process.mjs`; `sync-board.mjs`. |
| 5 | **Author edits judging tests** | The developer changes the expected value to match the bug. | The tester owns the tests; the review checks the test diff. | `docs/roles.md`; PR checklist. |
| 6 | **Test-only PR claimed as proof** | A PR changes only tests and claims mutation proof. | Report `NOT-APPLICABLE`, not `PROVEN`. | `revert-fix.mjs`. |
| 7 | **Mutation score as a target** | The team optimizes a percentage instead of asking whether tests detect behavior. | Tier 2 is evidence, not a score to maximize; tier 1 is the required proof. | `docs/gates.md`. |
| 8 | **Gate weakening** | A threshold drops or a per-page bypass appears to make a run green. | Gate changes require a fixture and a reviewed change to the gate. | `CONTRIBUTING.md`; `docs/gates.md`. |
| 9 | **"CI is green" as done** | The author stops at a passing pipeline without checking the artifact. | Definition of done requires observed evidence and independent review. | `docs/process.md`; PR template. |
| 10 | **Giant PR** | A refactor and a behavior change land together; review is impossible. | Keep one change per PR; large work goes through a branch and a spec. | `docs/working-rules.md`. |
| 11 | **Secrets in fixtures** | A token, key or customer value is committed "for the test". | Forbidden-literal rules and allowlists with an expiry; fixed vectors only in tests. | `check-forbidden-literals.mjs`; `docs/working-rules.md`. |
| 12 | **Stale docs** | The behavior changes; the spec and generated docs do not. | Docs freshness is part of the PR contract and the archive step. | `docs/process.md`; `docs/gates.md`. |
| 13 | **Alert fatigue** | Alerts pile up with no owner or deadline. | Route each alert to one issue with severity, SLA and a marker; close when it resolves. | `security-alerts-sync.mjs`. |
| 14 | **Background agent leak** | A nested agent spawns processes that outlive the session. | Use role agents without `Agent` for background work; sweep processes before ending. | `docs/roles.md`; `docs/working-rules.md`. |
| 15 | **Donor copying** | A reference site's names, domains or layout are copied into the product. | Forbidden-literal guard; measurement reports use `ref-site-a`; density is evidence, not a target. | `check-forbidden-literals.mjs`; `skills/donor-reverse`. |
| 16 | **Duplicate UI controls or raw URL labels** | Two controls do the same job; a link shows `https://...` as its text. | UI audit detectors for duplicate controls, raw-path labels and raw URLs. | `skills/ui-self-review`; project audit. |
| 17 | **Empty selector is read as zero** | A measurement reports `0` because the selector matched nothing. | Report `selector_matched_nothing` and `null`, not `0`; require an explicit opt-in for an empty page. | `skills/donor-reverse`; project measurement script. |
| 18 | **Silent config fallback** | A missing config makes a gate pass with defaults. | Fail loud on missing required config; distinguish "not configured" from "clean". | All scripts; `docs/gates.md`. |
| 19 | **Unbounded retry** | A failing step is retried in a loop until it accidentally passes. | Diagnose the cause; bounded retries with a recorded reason. | `docs/working-rules.md`. |
| 20 | **Stale board** | Issues have no type, milestone, priority or plan dates. | Daily sync and `--verify`; missing fields fail the monitor. | `sync-board.mjs`; `docs/board.md`. |

## How to use this table

- When a defect recurs, find its row. If the row has no mechanical counter, add
  one before fixing the defect again.
- When you add a gate, add the failure mode it prevents to this table.
- A counter that produces false positives without an expiry becomes noise.
  Tune the allowlist, not the definition of the failure.
