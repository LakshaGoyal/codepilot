import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Avatar, { CodePilotMark } from "./Avatar.jsx";
import Messages from "./Messages.jsx";
import Composer from "./Composer.jsx";
import ExecutionPipeline from "./ExecutionPipeline.jsx";

const STALE_MS = 3 * 60 * 1000;

function reducer(s, a) {
  switch (a.type) {
    case "load":
      return { ...s, messages: a.history, members: a.members, me: a.me, live: a.live };
    case "msg": {
      if (a.msg.kind === "agent_status") return { ...s, run: applyStatus(s.run, a.msg) };
      const i = s.messages.findIndex((m) => m.id === a.msg.id);
      const messages = i >= 0 ? s.messages.map((m, j) => (j === i ? a.msg : m)) : [...s.messages, a.msg];
      return { ...s, messages };
    }
    case "reactions":
      return { ...s, messages: s.messages.map((m) => (m.id === a.id ? { ...m, reactions: a.reactions } : m)) };
    case "typing": {
      const typing = { ...s.typing };
      if (a.on) typing[a.user.uid] = a.user.name;
      else delete typing[a.user.uid];
      return { ...s, typing };
    }
    case "presence":
      return { ...s, members: s.members.map((m) => (m.uid === a.uid ? { ...m, status: a.status } : m)) };
    case "conn":
      return { ...s, conn: a.conn };
    default:
      return s;
  }
}

function applyStatus(run, msg) {
  const d = msg.data || {};
  if (d.state === "idle") return null;
  if (Date.now() - msg.sentAt > STALE_MS) return run;
  const same = run && run.runId === d.runId;
  const steps = same ? run.steps : [];
  const last = steps[steps.length - 1];
  const next = d.step && (!last || last.text !== d.step.text) ? [...steps, { ...d.step, at: msg.sentAt }] : steps;
  return { runId: d.runId, prompt: d.prompt, by: d.by, startedAt: same ? run.startedAt : msg.sentAt, steps: next };
}

