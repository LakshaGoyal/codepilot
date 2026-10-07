// Decides what the agent does with each group message, and talks back through CometChat.
import { config, humanUids } from "./config.js";
import { cc } from "./cometchat.js";
import { runAgent, commit, undo, lastCommits, resetSession } from "./agent.js";
import { reviewChange } from "./codeReview.js";
import { evaluateSecurityGate } from "./securityGate.js";

const state = {
  busy: false,
  run: null, // { id, prompt, by, steps: [] }
  pending: null, // last finished run whose changes are not committed yet
  history: [], // recent finished runs for /api/status
  lastSeen: new Set(),
  online: true,
};

export const getState = () => ({
  busy: state.busy,
  run: state.run && { id: state.run.id, prompt: state.run.prompt, by: state.run.by, steps: state.run.steps.slice(-8) },
  pending: state.pending && { id: state.pending.id, prompt: state.pending.prompt },
  history: state.history.slice(0, 5),
  mode: config.mode,
  mock: config.mockAgent,
});

// Messages in the group are only for the agent if they start with @pager, /, or mention it.
const MENTION = new RegExp(`^\\s*(?:<@uid:${config.agentUid}>|@${config.agentName}|@agent|@pager)[\\s,:]*`, "i");

export function parseCommand(text) {
  const t = (text || "").trim();
  if (!t) return null;
  if (t.startsWith("/")) {
    const [cmd, ...rest] = t.slice(1).split(/\s+/);
    return { kind: cmd.toLowerCase(), arg: rest.join(" ") };
  }
  if (MENTION.test(t)) {
    const prompt = t.replace(MENTION, "").trim();
    return prompt ? { kind: "ask", arg: prompt } : { kind: "help", arg: "" };
  }
  return null;
}

const nameOf = (msg) => msg?.data?.entities?.sender?.entity?.name || msg?.sender || "someone";
const senderOf = (msg) => (typeof msg?.sender === "object" ? msg.sender.uid : msg?.sender);

// Status updates are throttled: CometChat allows ~30 messages/min per user.
let statusTimer = null;
let statusQueued = null;
function pushStatus(payload) {
  statusQueued = payload;
  if (statusTimer) return;
  const flush = () => {
    const p = statusQueued;
    statusQueued = null;
    statusTimer = null;
    if (p) cc.sendCustom("agent_status", p, `${config.agentName}: ${p.step?.text || p.state}`).catch((e) => console.warn("status:", e.message));
  };
  flush();
  statusTimer = setTimeout(() => {
    statusTimer = null;
    if (statusQueued) pushStatus(statusQueued);
  }, 2500);
}

export async function handleMessage(msg) {
  if (!msg || state.lastSeen.has(String(msg.id))) return;
  state.lastSeen.add(String(msg.id));
  if (state.lastSeen.size > 500) state.lastSeen = new Set([...state.lastSeen].slice(-200));

  const sender = senderOf(msg);
  if (!sender || sender === config.agentUid) return;
  if (msg.receiver !== config.groupGuid && msg.receiverId !== config.groupGuid) return;

  const meta = msg.data?.metadata || msg.metadata || {};
  const text = msg.data?.text ?? msg.text ?? "";
  let cmd = meta.approveRun ? { kind: "ship", arg: meta.approveRun } : parseCommand(text);
  if (meta.discardRun) cmd = { kind: "undo", arg: "" };
  if (!cmd) return;

  if (!humanUids().has(sender)) {
    await cc.sendText(`Sorry ${nameOf(msg)}, you're not on my allowlist. I only take orders from ${config.humans.map((h) => h.name).join(" & ")}.`);
    return;
  }

  const who = nameOf(msg);
  switch (cmd.kind) {
    case "ask":
      return startRun(cmd.arg, who, sender);
    case "ship":
    case "commit":
      return ship(who);
    case "undo":
    case "discard":
      if (state.busy) return cc.sendText("I'm mid-run, give me a sec.");
      await undo();
      state.pending = null;
      return cc.sendCustom("agent_event", { kind: "discarded", by: who }, `${who} discarded the changes`);
    case "status": {
      const commits = await lastCommits(3);
      return cc.sendCustom("agent_event", { kind: "status", busy: state.busy, prompt: state.run?.prompt, commits }, "status");
    }
    case "new":
    case "reset":
      resetSession();
      return cc.sendText("Fresh session. I've forgotten our earlier context.");
    default:
      return cc.sendCustom(
        "agent_event",
        {
          kind: "help",
          lines: [
            "@CodePilot <what to change>  - I edit the code and run the tests",
            "/ship  - commit my last change",
            "/undo  - throw my last change away",
            "/status  - what I'm doing + recent commits",
            "/new  - start a fresh session",
          ],
        },
        "help"
      );
  }
}

