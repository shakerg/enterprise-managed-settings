#!/usr/bin/env node
// Regenerates js/models-snapshot.js from the GitHub Docs "Supported AI models" page.
// Only rewrites the file when the model list actually changes.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const EMS = require("../js/settings-core.js");

const URL = "https://docs.github.com/api/article/body?pathname=/en/copilot/reference/ai-models/supported-models";
const OUT = path.join(__dirname, "..", "js", "models-snapshot.js");
const HEADER = `/* Offline fallback for the model pick list. Generated from the GitHub docs
   "Supported AI models in Copilot" table; the app refreshes it live when online. */
window.EMS_MODELS_SNAPSHOT = `;

function readCurrent() {
  try {
    const src = fs.readFileSync(OUT, "utf8");
    return JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1)).models;
  } catch (e) {
    return null;
  }
}

(async () => {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Docs request failed: HTTP ${res.status}`);
  const models = EMS.parseModelsDoc(await res.text());
  // Guard against a docs layout change wiping the fallback list.
  if (models.length < 5) throw new Error(`Only parsed ${models.length} models; refusing to overwrite snapshot`);

  const current = readCurrent();
  if (current && JSON.stringify(current) === JSON.stringify(models)) {
    console.log(`No change (${models.length} models).`);
    return;
  }
  const fetchedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(OUT, HEADER + JSON.stringify({ fetchedAt, models }, null, 2) + ";\n");
  const before = new Set((current || []).map((m) => m.id));
  const after = new Set(models.map((m) => m.id));
  const added = [...after].filter((id) => !before.has(id));
  const removed = [...before].filter((id) => !after.has(id));
  console.log(`Updated snapshot: ${models.length} models. Added: ${added.join(", ") || "none"}. Removed: ${removed.join(", ") || "none"}.`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=Added: ${added.join(", ") || "none"}; Removed: ${removed.join(", ") || "none"}\n`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
