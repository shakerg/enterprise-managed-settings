# Managed Settings Builder

A dependency-free web UI that walks enterprise admins through creating GitHub Copilot's
[`managed-settings.json`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/enterprise-administrators/enterprise-managed-settings).

## Use

**Live site:** https://shakerg.github.io/enterprise-managed-settings/

Or open `index.html` locally in a browser (no server or build step needed).

1. Pick a starting point (Blank, Starter, Secure baseline, Locked down) or **Import** an existing file.
2. Step through Models, Permissions, Features & access, Plugins, MCP servers, Sandbox, and Telemetry. Turn on **Manage** for settings you want to enforce; unmanaged settings are omitted.
3. Watch the live preview and validation, then **Download** or **Copy** the file.
4. Commit it to `copilot/managed-settings.json` in your enterprise's `.github-private` repository.

Progress and theme (system / light / dark) are saved in `localStorage`. Nothing is uploaded.

## Structure

| Path | Purpose |
| --- | --- |
| `index.html` | App shell |
| `css/styles.css` | Design tokens (blue/purple palette, light & dark themes) and components |
| `js/settings-core.js` | Pure logic: state → JSON, JSON → state, validation, presets |
| `js/app.js` | Wizard UI |
| `tests/` | Unit tests for `settings-core.js` |

## Tests

- Browser: open `tests/index.html`.
- Node: `node --test tests/`
