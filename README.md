# Managed Settings Builder

A dependency-free web UI that walks enterprise admins through creating GitHub Copilot's
[`managed-settings.json`](https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/enterprise-administrators/enterprise-managed-settings).

## Use

**Live site:** https://shakerg.github.io/enterprise-managed-settings/

Or open `index.html` locally in a browser (no server or build step needed).

1. Pick a starting point (Blank, Starter, Secure baseline, Locked down) or **Import** an existing file.
2. Step through Models, Permissions, Features & access, Plugins, MCP servers, Sandbox, and Telemetry. Turn on **Manage** for settings you want to enforce; unmanaged settings are omitted.
   The **Default model** pick list is loaded live from the [Supported AI models](https://docs.github.com/en/copilot/reference/ai-models/supported-models) docs page (cached for 24 hours, with a bundled snapshot in `js/models-snapshot.js` as an offline fallback). A custom model ID can also be entered.
3. Watch the live preview and validation, then **Download** or **Copy** the file.
4. Commit it to `copilot/managed-settings.json` in your enterprise's `.github-private` repository.

Progress and theme (system / light / dark) are saved in `localStorage`. Nothing is uploaded.

## Structure

| Path | Purpose |
| --- | --- |
| `index.html` | App shell |
| `css/styles.css` | Design tokens (blue/purple palette, light & dark themes) and components |
| `js/settings-core.js` | Pure logic: state → JSON, JSON → state, validation, presets, model list parsing |
| `js/models-snapshot.js` | Offline fallback list of supported models |
| `js/app.js` | Wizard UI |
| `tests/` | Unit tests for `settings-core.js` |

## Tests

- Browser: open `tests/index.html`.
- Node: `node --test tests/settings-core.test.js` (also runs in CI on every push and PR)

## Keeping it current

Two scheduled GitHub Actions workflows run daily:

| Workflow | What it does |
| --- | --- |
| [`update-models.yml`](.github/workflows/update-models.yml) | Regenerates `js/models-snapshot.js` from the Supported AI models docs page, commits it if the list changed, and redeploys Pages. |
| [`docs-watch.yml`](.github/workflows/docs-watch.yml) | Compares the managed settings reference with `docs-baseline/enterprise-managed-settings.md`. When it changes, opens a `docs-change` issue with the diff and assigns it to the Copilot coding agent, which opens a PR. |

Both can also be run manually from the **Actions** tab.

To let `docs-watch.yml` assign issues to Copilot, add a repository secret named `COPILOT_ASSIGN_TOKEN` containing a fine-grained personal access token for this repository with read and write access to **Issues**, **Pull requests**, **Contents**, and **Actions**, and read access to **Metadata**. Without it, the issue is still opened and you can assign Copilot manually.
