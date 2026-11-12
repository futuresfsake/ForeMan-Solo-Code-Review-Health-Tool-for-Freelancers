# Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Performance | Static pass completes in under 10 s on a 50k-LOC repo, excluding `npm audit`. |
| NFR-02 | Determinism | Same input yields identical findings and score. Static pass has no randomness, no network (except `npm audit`). |
| NFR-03 | Privacy | No telemetry, no account, no phoning home. Source code never leaves the machine unless the user explicitly enables an LLM feature. |
| NFR-04 | Portability | Runs on Windows, macOS, Linux; Node 20 LTS+. Paths and globs handled cross-platform. |
| NFR-05 | Zero setup | Works with `npx foreman-solo scan` and no config on a fresh repo. |
| NFR-06 | Accuracy | On the author's own reference projects, false positives per scan <= 3 and no known true issue missed among the covered rule categories. Tracked per release. |
| NFR-07 | Safety | Never executes scanned project code, never modifies it, never writes outside the report/history paths. This must hold for a project built to break it: no program placed in the project folder or named in its settings is run, nothing is written through a link, and its config cannot send output outside the working folder. |
| NFR-08 | Robustness | A parse failure in one file produces a warning, not a crash. Scan continues. A file that cannot be analysed never switches a check off for other files, and an incomplete scan is never reported as a clean one: affected checklist items are `unverified` and a failed rule gives exit code 3. |
| NFR-09 | Output | Reports are self-contained (no external CDN/fonts/scripts). |
| NFR-10 | Stability | Rule IDs, checklist IDs, JSON schema, flags and exit codes are semver-stable contracts. |
| NFR-11 | Honesty | Output states what was and wasn't checked; never claims "secure" or "certified". |
| NFR-12 | Extensibility | New adapter or rule needs no change to the core scanner. |
| NFR-13 | Offline | Everything except `npm audit` and optional LLM features works offline. |
| NFR-14 | Accessibility | HTML report readable without JS, usable in light/dark, keyboard navigable. |
