# FAQ

**Is this a hosted app?** No. A local CLI. Nothing is uploaded (ADR-0001).

**Is it open source and free?** Yes, one npm package, MIT. No paid tier is planned.

**Does it work on any Node app?** The generic checks do. Route/auth/validation checks need a framework adapter; Express first, others later.

**Does it run my app?** Never. It parses the code (NFR-07).

**Is it a security audit?** No. See [security-and-trust.md](security-and-trust.md).

**Why is a checklist item "unverified"?** It can't be proven from code (e.g. backups). Attest it in `foreman.config.json` with a note.

**It flagged a route as unauthenticated but it's public on purpose.** Add the route pattern to config or an inline `// foreman-ignore auth/missing-on-sensitive-route: public webhook`. A reason is required.

**Scan says dependencies were skipped.** `npm audit` needs network (or you passed `--no-audit`). The report lists it under skipped checks.

**How do I scan every client project?** `foreman-solo scan --all "./clients/*"`.

**How do I get weekly checks?** Use the sample GitHub Action or cron from `foreman-solo init` (M8).

**Why did my score drop with no code change?** A newly disclosed CVE in a dependency.

**Can the LLM review see my code?** Only if you enable it and supply a key, and you'll see what is sent first (M6+).
