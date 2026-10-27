/* Changelog for the "What's new" banner and "New" badges.
   Each entry: { date: "YYYY-MM-DD", type: "setting" | "model" | "fix", title, step?, key? }
   - step: wizard step id (welcome, model, permissions, access, plugins, mcp, sandbox, telemetry, review)
   - key: the setting key shown on the card (for example "sandbox" or "permissions.deny")
   scripts/update-models.js appends model entries automatically. Keep the JSON array valid. */
window.EMS_WHATS_NEW = [
  {
    "date": "2026-10-27",
    "type": "model",
    "title": "Default model is now a pick list of supported models, refreshed daily from GitHub Docs",
    "step": "model",
    "key": "model"
  }
];
