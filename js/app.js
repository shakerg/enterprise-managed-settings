/* Managed Settings Builder – UI layer. Depends on js/settings-core.js (window.EMS). */
(function () {
  "use strict";
  const EMS = window.EMS;
  const STORE_KEY = "ems-state-v1";
  const STEP_KEY = "ems-step-v1";
  const THEME_KEY = "ems-theme";
  const DOCS = "https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/enterprise-administrators/enterprise-managed-settings";
  const DOCS_START = "https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/get-started";
  const DOCS_DEPLOY = "https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/deploy-managed-settings";
  const DOCS_TEAMS = "https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/override-settings-for-teams";

  // ------------------------------------------------------------------ state
  let state = loadState();
  let step = Number(safeGet(STEP_KEY)) || 0;
  let pendingFocus = null;
  let uid = 0;

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }

  // ------------------------------------------------------------------ model catalog
  const MODELS_KEY = "ems-models-v1";
  const MODELS_TTL = 24 * 60 * 60 * 1000;
  const MODELS_DOC_API = "https://docs.github.com/api/article/body?pathname=/en/copilot/reference/ai-models/supported-models";
  const MODELS_DOC = "https://docs.github.com/en/copilot/reference/ai-models/supported-models";
  let modelCustom = false;
  let models = loadModels();

  function loadModels() {
    try {
      const c = JSON.parse(safeGet(MODELS_KEY));
      if (c && Array.isArray(c.models) && c.models.length) return { ...c, source: "docs" };
    } catch (e) { /* ignore bad cache */ }
    const snap = window.EMS_MODELS_SNAPSHOT || { fetchedAt: null, models: [] };
    return { models: snap.models, fetchedAt: snap.fetchedAt, source: "snapshot" };
  }

  async function refreshModels(force) {
    if (models.loading) return;
    const age = models.source === "docs" ? Date.now() - Date.parse(models.fetchedAt) : Infinity;
    if (!force && age < MODELS_TTL) return;
    models.loading = true;
    models.error = null;
    if (STEPS[step].id === "model") renderMain();
    try {
      const res = await fetch(MODELS_DOC_API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = EMS.parseModelsDoc(await res.text());
      if (!list.length) throw new Error("No models found in the docs page");
      models = { models: list, fetchedAt: new Date().toISOString(), source: "docs" };
      safeSet(MODELS_KEY, JSON.stringify(models));
      if (force) toast(`Loaded ${list.length} models from GitHub Docs`);
    } catch (e) {
      models.error = e.message || String(e);
      if (force) toast("Couldn't refresh models — using saved list");
    } finally {
      models.loading = false;
      if (STEPS[step].id === "model") renderMain();
    }
  }

  // What's new: changelog entries from js/whats-new.js drive a banner and "New" badges.
  const SEEN_KEY = "ems-whats-new-seen-ids";
  const WHATS_NEW = Array.isArray(window.EMS_WHATS_NEW) ? window.EMS_WHATS_NEW : [];
  const TODAY = new Date().toISOString().slice(0, 10);
  const saveSeen = (ids) => {
    // Only keep IDs that still exist so the stored list can't grow forever.
    const current = new Set(WHATS_NEW.map(EMS.whatsNewId));
    seenIds = [...new Set(ids)].filter((id) => current.has(id));
    safeSet(SEEN_KEY, JSON.stringify(seenIds));
  };
  let seenIds = null;
  try { seenIds = JSON.parse(safeGet(SEEN_KEY) || "null"); } catch { seenIds = null; }
  // First visit: mark everything as seen so there's no backlog to read through.
  if (!Array.isArray(seenIds)) saveSeen(WHATS_NEW.map(EMS.whatsNewId));
  const recent = EMS.recentHighlights(WHATS_NEW, TODAY);
  const NEW_STEPS = new Set(recent.steps);
  const NEW_KEYS = new Set(recent.keys);
  const newBadge = () => `<span class="badge-new">New</span>`;

  function loadState() {
    const raw = safeGet(STORE_KEY);
    if (!raw) return EMS.defaultState();
    try {
      // Merge onto defaults so new fields added later still exist.
      return deepMerge(EMS.defaultState(), JSON.parse(raw));
    } catch (e) {
      return EMS.defaultState();
    }
  }
  function deepMerge(base, over) {
    if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
    if (base && typeof base === "object" && over && typeof over === "object") {
      const out = { ...base };
      Object.keys(over).forEach((k) => (out[k] = k in base ? deepMerge(base[k], over[k]) : over[k]));
      return out;
    }
    return over === undefined ? base : over;
  }

  const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  function setPath(obj, path, val) {
    const parts = path.split(".");
    const last = parts.pop();
    const target = parts.reduce((o, k) => o[k], obj);
    target[last] = val;
  }

  // ------------------------------------------------------------------ metadata
  const CLIENTS = ["Copilot CLI", "VS Code", "Copilot app", "Cloud agent", "JetBrains"];
  const SUPPORT = {
    disableBypass: [1, 1, 1, 0, 1],
    rules: [1, 1, 1, 0, 0],
    computerUse: [1, 0, 1, 0, 0],
    model: [1, 1, 1, 1, 0],
    autoTier: [1, 1, 0, 0, 0],
    plugins: [1, 1, 1, 1, 1],
    telemetry: [1, 1, 1, 0, 1],
    remoteControl: [1, 1, 1, 0, 0],
    refresh: [1, 1, 1, 0, 0],
    mcp: [1, 1, 1, 0, 1],
    sandbox: [1, 1, 1, 0, 0],
  };

  const STEPS = [
    { id: "welcome", label: "Get started", render: renderWelcome },
    { id: "model", label: "Models", render: renderModel, keys: ["model", "autoTier"] },
    { id: "permissions", label: "Permissions", render: renderPermissions, keys: ["permissions"] },
    { id: "access", label: "Features & access", render: renderAccess, keys: ["features", "remoteControl", "forceRemoteSettingsRefresh"] },
    { id: "plugins", label: "Plugins", render: renderPlugins, keys: ["enabledPlugins", "extraKnownMarketplaces", "strictKnownMarketplaces"] },
    { id: "mcp", label: "MCP servers", render: renderMcp, keys: ["allowedMcpServers", "deniedMcpServers"] },
    { id: "sandbox", label: "Sandbox", render: renderSandbox, keys: ["sandbox"] },
    { id: "telemetry", label: "Telemetry", render: renderTelemetry, keys: ["telemetry"] },
    { id: "review", label: "Review & export", render: renderReview },
  ];
  if (step < 0 || step >= STEPS.length) step = 0;

  const RULE_PLACEHOLDER = { Shell: "git push *", PowerShell: "Remove-Item *", Read: "~/.ssh/**", Edit: "/src/**", Domain: "*.example.com" };
  const RULE_SUGGESTIONS = {
    deny: ["Shell(rm -rf *)", "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(./.env)", "Edit(//etc/**)", "Shell(sudo *)"],
    ask: ["Shell(git push *)", "Shell(curl *)", "Shell(npm publish *)", "Edit(/.github/workflows/**)", "Domain(api.github.com)"],
    allow: ["Shell(npm test *)", "Shell(git status)", "Read(/src/**)", "Domain(registry.npmjs.org)"],
  };

  const TEMPLATES = {
    plugin: () => ({ key: "", enabled: true }),
    marketplace: () => ({ name: "", source: EMS.parseSource({ source: "github" }), autoUpdate: "" }),
    strict: () => EMS.parseSource({ source: "github" }),
    mcp: () => ({ type: "serverUrl", value: "" }),
    kv: () => ({ key: "", value: "" }),
  };

  // ------------------------------------------------------------------ html helpers
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nid = () => `f${++uid}`;

  const ICONS = {
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    warning: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 1.7 1.7.8-1.7.8L19 20l-.8-1.7-1.7-.8 1.7-.8z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    arrowL: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    arrowR: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    sparkle: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/>',
    shield: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

  function support(key) {
    const s = SUPPORT[key];
    if (!s) return "";
    return `<div class="support" aria-label="Client support">${CLIENTS.map(
      (c, i) => `<span class="chip-client ${s[i] ? "yes" : "no"}" title="${esc(c)}: ${s[i] ? "supported" : "not supported"}">${esc(c)}</span>`
    ).join("")}</div>`;
  }

  function callout(level, html) {
    return `<div class="callout ${level}" role="${level === "error" ? "alert" : "note"}">${icon(level)}<div>${html}</div></div>`;
  }

  function switchCtl(path, checked, label, { rerender = true, muted = false } = {}) {
    return `<label class="switch"><input type="checkbox" data-path="${esc(path)}" data-fk="${esc(path)}" ${checked ? "checked" : ""} ${rerender ? "data-rerender" : ""}><span class="track"></span><span class="${muted ? "switch-label-muted" : ""}">${label}</span></label>`;
  }

  function card({ title, key, desc, sup, toggle, overridable, body = "", head = "" }) {
    const off = toggle && !toggle.checked;
    return `<section class="card ${off ? "is-off" : ""}">
      <div class="card-head">
        <div class="card-head-text">
          <h2 class="card-title">${title}${key ? ` <span class="card-key">${esc(key)}</span>` : ""}${key && NEW_KEYS.has(key) ? ` ${newBadge()}` : ""}</h2>
          ${desc ? `<p class="card-desc">${desc}</p>` : ""}
          ${sup ? support(sup) : ""}
        </div>
        ${toggle ? switchCtl(toggle.path, toggle.checked, toggle.label || "Manage", { muted: true }) : ""}
        ${head}
      </div>
      ${body || overridable ? `<div class="card-body">${body}${overridable ? overridableCtl(overridable.path, overridable.checked) : ""}</div>` : ""}
    </section>`;
  }

  function overridableCtl(path, checked) {
    return `<div class="tri-row"><div class="tri-row-text"><div class="label">Allow enterprise team overrides</div><div class="hint">Wraps the value as <code>{ "overridable": … }</code> so team files in <code>copilot/teams/</code> can replace it.</div></div>${switchCtl(path, checked, "", { muted: true })}</div>`;
  }

  function tri(path, value, labels = ["Not set", "On", "Off"]) {
    const name = nid();
    const opts = [["", labels[0]], ["true", labels[1]], ["false", labels[2]]];
    return `<div class="seg" role="radiogroup">${opts
      .map(
        ([v, l]) =>
          `<label><input type="radio" name="${name}" value="${v}" data-path="${esc(path)}" data-fk="${esc(path)}:${v}" ${value === v ? "checked" : ""}><span>${esc(l)}</span></label>`
      )
      .join("")}</div>`;
  }

  function triRow(path, label, desc, labels) {
    return `<div class="tri-row"><div class="tri-row-text"><div class="label">${label}</div>${desc ? `<div class="hint">${desc}</div>` : ""}</div>${tri(path, getPath(state, path), labels)}</div>`;
  }

  function textField(path, { label, hint, placeholder = "", mono = false, list = "", type = "text" } = {}) {
    const id = nid();
    const v = getPath(state, path);
    return `<div class="field">${label ? `<label class="label" for="${id}">${label}</label>` : ""}<input id="${id}" class="input ${mono ? "mono" : ""}" type="${type}" data-path="${esc(path)}" data-fk="${esc(path)}" value="${esc(v)}" placeholder="${esc(placeholder)}" ${list ? `list="${list}"` : ""} spellcheck="false" autocomplete="off">${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  }

  function selectField(path, options, { label, hint, rerender = false, cls = "" } = {}) {
    const id = nid();
    const v = getPath(state, path);
    return `<div class="field ${cls}">${label ? `<label class="label" for="${id}">${label}</label>` : ""}<select id="${id}" class="select" data-path="${esc(path)}" data-fk="${esc(path)}" ${rerender ? "data-rerender" : ""}>${options
      .map(([ov, ol]) => `<option value="${esc(ov)}" ${ov === v ? "selected" : ""}>${esc(ol)}</option>`)
      .join("")}</select>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;
  }

  function chips(listPath, items, cls = "") {
    if (!items.length) return `<p class="empty">Nothing added yet.</p>`;
    return `<div class="chips">${items
      .map(
        (it, i) =>
          `<span class="chip ${cls}">${esc(it)}<button type="button" data-action="remove-item" data-path="${esc(listPath)}" data-index="${i}" aria-label="Remove ${esc(it)}">${icon("x")}</button></span>`
      )
      .join("")}</div>`;
  }

  function suggestions(listPath, values, existing, action = "suggest") {
    const avail = values.filter((v) => !existing.includes(v));
    if (!avail.length) return "";
    return `<div class="suggest"><span class="suggest-label">Quick add:</span>${avail
      .map((v) => `<button type="button" data-action="${action}" data-path="${esc(listPath)}" data-value="${esc(v)}">+ ${esc(v)}</button>`)
      .join("")}</div>`;
  }

  // A text input + Add button that pushes strings onto an array.
  function stringList(listPath, { placeholder = "", label = "", suggest = [], cls = "" } = {}) {
    const items = getPath(state, listPath) || [];
    const id = nid();
    const fk = `${listPath}:composer`;
    return `<div class="field">
      ${label ? `<label class="label" for="${id}">${label}</label>` : ""}
      <div class="inline" data-composer>
        <input id="${id}" class="input mono" data-role="val" data-fk="${esc(fk)}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off">
        <button type="button" class="btn" data-action="add-string" data-path="${esc(listPath)}" data-fk-return="${esc(fk)}">${icon("plus")}Add</button>
      </div>
      ${chips(listPath, items, cls)}
      ${suggest.length ? suggestions(listPath, suggest, items) : ""}
    </div>`;
  }

  function kvList(listPath, { keyPh = "key", valPh = "value", addLabel = "Add", secret = false } = {}) {
    const items = getPath(state, listPath) || [];
    return `<div class="item-list">${items
      .map(
        (it, i) => `<div class="inline">
          <input class="input mono" data-path="${listPath}.${i}.key" data-fk="${listPath}.${i}.key" value="${esc(it.key)}" placeholder="${esc(keyPh)}" aria-label="Key" spellcheck="false" autocomplete="off">
          <input class="input mono" type="${secret ? "password" : "text"}" data-path="${listPath}.${i}.value" data-fk="${listPath}.${i}.value" value="${esc(it.value)}" placeholder="${esc(valPh)}" aria-label="Value" spellcheck="false" autocomplete="off">
          <button type="button" class="btn btn-icon btn-ghost btn-danger" data-action="remove-item" data-path="${listPath}" data-index="${i}" aria-label="Remove">${icon("trash")}</button>
        </div>`
      )
      .join("")}</div>
      <div><button type="button" class="btn btn-sm" data-action="add-item" data-path="${listPath}" data-template="kv" data-focus-field="key">${icon("plus")}${esc(addLabel)}</button></div>`;
  }

  function stepIssuesHtml(id) {
    const issues = EMS.validate(state).filter((i) => i.step === id);
    if (!issues.length) return "";
    return `<div class="issues">${issues.map((i) => callout(i.level, esc(i.message))).join("")}</div>`;
  }

  function header(eyebrow, title, desc) {
    return `<header class="step-header"><div class="eyebrow">${eyebrow || `Step ${step + 1} of ${STEPS.length}`}</div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ""}</header>`;
  }

  // ------------------------------------------------------------------ steps
  function renderWelcome() {
    const presets = [
      { id: "blank", icon: "file", title: "Blank", desc: "Start from an empty file and choose each setting yourself." },
      { id: "starter", icon: "sparkle", title: "Starter", desc: "Auto model as an overridable default. Low-risk way to test a rollout." },
      { id: "secure", icon: "shield", title: "Secure baseline", desc: "Disable bypass mode, deny risky commands and secrets, block computer use." },
      { id: "locked", icon: "lock", title: "Locked down", desc: "Strict sandbox, MCP allowlist, plugin lockdown, forced policy refresh." },
    ];
    return `
      <div class="hero">
        <h1>Build your Copilot managed settings</h1>
        <p>This wizard walks you through each supported key in <code>managed-settings.json</code>, the file enterprises use to centrally govern Copilot CLI, VS Code, the Copilot app, Copilot cloud agent, and JetBrains IDEs.</p>
      </div>
      <h2 style="font-size: var(--fs-lg); margin-bottom: 12px">Choose a starting point</h2>
      <div class="preset-grid">
        ${presets
          .map(
            (p) => `<button type="button" class="preset" data-action="preset" data-preset="${p.id}">
              <span class="preset-icon">${icon(p.icon)}</span>
              <span class="preset-title">${p.title}</span>
              <span class="preset-desc">${p.desc}</span>
            </button>`
          )
          .join("")}
        <button type="button" class="preset" data-action="open-import">
          <span class="preset-icon">${icon("upload")}</span>
          <span class="preset-title">Import existing</span>
          <span class="preset-desc">Paste or upload a current managed-settings.json to edit it.</span>
        </button>
      </div>
      <div style="height: 20px"></div>
      ${card({
        title: "How it works",
        body: `<ol style="margin:0; padding-left: 20px; display: grid; gap: 6px; color: var(--text-muted); font-size: var(--fs-sm)">
          <li>Go through each step and turn on <strong>Manage</strong> for the settings you want to enforce. Unmanaged settings are left out of the file.</li>
          <li>Watch the live preview update as you go. Validation flags problems before you deploy.</li>
          <li>Export the file and commit it to <code>copilot/managed-settings.json</code> in your enterprise's <code>.github-private</code> repository, or deploy it through MDM or local files.</li>
        </ol>
        <p class="hint">Reference: <a href="${DOCS}" target="_blank" rel="noopener">Enterprise managed settings</a> · <a href="${DOCS_START}" target="_blank" rel="noopener">Getting started</a></p>`,
      })}
      ${callout("info", "Your progress is saved automatically in this browser. Nothing is uploaded anywhere.")}
    `;
  }

  function renderModel() {
    const m = state.model;
    const t = state.autoTier;
    return `
      ${header(null, "Models", "Set the default model and Auto routing tier for new conversations. Users can still pick a different model per conversation.")}
      ${stepIssuesHtml("model")}
      ${card({
        title: "Default model",
        key: "model",
        desc: 'Use <code>auto</code> to let Copilot pick the best model from your enterprise\'s allowed models, or pick a specific model from the latest supported list.',
        sup: "model",
        toggle: { path: "model.managed", checked: m.managed },
        body: modelPicker(),
        overridable: { path: "model.overridable", checked: m.overridable },
      })}
      ${card({
        title: "Auto routing tier",
        key: "autoTier",
        desc: 'Default routing tier when the selected model is <code>auto</code>. Values other than <code>unmanaged</code> lock the tier against user and repository overrides. Requires Copilot CLI 1.0.87-0+ or VS Code 1.140.0+.',
        sup: "autoTier",
        toggle: { path: "autoTier.managed", checked: t.managed },
        body: selectField(
          "autoTier.value",
          [
            ["efficiency", "efficiency (most restrictive)"],
            ["balance", "balance"],
            ["intelligence", "intelligence"],
            ["unmanaged", "unmanaged (least restrictive)"],
          ],
          { label: "Tier" }
        ),
        overridable: { path: "autoTier.overridable", checked: t.overridable },
      })}
    `;
  }

  function modelPicker() {
    const v = state.model.value;
    const list = models.models || [];
    const known = v === "auto" || list.some((m) => m.id === v);
    const custom = modelCustom || (v !== "" && !known);
    const sel = custom ? "__custom" : v;
    const opt = (val, label) => `<option value="${esc(val)}" ${val === sel ? "selected" : ""}>${esc(label)}</option>`;
    const groups = {};
    list.forEach((m) => (groups[m.provider || "Other"] = groups[m.provider || "Other"] || []).push(m));
    const id = nid();
    const when = models.fetchedAt ? new Date(models.fetchedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "unknown";
    const srcText = models.loading
      ? "Fetching the latest list from GitHub Docs…"
      : `${list.length} models from ${models.source === "docs" ? "GitHub Docs" : "the bundled snapshot"} · updated ${esc(when)}${models.error ? ` · <span class="text-warn">refresh failed (${esc(models.error)})</span>` : ""} ·`;
    return `<div class="field">
        <label class="label" for="${id}">Model</label>
        <select id="${id}" class="select" data-role="model-pick" data-fk="model.pick">
          ${opt("", "Select a model…")}
          ${opt("auto", "auto — let Copilot choose (recommended)")}
          ${Object.keys(groups)
            .map((p) => `<optgroup label="${esc(p)}">${groups[p].map((m) => opt(m.id, `${m.name}${m.status && m.status !== "GA" ? ` · ${m.status}` : ""}  (${m.id})`)).join("")}</optgroup>`)
            .join("")}
          ${opt("__custom", "Custom model ID…")}
        </select>
        <div class="hint model-source">${srcText}
          <button type="button" class="link-btn" data-action="refresh-models" ${models.loading ? "disabled" : ""}>Refresh</button> ·
          <a href="${MODELS_DOC}" target="_blank" rel="noopener">Supported models ${icon("ext")}</a></div>
      </div>
      ${custom ? textField("model.value", { label: "Custom model ID", placeholder: "e.g. claude-sonnet-4.6", mono: true, hint: !v || known ? "" : "This ID isn't in the current supported models list. Check that it's spelled correctly and enabled for your enterprise." }) : ""}
      <p class="hint">IDs are derived from the model names in the docs. Models must also be enabled by your enterprise's model policies. In team files, <code>"unmanaged"</code> removes the default for that team.</p>`;
  }

  function ruleCard(kind, title, desc) {
    const r = state.permissions[kind];
    const listPath = `permissions.${kind}.rules`;
    const fk = `${listPath}:composer`;
    const id = nid();
    return card({
      title,
      key: `permissions.${kind}`,
      desc,
      sup: "rules",
      toggle: { path: `permissions.${kind}.managed`, checked: r.managed },
      body: `
        <div class="field">
          <label class="label" for="${id}">Add a rule</label>
          <div class="inline" data-composer>
            <select class="select" data-role="sel" aria-label="Selector">${EMS.RULE_SELECTORS.map((s) => `<option>${s}</option>`).join("")}</select>
            <input id="${id}" class="input mono" data-role="val" data-fk="${fk}" placeholder="${RULE_PLACEHOLDER.Shell}" spellcheck="false" autocomplete="off">
            <button type="button" class="btn" data-action="add-rule" data-kind="${kind}" data-fk-return="${fk}">${icon("plus")}Add</button>
          </div>
        </div>
        ${chips(listPath, r.rules, kind)}
        ${suggestions(listPath, RULE_SUGGESTIONS[kind], r.rules)}
      `,
      overridable: { path: `permissions.${kind}.overridable`, checked: r.overridable },
    });
  }

  function renderPermissions() {
    const p = state.permissions;
    return `
      ${header(null, "Permissions", "Control approval modes and which operations agents can perform. Rules apply with <strong>deny &gt; ask &gt; allow</strong> precedence.")}
      ${stepIssuesHtml("permissions")}
      ${card({
        title: "Disable bypass mode",
        key: "permissions.disableBypassPermissionsMode",
        desc: 'Prevents users from enabling bypass (YOLO / allow-all) mode. Sets the value to <code>"disable"</code>. Once any policy layer disables it, it cannot be relaxed.',
        sup: "disableBypass",
        head: switchCtl("permissions.disableBypassPermissionsMode", p.disableBypassPermissionsMode, "", { muted: true }),
      })}
      ${card({
        title: "Disable assisted permissions",
        key: "permissions.disableAssistedPermissionsMode",
        desc: "Prevents users from enabling assisted permissions. Doesn't affect bypass mode.",
        head: switchCtl("permissions.disableAssistedPermissionsMode", p.disableAssistedPermissionsMode, "", { muted: true }),
      })}
      ${card({
        title: "Default permission mode",
        key: "permissions.defaultMode",
        desc: "Default mode for new sessions. This is a default, not a lock. If the mode is blocked by policy, sessions start in manual approval.",
        body: selectField("permissions.defaultMode", [
          ["", "Not managed"],
          ["manual", "manual"],
          ["assisted", "assisted"],
          ["allow-all", "allow-all"],
        ]),
      })}
      <details class="card" style="padding: 14px 20px">
        <summary style="cursor:pointer; font-weight:650; font-size: var(--fs-sm)">Rule selector reference</summary>
        <div style="display:grid; gap:8px; margin-top: 12px; font-size: var(--fs-sm); color: var(--text-muted)">
          <div><code>Shell(...)</code> Shell commands. Use <code>git push *</code> to match a prefix; otherwise matches exact text. <code>Bash(...)</code> is an alias; <code>PowerShell(...)</code> is case-insensitive.</div>
          <div><code>Read(...)</code> File read paths. Supports globs and roots: <code>//</code> filesystem root, <code>/</code> workspace root, <code>~/</code> home, <code>./</code> cwd.</div>
          <div><code>Edit(...)</code> File write/edit paths, matched like Read. <code>Write(...)</code> is an alias.</div>
          <div><code>Domain(...)</code> Network origins. Bare hosts default to HTTPS; <code>*.example.com</code> includes subdomains.</div>
        </div>
      </details>
      ${ruleCard("deny", "Deny rules", "Blocks matching operations for all users, even if they also match an ask or allow rule.")}
      ${ruleCard("ask", "Ask rules", "Requires a fresh, one-time human approval. Can't be satisfied by bypass mode, auto-approval, hooks, or earlier grants.")}
      ${ruleCard("allow", "Allow rules", "Lets matching operations run without a prompt. Declaring an allow list means unmatched operations require approval.")}
    `;
  }

  function renderAccess() {
    const rc = state.remoteControl;
    return `
      ${header(null, "Features &amp; access", "Control computer use, remote control of sessions, and how clients refresh server-managed policy.")}
      ${stepIssuesHtml("access")}
      ${card({
        title: "Computer use",
        key: "features.computerUse",
        desc: "Set to <strong>Block</strong> to stop users from enabling computer use. Local settings can't override it. <strong>Allow</strong> or <strong>Not set</strong> leaves it up to users.",
        sup: "computerUse",
        body: `<div>${tri("features.computerUse", state.features.computerUse, ["Not set", "Allow", "Block"])}</div>`,
      })}
      ${card({
        title: "Remote control",
        key: "remoteControl",
        desc: "Restricts whether sessions hosted on this device can be remotely controlled. Doesn't affect controlling sessions hosted on other devices.",
        sup: "remoteControl",
        toggle: { path: "remoteControl.managed", checked: rc.managed },
        body: `${selectField(
          "remoteControl.mode",
          [
            ["disabled", "disabled: no remote control"],
            ["requireSSO", "requireSSO: only from SSO-authorized clients"],
            ["enabled", "enabled: unrestricted"],
          ],
          { label: "Mode", rerender: true }
        )}
        ${rc.mode === "requireSSO" ? stringList("remoteControl.orgs", { label: "GitHub.com organizations (githubDotComOrganizations)", placeholder: "ORG-NAME" }) : ""}`,
      })}
      ${card({
        title: "Force remote settings refresh",
        key: "forceRemoteSettingsRefresh",
        desc: "Requires a fresh server-managed settings download at startup, skipping the one-hour cache. If the download fails, affected features are restricted, so users need a network connection. Deliver it through MDM or a local file for it to apply from the first startup.",
        sup: "refresh",
        head: switchCtl("forceRemoteSettingsRefresh", state.forceRemoteSettingsRefresh, "", { muted: true }),
      })}
    `;
  }

  function sourceEditor(basePath, src, types) {
    const fields = EMS.SOURCE_FIELDS[src.source] || [];
    const req = EMS.SOURCE_REQUIRED[src.source];
    const PH = { repo: "OWNER/REPO", url: "https://example.com/marketplace.git", ref: "main", path: "plugins/", package: "@scope/marketplace", hostPattern: "^github\\.example\\.com$", pathPattern: "^/plugins/.*" };
    return `<div class="item-row">
      ${selectField(`${basePath}.source`, types.map((t) => [t, t]), { label: "Source", rerender: true, cls: "narrow" })}
      ${fields.map((f) => textField(`${basePath}.${f}`, { label: f + (f === req ? " *" : ""), placeholder: PH[f], mono: true })).join("")}
    </div>
    ${src.source === "url" ? `<div class="field"><div class="label">Headers</div>${kvList(`${basePath}.headers`, { keyPh: "Header", valPh: "Value", addLabel: "Add header" })}</div>` : ""}`;
  }

  function itemShell(listPath, i, inner) {
    return `<div class="item">${inner}<div><button type="button" class="btn btn-sm btn-ghost btn-danger" data-action="remove-item" data-path="${listPath}" data-index="${i}">${icon("trash")}Remove</button></div></div>`;
  }

  function renderPlugins() {
    const ep = state.enabledPlugins;
    const xm = state.extraKnownMarketplaces;
    const sm = state.strictKnownMarketplaces;
    return `
      ${header(null, "Plugins &amp; marketplaces", "Require or block specific plugins, add approved marketplaces, and restrict where plugins can be installed from.")}
      ${stepIssuesHtml("plugins")}
      ${card({
        title: "Enabled plugins",
        key: "enabledPlugins",
        desc: "Plugins that are automatically installed (<strong>on</strong>) or blocked (<strong>off</strong>) for all users. Keys use <code>PLUGIN-NAME@MARKETPLACE-NAME</code>.",
        sup: "plugins",
        toggle: { path: "enabledPlugins.managed", checked: ep.managed },
        body: `<div class="item-list">${ep.items
          .map(
            (it, i) => `<div class="inline">
              <input class="input mono" data-path="enabledPlugins.items.${i}.key" data-fk="enabledPlugins.items.${i}.key" value="${esc(it.key)}" placeholder="my-plugin@agent-skills" aria-label="Plugin key" spellcheck="false" autocomplete="off">
              ${switchCtl(`enabledPlugins.items.${i}.enabled`, it.enabled, it.enabled ? "Required" : "Blocked", { muted: true })}
              <button type="button" class="btn btn-icon btn-ghost btn-danger" data-action="remove-item" data-path="enabledPlugins.items" data-index="${i}" aria-label="Remove plugin">${icon("trash")}</button>
            </div>`
          )
          .join("")}</div>
          <div><button type="button" class="btn btn-sm" data-action="add-item" data-path="enabledPlugins.items" data-template="plugin" data-focus-field="key">${icon("plus")}Add plugin</button></div>`,
      })}
      ${card({
        title: "Extra known marketplaces",
        key: "extraKnownMarketplaces",
        desc: "Additional plugin marketplaces available to users. <strong>Auto update</strong> forces clients to refresh the marketplace (On) or keep auto updates off (Off).",
        sup: "plugins",
        toggle: { path: "extraKnownMarketplaces.managed", checked: xm.managed },
        body: `<div class="item-list">${xm.items
          .map((it, i) =>
            itemShell(
              "extraKnownMarketplaces.items",
              i,
              `<div class="item-row">${textField(`extraKnownMarketplaces.items.${i}.name`, { label: "Marketplace name *", placeholder: "agent-skills", mono: true })}
               <div class="field"><div class="label">Auto update</div>${tri(`extraKnownMarketplaces.items.${i}.autoUpdate`, it.autoUpdate, ["Client default", "On", "Off"])}</div></div>
               ${sourceEditor(`extraKnownMarketplaces.items.${i}.source`, it.source, EMS.MARKETPLACE_SOURCES)}`
            )
          )
          .join("")}</div>
          <div><button type="button" class="btn btn-sm" data-action="add-item" data-path="extraKnownMarketplaces.items" data-template="marketplace" data-focus-field="name">${icon("plus")}Add marketplace</button></div>`,
        overridable: { path: "extraKnownMarketplaces.overridable", checked: xm.overridable },
      })}
      ${card({
        title: "Strict known marketplaces",
        key: "strictKnownMarketplaces",
        desc: "Restricts plugin installation to only the listed marketplaces. <strong>An empty list means complete lockdown.</strong>",
        sup: "plugins",
        toggle: { path: "strictKnownMarketplaces.managed", checked: sm.managed },
        body: `<div class="item-list">${sm.items
          .map((it, i) => itemShell("strictKnownMarketplaces.items", i, sourceEditor(`strictKnownMarketplaces.items.${i}`, it, EMS.STRICT_SOURCES)))
          .join("")}</div>
          ${sm.items.length ? "" : `<p class="empty">No marketplaces listed: plugin installation is fully locked down.</p>`}
          <div><button type="button" class="btn btn-sm" data-action="add-item" data-path="strictKnownMarketplaces.items" data-template="strict">${icon("plus")}Add allowed marketplace</button></div>`,
        overridable: { path: "strictKnownMarketplaces.overridable", checked: sm.overridable },
      })}
    `;
  }

  function mcpList(listPath) {
    const items = getPath(state, listPath);
    const PH = { serverUrl: "https://mcp.example.com/*", serverCommand: "npx -y my-mcp-server", serverName: "microsoft/playwright-mcp" };
    return `<div class="item-list">${items
      .map(
        (it, i) => `<div class="inline">
          <select class="select" data-path="${listPath}.${i}.type" data-fk="${listPath}.${i}.type" data-rerender aria-label="Matcher type">${EMS.MCP_MATCHERS.map(
            (m) => `<option value="${m}" ${m === it.type ? "selected" : ""}>${m}</option>`
          ).join("")}</select>
          <input class="input mono" data-path="${listPath}.${i}.value" data-fk="${listPath}.${i}.value" value="${esc(it.value)}" placeholder="${esc(PH[it.type])}" aria-label="Matcher value" spellcheck="false" autocomplete="off">
          <button type="button" class="btn btn-icon btn-ghost btn-danger" data-action="remove-item" data-path="${listPath}" data-index="${i}" aria-label="Remove server">${icon("trash")}</button>
        </div>`
      )
      .join("")}</div>
      <div><button type="button" class="btn btn-sm" data-action="add-item" data-path="${listPath}" data-template="mcp" data-focus-field="value">${icon("plus")}Add server</button></div>`;
  }

  function renderMcp() {
    const a = state.allowedMcpServers;
    const d = state.deniedMcpServers;
    return `
      ${header(null, "MCP servers", "Allowlist and denylist Model Context Protocol servers. Deny always wins over allow. First-party Copilot servers can't be blocked.")}
      ${stepIssuesHtml("mcp")}
      ${card({
        title: "Matcher reference",
        body: `<div style="display:grid; gap:6px; font-size: var(--fs-sm); color: var(--text-muted)">
          <div><code>serverUrl</code> Remote (HTTP/SSE) servers. Supports <code>*</code> wildcards, e.g. <code>https://*.internal.example.com/*</code>.</div>
          <div><code>serverCommand</code> Local stdio servers. Exact command and arguments, with no wildcards. Enter it as a command line; it's split into an array.</div>
          <div><code>serverName</code> The user-assigned label. Users choose these, so prefer URL or command matchers to enforce identity.</div>
        </div>`,
      })}
      ${card({
        title: "Allowed MCP servers",
        key: "allowedMcpServers",
        desc: "When managed, only matching servers can run. Leave the list empty to block all servers except built-in defaults. Turn this off to allow all servers (subject to deny rules).",
        sup: "mcp",
        toggle: { path: "allowedMcpServers.managed", checked: a.managed },
        body: mcpList("allowedMcpServers.items") + suggestions("allowedMcpServers.items", ["https://api.githubcopilot.com/*"], a.items.map((i) => i.value), "suggest-mcp"),
        overridable: { path: "allowedMcpServers.overridable", checked: a.overridable },
      })}
      ${card({
        title: "Denied MCP servers",
        key: "deniedMcpServers",
        desc: "Servers that are always blocked, even if they match the allowlist.",
        sup: "mcp",
        toggle: { path: "deniedMcpServers.managed", checked: d.managed },
        body: mcpList("deniedMcpServers.items"),
      })}
    `;
  }

  function managedList(path, label, desc, placeholder) {
    const o = getPath(state, path);
    return `<div class="subcard">
      <div class="subcard-head"><div><div class="subcard-title">${label} <span class="card-key">${path.split(".").pop()}</span></div><div class="hint">${desc}</div></div>${switchCtl(`${path}.managed`, o.managed, "Manage", { muted: true })}</div>
      ${o.managed ? stringList(`${path}.items`, { placeholder }) : ""}
    </div>`;
  }

  function renderSandbox() {
    const sb = state.sandbox;
    const S = "sandbox";
    const body = `
      ${callout("warning", "Adding <code>sandbox</code> enforces minimum client versions for everyone in scope: <strong>VS Code 1.141.0</strong>, <strong>Copilot CLI 1.0.93</strong>, <strong>Copilot app 1.1.26</strong>. Older clients are blocked until they update.")}
      ${callout("info", "Force-on settings are enforced when <strong>On</strong>. Capability settings are prohibited when <strong>Off</strong>. <strong>Not set</strong> leaves the user's configuration unchanged.")}
      <div class="subcard">
        <div class="subcard-title">Enforcement</div>
        <div>
          ${triRow(`${S}.enabled`, "<code>enabled</code>", "Require sandboxing. Users can't turn it off in config or with <code>--no-sandbox</code>.")}
          ${triRow(`${S}.failIfUnavailable`, "<code>failIfUnavailable</code>", "With enabled, block model and tool execution if the sandbox can't be enforced.")}
          ${triRow(`${S}.allowBypass`, "<code>allowBypass</code>", "Off prevents commands running outside the sandbox and session-level opt-outs.")}
          ${triRow(`${S}.addCurrentWorkingDirectory`, "<code>addCurrentWorkingDirectory</code>", "Off stops automatically granting read/write to the current directory.")}
          ${triRow(`${S}.sandboxMcpServers`, "<code>sandboxMcpServers</code>", "On requires local MCP servers to run in the sandbox.")}
          ${triRow(`${S}.sandboxLspServers`, "<code>sandboxLspServers</code>", "On requires language servers to run in the sandbox.")}
          ${triRow(`${S}.allowDevToolAccess`, "<code>allowDevToolAccess</code>", "Off blocks automatic access to dev-tool config, caches, and registries. This can break builds.")}
          <div class="tri-row"><div class="tri-row-text"><div class="label"><code>learningMode: "deny"</code></div><div class="hint">Windows only. Enforce restrictions and record blocked access. (<code>"allow"</code> only works through native Windows device management.)</div></div>${switchCtl(`${S}.learningModeDeny`, sb.learningModeDeny, "", { muted: true })}</div>
        </div>
      </div>
      <div class="subcard">
        <div class="subcard-title">Credentials <span class="card-key">auth</span></div>
        <div>
          ${triRow(`${S}.authGit`, "<code>auth.git</code>", "Off stops injecting a GitHub token for Git HTTPS operations.")}
          ${triRow(`${S}.authGh`, "<code>auth.gh</code>", "Off stops injecting a GitHub token for GitHub CLI.")}
        </div>
      </div>
      <h3 style="font-size: var(--fs-md); margin-top: 4px">Filesystem <span class="card-key">userPolicy.filesystem</span></h3>
      ${managedList(`${S}.filesystem.readwritePaths`, "Read/write paths", "Restricts user grants to paths also listed here (exact match). Empty removes all user read/write grants.", "/workspace/shared")}
      ${managedList(`${S}.filesystem.readonlyPaths`, "Read-only paths", "Restricts user read-only grants to paths also listed here. Empty removes all user read-only grants.", "/opt/tools")}
      ${managedList(`${S}.filesystem.deniedPaths`, "Denied paths", "Added to the user's denied paths.", "~/.ssh")}
      <h3 style="font-size: var(--fs-md); margin-top: 4px">Network <span class="card-key">userPolicy.network</span></h3>
      <div class="subcard"><div>
        ${triRow(`${S}.network.allowOutbound`, "<code>allowOutbound</code>", "Off blocks outbound network access.")}
        ${triRow(`${S}.network.allowLocalNetwork`, "<code>allowLocalNetwork</code>", "Off restricts local network access. Behavior varies by OS.")}
      </div>
      ${textField(`${S}.network.proxyUrl`, { label: "Upstream proxy URL <span class=\"card-key\">proxy.url</span>", placeholder: "http://proxy.example.com:8080", mono: true })}
      </div>
      ${managedList(`${S}.network.allowedHosts`, "Allowed hosts", "Hostnames or IPs only, without URLs or ports. <code>*.example.com</code> matches subdomains; <code>*</code> matches every host.", "*.github.com")}
      ${managedList(`${S}.network.blockedHosts`, "Blocked hosts", "Take precedence over allowed hosts. Blocking a domain also blocks its subdomains.", "tracker.example.com")}
      <h3 style="font-size: var(--fs-md); margin-top: 4px">macOS Seatbelt <span class="card-key">userPolicy.seatbelt</span></h3>
      <div class="subcard"><div>${triRow(`${S}.keychainAccess`, "<code>keychainAccess</code>", "Off prevents sandboxed processes from accessing the macOS Keychain.")}</div></div>
    `;
    return `
      ${header(null, "Local sandbox", "Enforce minimum sandbox restrictions for command execution, filesystem and network access, credentials, and local MCP/LSP servers.")}
      ${stepIssuesHtml("sandbox")}
      ${card({
        title: "Sandbox policy",
        key: "sandbox",
        desc: "Managed sandbox settings impose restrictions rather than defaults.",
        sup: "sandbox",
        toggle: { path: "sandbox.managed", checked: sb.managed },
        body,
        overridable: { path: "sandbox.overridable", checked: sb.overridable },
      })}
    `;
  }

  function renderTelemetry() {
    const t = state.telemetry;
    const T = "telemetry";
    const body = `
      <div class="subcard"><div>
        ${triRow(`${T}.enabled`, "<code>enabled</code>", "Turn OpenTelemetry export on or off.")}
      </div></div>
      <div class="field-row">
        ${textField(`${T}.endpoint`, { label: "Collector endpoint <span class=\"card-key\">endpoint</span>", placeholder: "https://otel-collector.example.com", mono: true, type: "url" })}
        ${selectField(`${T}.protocol`, [["", "Not set"], ["http/protobuf", "http/protobuf"], ["http/json", "http/json"]], { label: "Protocol" })}
        ${textField(`${T}.serviceName`, { label: "Service name", placeholder: "copilot", mono: true })}
      </div>
      <div class="subcard">
        <div class="subcard-title">Capture controls <span class="card-key">capture</span></div>
        <div class="hint">Every class defaults to off. Fine-grained capture is supported in Copilot CLI, the Copilot app, and VS Code Agent Host sessions.</div>
        <div>
          ${triRow(`${T}.capture.identity`, "<code>identity</code>", "Account name, OS user, and machine name.")}
          ${triRow(`${T}.capture.prompts`, "<code>prompts</code>", "User, system, and developer prompts and model input.")}
          ${triRow(`${T}.capture.responses`, "<code>responses</code>", "Assistant responses and supported reasoning.")}
          ${triRow(`${T}.capture.toolArguments`, "<code>toolArguments</code>", "Raw tool arguments, commands, and MCP/plugin identifiers.")}
          ${triRow(`${T}.capture.toolOutput`, "<code>toolOutput</code>", "Tool results and execution errors.")}
          ${triRow(`${T}.capture.policyDetail`, "<code>policyDetail</code>", "Unbounded policy details such as raw sandbox path arrays.")}
        </div>
      </div>
      <div class="subcard"><div>
        ${triRow(`${T}.captureContent`, "<code>captureContent</code> <span class=\"hint\">(legacy)</span>", "Shorthand for prompts, responses, tool arguments/output, and policy detail.")}
        ${triRow(`${T}.lockCaptureContent`, "<code>lockCaptureContent</code>", "Stops local settings from enabling legacy content classes you haven't configured.")}
      </div></div>
      <div class="field"><div class="label">Resource attributes <span class="card-key">resourceAttributes</span></div>${kvList(`${T}.resourceAttributes`, { keyPh: "deployment.environment", valPh: "production", addLabel: "Add attribute" })}</div>
      <div class="field"><div class="label">HTTP headers <span class="card-key">headers</span></div><div class="hint">Sent with each telemetry request, for example an <code>Authorization</code> header. Requires an endpoint. Values are hidden here but written to the file in plain text.</div>${kvList(`${T}.headers`, { keyPh: "Authorization", valPh: "Bearer …", addLabel: "Add header", secret: true })}</div>
      <div class="tri-row"><div class="tri-row-text"><div class="label">Disable dynamic headers <span class="card-key">headersProvider: false</span></div><div class="hint">Copilot CLI only. Prevents a user-configured headers helper from supplying headers.</div></div>${switchCtl(`${T}.disableHeadersProvider`, t.disableHeadersProvider, "", { muted: true })}</div>
      ${callout("warning", "Captured content can include source code, file contents, prompts, commands, and secrets. Enable only the classes you need and send data to an approved collector.")}
    `;
    return `
      ${header(null, "Telemetry", "Route Copilot usage data to your own OpenTelemetry collector. Managed values take precedence over local settings and environment variables.")}
      ${stepIssuesHtml("telemetry")}
      ${card({
        title: "OpenTelemetry export",
        key: "telemetry",
        sup: "telemetry",
        toggle: { path: "telemetry.managed", checked: t.managed },
        body,
      })}
    `;
  }

  function renderReview() {
    const built = EMS.buildSettings(state);
    const issues = EMS.validate(state);
    const count = (l) => issues.filter((i) => i.level === l).length;
    const keys = countLeafKeys(built);
    const teams = EMS.hasOverridable(state);
    const stepIndex = (id) => STEPS.findIndex((s) => s.id === id);
    return `
      ${header(null, "Review &amp; export", "Check for issues, then download or copy your file.")}
      <div class="summary-grid" style="margin-bottom: 16px">
        <div class="stat"><div class="stat-num">${Object.keys(built).length}</div><div class="stat-label">Top-level keys</div></div>
        <div class="stat"><div class="stat-num">${keys}</div><div class="stat-label">Values set</div></div>
        <div class="stat"><div class="stat-num">${count("error")}</div><div class="stat-label">Errors</div></div>
        <div class="stat"><div class="stat-num">${count("warning")}</div><div class="stat-label">Warnings</div></div>
      </div>
      ${card({
        title: "Validation",
        body: issues.length
          ? `<div class="issues">${issues
              .map(
                (i) => `<div class="issue ${i.level}"><span class="lvl">${i.level}</span><span class="msg">${esc(i.message)}</span>
                  <button type="button" class="btn btn-sm btn-ghost go" data-action="goto" data-step="${stepIndex(i.step)}">Fix in ${esc(STEPS[stepIndex(i.step)].label)} →</button></div>`
              )
              .join("")}</div>`
          : callout("info", "No issues found. Your file looks good."),
      })}
      ${!Object.keys(built).length ? callout("warning", "The file is empty. Go back and manage at least one setting.") : ""}
      ${card({
        title: "Export",
        body: `<div class="inline" style="flex-wrap: wrap">
            <button type="button" class="btn btn-primary" data-action="download">${icon("download")}Download managed-settings.json</button>
            <button type="button" class="btn" data-action="copy">${icon("copy")}Copy to clipboard</button>
          </div>`,
      })}
      ${card({
        title: "Deploy",
        body: `<ol style="margin:0; padding-left: 20px; display: grid; gap: 6px; font-size: var(--fs-sm); color: var(--text-muted)">
            <li>In your enterprise's <code>.github-private</code> repository (selected as the source of client governance), commit the file to <code>copilot/managed-settings.json</code> on the default branch.</li>
            <li>Open <strong>Enterprise → AI controls → Agents</strong> and check the <em>Copilot settings validation</em> section.</li>
            <li>Clients pick up server-managed changes within about an hour, or right away after a restart or sign-in.</li>
          </ol>
          <p class="hint">Prefer MDM or local file delivery? See <a href="${DOCS_DEPLOY}" target="_blank" rel="noopener">Choosing how to deploy enterprise-managed settings</a>.</p>`,
      })}
      ${
        teams
          ? card({
              title: "Team overrides",
              desc: `Some keys are marked <code>overridable</code>. To specialize them for enterprise teams, add team files and a mapping. See <a href="${DOCS_TEAMS}" target="_blank" rel="noopener">Overriding settings for teams</a>.`,
              body: `<div class="tree">.github-private/
└── copilot/
    ├── managed-settings.json
    ├── team-mappings.json    { "TEAM-FILE.json": ["team-slug"] }
    └── teams/
        └── TEAM-FILE.json    { "model": "unmanaged" }</div>`,
            })
          : ""
      }
    `;
  }

  function countLeafKeys(o) {
    if (Array.isArray(o)) return o.length ? o.reduce((n, v) => n + (v && typeof v === "object" ? countLeafKeys(v) : 1), 0) : 1;
    if (o && typeof o === "object") return Object.values(o).reduce((n, v) => n + (v && typeof v === "object" ? countLeafKeys(v) : 1), 0);
    return 1;
  }

  // ------------------------------------------------------------------ render
  const $ = (sel) => document.querySelector(sel);

  function render() {
    renderSteps();
    renderMain();
    updatePreview();
  }

  function renderSteps() {
    const built = EMS.buildSettings(state);
    const issues = EMS.validate(state);
    $("#steps").innerHTML = STEPS.map((s, i) => {
      const n = s.keys ? s.keys.reduce((acc, k) => acc + (k in built ? (k === "permissions" ? Object.keys(built.permissions).length : 1) : 0), 0) : 0;
      const errs = issues.filter((x) => x.step === s.id && x.level === "error").length;
      const warns = issues.filter((x) => x.step === s.id && x.level === "warning").length;
      const meta = s.keys ? (n ? `${n} set` : "") : "";
      const dot = errs ? `<span class="step-dot" title="${errs} error(s)"></span>` : warns ? `<span class="step-dot warn" title="${warns} warning(s)"></span>` : "";
      return `<li><button type="button" class="step-btn ${n ? "configured" : ""}" data-action="goto" data-step="${i}" ${i === step ? 'aria-current="step"' : ""}>
        <span class="step-num">${i + 1}</span><span class="step-label">${esc(s.label)}</span>${NEW_STEPS.has(s.id) ? newBadge() : ""}<span class="step-meta">${meta}</span>${dot}</button></li>`;
    }).join("");
    const pct = Math.round((step / (STEPS.length - 1)) * 100);
    $("#progress-fill").style.width = pct + "%";
    $("#progress-label").textContent = `Step ${step + 1} of ${STEPS.length}`;
    const cur = $('#steps [aria-current="step"]');
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderMain() {
    const active = document.activeElement;
    const fk = pendingFocus || (active && active.dataset && active.dataset.fk);
    uid = 0;
    const s = STEPS[step];
    const nav = `<div class="step-nav">
      ${step > 0 ? `<button type="button" class="btn" data-action="prev">${icon("arrowL")}Back</button>` : "<span></span>"}
      ${step < STEPS.length - 1 ? `<button type="button" class="btn btn-primary" data-action="next">${step === 0 ? "Start" : "Next"}: ${esc(STEPS[step + 1].label)}${icon("arrowR")}</button>` : "<span></span>"}
    </div>`;
    $("#main").innerHTML = s.render() + nav;
    if (fk) {
      const el = document.querySelector(`[data-fk="${CSS.escape(fk)}"]`);
      if (el) el.focus();
    }
    pendingFocus = null;
  }

  const WHATS_NEW_LABELS = { setting: "Setting", model: "Models", fix: "Fix" };

  function renderWhatsNew() {
    const el = $("#whats-new");
    if (!el) return;
    const status = $("#whats-new-status");
    const entries = EMS.unseenEntries(WHATS_NEW, seenIds);
    if (!entries.length) {
      el.hidden = true;
      el.innerHTML = "";
      if (status) status.textContent = "";
      return;
    }
    const item = (e) => {
      const i = STEPS.findIndex((st) => st.id === e.step);
      const title = i >= 0
        ? `<button type="button" class="link-btn" data-action="goto" data-step="${i}">${esc(e.title)}</button>`
        : `<span>${esc(e.title)}</span>`;
      const when = new Date(e.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return `<li><span class="wn-tag wn-${esc(e.type)}">${esc(WHATS_NEW_LABELS[e.type] || e.type)}</span>${title}<time datetime="${esc(e.date)}">${esc(when)}</time></li>`;
    };
    const first = entries.slice(0, 5).map(item).join("");
    const rest = entries.slice(5);
    const more = rest.length
      ? `<details class="wn-more"><summary>Show ${rest.length} more</summary><ul>${rest.map(item).join("")}</ul></details>`
      : "";
    el.innerHTML = `<div class="whats-new-card">
      <div class="whats-new-icon">${icon("sparkle")}</div>
      <div class="whats-new-body">
        <h2 class="whats-new-title">What's new since your last visit</h2>
        <ul>${first}</ul>${more}
      </div>
      <button type="button" class="btn btn-icon btn-ghost" data-action="dismiss-whats-new" aria-label="Dismiss what's new" title="Dismiss">${icon("x")}</button>
    </div>`;
    el.hidden = false;
    // The banner region starts hidden, so announce through a separate, always-present live region.
    if (status) status.textContent = `What's new: ${entries.length} change${entries.length > 1 ? "s" : ""} since your last visit.`;
  }

  function dismissWhatsNew() {
    saveSeen([...seenIds, ...EMS.unseenEntries(WHATS_NEW, seenIds).map(EMS.whatsNewId)]);
    renderWhatsNew();
  }

  function highlight(json) {
    return esc(json).replace(
      /(&quot;(?:\\.|[^&\\]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)|([{}\[\],])/g,
      (m, str, colon, bool, num, punc) => {
        if (str) return colon ? `<span class="k">${str}</span><span class="p">:</span>` : `<span class="s">${str}</span>`;
        if (bool) return `<span class="b">${bool}</span>`;
        if (num) return `<span class="n">${num}</span>`;
        return `<span class="p">${punc}</span>`;
      }
    );
  }

  function currentJson() {
    return JSON.stringify(EMS.buildSettings(state), null, 2) + "\n";
  }

  function updatePreview() {
    const json = currentJson();
    $("#json-preview").innerHTML = highlight(json);
    const issues = EMS.validate(state);
    const errs = issues.filter((i) => i.level === "error").length;
    const warns = issues.filter((i) => i.level === "warning").length;
    const pill = $("#status-pill");
    pill.className = `status-pill ${errs ? "err" : warns ? "warn" : "ok"}`;
    pill.textContent = errs ? `${errs} error${errs > 1 ? "s" : ""}` : warns ? `${warns} warning${warns > 1 ? "s" : ""}` : "Valid";
    const lines = json.split("\n").length - 1;
    $("#preview-stats").textContent = `${lines} lines · ${new Blob([json]).size} B`;
  }

  function commit(rerender) {
    safeSet(STORE_KEY, JSON.stringify(state));
    updatePreview();
    renderSteps();
    if (rerender) renderMain();
  }

  function goto(i) {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    safeSet(STEP_KEY, String(step));
    render();
    $("#main").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------------------------------------------------------------------ events
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.path) return;
    if (el.matches("input[type=text], input[type=url], input[type=password], input:not([type]), textarea")) {
      setPath(state, el.dataset.path, el.value);
      commit(false);
    }
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.role === "model-pick") {
      if (el.value === "__custom") {
        modelCustom = true;
        if (state.model.value === "auto" || (models.models || []).some((m) => m.id === state.model.value)) state.model.value = "";
        pendingFocus = "model.value";
      } else {
        modelCustom = false;
        state.model.value = el.value;
      }
      if (el.value) state.model.managed = true;
      commit(true);
      return;
    }
    if (el.dataset && el.dataset.role === "sel") {
      const input = el.closest("[data-composer]").querySelector('[data-role="val"]');
      input.placeholder = RULE_PLACEHOLDER[el.value] || "";
      return;
    }
    if (!el.dataset || !el.dataset.path) return;
    if (el.type === "checkbox") setPath(state, el.dataset.path, el.checked);
    else if (el.type === "radio") {
      if (!el.checked) return;
      setPath(state, el.dataset.path, el.value);
    } else if (el.tagName === "SELECT") setPath(state, el.dataset.path, el.value);
    else return;
    commit(el.type === "checkbox" || el.hasAttribute("data-rerender"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const composer = e.target.closest && e.target.closest("[data-composer]");
    if (composer && e.target.dataset.role === "val") {
      e.preventDefault();
      composer.querySelector("[data-action]").click();
    }
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const a = btn.dataset.action;
    const actions = {
      goto: () => goto(Number(btn.dataset.step)),
      "dismiss-whats-new": dismissWhatsNew,
      next: () => goto(step + 1),
      prev: () => goto(step - 1),
      preset: () => applyPreset(btn.dataset.preset),
      "add-item": () => {
        autoManage(btn.dataset.path);
        const list = getPath(state, btn.dataset.path);
        list.push(TEMPLATES[btn.dataset.template]());
        if (btn.dataset.focusField) pendingFocus = `${btn.dataset.path}.${list.length - 1}.${btn.dataset.focusField}`;
        commit(true);
      },
      "remove-item": () => {
        getPath(state, btn.dataset.path).splice(Number(btn.dataset.index), 1);
        commit(true);
      },
      "add-string": () => {
        const input = btn.closest("[data-composer]").querySelector('[data-role="val"]');
        const v = input.value.trim();
        if (!v) return input.focus();
        const list = getPath(state, btn.dataset.path);
        if (!list.includes(v)) list.push(v);
        autoManage(btn.dataset.path);
        pendingFocus = btn.dataset.fkReturn;
        commit(true);
      },
      "add-rule": () => {
        const box = btn.closest("[data-composer]");
        const sel = box.querySelector('[data-role="sel"]').value;
        const input = box.querySelector('[data-role="val"]');
        let v = input.value.trim();
        if (!v) return input.focus();
        if (!/^\w+\(.*\)$/.test(v)) v = `${sel}(${v})`;
        const r = state.permissions[btn.dataset.kind];
        if (!r.rules.includes(v)) r.rules.push(v);
        r.managed = true;
        pendingFocus = btn.dataset.fkReturn;
        commit(true);
      },
      suggest: () => {
        const list = getPath(state, btn.dataset.path);
        if (!list.includes(btn.dataset.value)) list.push(btn.dataset.value);
        autoManage(btn.dataset.path);
        commit(true);
      },
      "suggest-mcp": () => {
        getPath(state, btn.dataset.path).push({ type: "serverUrl", value: btn.dataset.value });
        autoManage(btn.dataset.path);
        commit(true);
      },
      copy: copyJson,
      "refresh-models": () => refreshModels(true),
      download: downloadJson,
      theme: cycleTheme,
      reset: () => {
        if (!confirm("Clear all settings and start over?")) return;
        state = EMS.defaultState(); modelCustom = false;
        commit(false);
        goto(0);
        toast("Configuration reset");
      },
      "open-import": openImport,
      "do-import": doImport,
    };
    if (actions[a]) {
      e.preventDefault();
      actions[a]();
    }
  });

  // Adding content to an unmanaged section implies the admin wants it managed.
  function autoManage(path) {
    const parts = path.split(".");
    for (let i = parts.length - 1; i > 0; i--) {
      const obj = getPath(state, parts.slice(0, i).join("."));
      if (obj && typeof obj === "object" && obj.managed === false) obj.managed = true;
    }
  }

  function isEmptyConfig() {
    return !Object.keys(EMS.buildSettings(state)).length;
  }

  function applyPreset(name) {
    if (!isEmptyConfig() && !confirm("Replace your current configuration with this starting point?")) return;
    state = name === "blank" ? EMS.defaultState() : EMS.preset(name); modelCustom = false;
    commit(false);
    goto(1);
    toast(name === "blank" ? "Starting from a blank file" : "Preset applied. Review each step");
  }

  // ------------------------------------------------------------------ import / export
  function openImport() {
    $("#import-error").textContent = "";
    $("#import-text").value = isEmptyConfig() ? "" : currentJson();
    $("#import-dialog").showModal();
    $("#import-text").focus();
  }

  function doImport() {
    try {
      state = EMS.parseSettings($("#import-text").value); modelCustom = false;
      $("#import-dialog").close();
      commit(false);
      goto(1);
      toast("Settings imported");
    } catch (err) {
      $("#import-error").textContent = "Couldn't import: " + err.message;
    }
  }

  $("#import-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((t) => {
      $("#import-text").value = t;
      $("#import-error").textContent = "";
    });
    e.target.value = "";
  });

  function copyJson() {
    const text = currentJson();
    const done = () => toast("Copied managed-settings.json");
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      toast("Copy failed. Select the preview text instead");
    }
    ta.remove();
  }

  function downloadJson() {
    const errs = EMS.validate(state).filter((i) => i.level === "error").length;
    if (errs && !confirm(`There ${errs === 1 ? "is 1 error" : `are ${errs} errors`} in your settings. Download anyway?`)) return;
    const blob = new Blob([currentJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "managed-settings.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Downloaded managed-settings.json");
  }

  // ------------------------------------------------------------------ theme + toast
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
    const btn = $("#theme-btn");
    const label = t === "light" ? "Light" : t === "dark" ? "Dark" : "System";
    btn.innerHTML = icon(t === "light" ? "sun" : t === "dark" ? "moon" : "monitor");
    btn.title = `Theme: ${label} (click to change)`;
    btn.setAttribute("aria-label", `Color theme: ${label}. Click to change.`);
  }

  function cycleTheme() {
    const cur = safeGet(THEME_KEY) || "system";
    const next = { system: "light", light: "dark", dark: "system" }[cur] || "system";
    safeSet(THEME_KEY, next);
    applyTheme(next);
    toast(`Theme: ${next[0].toUpperCase() + next.slice(1)}`);
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ------------------------------------------------------------------ init
  applyTheme(safeGet(THEME_KEY) || "system");
  render();
  // Fill the live region after load so screen readers announce it without moving focus.
  setTimeout(renderWhatsNew, 300);
  refreshModels(false);
})();
