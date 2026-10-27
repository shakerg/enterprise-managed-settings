#!/usr/bin/env node
// Fetches the enterprise managed settings reference as markdown, normalized for diffing.
// Usage: node scripts/fetch-reference.js > docs-baseline/enterprise-managed-settings.md
"use strict";
const URL =
  "https://docs.github.com/api/article/body?pathname=/en/enterprise-cloud@latest/copilot/reference/enterprise-administrators/enterprise-managed-settings";

(async () => {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Docs request failed: HTTP ${res.status}`);
  const md = (await res.text())
    .replace(/<svg[\s\S]*?<\/svg>/g, "") // inline octicons are noise
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (md.length < 2000) throw new Error(`Reference looks truncated (${md.length} chars)`);
  process.stdout.write(md + "\n");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
