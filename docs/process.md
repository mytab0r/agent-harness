# Process

The process is a loop with two gates and one archive step. It exists to stop
four failures: a test that cannot fail, self-review, code without a spec, and
work that exists only in a chat.

## 0. Intake

A non-trivial change starts with an issue that has:

- a problem statement;
- observable acceptance criteria;
- an explicit out-of-scope;
- an area and a priority;
- a task key, `<PREFIX>-<issue number>`.

The issue is not the plan. It points at a spec change folder.

## 1. Propose

The analyst writes:

```text
specs/changes/<change-id>/
  proposal.md   # problem, scope, out-of-scope, acceptance, risks
  design.md     # optional; required when there is a real trade-off
  tasks.md      # sections, checkboxes, blocked-by
  specs/<domain>/spec.md
```

A section in `tasks.md` is the unit that becomes a sub-issue. It has one owner,
a checkbox list and an optional `(blocked by: ...)` line. If frontend and
backend can move independently, they are separate sections.

A proposal with no testable acceptance criterion is not ready.

## 2. Gate 1: tests before code

The tester writes the acceptance tests first. They must fail on the current
code for the right reason; the failure is recorded.

The critic reviews the proposal, design, tasks and delta specs before any
product code is written:

- Does the proposal answer why/what/out-of-scope?
- Does the design record the chosen and rejected approach?
- Are the tasks small enough to assign?
- Do the delta specs merge into the source of truth?
- Are the criteria testable?

Both gates pass before implementation starts.

## 3. Implement

The developer takes one section and implements the smallest change that
satisfies it.

Rules:

- The developer does not edit the tests that judge the change. If a test must
  change, the tester changes it.
- The developer does not add behavior outside the proposal, design or delta
  specs. A new step goes into `tasks.md` and is reviewed.
- The developer runs the project's verification commands and the universal
  mutation tier after the last edit.
- A red test stops the work. It is not deleted, skipped or weakened.

## 4. Gate 2: verify and review

The tester runs the acceptance tests and the relevant regression suite. PASS
means a real run with output, not a reading of the diff.

The critic reviews the implementation against the proposal, design and delta
specs. The critic is a different context from the developer and receives the
diff, the spec and the evidence bundle, not the author's justification.

The independent review is mandatory. The author may not approve its own work,
even when every automated gate is green.

## 5. Pull request

The PR body follows `.github/pull_request_template.md`:

- `Summary` — what and why.
- `Task` — the key and a closing reference, or `Task: none — <reason>` for a
  docs/process-only change.
- `Verification` — the commands run and their observed result.
- `Mutation proof` — universal output first, adapter output when present.
- `Risk and rollback` — what can break and how to undo it.
- `Review` — author and a different reviewer.

The process-contract check fails a body with missing sections, placeholders,
`NOT-CAUGHT` mutation proof, a self-review, or a product path under
`Task: none`.

## 6. Archive

The librarian:

1. merges the delta specs into `specs/<domain>/spec.md`;
2. moves the change to `specs/archive/<id>/`;
3. verifies every task checkbox is closed;
4. updates the repository map or README when a new domain appeared;
5. writes a memory note only when the decision is not obvious from the code;
6. removes temporary artifacts and stale worktrees.

A change with an open task is not archived.

## Definition of done

A change is done when all of these are true:

1. Every task checkbox is closed.
2. Every acceptance criterion has observed evidence.
3. The universal mutation tier reports `PROVEN` or a justified
   `NOT-APPLICABLE`.
4. A reviewer other than the author approved.
5. The PR contract passes.
6. The delta specs are in the source of truth.
7. The documentation matches the behavior.

"CI is green" is not on the list. It is a precondition, not the definition.

## Exceptions

A trivial change — a typo, a comment, a one-line docs correction with no
behavior change — may skip the spec folder. It still needs a verification line
and an independent review. Any change to product behavior needs a spec, even if
the diff is small.

If a gate is wrong, change the gate in a reviewed pull request with a fixture
that demonstrates the new behavior. Do not add an inline bypass.

## Handoff artifacts

| From | To | Artifact |
|---|---|---|
| analyst | tester/critic | proposal, design, tasks, delta specs |
| tester | developer | failing acceptance tests + failure output |
| developer | tester/critic | diff, verification output, mutation proof |
| tester/critic | owner | PASS/FAIL and findings with evidence |
| librarian | repository | merged specs, archive folder, updated docs |
