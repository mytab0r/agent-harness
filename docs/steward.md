# Steward

The steward is a scheduled relevance check. It does not finish work, close
issues or reprioritize anything. It produces a short list of evidence-backed
questions so a person can decide what still matters.

Most backlog hygiene fails because the question is never asked: an epic is old,
its premise changed, its blocker is closed, or it never had a definition of
done. The steward asks those questions every week.

## What runs

`steward.mjs` runs on a schedule (default: Monday 06:17 UTC) and creates or
updates one rolling issue with the hidden marker `<!-- steward-report -->`.

It reads:

- open issues, their labels, milestones, assignees and body;
- open pull requests, their last activity and check conclusions;
- change folders under `changesDir` and their `proposal.md`.

It asks, with evidence:

- **Staleness.** An issue or pull request has no activity beyond `staleDays`.
  Is it still relevant?
- **Missing acceptance.** An issue has no `Acceptance` / `Done when` section
  with content. What observable result means done? (Bug and security issues are
  exempt by default.)
- **Overdue milestone.** The due date passed while the issue is open. Keep,
  move the milestone, or close.
- **Closed blocker.** The body says "blocked by #N" and #N is closed. Can this
  start now?
- **Likely duplicate.** Two open titles have a Jaccard similarity above the
  configured threshold. Merge or keep both?
- **Spec drift.** A change folder is old, has no proposal, or its proposal has
  no out-of-scope or acceptance section.

## What it may not do

- Close, merge, reprioritize or move a milestone.
- Edit an issue a human edited in the last 24 hours.
- Comment repeatedly with the same question. The report is one rolling issue,
  not a stream of comments.
- Invent a status. If the evidence is missing, the report says "unknown".
- Judge product direction without the owner. It can recommend "close"; the
  owner decides.

## The steward agent

`agents/steward.md` is the judgment layer. On a session, the agent reads the
report and:

1. checks each question against the current spec and repository;
2. closes only a provable duplicate, with a comment naming the duplicate and
   the evidence;
3. returns everything else as a recommendation: keep / reprioritize / close /
   merge;
4. never closes assigned work, work with an open pull request, or work with a
   hold label;
5. closes no more than 10 items in one pass.

The script produces the questions; the agent adds judgment; the owner makes the
decision.

## Commands

```sh
node scripts/steward.mjs --dry-run
node scripts/steward.mjs --apply
node scripts/steward.mjs --self-test
```

Configuration: `.github/steward.json`.

```json
{
  "staleDays": 30,
  "maxQuestions": 25,
  "acceptanceExemptLabels": ["bug", "security", "security-alert"],
  "labels": { "steward": "steward", "hold": ["owner-decision", "pinned"] },
  "changesDir": "specs/changes",
  "duplicateThreshold": 0.8
}
```

## Tuning

- If the report is noisy, raise `staleDays` or `duplicateThreshold`; do not
  remove the question class.
- If a legitimate issue type has no acceptance section, add its label to
  `acceptanceExemptLabels`, with a reason in the repository docs.
- Keep `maxQuestions` small enough that the owner can decide the list in a few
  minutes. A report nobody reads is worse than no report.

## Limits

- Title similarity catches wording duplicates, not the same defect described
  with different words. The agent and the PM still read the bodies.
- The script cannot know whether a product direction changed. That is the
  owner's call.
- A green steward run means the report was written, not that the backlog is
  healthy.
