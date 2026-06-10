# Security Policy

## Supported Versions

Security fixes are applied to the **latest minor release** of the monorepo.
Older minor versions do not receive backported patches unless the vulnerability
is rated Critical (CVSS ≥ 9.0) and a workaround is not available.

| Version | Supported          |
|---------|--------------------|
| 0.11.x  | ✅ Current release  |
| < 0.11  | ❌ Not supported    |

## Reporting a Vulnerability

**Please do not file a public GitHub issue for security vulnerabilities.**

Report security issues by emailing **security@datacules.com**. You will receive
a response within **72 hours** acknowledging receipt. If you do not receive a
response within that window, please follow up to ensure the original message
was received.

When reporting, include as much of the following as possible:

- Description of the vulnerability and its potential impact
- Steps to reproduce or a proof-of-concept (PoC)
- Affected package(s) and version(s)
- Any suggested mitigations

## Disclosure Policy

Datacules follows **coordinated disclosure**:

1. You report the vulnerability privately to security@datacules.com.
2. We investigate and confirm the issue within **7 days**.
3. We prepare and release a patch. For Critical issues we aim to release
   within **14 days** of confirmation; for High within **30 days**.
4. A CVE is requested (if applicable) and a public advisory is published on
   the [GitHub Security Advisories](https://github.com/hvrcharon1/agent-identity/security/advisories)
   page once the patch is released.
5. Credit is given to the reporter in the advisory unless anonymity is requested.

## Scope

In-scope for this policy:

- All packages published under the `@datacules` npm scope from this repository
- The Python SDK (`datacules-agent-identity` on PyPI)
- The Next.js dashboard application (`src/`)
- CI/CD workflows and supply-chain security

Out-of-scope:

- Vulnerabilities in third-party dependencies that are not yet patched upstream
  (please report those to the upstream maintainer; feel free to CC us)
- Issues requiring physical access to infrastructure
- Social engineering attacks

## Preferred Languages

We accept reports in **English**.
