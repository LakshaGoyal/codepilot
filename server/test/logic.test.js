import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseCommand, extractMessage } from "../brain.js";
import { parseTestOutput, describeTool } from "../agent.js";
import { codexArgs, parseCodexEvent, runCodex } from "../codex.js";

const execP = promisify(execFile);

test("@Pager mentions become asks", () => {
  assert.deepEqual(parseCommand("@Pager make the button orange"), { kind: "ask", arg: "make the button orange" });
  assert.deepEqual(parseCommand("@pager, fix tests"), { kind: "ask", arg: "fix tests" });
  assert.deepEqual(parseCommand("<@uid:codepilot-agent> hi"), { kind: "ask", arg: "hi" });
});

test("slash commands parse", () => {
  assert.deepEqual(parseCommand("/ship"), { kind: "ship", arg: "" });
  assert.deepEqual(parseCommand("/undo now"), { kind: "undo", arg: "now" });
});

test("plain chatter is ignored", () => {
  assert.equal(parseCommand("nice work team"), null);
  assert.equal(parseCommand(""), null);
  assert.equal(parseCommand("email me @pagerduty later"), null);
});

test("bare mention asks for help", () => {
  assert.deepEqual(parseCommand("@Pager"), { kind: "help", arg: "" });
});

test("node:test spec output is parsed", () => {
  const r = parseTestOutput("✔ a (1ms)\n✖ rejects bad email (2.1ms)\nℹ pass 6\nℹ fail 1\n", false, 10);
  assert.equal(r.passed, 6);
  assert.equal(r.failed, 1);
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures, ["rejects bad email"]);
});

test("TAP output is parsed", () => {
  const r = parseTestOutput("not ok 3 - signup needs a name\n# pass 6\n# fail 1\n", false, 10);
  assert.deepEqual([r.passed, r.failed, r.failures[0]], [6, 1, "signup needs a name"]);
});

test("tool calls become readable steps", () => {
  assert.equal(describeTool("Edit", { file_path: "styles.css" }).text, "Editing styles.css");
  assert.equal(describeTool("Bash", { command: "npm test" }).text, "Running npm test");
  assert.equal(describeTool("Grep", { pattern: "signup" }).icon, "search");
});

test("Codex is invoked headlessly in the workspace with the user request", () => {
  const args = codexArgs("change the signup button", "E:/comet-command/workspace");
  assert.deepEqual(args.slice(0, 6), ["exec", "--json", "--approve-for-me", "--cd", "E:/comet-command/workspace", "--ephemeral"]);
  assert.match(args.at(-1), /change the signup button/);
});

test("Codex JSON events become readable steps and a summary", () => {
  assert.deepEqual(parseCodexEvent({ type: "item.started", item: { type: "command_execution", command: "npm test" } }).step, { icon: "run", text: "Running npm test" });
  assert.equal(parseCodexEvent({ type: "item.completed", item: { type: "agent_message", text: "Updated the button." } }).text, "Updated the button.");
  assert.equal(parseCodexEvent({ type: "turn.failed", error: { message: "nope" } }).error, "nope");
});

test("Codex adapter uses the workspace cwd and reports success or failure", async () => {
  const makeSpawn = (lines, code = 0) => {
    const calls = [];
    const spawn = (bin, args, options) => {
      calls.push({ bin, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        for (const line of lines) child.stdout.emit("data", Buffer.from(line + "\n"));
        child.emit("close", code);
      });
      return child;
    };
    return { spawn, calls };
  };
  const ok = makeSpawn(['{"type":"item.completed","item":{"type":"agent_message","text":"Changed it."}}']);
  const result = await runCodex("change it", { bin: "codex-test", workspace: "E:/workspace", onStep: () => {}, spawn: ok.spawn });
  assert.equal(ok.calls[0].options.cwd, "E:/workspace");
  assert.equal(result.summary, "Changed it.");
  assert.equal(result.isError, false);
  const bad = makeSpawn(['{"type":"turn.failed","error":{"message":"denied"}}'], 1);
  assert.equal((await runCodex("change it", { bin: "codex-test", workspace: "E:/workspace", onStep: () => {}, spawn: bad.spawn })).isError, true);

  if (process.platform === "win32") {
    const cmdSpawn = makeSpawn(['{"type":"item.completed","item":{"type":"agent_message","text":"Cmd test."}}']);
    await runCodex("change it", { bin: "C:\\path\\to\\codex.cmd", workspace: "E:/workspace", onStep: () => {}, spawn: cmdSpawn.spawn });
    assert.equal(cmdSpawn.calls[0].bin, "cmd.exe");
    assert.deepEqual(cmdSpawn.calls[0].args.slice(0, 4), ["/d", "/s", "/c", "C:\\path\\to\\codex.cmd"]);
  }
});

test("callback payloads are unwrapped", () => {
  const msg = { id: "9", sender: "hridya", receiver: "ship-it", data: { text: "@Pager hi" } };
  assert.equal(extractMessage({ data: { message: msg } }), msg);
  assert.equal(extractMessage(msg), msg);
  assert.equal(extractMessage({ trigger: "x" }), null);
});

