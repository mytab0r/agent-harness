# Case note: applying the harness to an existing repository

This is an honest note from one adoption. It is not a benchmark. Numbers are
rounded and the repository is described generically.

## Context

A production repository with:

- a Rust service and a static JavaScript frontend;
- a CI that ran unit tests and a deterministic UI audit;
- GitHub Issues and a Projects v2 board;
- several agents working in the same checkout over a week.

The team already had a spec folder, role prompts and a UI audit. The problem was
not a missing tool. It was that the loop could finish on the author's own claim.

## What was failing

1. **Tests passed for the wrong reason.** A change fixed a parser bug and added
   a test. The test passed before the fix too, because it asserted a different
   branch. Nobody checked whether the test could fail.
2. **The author reviewed the author.** The agent that built the page ran the UI
   audit, read its own diff and declared it done. The audit caught overflow and
   small targets, but not a ragged two-column split or a control clipped by an
   ancestor.
3. **The board lagged.** Epics and sub-issues were created by hand, often after
   the work had already merged. Some issues had no type, milestone or priority.
4. **Security alerts had no owner.** Code-scanning findings sat open until
   someone remembered to look.

## What was installed, in order

1. **Process contract.** A PR template with six sections and a checker. The
   first version was too strict: it treated every Markdown file as docs-only
   and blocked a product README change. The docs-only globs were corrected; the
   gate stayed.
2. **Universal mutation tier.** Configured with the project's test command and
   test globs. First run on an existing branch: 5 changed files, 2 reported
   `NOT-CAUGHT`. Both tests asserted behavior that did not depend on the fix.
   The tester rewrote them; the next run was `PROVEN`.
3. **Independent review.** A different agent opened the built pages at 375,
   768 and 1280 in both themes and pasted computed geometry. It found three
   clipped controls and one ragged row that the deterministic audit did not
   report. The author had approved the same page an hour earlier.
4. **Board sync.** The sync created one epic per change and one sub-issue per
   task section, with native links and dependencies. The first dry run showed
   two changes with no `tasks.md`; both were archived instead of tracked.
5. **Security routing.** The first run created two issues from code-scanning
   alerts and one from a dependency advisory. One secret-scanning source was
   unavailable; the report said so instead of reporting "clean".
6. **Steward.** The first weekly report asked 11 questions. The owner closed 3
   stale items, reprioritized 2 and added acceptance criteria to 4. The
   remaining 2 needed a product decision and stayed open.

## What the numbers looked like

- Mutation tier 1: 2 of 5 changed files were `NOT-CAUGHT` on the first run.
- Independent UI review: 3 clipped controls and 1 ragged row the audit missed.
- Board sync: 17 issues created in the first apply; a second apply created 0.
- Security routing: 3 issues created; 1 source unavailable and reported.
- Steward: 11 questions, 9 decided in one sitting, 2 deferred.
- Process contract: 4 PRs failed on the first attempt; all 4 were missing a
  verification command or had a placeholder in the body.

## What did not work

- **Mutation tier 2 stayed disabled.** The repository had no per-language
  mutation tool configured. Tier 1 was enough to catch the two fake-green
  tests, and enabling a tool would have added a CI dependency before the team
  trusted the gate. Tier 2 remains an option, not a requirement.
- **The steward cannot judge product direction.** It can prove that an epic is
  old, has no acceptance and has no open dependency. It cannot know that the
  product bet changed. The owner still has to read the list.
- **The first process contract was noisy.** It rejected a docs-only PR that
  touched a product README. The fix was to make the path rule explicit, not to
  add a bypass. The checker's own self-test now includes a docs-only case.
- **The UI audit was necessary but not sufficient.** It measured thresholds.
  The independent reviewer found composition problems that no threshold
  captured. Both are needed.
- **The board sync is GitHub-specific.** The text convention is
  provider-neutral, but the template adapter uses GitHub Issues and Projects.
  A Bitbucket or Jira adapter is a separate implementation, not a configuration
  flag.

## Lessons

1. **Start with tier 1.** It works in any language and finds the cheapest
   failure: a test that never asserted the change.
2. **Make one gate required at a time.** A new gate that blocks every PR on day
   one gets disabled on day two. Run it advisory, fix the false positives, then
   make it required.
3. **Keep allowlists shrink-only.** Every exception needs a rule id, a reason,
   an owner and an expiry. An allowlist without an expiry becomes policy.
4. **Do not let the author review.** The most valuable finding in this adoption
   came from a reviewer who had not read the author's reasoning.
5. **Measure the false positives.** A gate that is right but noisy loses
   adoption. The process contract failed 4 of the first 10 PRs; two were real
   omissions and two were template confusion. The template was clarified before
   the gate was made required.
6. **Report what did not run.** "Source unavailable" and "not applicable" are
   results. A silent skip is a lie.

## What was left project-specific

- The test command, test globs and runtime setup.
- The UI audit selectors, thresholds and route matrix.
- The area list, milestone dates and project number.
- The security source permissions and token scopes.
- The product's definition of done, which lives in its specs, not here.

The harness supplies the contracts and the scripts. The adopting repository
supplies the domain.
