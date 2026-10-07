// Adapter for Codex CLI's JSONL `exec` protocol.  Keep this separate from the
// Pager workflow so the transport, diff, tests, and approval flow stay stable.
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";

export function codexArgs(prompt, workspace) {
  const fullPrompt = [
    prompt,
    "",
    "Instructions for CodePilot:",
    "- Actually modify the workspace files directly to implement the user's request above.",
    "- Inspect the existing files first.",
    "- Do not merely explain what should be changed.",
    "- Do not stop after planning.",
    "- Do not only run tests.",
    "- Make the requested code changes directly in the workspace files.",
    "- After modifying the files, run the relevant tests.",
    "- Do not commit, push, or modify git configuration.",
    "- When finished, briefly state what changed.",
  ].join("\n");

  return [
    "exec",
    "--json",
    // In Codex 0.160, this option both selects workspace-write and automatically
    // handles approvals; it cannot be combined with an explicit --sandbox flag.
    "--approve-for-me",
    "--cd", workspace,
    "--ephemeral",
    fullPrompt,
  ];
}

export function describeCodexItem(item = {}, workspace = "") {
  const type = item.type || "";
  if (type === "command_execution") {
    const rawCmd = String(item.command || "").replace(/\s+/g, " ").trim();
    if (!rawCmd) return null;
    if (/Get-Content|type\s+|cat\s+/i.test(rawCmd)) {
      const match = rawCmd.match(/(?:Get-Content(?:\s+-Raw)?|type|cat)\s+([^\s;]+)/i);
      const file = match?.[1]?.replaceAll('"', "")?.replaceAll("'", "") || "";
      const short = file && workspace ? path.relative(workspace, path.resolve(workspace, file)).replaceAll("\\", "/") : file;
      return { icon: "read", text: short ? `Reading ${short}` : `Reading files` };
    }
    if (/Get-ChildItem|Select-String|rg\s+|grep\s+|dir\s+|findstr/i.test(rawCmd)) {
      return { icon: "search", text: `Searching workspace` };
    }
    if (/npm\s+test|node\s+--test|test/i.test(rawCmd)) {
      return { icon: "run", text: `Running ${rawCmd.slice(0, 80)}` };
    }
    return { icon: "run", text: `Running ${rawCmd.slice(0, 80)}` };
  }
  if (type === "file_change" || type === "file_edit" || type === "edit") {
    const files = item.changes || item.files || [];
    const file = files[0]?.path || files[0]?.file || item.path || item.file;
    const short = file && workspace ? path.relative(workspace, path.resolve(workspace, file)).replaceAll("\\", "/") : file;
    return short ? { icon: "edit", text: `Editing ${String(short).replaceAll("\\", "/")}` } : { icon: "edit", text: "Applying file changes" };
  }
  if (type === "file_read" || type === "read") {
    const file = item.path || item.file;
    const short = file && workspace ? path.relative(workspace, path.resolve(workspace, file)).replaceAll("\\", "/") : file;
    return short ? { icon: "read", text: `Reading ${String(short).replaceAll("\\", "/")}` } : { icon: "read", text: "Reading file" };
  }
  if (type === "reasoning" || type === "plan") return { icon: "plan", text: "Planning the change" };
  return null;
}

// Returns a small, stable view of an event. Unknown event types are ignored.
export function parseCodexEvent(event, workspace = "") {
  const item = event?.item;
  // `item.completed` repeats the same item after its start notification. Emit
  // progress only when it begins so the chat does not show duplicate steps.
  const step = event?.type === "item.started" && item ? describeCodexItem(item, workspace) : null;
  const text = item?.type === "agent_message" ? String(item.text || "").trim() : "";
  const threadId = event?.thread_id || event?.thread?.id || null;
  const error = event?.type === "turn.failed" || event?.type === "error" ? String(event?.error?.message || event?.message || "Codex failed") : null;
  return { step, text, threadId, error, done: event?.type === "turn.completed" };
}

export function runCodex(prompt, { bin, workspace, onStep, spawn = nodeSpawn } = {}) {
  return new Promise((resolve, reject) => {
    let command = bin;
    let args = codexArgs(prompt, workspace);
    console.log(`[codex] Invoking Codex CLI with args:\n`, args);

    if (process.platform === "win32" && /\.cmd$/i.test(bin)) {
      command = "cmd.exe";
      args = ["/d", "/s", "/c", bin, ...args];
    }
    const child = spawn(command, args, { cwd: workspace, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let stderr = "";
    let summary = "";
    let failure = null;
    const consume = (line) => {
      if (!line) return;
      try {
        const parsed = parseCodexEvent(JSON.parse(line), workspace);
        if (parsed.step) onStep(parsed.step);
        if (parsed.text) summary = parsed.text;
        if (parsed.error) failure = parsed.error;
      } catch {
        // JSON mode should be JSONL, but retain non-JSON lines as useful final text.
        summary = line;
      }
    };
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, end).trim());
        buffer = buffer.slice(end + 1);
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      consume(buffer.trim());
      if (code !== 0 || failure) {
        resolve({ summary: failure || stderr.trim().slice(-600) || `codex exited ${code}`, costUsd: null, turns: null, isError: true });
        return;
      }
      resolve({ summary: summary || "Done.", costUsd: null, turns: null, isError: false });
    });
  });
}
