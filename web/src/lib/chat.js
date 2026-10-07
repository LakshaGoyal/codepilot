// Real CometChat transport. Built from the CometChat MCP's js-sdk-messaging-basics and
// presence-and-typing bundles, plus the reactions page fetched through the same MCP.
import { CometChat } from "@cometchat/chat-sdk-javascript";

const LID = "agent-pager";

function toUser(u) {
  if (!u) return null;
  return {
    uid: u.getUid(),
    name: u.getName(),
    avatar: u.getAvatar?.() || null,
    status: u.getStatus?.() || "offline",
  };
}

function reactionsOf(m) {
  return (m.getReactions?.() || []).map((r) => ({
    emoji: r.getReaction(),
    count: r.getCount(),
    mine: Boolean(r.getReactedByMe?.()),
  }));
}

export function normalize(m) {
  const category = m.getCategory();
  if (category !== "message" && category !== "custom") return null;
  const base = {
    id: String(m.getId()),
    sender: toUser(m.getSender()),
    sentAt: m.getSentAt() * 1000,
    reactions: reactionsOf(m),
    metadata: m.getMetadata?.() || {},
  };
  if (category === "custom") return { ...base, kind: m.getType(), data: m.getCustomData() || {} };
  if (m.getType() !== "text") return null;
  return { ...base, kind: "text", text: m.getText() };
}

export async function createChat(cfg, uid, handlers) {
  const raw = new Map(); // id -> SDK message, needed to apply reaction events

  const settings = new CometChat.AppSettingsBuilder()
    .subscribePresenceForAllUsers()
    .setRegion(cfg.region)
    .autoEstablishSocketConnection(true)
    .build();
  await CometChat.init(cfg.appId, settings);

  const existing = await CometChat.getLoggedinUser();
  if (existing && existing.getUid() !== uid) await CometChat.logout();
  if (!existing || existing.getUid() !== uid) {
    const r = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "could not get a login token");
    await CometChat.login(j.authToken);
  }
  const me = toUser(await CometChat.getLoggedinUser());
  const guid = cfg.group.guid;
  const inGroup = (m) => m.getReceiverType() === "group" && m.getReceiverId() === guid;

  const emit = (m) => {
    if (!inGroup(m)) return;
    raw.set(String(m.getId()), m);
    const n = normalize(m);
    if (n) handlers.onMessage(n);
  };

  const onReaction = (ev, action) => {
    const r = ev.getReaction();
    const id = String(r.getMessageId());
    const m = raw.get(id);
    if (!m) return;
    const updated = CometChat.CometChatHelper.updateMessageWithReactionInfo(m, r, action);
    raw.set(id, updated);
    handlers.onReactions(id, reactionsOf(updated));
  };

  CometChat.addMessageListener(
    LID,
    new CometChat.MessageListener({
      onTextMessageReceived: emit,
      onCustomMessageReceived: emit,
      onMessageEdited: emit,
      onTypingStarted: (t) => t.getReceiverId() === guid && handlers.onTyping(toUser(t.getSender()), true),
      onTypingEnded: (t) => t.getReceiverId() === guid && handlers.onTyping(toUser(t.getSender()), false),
      onMessageReactionAdded: (ev) => onReaction(ev, CometChat.REACTION_ACTION.REACTION_ADDED),
      onMessageReactionRemoved: (ev) => onReaction(ev, CometChat.REACTION_ACTION.REACTION_REMOVED),
    })
  );
  CometChat.addUserListener(
    LID,
    new CometChat.UserListener({
      onUserOnline: (u) => handlers.onPresence(u.getUid(), "online"),
      onUserOffline: (u) => handlers.onPresence(u.getUid(), "offline"),
    })
  );
  CometChat.addConnectionListener(
    LID,
    new CometChat.ConnectionListener({
      onConnected: () => handlers.onConnection("connected"),
      inConnecting: () => handlers.onConnection("connecting"),
      onDisconnected: () => handlers.onConnection("disconnected"),
    })
  );

  const membersReq = new CometChat.GroupMembersRequestBuilder(guid).setLimit(30).build();
  const members = (await membersReq.fetchNext()).map(toUser);

  const historyReq = new CometChat.MessagesRequestBuilder().setGUID(guid).setLimit(60).hideReplies(true).build();
  const history = (await historyReq.fetchPrevious()).filter(inGroup).map((m) => {
    raw.set(String(m.getId()), m);
    return normalize(m);
  });

  const typing = new CometChat.TypingIndicator(guid, CometChat.RECEIVER_TYPE.GROUP);

  return {
    live: true,
    me,
    members,
    history: history.filter(Boolean),
    async sendText(text, metadata) {
      const msg = new CometChat.TextMessage(guid, text, CometChat.RECEIVER_TYPE.GROUP);
      if (metadata) msg.setMetadata(metadata);
      const sent = await CometChat.sendMessage(msg);
      raw.set(String(sent.getId()), sent);
      return normalize(sent);
    },
    async react(id, emoji, on = true) {
      const updated = on ? await CometChat.addReaction(id, emoji) : await CometChat.removeReaction(id, emoji);
      raw.set(id, updated);
      handlers.onReactions(id, reactionsOf(updated));
    },
    startTyping: () => CometChat.startTyping(typing),
    endTyping: () => CometChat.endTyping(typing),
    async destroy() {
      CometChat.removeMessageListener(LID);
      CometChat.removeUserListener(LID);
      CometChat.removeConnectionListener(LID);
    },
    async logout() {
      await this.destroy();
      await CometChat.logout();
    },
  };
}
