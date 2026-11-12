# Security policy

## Supported versions

Foreman Solo is pre-release. Once versions are published, only the latest minor release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue with the details of a security problem.

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. If that button is not shown, open an issue that says only "I have a security report" and a way to reach you, with no details, and you will be contacted.

Include:

- what you found and the impact,
- steps or a minimal repository to reproduce it,
- the Foreman Solo version, Node version and operating system you used.

You can expect an acknowledgement within 7 days and a status update within 30 days. Fixes are released as patch versions and credited in the [CHANGELOG](CHANGELOG.md) unless you prefer to stay anonymous.

## Scope

Foreman Solo is run on code its user did not write, so the project being scanned is treated as hostile input. In scope is anything that lets such a project:

- run a program or code on the machine doing the scan,
- write, overwrite or read a file outside the project and the report folder,
- send scanned code or secrets to the network or into a report,
- make an incomplete or failed scan look like a clean one (a passed checklist item, exit code 0) without the output saying so,
- control the terminal or the content of a report through names or text in its files.

Out of scope: findings that Foreman Solo fails to detect in your own projects (file those as a false negative using the bug report template), ways to hide code that the output already reports (a skipped file, an ignored folder, a suppression), and vulnerabilities in third-party packages with no impact on Foreman Solo.

## More

- How the tool handles data and untrusted projects: [docs/security-and-trust.md](docs/security-and-trust.md)
- The last security review of the tool, with what was found and what is still open: [docs/security/security-audit.md](docs/security/security-audit.md)
- The checks that run on every change: [docs/security/safeguards.md](docs/security/safeguards.md)
