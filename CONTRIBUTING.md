# Contributing

## What belongs here

- A failure mode that keeps recurring, stated as an observable symptom.
- A mechanical counter that fails a build or a pull request without human
  interpretation.
- A role boundary that prevents one agent from being both author and judge.
- A sanitized method that another repository can apply without knowing ours.

Project-specific examples are welcome under `examples/` only. Do not add a
provider name, internal hostname, customer name or credential.

## Propose a new gate

Open an issue using the task form. The proposal must answer:

1. **Failure mode.** What goes wrong today, and how would a reviewer see it?
2. **Counter.** Which command, exit code or required field catches it?
3. **False positives.** What legitimate change would fail? How is it
   allowlisted, with what expiry?
4. **Fixture.** A minimal passing and failing case, committed as test data.
5. **Rollout.** Which repositories adopt it first; is it advisory or required?
6. **Owner.** Who answers when the gate is wrong?

A gate without a failing fixture is a wish, not a gate.

## The rules a gate must follow

- **Fail loud.** A missing config, unreadable file or empty selector is an
  error, not a zero. "No findings" must mean "the check ran and found none".
- **One source of truth.** Counts, paths, labels and milestones come from
  config or data files. Do not copy a literal into a second script.
- **Shrink-only allowlists.** Every exception has a rule id, a reason, an owner
  and an `expires` date. Expired entries fail. An allowlist never covers a
  whole file when a line match would do.
- **No per-change bypass.** A gate is changed by a reviewed change to the gate,
  with a fixture that demonstrates the new behavior. Comments like
  `// gate-ignore` are not a mechanism.
- **Deterministic.** The check must not depend on a network service that can
  silently disappear, an LLM's opinion, or the order of a directory listing.
  If it fetches, it must distinguish "unavailable" from "clean".
- **Portable.** Node built-ins and `gh` only for the core scripts. No `npm
  install` for a template that an adopting repository must run.

## Change the process

A change to `docs/process.md`, `docs/roles.md`, `docs/gates.md` or a workflow
needs:

- the problem it fixes;
- the old and new behavior;
- the migration for an adopting repository;
- a note in the PR's `## Risk and rollback` section.

Process-only pull requests may use `Task: none — <reason>`.

## Sanitization checklist

Before opening a pull request, run:

```sh
git grep -inE 'donor-name|internal\\.example|example-corp|your-company' || true
node templates/check-forbidden-literals.mjs --self-test
node templates/check-process.mjs --self-test
node examples/mutation/run-selftest.mjs
```

Replace any hit with a placeholder such as `ref-site-a`, `example.test` or
`OWNER/REPO`.

## Commits and review

- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- No AI attribution trailers. The commit author is the person who made the
  change.
- The author does not approve their own pull request. A different agent or
  person reviews the diff, the spec and the evidence bundle.
- Tests that judge a change are owned by the tester role. The developer does
  not edit them to make a build pass.
