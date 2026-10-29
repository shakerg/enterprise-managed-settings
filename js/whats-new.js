/* Changelog for the "What's new" banner and "New" badges.
   Each entry: { date: "YYYY-MM-DD", type: "setting" | "model" | "fix", title, step?, key? }
   - step: wizard step id (welcome, model, permissions, access, plugins, mcp, sandbox, telemetry, review)
   - key: the setting key shown on the card (for example "sandbox" or "permissions.deny")
   Entries are tracked by date + title, so editing either shows the entry again to returning visitors.
   scripts/update-models.js appends model entries automatically. Keep the JSON array valid. */
window.EMS_WHATS_NEW = [
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for allowed MCP servers",
    "step": "mcp",
    "key": "allowedMcpServers"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for denied MCP servers",
    "step": "mcp",
    "key": "deniedMcpServers"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for strict marketplaces",
    "step": "plugins",
    "key": "strictKnownMarketplaces"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for extra marketplaces",
    "step": "plugins",
    "key": "extraKnownMarketplaces"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for enabled plugins",
    "step": "plugins",
    "key": "enabledPlugins"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for allowed operations",
    "step": "permissions",
    "key": "permissions.allow"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for operations requiring approval",
    "step": "permissions",
    "key": "permissions.ask"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for blocked operations",
    "step": "permissions",
    "key": "permissions.deny"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for the default permission mode",
    "step": "permissions",
    "key": "permissions.defaultMode"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for assisted permissions",
    "step": "permissions",
    "key": "permissions.disableAssistedPermissionsMode"
  },
  {
    "date": "2026-10-29",
    "type": "setting",
    "title": "Client support updated for bypass mode",
    "step": "permissions",
    "key": "permissions.disableBypassPermissionsMode"
  },
  {
    "date": "2026-10-27",
    "type": "model",
    "title": "Default model is now a pick list of supported models, refreshed daily from GitHub Docs",
    "step": "model",
    "key": "model"
  }
];
