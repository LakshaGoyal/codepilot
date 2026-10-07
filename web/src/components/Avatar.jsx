const PALETTE = ["#666", "#777", "#888", "#555", "#999"];

function hash(s = "") {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export default function Avatar({ user, agent, size = 36, status }) {
  const name = user?.name || "?";
  const bg = PALETTE[hash(user?.uid) % PALETTE.length];
  return (
    <span className={`avatar ${agent ? "is-agent" : ""}`} style={{ width: size, height: size, "--av": bg }}>
      {agent ? <CodePilotMark /> : <span className="initial">{name.slice(0, 1).toUpperCase()}</span>}
      {status && <i className={`dot ${status}`} />}
    </span>
  );
}

/** Minimal geometric CodePilot mark — a "C" arc + cursor dot */
export function PagerGlyph() {
  return <CodePilotMark />;
}

export function CodePilotMark() {
  return (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden="true">
      <path d="M10 16a6 6 0 0 1 6-6" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.5" fill="#fff" />
    </svg>
  );
}
