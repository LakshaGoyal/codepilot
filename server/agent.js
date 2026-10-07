// Runs Codex headlessly inside WORKSPACE_DIR and reports what it is doing.
import { execFile, exec as execShell } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";
import { runCodex } from "./codex.js";

const exec = promisify(execFile);
const execCmd = promisify(execShell);
const MAX_PATCH = 4200; // CometChat customData is capped at 10 KB; leave room for the rest of the card

// The workspace keeps its history in .pager-git so it never nests inside the Agent Pager repo.
const git = (...args) =>
  exec("git", [`--git-dir=${path.join(config.workspace, ".pager-git")}`, `--work-tree=${config.workspace}`, ...args], {
    cwd: config.workspace,
    maxBuffer: 8 << 20,
  }).then((r) => r.stdout);

// Turns a stream-json tool_use block into a short human step for the chat.
export function describeTool(name, input = {}) {
  const file = input.file_path || input.path || input.notebook_path;
  const short = file ? path.relative(config.workspace, path.resolve(config.workspace, file)).replaceAll("\\", "/") : "";
  switch (name) {
    case "Read":
      return { icon: "read", text: `Reading ${short}` };
    case "Edit":
    case "MultiEdit":
      return { icon: "edit", text: `Editing ${short}` };
    case "Write":
      return { icon: "edit", text: `Writing ${short}` };
    case "Glob":
    case "Grep":
      return { icon: "search", text: `Searching ${input.pattern ? `“${String(input.pattern).slice(0, 40)}”` : "the code"}` };
    case "Bash":
      return { icon: "run", text: `Running ${String(input.command || "").slice(0, 60)}` };
    case "TodoWrite":
      return { icon: "plan", text: "Planning the change" };
    default:
      return { icon: "tool", text: name };
  }
}

export function resetSession() {
  // Codex exec uses one isolated request at a time. Keep this no-op so /new
  // remains compatible if resumable sessions are added later.
}

async function mockClaude(prompt, onStep) {
  const steps = [
    { icon: "plan", text: "Planning the change" },
    { icon: "search", text: "Searching “signup”" },
    { icon: "read", text: "Reading index.html" },
    { icon: "edit", text: "Editing styles.css" },
    { icon: "run", text: "Running npm test" },
  ];
  for (const s of steps) {
    onStep(s);
    await new Promise((r) => setTimeout(r, 700));
  }
  return { summary: `(mock) I would have done: ${prompt.slice(0, 80)}`, costUsd: 0, turns: steps.length, isError: false };
}

export async function captureBaseline() {
  await git("add", "-A").catch(() => {});
  return (await git("write-tree")).trim();
}

export async function collectDiff(baselineTree) {
  await git("add", "-A").catch(() => {});
  let numstat = "";
  let patch = "";
  if (baselineTree) {
    const currentTree = (await git("write-tree")).trim();
    if (baselineTree === currentTree) {
      return { files: [], patch: "", truncated: false, hasChanges: false };
    }
    numstat = await git("diff", "--numstat", baselineTree, currentTree).catch(() => "");
    patch = await git("diff", "--unified=2", "--no-color", baselineTree, currentTree).catch(() => "");
  } else {
    numstat = await git("diff", "--numstat").catch(() => "");
    patch = await git("diff", "--unified=2", "--no-color").catch(() => "");
  }
  const files = numstat
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [add, del, file] = l.split("\t");
      return { file, add: Number(add) || 0, del: Number(del) || 0 };
    });
  const truncated = patch.length > MAX_PATCH;
  if (truncated) patch = patch.slice(0, MAX_PATCH);
  return { files, patch, truncated, hasChanges: files.length > 0 };
}

export async function runTests() {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execCmd("npm test --silent", {
      cwd: config.workspace,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 << 20,
    });
    return parseTestOutput(stdout + stderr, true, Date.now() - started);
  } catch (e) {
    return parseTestOutput(`${e.stdout || ""}${e.stderr || ""}`, false, Date.now() - started);
  }
}

export function parseTestOutput(out, ok, ms) {
  const num = (re) => Number(out.match(re)?.[1] ?? NaN);
  // node:test prints "ℹ pass 7" (spec reporter) or "# pass 7" (TAP)
  let passed = num(/^(?:#|ℹ) pass (\d+)/m);
  let failed = num(/^(?:#|ℹ) fail (\d+)/m);
  if (Number.isNaN(passed)) passed = num(/(\d+) passing/);
  if (Number.isNaN(failed)) failed = num(/(\d+) failing/);
  passed = Number.isNaN(passed) ? null : passed;
  failed = Number.isNaN(failed) ? (ok ? 0 : null) : failed;
  const failures = [...out.matchAll(/^(?:not ok \d+ - |✖ )(.+?)(?: \([\d.]+ms\))?$/gm)]
    .map((m) => m[1])
    .filter((f) => !/^failing tests:?$/i.test(f))
    .slice(0, 3);
  return { ok: ok && !failed, passed, failed, failures, ms };
}

export async function runAgent(prompt, onStep) {
  const started = Date.now();
  const baseline = await captureBaseline().catch(() => null);
  const res = config.mockAgent ? await mockClaude(prompt, onStep) : await runCodex(prompt, { bin: config.codexBin, workspace: config.workspace, onStep });
  onStep({ icon: "run", text: "Running the test suite" });
  const [diff, tests] = await Promise.all([collectDiff(baseline), runTests()]);
  return { ...res, diff, tests, ms: Date.now() - started, baseline };
}

export async function commit(message) {
  const { files } = await collectDiff();
  if (!files.length) return null;
  await git("add", "-A");
  await git("-c", "user.name=CodePilot (agent)", "-c", "user.email=codepilot@agent.local", "commit", "-q", "-m", message);
  const sha = (await git("rev-parse", "--short", "HEAD")).trim();
  return { sha, files: files.length };
}

export async function undo() {
  await git("checkout", "--", ".").catch(() => {});
  await git("clean", "-fdq").catch(() => {});
}

export async function lastCommits(n = 3) {
  const out = await git("log", `-${n}`, "--pretty=%h\t%s\t%cr").catch(() => "");
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, subject, when] = l.split("\t");
      return { sha, subject, when };
    });
}
