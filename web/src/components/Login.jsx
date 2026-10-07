import Avatar, { CodePilotMark } from "./Avatar.jsx";

export default function Login({ cfg, demo, onPick }) {
  return (
    <main className="login">
      <section className="hero">
        <div className="logo">
          <span className="logo-mark">
            <CodePilotMark />
          </span>
          CODEPILOT
        </div>
        <h1>
          AI Code<br />Control Center
        </h1>
        <p className="lede">
          AI executes. CodePilot verifies. <b>You decide.</b>
        </p>
        <p className="stack">Codex · CometChat · Human-controlled AI software engineering</p>
      </section>

      <section className="pick">
        <p className="eyebrow">Select operator</p>
        <div className="people">
          {cfg.humans.map((h) => (
            <button key={h.uid} className="person" onClick={() => onPick(h.uid)}>
              <Avatar user={h} size={40} />
              <span>
                <b>{h.name}</b>
                <small>@{h.uid}</small>
              </span>
              <span className="arrow">→</span>
            </button>
          ))}
        </div>
        <div className="agent-row">
          <Avatar user={cfg.agent} agent size={32} status="online" />
          <span>
            <b>{cfg.agent.name}</b> is online
            <small>AI coding agent · awaiting commands</small>
          </span>
        </div>
        {demo && (
          <p className="demo-note">
            <span className="tag">Demo</span>
            {cfg.configured ? "Forced with ?demo." : "No CometChat keys configured. Agent is simulated."}
          </p>
        )}
      </section>
    </main>
  );
}
