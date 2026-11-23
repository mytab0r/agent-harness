# Mutation proof

The harness has two tiers. The universal tier works in any language and needs
no mutation tool. The adapter tier adds per-language, per-mutant evidence and
is optional.

## Tier 1 — universal

`revert-fix.mjs` compares the pull request with its base, keeps test files,
reverts the non-test hunks, runs your test command, and requires it to fail.
That proves the tests detect the change. It restores the tree in a `finally`
block.

```sh
node mutation/revert-fix.mjs --base origin/main
node mutation/revert-fix.mjs --base origin/main --dry-run
```

Configuration: `mutation/config.json`.

```json
{
  "testCommand": ["node", "test/all.test.mjs"],
  "testGlobs": ["**/*.test.mjs", "tests/**"],
  "ignoreGlobs": ["docs/**", "specs/**", "**/*.md", ".github/**"],
  "timeoutMs": 120000,
  "allowDirty": false
}
```

`ignoreGlobs` are paths that cannot affect the test command (docs, specs,
workflow files). A pull request that changes only tests, docs or process files
is `NOT-APPLICABLE`, not `NOT-CAUGHT`.

Output contract:

| Token | Meaning | Exit |
|---|---|---|
| `PROVEN` | The test failed after the non-test change was reverted. | 0 |
| `NOT-APPLICABLE` | Only test files changed; nothing to revert. | 0 |
| `NOT-CAUGHT` | The test stayed green. This is a failure. | 1 |
| `BASELINE-RED` | The test was already failing before the revert. | 1 |
| `ERROR` | The proof could not run: dirty tree, bad base, missing command. | 2 |
| `DRY-RUN` | The selected files were printed; nothing was executed. | 0 |

### Limits

- It needs a clean working tree and a configured test command.
- It runs one test command, not a per-test mutation. A broad command can pass
  because an unrelated test fails, and a flaky test can produce a false
  `PROVEN`. Treat a `PROVEN` from a flaky suite as unproven.
- It does not prove that the test is a good test; it proves that reverting the
  change makes the suite fail.
- A test-only or docs/process-only PR is `NOT-APPLICABLE`, not `PROVEN`.

## Tier 2 — adapters

`run-adapters.mjs` reads `mutation/adapters.json` and runs only enabled adapters
whose globs match the changed files. Each adapter gets a temporary diff and the
matched paths.

```sh
node mutation/run-adapters.mjs --base origin/main
node mutation/run-adapters.mjs --base origin/main --list
node mutation/run-adapters.mjs --base origin/main --only rust-cargo-mutants --dry-run
```

Adapter shape:

```json
{
  "id": "rust-cargo-mutants",
  "enabled": true,
  "globs": ["**/*.rs"],
  "command": ["cargo", "mutants", "--in-diff", "{diff}", "--timeout", "120"],
  "install": "cargo install cargo-mutants --locked",
  "proves": "per-mutant survival in the changed Rust code"
}
```

Placeholders: `{diff}`, `{files}`, `{base}`, `{repoRoot}`.

Output: `adapter-mutation: NONE-MATCHED`, `adapter-mutation: <id> PASS|FAIL|MISSING-TOOL|ERROR`,
then `adapter-mutation: PASSED|FAILED`.

### Adding an adapter for a new language

1. Find a mutation generator that can run on only the changed files.
2. Add an entry with `enabled: false` and the exact `install` command.
3. Run `--dry-run` and then `--only <id>` on a real branch.
4. Enable it only after the command is reproducible in CI.
5. Add the tool installation to `.github/workflows/mutation.yml`.

Tier 2 never replaces tier 1. A repository with no adapters still gets the
universal proof.

## What the PR must show

The `## Mutation proof` section shows the universal output first and the
adapter output when present:

```text
universal-mutation: PROVEN
  ...
adapter-mutation: NONE-MATCHED
```

`NOT-CAUGHT`, `BASELINE-RED`, `ERROR`, `FAILED` and `MISSING-TOOL` fail the
process contract.