async function startRun(prompt, who, uid) {
  if (state.busy) {
    return cc.sendText(`Still working on “${state.run.prompt.slice(0, 60)}”. I'll take the next one when I'm done.`);
  }
  const run = { id: `run_${Date.now().toString(36)}`, prompt, by: who, uid, steps: [], started: Date.now() };
  state.busy = true;
  state.run = run;
  pushStatus({ runId: run.id, state: "working", prompt, by: who, step: { icon: "plan", text: "On it" } });

  try {
    const result = await runAgent(prompt, (step) => {
      run.steps.push(step);
      pushStatus({ runId: run.id, state: "working", prompt, by: who, step, count: run.steps.length });
    });
    const hasDiff = Boolean(result.diff?.files?.length > 0);
    const hasError = Boolean(result.isError);
    if (hasError && !hasDiff) throw new Error(result.summary || "Codex execution failed");

    const summary = result.summary
      ? result.summary.slice(0, 600)
      : hasDiff
      ? "Applied requested changes to workspace."
      : "Codex completed successfully but did not produce a code change.";

    const review = reviewChange({
      request: prompt,
      diff: result.diff,
      tests: result.tests,
      isError: hasError,
    });

    const security = evaluateSecurityGate({
      steps: run.steps,
      diff: result.diff,
      tests: result.tests,
      workspace: config.workspace,
    });

    const card = {
      runId: run.id,
      prompt,
      by: who,
      summary,
      files: result.diff.files.slice(0, 12),
      patch: result.diff.patch,
      truncated: result.diff.truncated,
      tests: result.tests,
      ms: result.ms,
      steps: run.steps.length,
      stepsList: run.steps,
      costUsd: result.costUsd,
      isError: result.isError,
      hasChanges: hasDiff,
      review,
      security,
    };
    state.pending = hasDiff && !hasError && result.tests?.ok && review.status !== "blocked" && security.status !== "blocked" ? { id: run.id, prompt } : null;
    state.history.unshift({ id: run.id, prompt, by: who, files: card.files.length, tests: card.tests, steps: run.steps, at: Date.now() });
    await cc.sendCustom("agent_result", card, `${config.agentName}: ${card.summary.slice(0, 120)}`);
  } catch (e) {
    console.error("run failed:", e);
    await cc.sendCustom("agent_event", { kind: "error", message: String(e.message || e).slice(0, 400) }, "error");
  } finally {
    state.busy = false;
    state.run = null;
    pushStatus({ runId: run.id, state: "idle" });
  }
}

async function ship(who) {
  if (state.busy) return cc.sendText("Hang on, I'm still working. Ship after I report back.");
  if (!state.pending) return cc.sendText("Nothing to ship. Ask me for a change first.");
  const { prompt, id } = state.pending;
  const res = await commit(`${prompt.slice(0, 68)}\n\nRequested in chat, approved by ${who}. Run ${id}.`);
  state.pending = null;
  if (!res) return cc.sendText("Working tree is clean, nothing to commit.");
  await cc.sendCustom("agent_event", { kind: "shipped", sha: res.sha, files: res.files, by: who, prompt, runId: id }, `Shipped ${res.sha}`);
}

// ---- polling transport (no dashboard setup needed) ----
export async function startPolling() {
  let cursor = null;
  const boot = Math.floor(Date.now() / 1000) - 2;
  try {
    const latest = await cc.latestMessages(config.groupGuid, 1);
    cursor = latest?.[0]?.id ?? null;
  } catch (e) {
    console.warn("could not read latest message, falling back to time filter:", e.message);
  }
  console.log(`[poll] watching ${config.groupGuid} from message ${cursor ?? "(start)"}`);
  const tick = async () => {
    try {
      const msgs = cursor ? await cc.messagesAfter(config.groupGuid, cursor) : await cc.latestMessages(config.groupGuid, 20);
      const list = (Array.isArray(msgs) ? msgs : []).sort((a, b) => Number(a.id) - Number(b.id));
      for (const m of list) {
        if (cursor && Number(m.id) <= Number(cursor)) continue;
        cursor = m.id;
        if (m.sentAt && m.sentAt < boot) continue;
        handleMessage(m).catch((e) => console.error("handle:", e.message));
      }
      state.online = true;
    } catch (e) {
      state.online = false;
      console.warn("[poll]", e.message);
    }
    setTimeout(tick, 1500);
  };
  tick();
}

// ---- callback transport (CometChat Custom Agent relays to us) ----
export function extractMessage(body) {
  // The relay wraps the message object; accept the common shapes.
  const cands = [body?.data?.message, body?.message, body?.data, body];
  return cands.find((c) => c && (c.sender || c.data?.text) && (c.receiver || c.receiverId)) || null;
}
