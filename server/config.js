import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const env = (k, d = "") => (process.env[k] ?? d).trim();

export const config = {
  // Also accept the VITE_* names the CometChat provisioning CLI may write.
  appId: env("COMETCHAT_APP_ID") || env("VITE_COMETCHAT_APP_ID"),
  region: env("COMETCHAT_REGION") || env("VITE_COMETCHAT_REGION", "us"),
  restKey: env("COMETCHAT_REST_API_KEY"),
  agentUid: env("AGENT_UID", "pager-agent"),
  agentName: env("AGENT_NAME", "Pager"),
  groupGuid: env("GROUP_GUID", "ship-it"),
  groupName: env("GROUP_NAME", "Ship It"),
  humans: env("HUMANS", "hridya:Hridya,sam:Sam")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [uid, ...name] = s.split(":");
      return { uid: uid.trim(), name: (name.join(":") || uid).trim() };
    }),
  mode: env("AGENT_MODE", "poll"),
  callbackUser: env("CALLBACK_USER", "pager"),
  callbackPass: env("CALLBACK_PASS"),
  workspace: path.resolve(ROOT, "server", env("WORKSPACE_DIR", "../workspace")),
  codexBin: env("CODEX_BIN", "codex"),
  mockAgent: env("MOCK_AGENT", "0") === "1",
  port: Number(env("PORT", "8787")),
};

export const isConfigured = () => Boolean(config.appId && config.restKey);
export const humanUids = () => new Set(config.humans.map((h) => h.uid));
