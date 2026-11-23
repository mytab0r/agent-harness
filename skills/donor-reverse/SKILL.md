---
name: donor-reverse
description: Reverse-engineer a reference site's density and decide what to change on the equivalent page. Use when someone asks why a reference site is tighter, what fits above the fold, or what to add, remove or compact. Produces a measured reference-vs-ours table, per-block deltas and a change list with pixel estimates. Measurement only; the UI change is a separate PR.
---

# Reference-site reverse-engineering and density parity

Do not answer "the other site is tighter" from a screenshot. Capture both pages
at fixed viewports, measure them, and turn the numbers into a ranked change
list. The instrument is the evidence; the change list is the decision.

Use `ref-site-a` for the reference site in reports and examples. Never commit a
real reference-site name, domain, internal URL or customer name.

## 1. Fix the comparison

- One page kind on both sides: same route and state.
- Viewports: `1440x900,1280x800,375x812` unless the question is narrower.
- Theme: one theme by default, so the reference page is loaded once per
  viewport. Both themes only when the question is about both.
- Serve our side locally and confirm a 200 before measuring.

Reference sites are third-party services. Do not bypass anti-bot protection, add
cookies, rotate proxies or scrape at a rate that could harm the site. One normal
desktop user-agent request is the limit. If the site is unreachable, record the
reason and continue with our side.

## 2. Measure

The adopting repository provides a measurement script, for example
`scripts/density-parity.mjs`. It should use the same headless-browser harness as
the UI audit and report, per side and viewport:

- chrome height (document top to the first data row);
- visible rows and row height;
- interactive controls, rendered and above the fold;
- top, height, padding, margin, gap and row-gap of named blocks;
- page-title, stat-value and table-header font sizes;
- document height and horizontal overflow.

Selectors are per side. Override them on the command line rather than editing
the script:

```sh
node scripts/density-parity.mjs \
  --reference https://ref-site-a.invalid/example \
  --ours http://127.0.0.1:PORT/example \
  --rows-reference "table tbody tr" --rows-ours ".row" \
  --blocks-reference "header=header,pager=.pager" \
  --blocks-ours "header=.site-header,pager=.pager" \
  --json reports/density-example.json
```

Never invent a missing number. If a selector matches nothing, the side status is
`selector_matched_nothing`, the row count is `null` (not `0`), and the report
says so. A legitimate empty page must opt in explicitly.

## 3. Read the report as a hierarchy

1. **Chrome height** decides whether anything useful is above the fold. Compare
   it first, then visible rows, then row height, then document height.
2. **Block deltas** explain the chrome difference. A positive delta with a large
   height is the signal. An extra reference-only block (for example a global
   search trigger) offsets the comparison and must be stated.
3. **Font sizes are evidence, not targets.** The project design system is
   normative. Record a reference difference as a deliberate deviation instead of
   copying it.
4. **Controls and rows** show information density. More controls above the fold
   is not automatically better; a filter counts only if the page needs it.
5. **Density ratio** (`ours / reference` rows per 1000px of chrome) is the
   one-line summary. `0.00` is a measured zero; `null` means the selector or
   chrome height is missing.

## 4. Write the document

`reports/density-<page>.md` contains:

- the exact command, URLs, commit and raw JSON path;
- the reference-site accessibility result: loaded, retried, or unreachable with
  the reason;
- the full 1440x900 table, the all-viewport table and the block delta table;
- the density ratio and document-height ratio;
- the change list.

The change list is ordered by pixels saved and risk. Every row names:

- the change in one sentence;
- the chrome pixels saved (and document pixels if rows change);
- the risk and what to re-check;
- `file:line` anchors;
- the evidence: which measured block or child height produces the saving.

Finish with a cumulative estimate and an explicit "not copied" section.

## 5. Rules for the change list

- **Density and information over decorative spacing.** Removing a redundant note
  row beats shrinking a target below 44px.
- **Never copy a feature the page does not need.** A reference global search box,
  an extra stat or a second filter is not parity if the page already has the
  control or does not use it.
- **Never break the design system to win a number.** Touch targets, the text
  floor and the shared component grammar stay as they are.
- **Semantics first.** Fix a specificity bug at its cause, not with `!important`
  on the page.
- **One change per commit.** A measurement PR contains no UI edits; an
  implementation PR contains the detector and evidence for each change.
- **Re-measure after the change.** Record before/after rows from the same
  command. "Looks tighter" is not evidence.

## 6. Report back

Return the measurement table, the reference-site accessibility result, the
change list with pixel estimates and every deviation from the plan. If a change
cannot be made without violating the design system, say so and leave it out.
