# Legal notes

This page explains the choices made to keep Foreman Solo and its users on safe ground. It is practical guidance written by the maintainers. **It is not legal advice.** If you rely on this tool commercially, or plan to sell a service built on it, have a lawyer in your country review your specific situation.

## Licence and warranty

Foreman Solo is released under the [MIT licence](../LICENSE). It is provided "as is", with no warranty of any kind, and the authors are not liable for damages arising from its use. This is the standard open-source position and it applies to every report the tool produces.

## What a report is, and is not

- A report is the output of automated static rules. It is **not** a security audit, a penetration test, a compliance assessment or a certification.
- A high score or a green checklist means the rules that ran found little. It does not mean the code is secure, and it must never be presented to a client as proof of security.
- Every report carries this disclaimer and lists what was not checked. Do not remove the disclaimer when you pass a report on.
- When you describe the work to a client, say "automated review completed" and list what was checked. Do not say "secure", "certified", "guaranteed" or "hack-proof". Those words can create a warranty you did not intend to give.

## Scanning code you do not own

- Only scan code you are authorised to access. For client work, your contract or the client's written permission should cover reviewing their repository.
- Foreman Solo only reads files. It does not run the project, probe live systems or send traffic to anyone's servers, so it is not a penetration-testing tool.
- Reports and `.foreman/history.json` can reveal file names and weaknesses. Treat them as confidential client material and share them only with the client they belong to.

## Data and privacy

- No telemetry, accounts or analytics. Source code never leaves the machine.
- The one network call is `npm audit`, which sends dependency names and versions to the npm registry under npm's own terms. Use `--no-audit` to stay fully offline.
- Detected secrets are redacted in all output. Reports contain project-relative paths only.
- If opt-in LLM features are added later, they will send code to a provider the user chooses. Sending client code to a third party may need the client's consent; the tool will say what is sent before sending it.

## Names and trademarks

- "Foreman Solo" is an independent project. It is **not affiliated with, endorsed by or connected to** The Foreman (theforeman.org), the `foreman` Ruby gem, the `foreman` npm package, or any other product named Foreman.
- Product and company names mentioned in rules and docs (Express, Stripe, GitHub, AWS and others) belong to their owners and are used only to describe what a rule detects.
- No formal trademark search has been done for the name. This is an open risk (R-08). Do one before commercial use, a public launch or registering a domain.

## Third-party software

| Package | Licence | Use |
|---|---|---|
| commander | MIT | Runtime: command-line parsing |
| typescript | Apache-2.0 | Runtime: parsing source files |
| vitest, @types/node | MIT | Development only |

Dependencies are installed by npm and are not bundled into the published package. All rules and detection patterns were written for this project; none are copied from other scanners.

## Contributions

By submitting a contribution you agree it is your own work and is licensed under the project's MIT licence. Do not paste code from projects whose licence does not allow that.
