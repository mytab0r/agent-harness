## Summary

<!-- One paragraph: what changed and why. Link the spec change. -->

## Task

<!-- Product PR: key + closing reference. Docs/process-only PR:
     Task: none — docs: <reason> -->

Task: TASK-<n>
Closes #<n>

## Verification

<!-- Paste the command(s) you ran and the observed result. A command that
     exited 0 is not proof; show what it proved. -->

```text
$ <command>
<output>
```

## Mutation proof

Universal tier (`node mutation/revert-fix.mjs --base origin/main`):

```text
universal-mutation: <paste the output of the universal tier here>
```

Adapter tier (`node mutation/run-adapters.mjs --base origin/main`), when an
adapter is configured:

```text
adapter-mutation: <paste the output, or NONE-MATCHED>
```

<!-- Expected universal shape:
universal-mutation: PROVEN
  base: origin/main
  reverted: <non-test files>
  kept: <test files>
  test: <test command>
  baseline: exit 0
  after revert: exit 1 (expected failure)
-->

<!-- `NOT-CAUGHT`, `BASELINE-RED`, `ERROR`, `FAILED` and `MISSING-TOOL` fail
     the process contract. A test-only PR reports NOT-APPLICABLE. -->

## Risk and rollback

<!-- What can break, who is affected, and the exact rollback step. -->

## Review

<!-- The reviewer must be a different identity from the author. Paste the
     reviewer's evidence or artifact link, not the author's reasoning. -->

Author: @<author>
Reviewer: @<reviewer>

- [ ] The reviewer is not the author.
- [ ] The reviewer read the spec/acceptance criteria, not only the diff.
- [ ] Verification output was produced after the last edit.
- [ ] Universal mutation proof is attached and is not `NOT-CAUGHT`.
- [ ] No test that judges this change was edited by the author.
- [ ] Docs/specs are updated in this PR.
- [ ] No secrets, tokens, customer data or internal hostnames are included.

## Checklist for UI changes

- [ ] Audit passes on affected routes at 375/768/1280 in light and dark.
- [ ] Screenshots/report are CI artifacts, not committed files.
- [ ] Worst-case data rendered; keyboard and reduced motion checked.
- [ ] Every fixed defect has a detector and a ledger entry.