// =========================================================================
// Baseline & Run Result Validation Test Suite (Cases 1-6)
// =========================================================================

function evaluateRunState({ isError, diff, tests }) {
  const hasChanges = Boolean(diff?.files?.length > 0);
  const testsOk = Boolean(tests?.ok);
  const testsFailed = Boolean(tests && (tests.ok === false || (tests.failed && tests.failed > 0)));
  const hasReviewableDiff = hasChanges && !isError && testsOk;
  const allowShip = hasReviewableDiff;
  const isNoChangeState = !hasChanges && !isError;
  const approvalStatus = isError
    ? "CODEX FAILED"
    : !hasChanges
    ? "NO CHANGES"
    : testsFailed
    ? "TESTS FAILED"
    : "READY FOR REVIEW";

  return {
    hasChanges,
    hasReviewableDiff,
    allowShip,
    isNoChangeState,
    approvalStatus,
  };
}

test("Case 1: Codex succeeds + new diff → successful review", () => {
  const state = evaluateRunState({
    isError: false,
    diff: { files: [{ file: "index.html", add: 2, del: 0 }], hasChanges: true },
    tests: { ok: true, passed: 7, failed: 0 },
  });
  assert.equal(state.hasReviewableDiff, true);
  assert.equal(state.allowShip, true);
  assert.equal(state.approvalStatus, "READY FOR REVIEW");
});

test("Case 2: Codex succeeds + no diff → no-change state", () => {
  const state = evaluateRunState({
    isError: false,
    diff: { files: [], hasChanges: false },
    tests: { ok: true, passed: 7, failed: 0 },
  });
  assert.equal(state.hasReviewableDiff, false);
  assert.equal(state.allowShip, false);
  assert.equal(state.isNoChangeState, true);
  assert.equal(state.approvalStatus, "NO CHANGES");
});

test("Case 3: Codex succeeds + tests fail + diff exists → failed tests, review state must reflect failure", () => {
  const state = evaluateRunState({
    isError: false,
    diff: { files: [{ file: "index.html", add: 2, del: 0 }], hasChanges: true },
    tests: { ok: false, passed: 6, failed: 1, failures: ["signup needs a name"] },
  });
  assert.equal(state.hasReviewableDiff, false);
  assert.equal(state.allowShip, false);
  assert.equal(state.approvalStatus, "TESTS FAILED");
});

test("Case 4: Codex fails + diff exists → execution failure", () => {
  const state = evaluateRunState({
    isError: true,
    diff: { files: [{ file: "index.html", add: 1, del: 0 }], hasChanges: true },
    tests: { ok: true, passed: 7, failed: 0 },
  });
  assert.equal(state.hasReviewableDiff, false);
  assert.equal(state.allowShip, false);
  assert.equal(state.approvalStatus, "CODEX FAILED");
});

test("Case 5: Existing unrelated uncommitted change + Codex makes new change → only Codex's new change belongs to this run", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codepilot-test-"));
  try {
    const gitRun = (...args) => execP("git", args, { cwd: tmpDir }).then((r) => r.stdout.trim());
    await gitRun("init");
    await gitRun("config", "user.name", "Test");
    await gitRun("config", "user.email", "test@test.local");
    
    // Initial commit
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "hello world\n");
    await fs.writeFile(path.join(tmpDir, "file2.txt"), "original\n");
    await gitRun("add", "-A");
    await gitRun("commit", "-m", "init");

    // Existing uncommitted user change in file1.txt
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "hello modified world\n");

    // Capture baseline before Codex run
    await gitRun("add", "-A");
    const baselineTree = await gitRun("write-tree");

    // Codex modifies file2.txt during the run
    await fs.writeFile(path.join(tmpDir, "file2.txt"), "changed by codex\n");

    // Capture current tree and compute run diff
    await gitRun("add", "-A");
    const currentTree = await gitRun("write-tree");
    const numstat = await gitRun("diff", "--numstat", baselineTree, currentTree);
    const files = numstat.split("\n").filter(Boolean).map((l) => l.split("\t")[2]);

    // Only file2.txt belongs to this run! file1.txt must NOT be in the run diff.
    assert.deepEqual(files, ["file2.txt"]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test("Case 6: Existing unrelated uncommitted change + Codex makes no change → no-change state", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codepilot-test-"));
  try {
    const gitRun = (...args) => execP("git", args, { cwd: tmpDir }).then((r) => r.stdout.trim());
    await gitRun("init");
    await gitRun("config", "user.name", "Test");
    await gitRun("config", "user.email", "test@test.local");

    // Initial commit
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "hello world\n");
    await gitRun("add", "-A");
    await gitRun("commit", "-m", "init");

    // Existing uncommitted user change in file1.txt
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "hello modified world\n");

    // Capture baseline before Codex run
    await gitRun("add", "-A");
    const baselineTree = await gitRun("write-tree");

    // Codex runs and makes NO changes
    await gitRun("add", "-A");
    const currentTree = await gitRun("write-tree");

    assert.equal(baselineTree, currentTree);
    const hasChanges = baselineTree !== currentTree;
    assert.equal(hasChanges, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
