# Copilot instructions

This repo is a dependency-free static site (GitHub Pages) that builds GitHub Copilot's enterprise `managed-settings.json`.

- `js/settings-core.js` holds all schema logic (pure functions, UMD module). Keep it DOM-free.
- `js/app.js` is the wizard UI; it renders HTML strings and binds inputs via `data-path` attributes.
- `css/styles.css` defines the design tokens (blue/purple palette, light and dark themes). Reuse existing tokens and components.
- Do not add build steps, frameworks, or npm dependencies.
- Run tests with `node --test tests/settings-core.test.js`. Add tests for any schema change.
- The source of truth is https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/enterprise-administrators/enterprise-managed-settings
