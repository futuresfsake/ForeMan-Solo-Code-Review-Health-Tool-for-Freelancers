# Risks

| ID | Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|---|
| R-01 | Scanner finds nothing real (polished shell, empty core) | High: product useless | Medium | M4 gate on a real project; ADR-0004 |
| R-02 | False positives erode trust | High | High | Confidence levels, per-rule fixtures for good and bad code, suppressions with reasons, FP budget NFR-06 |
| R-03 | False sense of security from a green score | High (legal/reputational) | Medium | NFR-11 wording, coverage section, "not an audit" disclaimer, `unverified` checklist state |
| R-04 | Dynamic Express patterns break the adapter | Medium | Medium | Log unresolved routes as coverage warnings; fixtures for common patterns |
| R-05 | `npm audit` noise or outage | Medium | Medium | Cache last result, `--no-audit`, filter by level |
| R-06 | LLM cost/privacy concerns when added | Medium | Medium | Opt-in, user key, show exactly what is sent, redact secrets before sending |
| R-07 | Solo author capacity | High | High | Small MVP, strict phase gates |
| R-08 | Name clash: `foreman` is taken on npm and is a well-known infrastructure tool; the short `foreman` bin may collide | Medium | High | Publish as `foreman-solo` (free 2026-11-11); only the `foreman-solo` bin is shipped (ADR-0006); non-affiliation notice in README and legal.md; do a trademark search before any commercial launch |
| R-11 | A client treats a report as a security guarantee and blames the freelancer after an incident | High (legal) | Medium | Disclaimer in every output, `unverified` state, "not checked" list, wording guidance in legal.md, MIT no-warranty clause |
| R-09 | Scope creep back to hosted product | Medium | Medium | ADR-0001; new ADR required |
| R-10 | Leaking client code in reports/history | High | Low | Reports are local; history stores only scores; docs warn before sharing HTML |
| R-12 | A project built to attack the scanner runs code on the reviewer's machine or overwrites a file there | High | Medium (found and fixed once: security review F-01, F-04) | Programs started by absolute path only; no write through a link; git settings neutralised; one regression test per weakness (`tests/security.test.ts`); the review is repeated before each release |
| R-13 | A project built to look clean: narrowing config, files that break the rules, terminal tricks | High (the reviewer signs off on bad code) | Medium | Config changes named in every output; `--no-project-config`; checklist items `unverified` unless every rule ran on every file; exit code 3 for an incomplete scan; project text cleaned before printing |
| R-14 | Supply chain: the npm name is registered by someone else, a dependency or a GitHub Action is compromised, or a release is tampered with | High | Medium until the name is registered | Register the name with two-factor authentication (open); two runtime dependencies only; `npm audit` and `npm audit signatures` in CI; actions pinned to commits; Dependabot; package content check; provenance on publish (planned) |
| R-15 | The single maintainer's GitHub or npm account is taken over | High | Low | Two-factor authentication on both; push protection; a ruleset on `main` (open); read-only CI token |
