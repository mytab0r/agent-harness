# Gates

A gate is a check that can fail a pull request without a human interpreting
the result. Everything else is a review aid.

| Gate | Runs | Fails when | Why it exists |
|---|---|---|---|
| Process contract | Every PR | A required section, task key, closing reference, verification evidence, mutation proof or independent reviewer is missing. | Stops untracked, evidence-free delivery. |
| Project tests | Every PR | The project's test command fails. | The baseline correctness signal. |
| Mutation tier 1 (universal) | Every PR | Reverting the non-test change leaves the test green; or the test was already red; or the tree is dirty. | Proves the test can fail. |
| Mutation tier 2 (adapters) | Every PR, when enabled | An enabled adapter for a changed language fails or cannot run. | Adds per-mutant, per-language evidence. |
| Forbidden literals | Every PR | A configured literal appears outside an unexpired allowlist. | Stops donor identities, internal hosts and token-like strings leaking into a public repository. |
| Security alert routing | Daily | A write fails, or an alert is older than its SLA with `--enforce-sla`. | Keeps findings owned and triaged. |
| Board sync | Daily | The sync cannot run, or `--verify` finds a managed issue without a milestone, project item or required field. | Keeps delivery visible and the plan honest. |
| Steward | Weekly | The report cannot be produced or written. It never closes work. | Challenges relevance with evidence. |
| UI audit | Every UI PR | The project's deterministic UI audit reports a violation. | Catches overflow, tiny targets, duplicate controls and broken states. |
| Defect ledger | Every PR | A fixed defect has no detector or ledger entry, or a detector id is unknown. | Turns a fix into a rule. |
| Docs freshness | Every behavior change | The spec or generated docs disagree with the code. | Stops silent drift. |

## Mutation: two tiers

### Tier 1 — universal, language-agnostic

`mutation/revert-fix.mjs`:

1. Requires a clean working tree and a configured test command.
2. Computes the diff `base...HEAD`.
3. Keeps files whose paths match `testGlobs` and reverses the other file
   hunks.
4. Runs the test command and requires a non-zero exit.
5. Restores the tree in a `finally` block and verifies it is clean.

The output token is the contract: `PROVEN`, `NOT-APPLICABLE`, `NOT-CAUGHT`,
`BASELINE-RED`, `ERROR` or `DRY-RUN`.

**What it proves:** reverting the production change makes the test suite fail.
That is the cheapest useful proof that the test is connected to the change.

**Limits:**

- It needs a test command and a clean tree. A repository with no test command
  cannot use tier 1; the `ERROR` is loud, not a silent skip.
- It is coarse. It runs one command, not a per-test mutation. A broad command
  can fail because an unrelated test fails, and a flaky test can produce a
  false `PROVEN`.
- It does not prove the test is a good test, only that the suite notices the
  revert.
- A test-only or docs/process-only PR is `NOT-APPLICABLE`, not `PROVEN`.
  `ignoreGlobs` decides which paths cannot affect the test command.
- If a test imports a newly added production file, reverting the file makes the
  test fail with an import error. That counts as `PROVEN`; review the output so
  the failure is the assertion, not a missing module.

**Why it is first:** it works in every language, needs no mutation tool, and
catches the most common fake-green pattern — a test that never asserted the
changed behavior.

### Tier 2 — adapters

`mutation/run-adapters.mjs` reads `mutation/adapters.json` and runs only the
enabled adapters whose globs match the changed files. Each adapter receives a
temporary diff and the matched paths. Supported examples in the template:
cargo-mutants, Stryker, mutmut, PIT and go-mutesting.

**What it adds:** per-mutant survival and per-test granularity inside the
changed files.

**Rules:**

- Every adapter is optional and disabled by default.
- An enabled adapter whose tool is missing reports `MISSING-TOOL` and fails;
  it does not silently skip.
- Tier 2 never replaces tier 1. A repository with no adapters still gets the
  universal proof.
- The PR template shows the universal output first and the adapter output when
  present.

### Adding a language

1. Configure `testCommand` and `testGlobs` so tier 1 can run.
2. Add an adapter entry with `enabled: false`, its globs, its command and its
   install command.
3. Run `--dry-run` and `--only <id>` on a real branch.
4. Add the tool installation to `.github/workflows/mutation.yml`.
5. Enable it only when the command is reproducible in CI.
6. Record what the adapter proves in its `proves` field.

## What CI cannot prove

- **That the reviewer thought.** The contract proves two identities signed off.
  It does not prove the review was independent in spirit. That is why the
  reviewer receives the diff, the spec and the evidence, not the author's
  reasoning.
- **That the requirements are right.** A spec can be internally consistent and
  still solve the wrong problem. The steward and the owner challenge relevance.
- **That the test is meaningful.** Mutation proof shows detection, not coverage
  of edge cases. The tester owns the acceptance criteria.
- **That the rendered page looks right.** A deterministic audit measures
  thresholds; a second agent must open the page at the target widths and paste
  the geometry.
- **That a third-party alert is a real vulnerability.** Routing creates an
  owner and a deadline; a person still triages the finding.

## Required checks

Make these required in branch protection after the first successful run:

1. `process contract`
2. `mutation tier 1 (universal)`
3. The project's test and build checks

Tier 2 becomes required when an adapter is enabled. The scheduled board,
security and steward jobs are monitors, not PR checks.

## Changing a gate

A gate change is a reviewed change to the gate itself:

1. State the failure mode the gate misses.
2. Add a fixture that fails before the change and passes after it.
3. State the false positives and how the allowlist handles them, with an
   expiry.
4. Update the docs and the detector registry.
5. Roll it out as advisory first, then required.

Never add an inline bypass. Never weaken a threshold to get one run green. An
allowlist entry needs a rule id, a reason, an owner and an expiry date.
