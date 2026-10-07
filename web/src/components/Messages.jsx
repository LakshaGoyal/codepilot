import { useEffect, useRef, useState } from "react";
import Avatar from "./Avatar.jsx";
import { ResultCard, EventCard } from "./Cards.jsx";
import { StepIcon } from "./Console.jsx";

const time = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const QUICK = ["👍", "🔥", "😂", "👀"];

function Text({ text, agent }) {
  const split = new RegExp(`(@${agent.name}|@codepilot|@pager|@agent|^/\\w+)`, "gi");
  const isTag = new RegExp(`^(@${agent.name}|@codepilot|@pager|@agent|/\\w+)$`, "i");
  return text.split(split).map((part, i) =>
    isTag.test(part) ? (
      <span key={i} className="mention">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function Reactions({ msg, onReact }) {
  if (!msg.reactions?.length) return null;
  return (
    <div className="reactions">
      {msg.reactions.map((r) => (
        <button key={r.emoji} className={`reaction ${r.mine ? "mine" : ""}`} onClick={() => onReact(msg.id, r.emoji, !r.mine)}>
          {r.emoji} <b>{r.count}</b>
        </button>
      ))}
    </div>
  );
}

function Row({ msg, prev, me, agent, onReact, onShip, onDiscard }) {
  const [hover, setHover] = useState(false);
  const mine = msg.sender?.uid === me?.uid;
  const isAgent = msg.sender?.uid === agent.uid;
  const grouped = prev && prev.sender?.uid === msg.sender?.uid && msg.sentAt - prev.sentAt < 120000 && prev.kind === "text" && msg.kind === "text";

  return (
    <div
      className={`row ${mine ? "mine" : ""} ${isAgent ? "from-agent" : ""} ${grouped ? "grouped" : ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {!mine && <div className="row-av">{!grouped && <Avatar user={msg.sender} agent={isAgent} size={32} />}</div>}
      <div className="row-body">
        {!grouped && !mine && (
          <div className="row-meta">
            <b>{msg.sender?.name}</b>
            {isAgent && <span className="bot-tag">agent</span>}
            <time>{time(msg.sentAt)}</time>
          </div>
        )}
        {msg.kind === "text" && (
          <div className="bubble">
            <Text text={msg.text} agent={agent} />
            {mine && <time className="in-bubble">{time(msg.sentAt)}</time>}
          </div>
        )}
        {msg.kind === "agent_result" && <ResultCard msg={msg} onShip={onShip} onDiscard={onDiscard} />}
        {msg.kind === "agent_event" && <EventCard data={msg.data} />}
        {!["text", "agent_result", "agent_event"].includes(msg.kind) && <div className="bubble muted">[{msg.kind}]</div>}
        <Reactions msg={msg} onReact={onReact} />
      </div>
      {hover && (
        <div className="quick">
          {QUICK.map((e) => (
            <button key={e} onClick={() => onReact(msg.id, e, true)} aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Messages({ messages, me, agent, run, onReact, onShip, onDiscard }) {
  const end = useRef(null);
  const last = run?.steps?.[run.steps.length - 1];
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, last?.text]);

  return (
    <div className="messages">
      {messages.length === 0 && (
        <div className="empty">
          <p>Say hi, or put the agent to work:</p>
          <code>@{agent.name} make the signup button orange</code>
        </div>
      )}
      {messages.map((m, i) => (
        <Row key={m.id} msg={m} prev={messages[i - 1]} me={me} agent={agent} onReact={onReact} onShip={onShip} onDiscard={onDiscard} />
      ))}
      {run && (
        <div className="row from-agent">
          <div className="row-av">
            <Avatar user={agent} agent size={32} />
          </div>
          <div className="row-body">
            <div className="working">
              <span className="dots">
                <i />
                <i />
                <i />
              </span>
              <span className="working-step" key={last?.text}>
                {last ? (
                  <>
                    <StepIcon icon={last.icon} /> {last.text}
                  </>
                ) : (
                  "thinking"
                )}
              </span>
              <span className="working-count">{run.steps.length} steps</span>
            </div>
          </div>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}
