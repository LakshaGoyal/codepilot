// Mirrors server/brain.js parseCommand so the UI can tell which messages are for the agent.
export function parseCommand(text, agent = { uid: "pager-agent", name: "Pager" }) {
  const t = (text || "").trim();
  if (!t) return null;
  if (t.startsWith("/")) {
    const [cmd, ...rest] = t.slice(1).split(/\s+/);
    return { kind: cmd.toLowerCase(), arg: rest.join(" ") };
  }
  const re = new RegExp(`^\\s*(?:<@uid:${agent.uid}>|@${agent.name}|@agent|@pager)[\\s,:]*`, "i");
  if (re.test(t)) {
    const arg = t.replace(re, "").trim();
    return arg ? { kind: "ask", arg } : { kind: "help", arg: "" };
  }
  return null;
}

export const isForAgent = (text, agent) => Boolean(parseCommand(text, agent));
