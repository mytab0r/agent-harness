---
name: ui-self-review
description: Run the project's deterministic UI audit before claiming a UI change is done. Use for any page, component, CSS or front-end change. Catches overflow, tiny text or targets, unlabeled icon controls, duplicated components, half-empty blocks and route parity regressions. Not for backend-only work.
---

# UI self-review

A UI change is not done because it looks right in one browser at one width. It
is done when the project's deterministic audit passes on the affected routes at
375, 768 and 1280 in both themes, and a different agent has checked the
rendered result.

This skill assumes the adopting repository provides an audit command (for
example `scripts/ui-audit.mjs`). The method is portable; the selectors and
thresholds are project configuration.

## 1. Query the design rules first

Before designing or restructuring a page, query the installed design guidance
for the specific problem (one intent, two to five terms). Apply the answer; do
not paste generic guidance into the page.

```sh
# Example; use the design guidance your environment provides.
python "$HOME/.claude/skills/ui-ux-pro-max/scripts/search.py" "<page or problem>" --domain ux
```

## 2. Run the deterministic audit

```sh
# Against a running local server.
node scripts/ui-audit.mjs

# Or let the audit start the project.
node scripts/ui-audit.mjs --serve

# Narrow loop while fixing.
node scripts/ui-audit.mjs --serve --routes example --viewports 375,1280 --themes dark
```

The audit must exit non-zero on a violation. A warning is not a pass. If the
harness itself cannot run, that is an error, not a clean result.

## 3. Read every violation

Log every violation id and fix it at the shared level: the component, token or
helper that owns the family. Do not add a page-local override.

Thresholds (adapt to the project, do not tune per page):

- **Touch target:** visible control below 44x44, except inline prose links.
- **Small text:** visible text below 12px, except hidden/aria-hidden text.
- **Overflow:** `document.scrollWidth > document.clientWidth`.
- **Clipping:** a control outside its card's padding box without a scrollable
  ancestor.
- **Half-empty block:** a card or section taller than 220px where visible
  children cover less than 55% of the content box.
- **Duplicate controls:** two visible controls with the same accessible name or
  destination in one section.
- **Raw path or URL as a label:** link text is human-readable; the path belongs
  in `href`/`title`.
- **Ragged columns:** cards in one visual row differ by more than 15% in width.
- **Zero is not data:** a selector that matches nothing is an error, not a
  measured zero.

## 4. Fix the class, not the page

- One defect seen twice becomes a shared component or token change. Do not add
  `body.<page> .card { ... }`.
- Keep one grammar for buttons, fields, cards, stats, tables and status pills
  across the whole route family.
- If a threshold is genuinely noisy, change it in the audit together with a
  comment explaining the measurement, and say so in the PR. Never add a
  per-page bypass.
- Do not weaken row counts, duplicate-control checks or route-coverage checks to
  make a run green.

## 5. Evidence bundle

The author attaches, and the reviewer checks:

1. The audit command, routes, viewports and themes covered.
2. The audit's JSON report and screenshots as CI artifacts. Do not commit
   screenshots or test evidence to the repository.
3. Computed geometry for affected controls and cards: `getBoundingClientRect()`,
   `scrollWidth` vs `clientWidth`, `scrollHeight` vs `clientHeight`, and the
   nearest ancestor with `overflow` not `visible`.
4. A worst-case data pass: long names, unbreakable strings, one-letter names,
   missing fields, zero items, huge counts, non-Latin text, emoji.
5. Every remaining violation, or "none", with a reason for any accepted
   deviation.

## 6. Independent review

- The author never signs off their own UI change.
- A different agent opens the built page at 375/768/1280 in both themes,
  screenshots the affected blocks, and pastes the geometry into the PR.
- Self-reported "audit passed" is not evidence. The reviewer opens the artifact.

## 7. Defect to detector

Every defect, whether found by the owner or a reviewer, gets a detector before
it gets a fix:

1. Add or extend a check in the audit or another gate.
2. Add the detector id to the defect ledger with a reason.
3. Add the rule to the project's agent instructions.
4. Run the ledger check.

A fix whose detector is missing is not done.

## Done check

- [ ] Audit exits 0 on the affected routes, including non-default routes.
- [ ] Evidence bundle is linked from the PR.
- [ ] Reviewer is not the author and has opened the rendered page.
- [ ] Worst-case data rendered, not only the happy path.
- [ ] Light and dark, 375/768/1280, keyboard and reduced motion checked.
- [ ] Every fixed defect has a detector and a ledger entry.
- [ ] No screenshots or test evidence were committed.
