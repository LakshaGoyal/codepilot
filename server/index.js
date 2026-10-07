import fs from "node:fs";
import path from "node:path";
import express from "express";
import { config, isConfigured, ROOT, humanUids } from "./config.js";
import { cc } from "./cometchat.js";
import { getState, handleMessage, startPolling, extractMessage } from "./brain.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- API used by the web app ----------
app.get("/api/config", (_req, res) => {
  res.json({
    configured: isConfigured(),
    appId: config.appId,
    region: config.region,
    agent: { uid: config.agentUid, name: config.agentName },
    group: { guid: config.groupGuid, name: config.groupName },
    humans: config.humans,
    mode: config.mode,
    mock: config.mockAgent,
  });
});

// Auth tokens are minted here so the Auth Key never ships to the browser
// (the CometChat multi-tenant bundle's advice, applied to a single tenant).
app.post("/api/token", async (req, res) => {
  const uid = String(req.body?.uid || "");
  if (!humanUids().has(uid)) return res.status(403).json({ error: "not on the allowlist" });
  try {
    const t = await cc.authToken(uid);
    res.json({ authToken: t.authToken });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get("/api/status", (_req, res) => res.json(getState()));

// ---------- CometChat Custom Agent callback ----------
app.post("/cometchat/callback", (req, res) => {
  if (config.callbackPass) {
    const expected = "Basic " + Buffer.from(`${config.callbackUser}:${config.callbackPass}`).toString("base64");
    if (req.headers.authorization !== expected) return res.status(401).end();
  }
  res.status(200).json({ ok: true }); // CometChat wants an immediate 200
  const msg = extractMessage(req.body);
  if (msg) handleMessage(msg).catch((e) => console.error("callback handle:", e.message));
});

// ---------- live preview of the workspace the agent edits ----------
const reloadClients = new Set();
app.get("/preview/__reload", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  res.write("retry: 1000\n\n");
  reloadClients.add(res);
  req.on("close", () => reloadClients.delete(res));
});
let reloadTimer;
try {
  fs.watch(config.workspace, { recursive: true }, (_e, file) => {
    if (!file || /(^|[\\/])(\.git|\.pager-git|node_modules)([\\/]|$)/.test(file)) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => reloadClients.forEach((c) => c.write(`data: ${file}\n\n`)), 150);
  });
} catch (e) {
  console.warn("preview watch disabled:", e.message);
}
const RELOAD_SNIPPET = `<script>new EventSource('/preview/__reload').onmessage=()=>location.reload()</script>`;
app.use("/preview", (req, res, next) => {
  let rel = decodeURIComponent(req.path);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(config.workspace, "." + rel);
  if (!file.startsWith(config.workspace) || /[\\/]\.(pager-)?git([\\/]|$)/.test(file)) return res.status(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
  if (file.endsWith(".html")) {
    res.set("Cache-Control", "no-store");
    return res.type("html").send(fs.readFileSync(file, "utf8").replace("</body>", `${RELOAD_SNIPPET}</body>`));
  }
  res.set("Cache-Control", "no-store");
  res.sendFile(file);
});

// ---------- the web app ----------
const dist = path.join(ROOT, "web", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|preview|cometchat).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(config.port, async () => {
  console.log(`\n  Agent Pager  →  http://localhost:${config.port}`);
  console.log(`  Preview      →  http://localhost:${config.port}/preview/`);
  console.log(`  Workspace    →  ${config.workspace}`);
  console.log(`  Agent        →  ${config.mockAgent ? "MOCK (no Codex calls)" : config.codexBin}  ·  mode: ${config.mode}\n`);
  if (!isConfigured()) {
    console.log("  ⚠  CometChat not configured yet. Fill .env, then run: npm run setup\n");
    return;
  }
  if (config.mode === "poll") startPolling();
  else console.log(`  Waiting for CometChat callbacks on POST /cometchat/callback`);
});
