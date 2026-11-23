# Security alerts

Security findings must have an owner, a deadline and a place to be discussed.
A dashboard is not an owner. The routing script turns each open alert into one
issue with a hidden marker, updates it on later runs, and closes it when the
alert is no longer open.

## Sources

`security-alerts-sync.mjs` reads three GitHub sources:

| Source | Endpoint | Typical severity |
|---|---|---|
| Code scanning | `repos/<repo>/code-scanning/alerts?state=open` | `critical`/`high`/`medium`/`low` from the rule |
| Dependabot | `repos/<repo>/dependabot/alerts?state=open` | advisory severity |
| Secret scanning | `repos/<repo>/secret-scanning/alerts?state=open` | `critical` |

A source that is disabled or not permitted returns 403/404. The script reports
`source unavailable`, continues with the other sources, and fails only if no
source can be read. "Unavailable" is never reported as "clean".

## Routing

Every open alert becomes one issue:

- Title: `[security][<severity>] <summary>`.
- Body: a hidden marker `<!-- security-alert: <source>:<id> -->`, the source,
  severity, triage target, location, alert link and a triage checklist.
- Labels: `security`, `security-alert`, `severity:<level>`,
  `source:<source>`, `area:<area>`.
- A secret-scanning issue says **do not paste the secret value**. Rotate the
  credential and reference the alert link.

The marker makes the run idempotent. A second run updates the same issue and
reopens it if the alert returned. A managed issue whose alert is no longer open
is commented on, labeled `security-resolved`, and closed.

Issues with a hold label (`owner-decision`, `pinned`) are left alone.

## Severity and SLA

The default map:

| Severity | Priority | Severity field | Triage target |
|---|---|---|---|
| critical | P0 | S1 | 1 day |
| high | P1 | S2 | 7 days |
| medium | P2 | S3 | 30 days |
| low | P3 | S4 | 90 days |

An alert older than its target is printed as `SLA-BREACH`. With
`--enforce-sla`, the run fails. The workflow enables it, so the monitor stays
red while a breach is open.

A false positive is dismissed with a written reason and evidence, for example:
"deterministic test fixture inside a test-only file, never used by production
code". Never dismiss silently and never suppress a whole rule to clear a list.

## Commands

```sh
node scripts/security-alerts-sync.mjs --dry-run
node scripts/security-alerts-sync.mjs --apply --enforce-sla
node scripts/security-alerts-sync.mjs --self-test
```

## Permissions

- `contents: read`
- `issues: write`
- `pull-requests: read`
- `security-events: read`

`SECURITY_ALERTS_TOKEN` is optional. Use it when the default `GITHUB_TOKEN`
cannot read one of the sources. Never store the value in the repository.

For secret scanning, GitHub may require a separate token with the
`security_events` scope. If the source is unavailable, the run says so; it does
not pretend there are no secrets.

## Ownership

- The security owner triages every new issue within the target above.
- A fix gets a regression check when the finding can recur.
- A dismissed finding keeps the evidence in the issue; the issue is closed only
  after the alert is dismissed or resolved.
- A secret is rotated first, then the alert is dismissed. The value never goes
  into an issue, a commit or a log.
- The weekly steward report includes overdue security issues because the same
  milestone due date applies.

## Failure modes

| Failure | Response |
|---|---|
| No source readable | Exit 2; fix permissions. Do not merge. |
| One source unavailable | Warn; continue with the others; report the gap. |
| Issue write fails | Exit 1; the alert remains open and the monitor stays red. |
| Alert reopens | The managed issue is reopened and a comment records the date. |
| Alert disappears | The managed issue is commented on and closed as resolved. |
| SLA breach | Printed; with `--enforce-sla`, the run fails. |
