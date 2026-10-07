import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSecurityGate } from "../securityGate.js";

test("TEST 1: Normal source edit → PASS, LOW", () => {
  const result = evaluateSecurityGate({
    steps: [
      { icon: "read", text: "Reading index.html" },
      { icon: "edit", text: "Editing index.html" },
    ],
    diff: {
      files: [{ file: "index.html", add: 2, del: 0 }],
      patch: `+<p class="subtitle">Welcome</p>`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "pass");
  assert.equal(result.level, "LOW");
  assert.equal(result.score, 100);
  assert.equal(result.blockedReasons.length, 0);
  assert.ok(result.checks.every((c) => c.status === "pass"));
});

test("TEST 2: .env modified → BLOCKED", () => {
  const result = evaluateSecurityGate({
    steps: [{ icon: "edit", text: "Editing .env" }],
    diff: {
      files: [{ file: ".env", add: 1, del: 0 }],
      patch: `+API_KEY=secret123`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.level, "BLOCKED");
  assert.equal(result.score, 0);
  assert.ok(result.blockedReasons.some((r) => r.includes(".env")));
  assert.equal(result.checks.find((c) => c.name === "Secret protection")?.status, "fail");
});

test("TEST 3: Secret-like token added to source → BLOCKED", () => {
  const result = evaluateSecurityGate({
    steps: [{ icon: "edit", text: "Editing validate.js" }],
    diff: {
      files: [{ file: "validate.js", add: 2, del: 0 }],
      patch: `+const apiKey = "TEST_API_KEY_1234567890123456";\n+const token = "TEST_GITHUB_TOKEN_1234567890123456";`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.level, "BLOCKED");
  assert.equal(result.score, 0);
  assert.ok(result.blockedReasons.some((r) => r.includes("Secret-like")));
  assert.equal(result.checks.find((c) => c.name === "Secret protection")?.status, "fail");
});

test("TEST 4: package.json modified → REVIEW, MEDIUM", () => {
  const result = evaluateSecurityGate({
    steps: [{ icon: "edit", text: "Editing package.json" }],
    diff: {
      files: [{ file: "package.json", add: 1, del: 0 }],
      patch: `+"axios": "^1.0.0"`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "review");
  assert.equal(result.level, "MEDIUM");
  assert.equal(result.score, 75);
  assert.equal(result.blockedReasons.length, 0);
  assert.equal(result.checks.find((c) => c.name === "Dependencies")?.status, "warn");
});

test("TEST 5: package-lock.json modified → REVIEW", () => {
  const result = evaluateSecurityGate({
    steps: [{ icon: "edit", text: "Editing package-lock.json" }],
    diff: {
      files: [{ file: "package-lock.json", add: 10, del: 2 }],
      patch: `@@ -1,5 +1,10 @@`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "review");
  assert.equal(result.level, "MEDIUM");
  assert.equal(result.checks.find((c) => c.name === "Dependencies")?.status, "warn");
});

test("TEST 6: Destructive command event → BLOCKED", () => {
  const result = evaluateSecurityGate({
    steps: [
      { icon: "run", text: "Running rm -rf /workspace/test" },
    ],
    diff: {
      files: [{ file: "test/validate.test.js", add: 0, del: 20 }],
      patch: `@@ -1,20 +0,0 @@`,
    },
    tests: { ok: true, passed: 0, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.level, "BLOCKED");
  assert.ok(result.blockedReasons.some((r) => r.includes("Destructive")));
  assert.equal(result.checks.find((c) => c.name === "Destructive commands")?.status, "fail");
});

test("TEST 7: Attempted modification outside workspace → BLOCKED", () => {
  const result = evaluateSecurityGate({
    steps: [
      { icon: "run", text: "Running cd .. && rm test.txt" },
    ],
    diff: {
      files: [{ file: "../../sensitive.txt", add: 1, del: 0 }],
      patch: `+malicious edit`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.level, "BLOCKED");
  assert.ok(result.blockedReasons.some((r) => r.includes("outside workspace")));
  assert.equal(result.checks.find((c) => c.name === "Workspace boundary")?.status, "fail");
});

test("TEST 8: git push event → BLOCKED", () => {
  const result = evaluateSecurityGate({
    steps: [
      { icon: "run", text: "Running git push origin main" },
    ],
    diff: {
      files: [{ file: "styles.css", add: 1, del: 0 }],
      patch: `+/* test */`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.level, "BLOCKED");
  assert.ok(result.blockedReasons.some((r) => r.includes("git push")));
  assert.equal(result.checks.find((c) => c.name === "Git safety")?.status, "fail");
});

test("TEST 9: Normal npm test → PASS", () => {
  const result = evaluateSecurityGate({
    steps: [
      { icon: "read", text: "Reading styles.css" },
      { icon: "edit", text: "Editing styles.css" },
      { icon: "run", text: "Running npm test" },
      { icon: "run", text: "Running the test suite" },
    ],
    diff: {
      files: [{ file: "styles.css", add: 1, del: 1 }],
      patch: `@@ -26,2 +26,2 @@\n-background: red;\n+background: purple;`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "pass");
  assert.equal(result.level, "LOW");
  assert.equal(result.score, 100);
  assert.equal(result.blockedReasons.length, 0);
});

test("TEST 10: No diff → NOT EVALUATED", () => {
  const result = evaluateSecurityGate({
    steps: [{ icon: "run", text: "Running npm test" }],
    diff: { files: [], patch: "" },
    tests: { ok: true, passed: 7, failed: 0 },
    workspace: "E:/comet-command/workspace",
  });

  assert.equal(result.status, "no-change");
  assert.equal(result.level, "NOT EVALUATED");
  assert.equal(result.score, null);
  assert.equal(result.blockedReasons.length, 0);
});
