# Security policy

## Supported versions

Foreman Solo is pre-release. Once versions are published, only the latest minor release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what you found and the impact,
- steps or a minimal repository to reproduce it,
- the Foreman Solo and Node versions you used.

You can expect an acknowledgement within 7 days and a status update within 30 days. Fixes are released as patch versions and credited in the [CHANGELOG](CHANGELOG.md) unless you prefer to stay anonymous.

## Scope

In scope: the Foreman Solo CLI and its reports, for example code execution while scanning, writing outside the report and history paths, or leaking scanned code or secrets into output or the network.

Out of scope: findings that Foreman Solo fails to detect in your own projects (file those as a false negative using the bug report template), and vulnerabilities in third-party packages with no impact on Foreman Solo.

For what the tool does and does not send over the network, see [docs/security-and-trust.md](docs/security-and-trust.md).
