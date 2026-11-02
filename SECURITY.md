# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

Older pre-1.0 builds are no longer supported; please upgrade to 1.0.0 or newer
before reporting a problem.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Report it privately
through the repository's **Security → Report a vulnerability** form (GitHub
private vulnerability reporting) at
<https://github.com/LittleLemonJam/dsh-quick-notes/security/advisories/new>, or by
contacting the maintainers listed in `package.json`.

Include:

- the affected version and DSH version;
- a minimal reproduction (steps, request payload, or note HTML);
- the impact you observed and any suggested fix.

We aim to acknowledge reports within a few working days. Please give us a
reasonable window to ship a fix before any public disclosure.

## Scope

This plugin runs inside the DeepSeek Harness Web GUI and owns:

- a same-origin HTTP surface under `/dsh-quick-notes/` (state, health,
  diagnostic);
- a state file at `$DSH_HOME/quick-notes/notes.json` and a size-capped
  diagnostic log beside it;
- a browser-side rich-text editor whose HTML is sanitised before it is rendered
  or persisted.

Reports about the host application itself belong to the DeepSeek Harness
project, not to this plugin.
