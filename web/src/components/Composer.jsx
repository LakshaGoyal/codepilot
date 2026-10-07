import { useRef, useState } from "react";
import { isForAgent } from "../lib/commands.js";

const SUGGESTIONS = [
  'change the signup button text to "Create account"',
  "make the signup button orange",
  "reject emails from mailinator.com and add a test",
];

export default function Composer({ agent, busy, onSend, chat }) {
  const [text, setText] = useState("");
  const [toAgent, setToAgent] = useState(true);
  const typingTimer = useRef(null);
  const typing = useRef(false);
  const input = useRef(null);

  const stopTyping = () => {
    if (typing.current) chat.current?.endTyping();
    typing.current = false;
  };

  const onChange = (v) => {
    setText(v);
    // Debounced typing indicators, as the presence-and-typing bundle recommends.
    if (!typing.current && v) {
      chat.current?.startTyping();
      typing.current = true;
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 2000);
  };

  const submit = (e) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    const out = toAgent && !isForAgent(t, agent) && !t.startsWith("/") ? `@${agent.name} ${t}` : t;
    onSend(out);
    setText("");
    stopTyping();
  };

  return (
    <form className="composer" onSubmit={submit}>
      {!text && (
        <div className="suggest">
          {SUGGESTIONS.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => {
                setToAgent(true);
                setText(s);
                input.current?.focus();
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="composer-row">
        <button
          type="button"
          className={`to-agent ${toAgent ? "on" : ""}`}
          onClick={() => setToAgent(!toAgent)}
          title={toAgent ? "Messages go to the agent" : "Messages go to the humans"}
        >
          {toAgent ? `@${agent.name}` : "team"}
        </button>
        <input
          ref={input}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={toAgent ? (busy ? `${agent.name} is busy, it'll queue a reply…` : `Tell ${agent.name} what to change…`) : "Message the team…"}
          aria-label="Message"
        />
        <button className="send" disabled={!text.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M3 11.5 21 3l-8.5 18-2.2-7.3z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </form>
  );
}