export default function Room({ cfg, uid, demo, onLeave }) {
  const [s, dispatch] = useReducer(reducer, {
    messages: [],
    members: [],
    me: null,
    typing: {},
    run: null,
    conn: "connecting",
    live: false,
  });
  const [error, setError] = useState(null);
  const [chatOpen, setChatOpen] = useState(true); // Right panel visible on desktop
  const [mobileTab, setMobileTab] = useState("pipeline"); // "pipeline" | "chat" on mobile
  const [showMembers, setShowMembers] = useState(false);
  const chat = useRef(null);

  useEffect(() => {
    let alive = true;
    const handlers = {
      onMessage: (msg) => alive && dispatch({ type: "msg", msg }),
      onReactions: (id, reactions) => alive && dispatch({ type: "reactions", id, reactions }),
      onTyping: (user, on) => alive && user && dispatch({ type: "typing", user, on }),
      onPresence: (u, status) => alive && dispatch({ type: "presence", uid: u, status }),
      onConnection: (conn) => alive && dispatch({ type: "conn", conn }),
    };

    const load = demo ? import("../lib/mock.js").then((m) => m.createMockChat) : import("../lib/chat.js").then((m) => m.createChat);
    load
      .then((create) => create(cfg, uid, handlers))
      .then((c) => {
        if (!alive) return c.destroy();
        chat.current = c;
        const statuses = c.history.filter((m) => m.kind === "agent_status");
        const history = c.history.filter((m) => m.kind !== "agent_status");
        dispatch({ type: "load", history, members: c.members, me: c.me, live: c.live });
        statuses.forEach((msg) => dispatch({ type: "msg", msg }));
        dispatch({ type: "conn", conn: "connected" });
      })
      .catch((e) => alive && setError(e.message || String(e)));
    return () => {
      alive = false;
      chat.current?.destroy();
    };
  }, [cfg, uid, demo]);

  const send = useCallback((text, metadata) => chat.current?.sendText(text, metadata), []);
  const react = useCallback((id, emoji, on) => chat.current?.react(id, emoji, on), []);
  const ship = useCallback(
    async (msg) => {
      if (msg?.id) await chat.current?.react(msg.id, "👍", true).catch(() => {});
      const runId = msg?.data?.runId || s.run?.runId;
      await chat.current?.sendText("👍 ship it", { approveRun: runId });
    },
    [s.run]
  );
  const discard = useCallback(
    (msg) => {
      const runId = msg?.data?.runId || s.run?.runId;
      chat.current?.sendText("✋ undo that", { discardRun: runId });
    },
    [s.run]
  );

  const agentUid = cfg.agent.uid;
  const people = useMemo(
    () => [...s.members].sort((a, b) => (a.uid === agentUid) - (b.uid === agentUid) || a.name.localeCompare(b.name)),
    [s.members, agentUid]
  );
  const typingNames = Object.entries(s.typing)
    .filter(([u]) => u !== s.me?.uid)
    .map(([, n]) => n);

  if (error) {
    return (
      <div className="fatal">
        <h2>Couldn't connect to CodePilot</h2>
        <p>{error}</p>
        <p className="muted">Check the server's .env and run <code>npm run setup</code> once.</p>
        <button className="btn" onClick={onLeave}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className={`command-center-layout ${chatOpen ? "chat-open" : "chat-closed"} mobile-${mobileTab}`}>
      {/* ─── Top Bar ─── */}
      <header className="cc-header">
        <div className="cc-brand">
          <span className="cc-brand-glyph">
            <CodePilotMark />
          </span>
          <div className="cc-brand-names">
            <b className="brand-title">CODEPILOT</b>
            <span className="brand-subtitle">AI CODE CONTROL CENTER</span>
          </div>
          <span className={`cc-conn-tag ${s.conn}`}>
            {demo ? "DEMO" : s.conn === "connected" ? "CONNECTED" : s.conn.toUpperCase()}
          </span>
          {s.run && (
            <div className="cc-running-pill">
              <span className="cc-pulse-dot" />
              <span className="cc-running-text">
                EXECUTING: "{s.run.prompt.slice(0, 40)}{s.run.prompt.length > 40 ? "…" : ""}"
              </span>
            </div>
          )}
        </div>

        {/* Mobile Tab Switcher */}
        <div className="cc-mobile-tabs only-mobile">
          <button
            type="button"
            className={`tab-btn ${mobileTab === "pipeline" ? "active" : ""}`}
            onClick={() => setMobileTab("pipeline")}
            aria-label="Show pipeline"
          >
            PIPELINE
          </button>
          <button
            type="button"
            className={`tab-btn ${mobileTab === "chat" ? "active" : ""}`}
            onClick={() => setMobileTab("chat")}
            aria-label="Show command channel"
          >
            COMMANDS
          </button>
        </div>

        <div className="cc-header-actions">
          <a className="cc-link-btn" href="/preview/" target="_blank" rel="noreferrer" title="Open live workspace preview"
             aria-label="Live preview">
            LIVE PREVIEW ↗
          </a>

          <button
            type="button"
            className={`cc-toggle-chat-btn not-mobile ${chatOpen ? "active" : ""}`}
            onClick={() => setChatOpen(!chatOpen)}
            title="Toggle command channel"
            aria-label="Toggle command channel"
          >
            <span>COMETCHAT</span>
            <span className="indicator-dot" />
          </button>

          <button type="button" className="cc-user-btn" onClick={onLeave} title="Switch operator"
                  aria-label="Switch user">
            <span className="user-name">{s.me?.name || "Operator"}</span>
            <span className="switch-label">SWITCH</span>
          </button>
        </div>
      </header>

      {/* ─── Main Workspace ─── */}
      <main className="cc-main-body">
        {/* PRIMARY: Execution Pipeline */}
        <section className="cc-pipeline-section">
          <ExecutionPipeline
            run={s.run}
            messages={s.messages}
            agent={cfg.agent}
            onShip={ship}
            onDiscard={discard}
            onSendCommand={send}
          />
        </section>

        {/* SECONDARY: Command Channel (CometChat) */}
        <aside className={`cc-activity-panel ${chatOpen ? "visible" : "collapsed"}`}>
          <header className="activity-panel-header">
            <div className="activity-channel-info">
              <span className="channel-hash">#</span>
              <div>
                <b>{cfg.group.name.toLowerCase().replace(/\s+/g, "-")}</b>
                <small>
                  {typingNames.length
                    ? `${typingNames.join(", ")} typing…`
                    : s.run
                    ? `${cfg.agent.name} executing`
                    : `${people.length} members · CometChat`}
                </small>
              </div>
            </div>

            <div className="panel-head-actions">
              <button
                type="button"
                className={`panel-icon-btn ${showMembers ? "active" : ""}`}
                onClick={() => setShowMembers(!showMembers)}
                title="Room members"
                aria-label="Toggle members"
              >
                👥
              </button>
              <button
                type="button"
                className="panel-icon-btn close-panel-btn not-mobile"
                onClick={() => setChatOpen(false)}
                title="Close command channel"
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>
          </header>

          {/* Members Section */}
          {showMembers && (
            <div className="activity-members-drawer">
              <p className="eyebrow">Operators</p>
              <ul className="members-compact">
                {people.map((m) => {
                  const isAgent = m.uid === agentUid;
                  const status = isAgent ? (s.run ? "busy" : "online") : m.status;
                  return (
                    <li key={m.uid} className={isAgent ? "is-agent-li" : ""}>
                      <Avatar user={m} agent={isAgent} size={24} status={status} />
                      <span className="member-name">
                        {m.name}
                        {m.uid === s.me?.uid && <em> (you)</em>}
                      </span>
                      <span className="member-status-tag">{isAgent ? (s.run ? "WORKING" : "IDLE") : (status || "").toUpperCase()}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* CometChat Messages */}
          <Messages
            messages={s.messages}
            me={s.me}
            agent={cfg.agent}
            run={s.run}
            onReact={react}
            onShip={ship}
            onDiscard={discard}
          />

          {/* Message Composer */}
          <Composer agent={cfg.agent} busy={Boolean(s.run)} onSend={send} chat={chat} />
        </aside>
      </main>
    </div>
  );
}
