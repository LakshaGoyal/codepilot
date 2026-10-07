// Thin CometChat REST v3 client. Endpoints and payload shapes were pulled from
// the CometChat MCP (fetch_cometchat_doc_page: rest-api/messages/*, groups/*, users/*).
import { config } from "./config.js";

const base = () => `https://${config.appId}.api-${config.region}.cometchat.io/v3`;

async function call(method, path, { body, onBehalfOf, query } = {}) {
  const url = new URL(base() + path);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers = {
    apikey: config.restKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (onBehalfOf) headers.onBehalfOf = onBehalfOf;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${json?.error?.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.code = json?.error?.code;
    throw err;
  }
  return json.data ?? json;
}

export const cc = {
  createUser: (uid, name, extra = {}) => call("POST", "/users", { body: { uid, name, ...extra } }),
  getUser: (uid) => call("GET", `/users/${encodeURIComponent(uid)}`),
  authToken: (uid) => call("POST", `/users/${encodeURIComponent(uid)}/auth_tokens`, { body: { force: true } }),
  createGroup: (guid, name, members, extra = {}) =>
    call("POST", "/groups", { body: { guid, name, type: "private", members: { participants: members }, ...extra } }),
  getGroup: (guid) => call("GET", `/groups/${encodeURIComponent(guid)}`),
  addMembers: (guid, uids) => call("POST", `/groups/${encodeURIComponent(guid)}/members`, { body: { participants: uids } }),

  // Messages after a given id, read as the agent.
  messagesAfter: (guid, afterId, limit = 30) =>
    call("GET", `/groups/${encodeURIComponent(guid)}/messages`, {
      onBehalfOf: config.agentUid,
      query: { id: afterId, affix: "append", limit, categories: "message" },
    }),
  latestMessages: (guid, limit = 1) =>
    call("GET", `/groups/${encodeURIComponent(guid)}/messages`, {
      onBehalfOf: config.agentUid,
      query: { affix: "prepend", limit },
    }),

  sendText: (text, metadata) =>
    call("POST", "/messages", {
      onBehalfOf: config.agentUid,
      body: { receiver: config.groupGuid, receiverType: "group", category: "message", type: "text", data: { text, metadata } },
    }),

  // Custom messages render as rich cards in the web app. customData must stay under 10 KB.
  sendCustom: (type, customData, text) =>
    call("POST", "/messages", {
      onBehalfOf: config.agentUid,
      body: {
        receiver: config.groupGuid,
        receiverType: "group",
        category: "custom",
        type,
        data: { customData, text: text || type },
      },
    }),
};
