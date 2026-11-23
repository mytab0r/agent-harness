# Roles

The roles are boundaries, not job titles. The point is that the entity that
writes a change is not the entity that judges it.

## Matrix

| Role | Writes | May edit judging tests? | May approve? | Default tools |
|---|---|---|---|---|
| analyst | proposal, design, tasks, delta specs | no | no | read, search, fetch |
| tester | acceptance tests, gate reports | **yes, owns them** | yes (gate) | read, write tests, run commands |
| developer | product code | **no** | no | read, edit, write, run commands |
| critic | findings | no | yes (review) | read, search, run read-only commands |
| orchestrator | coordination, decisions | no | no (delegates review) | agents, read, write coordination files |
| librarian | specs, docs, archive | no | no | read, write docs, run commands |
| pm | backlog comments and labels | no | no | read, search, run `gh` |
| steward | rolling relevance report | no | no | read, search, run `gh` |

"May edit judging tests" means the tests that decide whether the change is
correct. A developer may add a local probe or a temporary test, but it must be
handed to the tester before merge and cannot replace or weaken the acceptance
tests.

## Hard rules

1. **The author never approves its own change.** If the same identity wrote the
   code and signed off, the review did not happen.
2. **The author never edits the tests that judge the change.** The tester owns
   them. If an assertion must change, the tester changes it and records why.
3. **The reviewer receives the diff, the spec and the evidence — not the
   author's reasoning.** Reading the author's justification first anchors the
   review.
4. **The tester does not edit product code.** If the fix is obvious, the tester
   reports it; the developer applies it.
5. **The critic does not edit code or tests.** The critic reviews; the author
   reworks.
6. **The orchestrator does not hand-code.** Code edits, test runs and
   multi-step diagnosis go to a role agent. The orchestrator keeps gate
   decisions and evidence synthesis.
7. **PM and steward propose; the owner decides.** They may close a provable
   duplicate with evidence. They may not close assigned work, work with an open
   PR, or work with a pending-owner label.
8. **Nested agents never go to the background.** An agent whose tool set
   includes `Agent` can spawn children that outlive the session. Use it in the
   foreground, or use a role agent without `Agent`.
9. **The librarian archives only a finished change.** Open tasks mean the
   change is not archived.

## Escalation

- A disagreement about scope goes to the analyst and the owner, not to the
  developer's judgment.
- A disagreement about correctness goes to the tester with a reproducible case.
- A disagreement about relevance goes to the owner, with the steward's evidence.
- A security finding goes to the security owner immediately; it does not wait
  for the normal review queue.
- If a gate is wrong, propose a change to the gate. Never add a per-change
  bypass.

## Why the split exists

A single agent can write code, write the test, run the test and approve the
result. Every step is green, and the change can still be wrong. The split makes
at least one step independent:

- the tester writes the test before the implementation;
- the mutation tier proves the test can fail;
- the critic reviews without the author's reasoning;
- the process contract requires two identities.

None of these prove quality by itself. Together they make the cheap failure
modes visible.
