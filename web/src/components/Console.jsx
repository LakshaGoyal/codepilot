import { useEffect, useState } from "react";
import { PagerGlyph } from "./Avatar.jsx";

const ICONS = { read: "◔", edit: "✎", search: "⌕", run: "▶", plan: "☰", tool: "◆" };
export const StepIcon = ({ icon }) => <span className={`step-icon ${icon}`}>{ICONS[icon] || "•"}</span>;

function Elapsed({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="elapsed">{Math.max(0, Math.round((now - since) / 1000))}s</span>;
}

export default function Console({ run, messages, agent }) {
  const results = messages.filter((m) => m.kind === "agent_result").slice(-4).reverse();
  const shipped = messages.filter((m) => m.kind === "agent_event" && m.data.kind === "shipped").slice(-3).reverse();

  return (
    <aside className="console glass">
      <header className="console-head">
        <span className={`pager-face ${run ? "busy" : ""}`}>
          <PagerGlyph />
        </span>
        <div>
          <b>{agent.name}</b>
          <small>{run ? "working" : "idle · waiting for @" + agent.name}</small>
        </div>
      </header>

      <section className="screen">
        {run ? (
          <>
            <p className="screen-label">
              NOW <Elapsed since={run.startedAt} />
            </p>
            <p className="screen-task">“{run.prompt}”</p>
            <ol className="steps">
              {run.steps.map((s, i) => (
                <li key={i} className={i === run.steps.length - 1 ? "current" : ""}>
                  <StepIcon icon={s.icon} />
                  <span>{s.text}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className="screen-idle">
            <p className="screen-label">STANDBY</p>
            <p>
              Mention <b>@{agent.name}</b> with a change. I'll edit the repo, run the tests and post the diff here for a 👍.
            </p>
          </div>
        )}
      </section>

      <p className="eyebrow">Recent runs</p>
      <ul className="runs">
        {results.length === 0 && <li className="muted">Nothing yet.</li>}
        {results.map((m) => (
          <li key={m.id}>
            <span className={`run-dot ${m.data.tests?.ok ? "ok" : "bad"}`} />
            <span className="run-text">{m.data.prompt}</span>
            <span className="run-meta">{m.data.files?.length || 0}f</span>
          </li>
        ))}
      </ul>

      {shipped.length > 0 && (
        <>
          <p className="eyebrow">Shipped</p>
          <ul className="runs">
            {shipped.map((m) => (
              <li key={m.id}>
                <span className="sha sm">{m.data.sha}</span>
                <span className="run-text">{m.data.prompt}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <a className="preview-link" href="/preview/" target="_blank" rel="noreferrer">
        Open preview
      </a>
    </aside>
  );
}
