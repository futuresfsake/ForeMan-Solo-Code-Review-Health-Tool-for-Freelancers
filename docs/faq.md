# FAQ

**Is this a hosted app?** No. A local CLI. Nothing is uploaded (ADR-0001).

**Is it open source and free?** Yes, one npm package, MIT. No paid tier is planned.

**Does it work on any Node app?** The generic checks do. Route/auth/validation checks need a framework adapter; Express and NestJS are supported; others later.

**Does it run my app?** Never. It parses the code (NFR-07).

**Is it a security audit?** No. See [security-and-trust.md](security-and-trust.md).

**Why is a checklist item "unverified"?** Either it can't be proven from code (e.g. backups), or a check behind it did not run: a rule is turned off, no routes were found, or a source file could not be analysed. The note next to the item says which. Attest it in `foreman.config.json` with a note once you have confirmed it yourself.

**I was handed a project. Is it safe to scan it?** That is what the tool is for. Nothing in the project is executed, nothing is written through its links, and its own config is named in the output whenever it changes the scan. For a first look, run `foreman-solo scan --no-project-config` and read the warnings. See [security-and-trust.md](security-and-trust.md#projects-you-did-not-write).

**The scan exited with code 3.** A check failed partway, so the result is incomplete. Do not treat it as clean; the warnings say which rule failed.

**It flagged a route as unauthenticated but it's public on purpose.** Add the route pattern to config or an inline `// foreman-ignore auth/missing-on-sensitive-route: public webhook`. A reason is required.

**Scan says dependencies were skipped.** `npm audit` needs network (or you passed `--no-audit`). The report lists it under skipped checks.

**How do I scan every client project?** `foreman-solo scan --all "./clients/*"`.

**How do I get weekly checks?** Run `foreman-solo init --ci` in the project. It adds a GitHub Actions workflow that scans on every push and once a week; GitHub emails you when it fails. On your own server, a cron line such as `0 6 * * 1 cd /srv/app && npx foreman-solo scan --fail-under 70` does the same.

**What do I send my client?** `foreman-solo scan --report client` writes a plain-English summary with no code or file paths. Keep the technical report for yourself.

**Why did my score drop with no code change?** A newly disclosed CVE in a dependency.

**Can the LLM review see my code?** Only if you run `foreman-solo review`; `scan` never does. It uses a local model through Ollama, so nothing leaves your machine, and endpoints that are not on your machine are rejected. Secrets are masked first, and `review --dry-run` shows exactly what would be sent. A hosted provider is not built; it would need your explicit consent. It is experimental: small local models can be wrong, and the static scan never depends on it.
