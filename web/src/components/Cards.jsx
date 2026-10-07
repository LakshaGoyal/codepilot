import { useState } from "react";

const secs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s` : `${Math.round(ms / 1000)}s`);

function Diff({ patch, truncated }) {
  const lines = patch.split("\n").filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|similarity)/.test(l));
  return (
    <pre className="diff">
      {lines.map((l, i) => {
        const cls = l.startsWith("@@") ? "hunk" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "";
        return (
          <span key={i} className={cls}>
            {l || " "}
            {"\n"}
          </span>
        );
      })}
      {truncated && <span className="hunk">… diff truncated to fit the message</span>}
    </pre>
  );
}

export function ResultCard({ msg, onShip, onDiscard }) {
  const d = msg.data;
  const [open, setOpen] = useState(true);
  const t = d.tests || {};
  const shipped = msg.reactions?.some((r) => r.emoji === "👍");
  const changed = d.files?.length > 0;
  const add = d.files?.reduce((n, f) => n + f.add, 0) || 0;
  const del = d.files?.reduce((n, f) => n + f.del, 0) || 0;

  return (
    <article className={`card result ${d.isError ? "is-error" : ""}`}>
      <header>
        <span className="card-kicker">Finished in {secs(d.ms || 0)} · {d.steps} steps</span>
        <p className="ask">“{d.prompt}”</p>
        <p className="asked-by">asked by {d.by}</p>
      </header>
      <p className="summary">{d.summary}</p>

      <div className="badges">
        <span className={`badge ${t.ok ? "ok" : t.passed == null ? "" : "bad"}`}>
          {t.passed ?? "?"} tests passed{t.failed ? ` · ${t.failed} failed` : ""}
        </span>
        {changed && (
          <span className="badge">
            <b className="plus">+{add}</b> <b className="minus">−{del}</b> in {d.files.length} file{d.files.length > 1 ? "s" : ""}
          </span>
        )}
        {d.costUsd != null && <span className="badge ghost">${d.costUsd.toFixed(2)}</span>}
      </div>

      {t.failures?.length > 0 && (
        <ul className="failures">
          {t.failures.map((f) => (
            <li key={f}>✕ {f}</li>
          ))}
        </ul>
      )}

      {changed && (
        <>
          <div className="files">
            {d.files.map((f) => (
              <span key={f.file} className="file">
                {f.file}
              </span>
            ))}
            <button className="link" onClick={() => setOpen(!open)}>
              {open ? "hide diff" : "show diff"}
            </button>
          </div>
          {open && d.patch && <Diff patch={d.patch} truncated={d.truncated} />}
          <div className="actions">
            <button className="btn ship" disabled={shipped} onClick={() => onShip(msg)}>
              {shipped ? "Approved" : "Ship it"}
            </button>
            <button className="btn ghost" disabled={shipped} onClick={() => onDiscard(msg)}>
              Undo
            </button>
            <a className="btn ghost" href="/preview/" target="_blank" rel="noreferrer">
              Preview ↗
            </a>
          </div>
        </>
      )}
    </article>
  );
}

export function EventCard({ data }) {
  switch (data.kind) {
    case "shipped":
      return (
        <article className="card event shipped">
          <span className="sha">{data.sha}</span>
          <div>
            <b>Shipped.</b> {data.files} file{data.files > 1 ? "s" : ""} committed
            <small>approved by {data.by} · “{data.prompt?.slice(0, 60)}”</small>
          </div>
        </article>
      );
    case "discarded":
      return <article className="card event">↩︎ {data.by} discarded the change. Working tree is clean.</article>;
    case "error":
      return (
        <article className="card event is-error">
          <b>Run failed</b>
          <small>{data.message}</small>
        </article>
      );
    case "status":
      return (
        <article className="card event">
          <b>{data.busy ? `Working on “${data.prompt}”` : "Idle, ready for work"}</b>
          {data.commits?.map((c) => (
            <small key={c.sha}>
              <span className="sha sm">{c.sha}</span> {c.subject} · {c.when}
            </small>
          ))}
        </article>
      );
    case "help":
      return (
        <article className="card event help">
          <b>Things you can tell me</b>
          {data.lines?.map((l) => {
            const [cmd, desc] = l.split(/\s+-\s+/);
            return (
              <small key={l}>
                <code>{cmd.trim()}</code> {desc}
              </small>
            );
          })}
        </article>
      );
    default:
      return <article className="card event">{data.kind}</article>;
  }
}
