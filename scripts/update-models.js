#!/usr/bin/env node
// Regenerates js/models-snapshot.js from the GitHub Docs "Supported AI models" page.
// Only rewrites the file when the model list actually changes.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const EMS = require("../js/settings-core.js");

const URL = "https://docs.github.com/api/article/body?pathname=/en/copilot/reference/ai-models/supported-models";
const OUT = path.join(__dirname, "..", "js", "models-snapshot.js");
const WHATS_NEW = path.join(__dirname, "..", "js", "whats-new.js");
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

const list = (ids) => (ids.length > 3 ? `${ids.slice(0, 3).join(", ")} and ${ids.length - 3} more` : ids.join(", "));

// Adds a "model" entry to js/whats-new.js so returning users see the change.
function addWhatsNewEntry(date, added, removed) {
  if (!added.length && !removed.length) return;
  const parts = [];
  if (added.length) parts.push(`${added.length} model${added.length > 1 ? "s" : ""} added: ${list(added)}`);
  if (removed.length) parts.push(`${removed.length} removed: ${list(removed)}`);
  const src = fs.readFileSync(WHATS_NEW, "utf8");
  const start = src.indexOf("= [") + 2;
  const end = src.lastIndexOf("]") + 1;
  const entries = JSON.parse(src.slice(start, end));
  const problems = EMS.validateWhatsNew(entries);
  if (problems.length) throw new Error(`js/whats-new.js is invalid: ${problems.join("; ")}`);
  const entry = { date, type: "model", title: parts.join("; "), step: "model" };
  if (entries.some((e) => EMS.whatsNewId(e) === EMS.whatsNewId(entry))) return;
  entries.unshift(entry);
  fs.writeFileSync(WHATS_NEW, src.slice(0, start) + JSON.stringify(entries, null, 2) + src.slice(end));
  console.log("Added what's new entry.");
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
  addWhatsNewEntry(fetchedAt, added, removed);
  console.log(`Updated snapshot: ${models.length} models. Added: ${added.join(", ") || "none"}. Removed: ${removed.join(", ") || "none"}.`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=Added: ${added.join(", ") || "none"}; Removed: ${removed.join(", ") || "none"}\n`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
