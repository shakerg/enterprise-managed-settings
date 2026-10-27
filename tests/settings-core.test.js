// Run with `node --test tests/` or open tests/index.html in a browser.
/* global window */
const isNode = typeof window === "undefined";
const test = isNode ? require("node:test") : window.test;
const assert = isNode ? require("node:assert/strict") : window.assert;
const EMS = isNode ? require("../js/settings-core.js") : window.EMS;

// Example configuration from the GitHub docs reference page.
const DOCS_EXAMPLE = {
  features: { computerUse: false },
  model: "auto",
  autoTier: "intelligence",
  permissions: {
    disableBypassPermissionsMode: "disable",
    deny: ["Shell(rm -rf *)", "Read(~/.ssh/**)", "Edit(//etc/**)", "Domain(*.unapproved.example)"],
    ask: ["Shell(git push *)", "Edit(/src/**)", "Domain(api.github.com)"],
    allow: ["Shell(npm test *)", "Read(/src/**)", "Domain(registry.npmjs.org)"],
  },
  enabledPlugins: { "my-plugin@agent-skills": true },
  extraKnownMarketplaces: {
    "agent-skills": { source: { source: "github", repo: "OWNER/REPO" }, autoUpdate: true },
  },
  strictKnownMarketplaces: [{ source: "github", repo: "OWNER/REPO" }],
  telemetry: {
    enabled: true,
    endpoint: "https://otel-collector.example.com",
    protocol: "http/protobuf",
    capture: { identity: true, prompts: false, responses: false, toolArguments: false, toolOutput: false, policyDetail: false },
    captureContent: false,
    lockCaptureContent: true,
    serviceName: "copilot",
    resourceAttributes: { "deployment.environment": "production" },
    headers: { Authorization: "******" },
  },
  remoteControl: { mode: "requireSSO", githubDotComOrganizations: ["ORG-NAME"] },
  allowedMcpServers: [
    { serverUrl: "https://api.githubcopilot.com/*" },
    { serverCommand: ["npx", "@playwright/mcp@latest"] },
    { serverCommand: ["cmd", "/c", "uvx", "markitdown-mcp"] },
  ],
  deniedMcpServers: [{ serverCommand: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/"] }],
  sandbox: { enabled: true, failIfUnavailable: true, allowBypass: false, sandboxMcpServers: true, sandboxLspServers: true },
};

test("default state produces an empty object", () => {
  assert.deepEqual(EMS.buildSettings(EMS.defaultState()), {});
});

test("docs example round-trips through parse -> build", () => {
  const out = EMS.buildSettings(EMS.parseSettings(DOCS_EXAMPLE));
  assert.deepEqual(out, DOCS_EXAMPLE);
});

test("overridable wrappers round-trip", () => {
  const src = {
    model: { overridable: "auto" },
    autoTier: { overridable: "balance" },
    permissions: { deny: { overridable: ["Shell(rm -rf *)"] } },
    strictKnownMarketplaces: { overridable: [{ source: "github", repo: "o/r" }] },
    extraKnownMarketplaces: { overridable: { m: { source: { source: "git", url: "https://x/y.git", ref: "main" } } } },
    allowedMcpServers: { overridable: [{ serverName: "microsoft/playwright-mcp" }] },
    sandbox: { overridable: { enabled: true, allowBypass: false } },
  };
  const state = EMS.parseSettings(src);
  assert.equal(EMS.hasOverridable(state), true);
  assert.deepEqual(EMS.buildSettings(state), src);
});

test("full sandbox userPolicy round-trips", () => {
  const src = {
    sandbox: {
      enabled: true,
      addCurrentWorkingDirectory: false,
      allowDevToolAccess: false,
      learningMode: "deny",
      auth: { git: false, gh: false },
      userPolicy: {
        filesystem: { readwritePaths: ["/tmp/work"], readonlyPaths: [], deniedPaths: ["~/.ssh"] },
        network: { allowOutbound: true, allowLocalNetwork: false, allowedHosts: ["*.github.com"], blockedHosts: ["evil.example"], proxy: { url: "http://proxy:8080" } },
        seatbelt: { keychainAccess: false },
      },
    },
  };
  assert.deepEqual(EMS.buildSettings(EMS.parseSettings(src)), src);
});

test("legacy permissions.model is imported as top-level model", () => {
  const out = EMS.buildSettings(EMS.parseSettings({ permissions: { model: "auto" } }));
  assert.deepEqual(out, { model: "auto" });
});

test("empty strict marketplaces / allowed MCP stay as explicit empty arrays", () => {
  const src = { strictKnownMarketplaces: [], allowedMcpServers: [] };
  assert.deepEqual(EMS.buildSettings(EMS.parseSettings(src)), src);
});

test("validation catches common mistakes", () => {
  const s = EMS.defaultState();
  s.remoteControl = { managed: true, mode: "requireSSO", orgs: [] };
  s.permissions.deny = { managed: true, overridable: false, rules: ["rm -rf"] };
  s.telemetry.managed = true;
  s.telemetry.enabled = "true";
  s.enabledPlugins = { managed: true, items: [{ key: "noat", enabled: true }] };
  s.sandbox.managed = true;
  s.sandbox.network.allowedHosts = { managed: true, items: ["https://x.com"] };
  const errors = EMS.validate(s).filter((i) => i.level === "error").map((i) => i.step);
  for (const step of ["access", "permissions", "telemetry", "plugins", "sandbox"]) assert.ok(errors.includes(step), step);
});

test("presets are valid", () => {
  for (const name of ["starter", "secure", "locked"]) {
    const errs = EMS.validate(EMS.preset(name)).filter((i) => i.level === "error");
    assert.deepEqual(errs, [], name);
  }
});

test("command parsing honors quotes", () => {
  assert.deepEqual(EMS.parseCommand('node "my server.js" --flag'), ["node", "my server.js", "--flag"]);
  assert.equal(EMS.formatCommand(["node", "my server.js"]), 'node "my server.js"');
});

test("model IDs are derived from docs display names", () => {
  assert.equal(EMS.modelIdFromName("Claude Sonnet 4.6"), "claude-sonnet-4.6");
  assert.equal(EMS.modelIdFromName("GPT-5.3-Codex"), "gpt-5.3-codex");
  assert.equal(EMS.modelIdFromName("GPT-5.4 nano[^gpt54nano]"), "gpt-5.4-nano");
  assert.equal(EMS.modelIdFromName("MAI-Code-1.1-Flash"), "mai-code-1.1-flash");
  assert.equal(EMS.modelIdFromName("Claude Opus 4.8 (fast mode) (preview)"), "claude-opus-4.8-fast");
});

test("supported models table is parsed from docs markdown", () => {
  const md = [
    "# Supported AI models in GitHub Copilot",
    "## Supported AI models in Copilot",
    "<div>",
    "| Model name | Provider | Release status |",
    "| ---------- | -------- | -------------- |",
    "|            |          |                |",
    "| GPT-5.3-Codex | OpenAI | GA |",
    "|            |          |                |",
    "| Claude Haiku 4.5[^x] | Anthropic | Public preview |",
    "</div>",
    "## Supported AI models in Auto model selection",
    "| Model name | Provider |",
    "| --- | --- |",
    "| Not Included | Nobody |",
  ].join("\n");
  assert.deepEqual(EMS.parseModelsDoc(md), [
    { id: "gpt-5.3-codex", name: "GPT-5.3-Codex", provider: "OpenAI", status: "GA" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic", status: "Public preview" },
  ]);
  assert.deepEqual(EMS.parseModelsDoc("# nothing here"), []);
});
