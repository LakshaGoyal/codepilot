// Demo transport: same interface as chat.js, no network. Used when the server has no
// CometChat keys yet (or with ?demo) so the UI can be rehearsed. Always labelled "Demo mode".
import { parseCommand } from "./commands.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 1000;
const id = () => String(++seq);

const DIFF = `diff --git a/styles.css b/styles.css
--- a/styles.css
+++ b/styles.css
@@ -24,7 +24,8 @@ small { color: #dc2626; min-height: 1em; }
 .signup-btn {
   margin-top: 12px; padding: 12px; border: 0; border-radius: 8px;
-  background: #2563eb; color: #fff; font-weight: 700; font-size: 15px; cursor: pointer;
+  background: #ff6b4a; color: #fff; font-weight: 700; font-size: 15px; cursor: pointer;
+  box-shadow: 0 6px 18px rgba(255, 107, 74, .35);
 }`;

export async function createMockChat(cfg, uid, h) {
  const me = cfg.humans.find((x) => x.uid === uid) || cfg.humans[0];
  const other = cfg.humans.find((x) => x.uid !== me.uid) || { uid: "sam", name: "Sam" };
  const agent = { uid: cfg.agent.uid, name: cfg.agent.name, avatar: null, status: "online" };
  const members = [
    { ...me, avatar: null, status: "online" },
    { ...other, avatar: null, status: "online" },
    agent,
  ];
  const now = Date.now();
  const history = [
    { id: id(), kind: "text", sender: other, text: "signup conversion is down again 😩", sentAt: now - 1000 * 60 * 9, reactions: [], metadata: {} },
    {
      id: id(),
      kind: "agent_event",
      sender: agent,
      data: { kind: "help", lines: ["@CodePilot <what to change>  - I edit the code and run the tests", "/ship  - commit my last change", "/undo  - throw my last change away", "/status  - what I'm doing + recent commits"] },
      sentAt: now - 1000 * 60 * 8,
      reactions: [],
      metadata: {},
    },
  ];
  let pending = null;
  const say = (sender, kind, data, extra = {}) =>
    h.onMessage({ id: id(), kind, sender, data, sentAt: Date.now(), reactions: [], metadata: {}, ...extra });

  async function runAgent(prompt) {
    const runId = `run_${Date.now().toString(36)}`;
    const steps = [
      ["plan", "On it"],
      ["search", "Searching “signup-btn”"],
      ["read", "Reading styles.css"],
      ["edit", "Editing styles.css"],
      ["run", "Running npm test"],
      ["run", "Running the test suite"],
    ];
    for (const [icon, text] of steps) {
      say(agent, "agent_status", { runId, state: "working", prompt, by: me.name, step: { icon, text } });
      await sleep(900);
    }
    pending = { runId, prompt };
    say(agent, "agent_result", {
      runId,
      prompt,
      by: me.name,
      summary: "Made the signup button coral with a soft glow, matching the brand. All tests still pass.",
      files: [{ file: "styles.css", add: 2, del: 1 }],
      patch: DIFF,
      truncated: false,
      tests: { ok: true, passed: 7, failed: 0, failures: [], ms: 412 },
      ms: 23800,
      steps: steps.length,
      stepsList: steps.map(([icon, text]) => ({ icon, text })),
      costUsd: 0.04,
    });
    say(agent, "agent_status", { runId, state: "idle" });
    await sleep(1600);
    h.onTyping(other, true);
    await sleep(1400);
    h.onTyping(other, false);
    say(other, "text", null, { kind: "text", text: "ooh that's way better" });
  }

  return {
    live: false,
    me: { ...me, avatar: null, status: "online" },
    members,
    history,
    async sendText(text, metadata = {}) {
      const msg = { id: id(), kind: "text", sender: me, text, sentAt: Date.now(), reactions: [], metadata };
      h.onMessage(msg);
      const cmd = metadata.approveRun ? { kind: "ship" } : parseCommand(text, cfg.agent);
      if (!cmd) return msg;
      await sleep(500);
      if (cmd.kind === "ask") runAgent(cmd.arg);
      else if (cmd.kind === "ship" && pending) {
        say(agent, "agent_event", { kind: "shipped", sha: Math.random().toString(16).slice(2, 9), files: 1, by: me.name, prompt: pending.prompt, runId: pending.runId });
        pending = null;
      } else if (cmd.kind === "undo") {
        say(agent, "agent_event", { kind: "discarded", by: me.name });
        pending = null;
      } else say(agent, "agent_event", { kind: "help", lines: ["@CodePilot <what to change>", "/ship", "/undo", "/status"] });
      return msg;
    },
    async react(mid, emoji, on = true) {
      h.onReactions(mid, on ? [{ emoji, count: 1, mine: true }] : []);
    },
    startTyping() {},
    endTyping() {},
    async destroy() {},
    async logout() {},
  };
}
