/*
 * Core logic for the managed-settings.json builder.
 * Pure functions (no DOM) so it can be unit-tested with Node.
 * Schema reference:
 * https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/enterprise-administrators/enterprise-managed-settings
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EMS = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Tri-state values used for optional booleans: "" = not managed (omit), "true", "false".
  const UNSET = "";

  const RULE_SELECTORS = ["Shell", "PowerShell", "Read", "Edit", "Domain"];
  const MARKETPLACE_SOURCES = ["github", "git", "directory"];
  const STRICT_SOURCES = ["github", "git", "url", "npm", "file", "directory", "hostPattern", "pathPattern"];
  const MCP_MATCHERS = ["serverUrl", "serverCommand", "serverName"];

  function defaultState() {
    return {
      model: { managed: false, value: "auto", overridable: false },
      autoTier: { managed: false, value: "balance", overridable: false },
      permissions: {
        disableBypassPermissionsMode: false,
        disableAssistedPermissionsMode: false,
        defaultMode: UNSET,
        deny: { managed: false, overridable: false, rules: [] },
        ask: { managed: false, overridable: false, rules: [] },
        allow: { managed: false, overridable: false, rules: [] },
      },
      features: { computerUse: UNSET },
      forceRemoteSettingsRefresh: false,
      remoteControl: { managed: false, mode: "requireSSO", orgs: [] },
      enabledPlugins: { managed: false, items: [] }, // {key, enabled}
      extraKnownMarketplaces: { managed: false, overridable: false, items: [] }, // {name, source:{...}, autoUpdate}
      strictKnownMarketplaces: { managed: false, overridable: false, items: [] }, // source objects
      allowedMcpServers: { managed: false, overridable: false, items: [] }, // {type, value}
      deniedMcpServers: { managed: false, items: [] },
      sandbox: {
        managed: false,
        overridable: false,
        enabled: UNSET,
        failIfUnavailable: UNSET,
        allowBypass: UNSET,
        addCurrentWorkingDirectory: UNSET,
        sandboxMcpServers: UNSET,
        sandboxLspServers: UNSET,
        allowDevToolAccess: UNSET,
        learningModeDeny: false,
        authGit: UNSET,
        authGh: UNSET,
        filesystem: {
          readwritePaths: { managed: false, items: [] },
          readonlyPaths: { managed: false, items: [] },
          deniedPaths: { managed: false, items: [] },
        },
        network: {
          allowOutbound: UNSET,
          allowLocalNetwork: UNSET,
          allowedHosts: { managed: false, items: [] },
          blockedHosts: { managed: false, items: [] },
          proxyUrl: "",
        },
        keychainAccess: UNSET,
      },
      telemetry: {
        managed: false,
        enabled: "true",
        endpoint: "",
        protocol: UNSET,
        capture: {
          identity: UNSET,
          prompts: UNSET,
          responses: UNSET,
          toolArguments: UNSET,
          toolOutput: UNSET,
          policyDetail: UNSET,
        },
        captureContent: UNSET,
        lockCaptureContent: UNSET,
        serviceName: "",
        resourceAttributes: [], // {key, value}
        headers: [], // {key, value}
        disableHeadersProvider: false,
      },
    };
  }

  // ---------- helpers ----------
  const tri = (v) => (v === "true" ? true : v === "false" ? false : undefined);
  const toTri = (v) => (v === true ? "true" : v === false ? "false" : UNSET);
  const clean = (s) => (typeof s === "string" ? s.trim() : s);
  const wrap = (value, overridable) => (overridable ? { overridable: value } : value);
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

  function unwrap(v) {
    if (isObj(v) && Object.keys(v).length === 1 && "overridable" in v) return { value: v.overridable, overridable: true };
    return { value: v, overridable: false };
  }

  function setIf(obj, key, val) {
    if (val !== undefined && val !== "" && val !== null) obj[key] = val;
  }

  const SOURCE_FIELDS = {
    github: ["repo", "ref", "path"],
    git: ["url", "ref", "path"],
    url: ["url"],
    npm: ["package"],
    file: ["path"],
    directory: ["path"],
    hostPattern: ["hostPattern"],
    pathPattern: ["pathPattern"],
  };
  const SOURCE_REQUIRED = { github: "repo", git: "url", url: "url", npm: "package", file: "path", directory: "path", hostPattern: "hostPattern", pathPattern: "pathPattern" };

  function buildSource(src) {
    const out = { source: src.source };
    (SOURCE_FIELDS[src.source] || []).forEach((f) => setIf(out, f, clean(src[f])));
    if (src.source === "url") {
      const h = kvToObj(src.headers);
      if (Object.keys(h).length) out.headers = h;
    }
    return out;
  }

  function kvToObj(list) {
    const o = {};
    (list || []).forEach(({ key, value }) => {
      const k = clean(key);
      if (k) o[k] = value == null ? "" : value;
    });
    return o;
  }

  function objToKv(o) {
    return isObj(o) ? Object.entries(o).map(([key, value]) => ({ key, value: String(value) })) : [];
  }

  // Splits a command string into argv, honoring simple single/double quotes.
  function parseCommand(str) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(str || ""))) out.push(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
    return out;
  }

  function formatCommand(arr) {
    return (arr || []).map((a) => (/\s/.test(a) || a === "" ? `"${a}"` : a)).join(" ");
  }

  function buildMcp(items) {
    return items
      .filter((i) => clean(i.value))
      .map((i) => (i.type === "serverCommand" ? { serverCommand: parseCommand(i.value) } : { [i.type]: clean(i.value) }));
  }

  // ---------- build ----------
  function buildSettings(s) {
    const out = {};

    const features = {};
    setIf(features, "computerUse", tri(s.features.computerUse));
    if (Object.keys(features).length) out.features = features;

    if (s.model.managed && clean(s.model.value)) out.model = wrap(clean(s.model.value), s.model.overridable);
    if (s.autoTier.managed && s.autoTier.value) out.autoTier = wrap(s.autoTier.value, s.autoTier.overridable);

    const p = {};
    if (s.permissions.disableBypassPermissionsMode) p.disableBypassPermissionsMode = "disable";
    if (s.permissions.disableAssistedPermissionsMode) p.disableAssistedPermissionsMode = true;
    setIf(p, "defaultMode", s.permissions.defaultMode);
    ["deny", "ask", "allow"].forEach((k) => {
      const r = s.permissions[k];
      if (r.managed) p[k] = wrap(r.rules.map(clean).filter(Boolean), r.overridable);
    });
    if (Object.keys(p).length) out.permissions = p;

    if (s.enabledPlugins.managed) {
      const ep = {};
      s.enabledPlugins.items.forEach((i) => {
        if (clean(i.key)) ep[clean(i.key)] = !!i.enabled;
      });
      out.enabledPlugins = ep;
    }

    if (s.extraKnownMarketplaces.managed) {
      const m = {};
      s.extraKnownMarketplaces.items.forEach((i) => {
        if (!clean(i.name)) return;
        const entry = { source: buildSource(i.source) };
        const au = tri(i.autoUpdate);
        if (au !== undefined) entry.autoUpdate = au;
        m[clean(i.name)] = entry;
      });
      out.extraKnownMarketplaces = wrap(m, s.extraKnownMarketplaces.overridable);
    }

    if (s.strictKnownMarketplaces.managed) {
      out.strictKnownMarketplaces = wrap(s.strictKnownMarketplaces.items.map(buildSource), s.strictKnownMarketplaces.overridable);
    }

    const t = s.telemetry;
    if (t.managed) {
      const o = {};
      setIf(o, "enabled", tri(t.enabled));
      setIf(o, "endpoint", clean(t.endpoint));
      setIf(o, "protocol", t.protocol);
      const cap = {};
      Object.keys(t.capture).forEach((k) => setIf(cap, k, tri(t.capture[k])));
      if (Object.keys(cap).length) o.capture = cap;
      setIf(o, "captureContent", tri(t.captureContent));
      setIf(o, "lockCaptureContent", tri(t.lockCaptureContent));
      setIf(o, "serviceName", clean(t.serviceName));
      const ra = kvToObj(t.resourceAttributes);
      if (Object.keys(ra).length) o.resourceAttributes = ra;
      const hd = kvToObj(t.headers);
      if (Object.keys(hd).length) o.headers = hd;
      if (t.disableHeadersProvider) o.headersProvider = false;
      out.telemetry = o;
    }

    if (s.remoteControl.managed) {
      const rc = { mode: s.remoteControl.mode };
      if (s.remoteControl.mode === "requireSSO") rc.githubDotComOrganizations = s.remoteControl.orgs.map(clean).filter(Boolean);
      out.remoteControl = rc;
    }

    if (s.forceRemoteSettingsRefresh) out.forceRemoteSettingsRefresh = true;

    if (s.allowedMcpServers.managed) out.allowedMcpServers = wrap(buildMcp(s.allowedMcpServers.items), s.allowedMcpServers.overridable);
    if (s.deniedMcpServers.managed) out.deniedMcpServers = buildMcp(s.deniedMcpServers.items);

    const sb = s.sandbox;
    if (sb.managed) {
      const o = {};
      ["enabled", "failIfUnavailable", "allowBypass", "addCurrentWorkingDirectory", "sandboxMcpServers", "sandboxLspServers", "allowDevToolAccess"].forEach((k) =>
        setIf(o, k, tri(sb[k]))
      );
      if (sb.learningModeDeny) o.learningMode = "deny";
      const auth = {};
      setIf(auth, "git", tri(sb.authGit));
      setIf(auth, "gh", tri(sb.authGh));
      if (Object.keys(auth).length) o.auth = auth;

      const up = {};
      const fs = {};
      ["readwritePaths", "readonlyPaths", "deniedPaths"].forEach((k) => {
        if (sb.filesystem[k].managed) fs[k] = sb.filesystem[k].items.map(clean).filter(Boolean);
      });
      if (Object.keys(fs).length) up.filesystem = fs;
      const net = {};
      setIf(net, "allowOutbound", tri(sb.network.allowOutbound));
      setIf(net, "allowLocalNetwork", tri(sb.network.allowLocalNetwork));
      ["allowedHosts", "blockedHosts"].forEach((k) => {
        if (sb.network[k].managed) net[k] = sb.network[k].items.map(clean).filter(Boolean);
      });
      if (clean(sb.network.proxyUrl)) net.proxy = { url: clean(sb.network.proxyUrl) };
      if (Object.keys(net).length) up.network = net;
      const kc = tri(sb.keychainAccess);
      if (kc !== undefined) up.seatbelt = { keychainAccess: kc };
      if (Object.keys(up).length) o.userPolicy = up;

      out.sandbox = wrap(o, sb.overridable);
    }

    return out;
  }

  // ---------- parse (import) ----------
  function parseSettings(json) {
    const s = defaultState();
    const src = typeof json === "string" ? JSON.parse(json) : json;
    if (!isObj(src)) throw new Error("managed-settings.json must contain a JSON object.");

    if (isObj(src.features) && "computerUse" in src.features) s.features.computerUse = toTri(src.features.computerUse);

    // Legacy: permissions.model is read when top-level model is absent.
    let modelRaw = src.model;
    if (modelRaw === undefined && isObj(src.permissions) && src.permissions.model !== undefined) modelRaw = src.permissions.model;
    if (modelRaw !== undefined) {
      const u = unwrap(modelRaw);
      s.model = { managed: true, value: String(u.value), overridable: u.overridable };
    }
    if (src.autoTier !== undefined) {
      const u = unwrap(src.autoTier);
      s.autoTier = { managed: true, value: String(u.value), overridable: u.overridable };
    }

    const p = isObj(src.permissions) ? src.permissions : {};
    s.permissions.disableBypassPermissionsMode = p.disableBypassPermissionsMode !== undefined;
    s.permissions.disableAssistedPermissionsMode = p.disableAssistedPermissionsMode === true;
    if (typeof p.defaultMode === "string") s.permissions.defaultMode = p.defaultMode;
    ["deny", "ask", "allow"].forEach((k) => {
      if (p[k] !== undefined) {
        const u = unwrap(p[k]);
        s.permissions[k] = { managed: true, overridable: u.overridable, rules: Array.isArray(u.value) ? u.value.map(String) : [] };
      }
    });

    if (isObj(src.enabledPlugins)) {
      s.enabledPlugins = { managed: true, items: Object.entries(src.enabledPlugins).map(([key, v]) => ({ key, enabled: v !== false })) };
    }

    if (src.extraKnownMarketplaces !== undefined) {
      const u = unwrap(src.extraKnownMarketplaces);
      s.extraKnownMarketplaces = {
        managed: true,
        overridable: u.overridable,
        items: Object.entries(isObj(u.value) ? u.value : {}).map(([name, v]) => ({
          name,
          source: parseSource(v && v.source),
          autoUpdate: toTri(v && v.autoUpdate),
        })),
      };
    }

    if (src.strictKnownMarketplaces !== undefined) {
      const u = unwrap(src.strictKnownMarketplaces);
      s.strictKnownMarketplaces = { managed: true, overridable: u.overridable, items: (Array.isArray(u.value) ? u.value : []).map(parseSource) };
    }

    if (isObj(src.telemetry)) {
      const t = src.telemetry;
      const d = s.telemetry;
      d.managed = true;
      d.enabled = toTri(t.enabled);
      d.endpoint = t.endpoint || "";
      d.protocol = t.protocol || UNSET;
      if (isObj(t.capture)) Object.keys(d.capture).forEach((k) => (d.capture[k] = toTri(t.capture[k])));
      d.captureContent = toTri(t.captureContent);
      d.lockCaptureContent = toTri(t.lockCaptureContent);
      d.serviceName = t.serviceName || "";
      d.resourceAttributes = objToKv(t.resourceAttributes);
      d.headers = objToKv(t.headers);
      d.disableHeadersProvider = t.headersProvider === false;
    }

    if (isObj(src.remoteControl)) {
      s.remoteControl = {
        managed: true,
        mode: src.remoteControl.mode || "requireSSO",
        orgs: Array.isArray(src.remoteControl.githubDotComOrganizations) ? src.remoteControl.githubDotComOrganizations.map(String) : [],
      };
    }

    s.forceRemoteSettingsRefresh = src.forceRemoteSettingsRefresh === true || src.forceRemoteSettingsRefresh === "true";

    if (src.allowedMcpServers !== undefined) {
      const u = unwrap(src.allowedMcpServers);
      s.allowedMcpServers = { managed: true, overridable: u.overridable, items: parseMcp(u.value) };
    }
    if (src.deniedMcpServers !== undefined) s.deniedMcpServers = { managed: true, items: parseMcp(src.deniedMcpServers) };

    if (src.sandbox !== undefined) {
      const u = unwrap(src.sandbox);
      const v = isObj(u.value) ? u.value : {};
      const sb = s.sandbox;
      sb.managed = true;
      sb.overridable = u.overridable;
      ["enabled", "failIfUnavailable", "allowBypass", "addCurrentWorkingDirectory", "sandboxMcpServers", "sandboxLspServers", "allowDevToolAccess"].forEach(
        (k) => (sb[k] = toTri(v[k]))
      );
      sb.learningModeDeny = v.learningMode === "deny";
      if (isObj(v.auth)) {
        sb.authGit = toTri(v.auth.git);
        sb.authGh = toTri(v.auth.gh);
      }
      const up = isObj(v.userPolicy) ? v.userPolicy : {};
      const fs = isObj(up.filesystem) ? up.filesystem : {};
      ["readwritePaths", "readonlyPaths", "deniedPaths"].forEach((k) => {
        if (Array.isArray(fs[k])) sb.filesystem[k] = { managed: true, items: fs[k].map(String) };
      });
      const net = isObj(up.network) ? up.network : {};
      sb.network.allowOutbound = toTri(net.allowOutbound);
      sb.network.allowLocalNetwork = toTri(net.allowLocalNetwork);
      ["allowedHosts", "blockedHosts"].forEach((k) => {
        if (Array.isArray(net[k])) sb.network[k] = { managed: true, items: net[k].map(String) };
      });
      sb.network.proxyUrl = (isObj(net.proxy) && net.proxy.url) || "";
      if (isObj(up.seatbelt)) sb.keychainAccess = toTri(up.seatbelt.keychainAccess);
    }

    return s;
  }

  function parseSource(src) {
    const o = isObj(src) ? src : {};
    return {
      source: o.source || "github",
      repo: o.repo || "",
      url: o.url || "",
      ref: o.ref || "",
      path: o.path || "",
      package: o.package || "",
      hostPattern: o.hostPattern || "",
      pathPattern: o.pathPattern || "",
      headers: objToKv(o.headers),
    };
  }

  function parseMcp(list) {
    return (Array.isArray(list) ? list : []).map((e) => {
      if (isObj(e) && Array.isArray(e.serverCommand)) return { type: "serverCommand", value: formatCommand(e.serverCommand) };
      if (isObj(e) && e.serverUrl) return { type: "serverUrl", value: String(e.serverUrl) };
      return { type: "serverName", value: String((e && e.serverName) || "") };
    });
  }

  // ---------- validate ----------
  // Returns [{level: "error"|"warning"|"info", step, message}]
  function validate(s) {
    const issues = [];
    const add = (level, step, message) => issues.push({ level, step, message });

    if (s.model.managed && !clean(s.model.value)) add("error", "model", "Default model is managed but has no value.");
    if (s.autoTier.managed && s.model.managed && clean(s.model.value) !== "auto")
      add("info", "model", 'autoTier only applies when the selected model is "auto".');

    ["deny", "ask", "allow"].forEach((k) => {
      const r = s.permissions[k];
      if (!r.managed) return;
      if (!r.rules.length) add("warning", "permissions", `permissions.${k} is managed but has no rules.`);
      r.rules.forEach((rule) => {
        if (!/^(Shell|Bash|PowerShell|Read|Edit|Write|Domain)\(.+\)$/.test(rule))
          add("error", "permissions", `Invalid ${k} rule "${rule}". Use Shell(...), Read(...), Edit(...), or Domain(...).`);
      });
    });
    if (s.permissions.allow.managed && s.permissions.allow.rules.length)
      add("info", "permissions", "Declaring an allow list means unmatched operations will require approval.");

    if (s.remoteControl.managed && s.remoteControl.mode === "requireSSO" && !s.remoteControl.orgs.filter((o) => clean(o)).length)
      add("error", "access", 'remoteControl mode "requireSSO" requires at least one organization.');

    if (s.enabledPlugins.managed) {
      s.enabledPlugins.items.forEach((i) => {
        if (!/^[^@\s]+@[^@\s]+$/.test(clean(i.key) || "")) add("error", "plugins", `Plugin key "${i.key}" must use PLUGIN-NAME@MARKETPLACE-NAME.`);
      });
    }
    if (s.extraKnownMarketplaces.managed) {
      const names = new Set();
      s.extraKnownMarketplaces.items.forEach((i, idx) => {
        if (!clean(i.name)) add("error", "plugins", `Marketplace #${idx + 1} needs a name.`);
        else if (names.has(clean(i.name))) add("error", "plugins", `Duplicate marketplace name "${i.name}".`);
        names.add(clean(i.name));
        sourceIssues(i.source, `Marketplace "${i.name || idx + 1}"`).forEach((m) => add("error", "plugins", m));
      });
    }
    if (s.strictKnownMarketplaces.managed) {
      if (!s.strictKnownMarketplaces.items.length)
        add("warning", "plugins", "strictKnownMarketplaces is an empty array: plugin installation is completely locked down.");
      s.strictKnownMarketplaces.items.forEach((i, idx) => sourceIssues(i, `Strict marketplace #${idx + 1}`).forEach((m) => add("error", "plugins", m)));
    }

    const checkMcp = (list, label) =>
      list.forEach((i, idx) => {
        const v = clean(i.value);
        if (!v) return add("error", "mcp", `${label} entry #${idx + 1} is empty.`);
        if (i.type === "serverName" && !/^[A-Za-z0-9_./-]+$/.test(v))
          add("error", "mcp", `${label} serverName "${v}" may only contain letters, numbers, _ . / -`);
        if (i.type === "serverUrl" && !/^https?:\/\//i.test(v)) add("warning", "mcp", `${label} serverUrl "${v}" should start with http:// or https://`);
      });
    if (s.allowedMcpServers.managed) {
      if (!s.allowedMcpServers.items.length)
        add("warning", "mcp", "allowedMcpServers is empty: all MCP servers except built-in defaults are blocked.");
      checkMcp(s.allowedMcpServers.items, "Allowed MCP");
    }
    if (s.deniedMcpServers.managed) checkMcp(s.deniedMcpServers.items, "Denied MCP");

    const sb = s.sandbox;
    if (sb.managed) {
      add("info", "sandbox", "Adding sandbox enforces minimum client versions: VS Code 1.141.0, Copilot CLI 1.0.93, Copilot app 1.1.26.");
      if (sb.failIfUnavailable === "true" && sb.enabled !== "true") add("warning", "sandbox", "failIfUnavailable has no effect unless enabled is also true.");
      ["allowedHosts", "blockedHosts"].forEach((k) =>
        sb.network[k].items.forEach((h) => {
          if (/[:/]/.test(h)) add("error", "sandbox", `${k} entry "${h}" must be a hostname or IP without scheme, path, or port.`);
        })
      );
      ["readwritePaths", "readonlyPaths", "deniedPaths"].forEach((k) =>
        sb.filesystem[k].items.forEach((pth) => {
          if (!/^(\/|~|[A-Za-z]:[\\/]|\$)/.test(pth)) add("warning", "sandbox", `${k} entry "${pth}" should be an absolute path.`);
        })
      );
    }

    const t = s.telemetry;
    if (t.managed) {
      if (t.enabled === "true" && !clean(t.endpoint)) add("error", "telemetry", "Telemetry is enabled but no endpoint is set.");
      if (clean(t.endpoint) && !/^https?:\/\//i.test(clean(t.endpoint))) add("error", "telemetry", "Telemetry endpoint must be an http(s) URL.");
      const hasHeaders = t.headers.some((h) => clean(h.key));
      if (hasHeaders && !clean(t.endpoint)) add("error", "telemetry", "Telemetry headers require an endpoint in the same telemetry object.");
      if (hasHeaders && /^http:\/\//i.test(clean(t.endpoint))) add("warning", "telemetry", "Headers are sent in plaintext over HTTP. Use HTTPS for credentials.");
      if (hasHeaders) add("warning", "telemetry", "Header values are written into the file. Avoid committing real secrets to source control.");
      const content = ["prompts", "responses", "toolArguments", "toolOutput", "policyDetail"].some((k) => t.capture[k] === "true") || t.captureContent === "true";
      if (content) add("warning", "telemetry", "Content capture may include source code, prompts, and secrets. Only send to an approved collector.");
    }

    return issues;
  }

  function sourceIssues(src, label) {
    const req = SOURCE_REQUIRED[src.source];
    const out = [];
    if (req && !clean(src[req])) out.push(`${label}: "${req}" is required for source "${src.source}".`);
    if (src.source === "github" && clean(src.repo) && !/^[\w.-]+\/[\w.-]+$/.test(clean(src.repo))) out.push(`${label}: repo must be OWNER/REPO.`);
    return out;
  }

  function hasOverridable(s) {
    return !!(
      (s.model.managed && s.model.overridable) ||
      (s.autoTier.managed && s.autoTier.overridable) ||
      ["deny", "ask", "allow"].some((k) => s.permissions[k].managed && s.permissions[k].overridable) ||
      (s.extraKnownMarketplaces.managed && s.extraKnownMarketplaces.overridable) ||
      (s.strictKnownMarketplaces.managed && s.strictKnownMarketplaces.overridable) ||
      (s.allowedMcpServers.managed && s.allowedMcpServers.overridable) ||
      (s.sandbox.managed && s.sandbox.overridable)
    );
  }

  // ---------- presets ----------
  const BASE_DENY = ["Shell(rm -rf *)", "Read(~/.ssh/**)", "Read(~/.aws/**)", "Edit(//etc/**)"];

  function preset(name) {
    const s = defaultState();
    if (name === "starter") {
      s.model = { managed: true, value: "auto", overridable: true };
    } else if (name === "secure") {
      s.model = { managed: true, value: "auto", overridable: true };
      s.permissions.disableBypassPermissionsMode = true;
      s.permissions.deny = { managed: true, overridable: false, rules: BASE_DENY.slice() };
      s.permissions.ask = { managed: true, overridable: true, rules: ["Shell(git push *)", "Shell(curl *)"] };
      s.features.computerUse = "false";
      s.remoteControl = { managed: true, mode: "disabled", orgs: [] };
      s.deniedMcpServers = { managed: true, items: [{ type: "serverCommand", value: "npx -y @modelcontextprotocol/server-filesystem /" }] };
    } else if (name === "locked") {
      s.model = { managed: true, value: "auto", overridable: false };
      s.autoTier = { managed: true, value: "balance", overridable: false };
      s.permissions.disableBypassPermissionsMode = true;
      s.permissions.disableAssistedPermissionsMode = true;
      s.permissions.defaultMode = "manual";
      s.permissions.deny = { managed: true, overridable: false, rules: BASE_DENY.slice() };
      s.permissions.ask = { managed: true, overridable: false, rules: ["Shell(git push *)", "Shell(curl *)", "Shell(wget *)"] };
      s.features.computerUse = "false";
      s.forceRemoteSettingsRefresh = true;
      s.remoteControl = { managed: true, mode: "disabled", orgs: [] };
      s.strictKnownMarketplaces = { managed: true, overridable: false, items: [] };
      s.allowedMcpServers = { managed: true, overridable: false, items: [{ type: "serverUrl", value: "https://api.githubcopilot.com/*" }] };
      Object.assign(s.sandbox, {
        managed: true,
        enabled: "true",
        failIfUnavailable: "true",
        allowBypass: "false",
        sandboxMcpServers: "true",
        sandboxLspServers: "true",
        keychainAccess: "false",
      });
    }
    return s;
  }

  return {
    UNSET,
    RULE_SELECTORS,
    MARKETPLACE_SOURCES,
    STRICT_SOURCES,
    SOURCE_FIELDS,
    SOURCE_REQUIRED,
    MCP_MATCHERS,
    defaultState,
    buildSettings,
    parseSettings,
    validate,
    hasOverridable,
    preset,
    parseCommand,
    formatCommand,
    parseSource,
  };
});
