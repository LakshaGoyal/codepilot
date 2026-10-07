import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewChange } from "../codeReview.js";

test("TEST 1: Small valid code change + tests pass → READY", () => {
  const result = reviewChange({
    request: "add a small subtitle below the signup button",
    diff: {
      files: [{ file: "index.html", add: 2, del: 0 }],
      patch: `@@ -22,2 +22,3 @@
       <button type="submit" class="signup-btn">Create my account</button>
+      <p class="button-subtitle">Create your account in seconds</p>`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.verdict, "READY");
  assert.ok(result.score >= 80, `Expected score >= 80, got ${result.score}`);
  assert.equal(result.dimensions.tests, 100);
  assert.equal(result.dimensions.security, 100);
  assert.ok(result.findings.some((f) => f.level === "pass" && f.message.includes("passed cleanly")));
});

test("TEST 2: No diff → NO CHANGE", () => {
  const result = reviewChange({
    request: "make no changes",
    diff: { files: [], patch: "" },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.status, "no-change");
  assert.equal(result.verdict, "NO CHANGE");
  assert.equal(result.score, null);
  assert.ok(result.findings.some((f) => f.level === "info"));
});

test("TEST 3: Tests fail → BLOCKED", () => {
  const result = reviewChange({
    request: "update signup rules",
    diff: {
      files: [{ file: "validate.js", add: 5, del: 2 }],
      patch: `@@ -10,2 +10,5 @@
-  return pw.length >= 8;
+  return pw.length >= 20;`,
    },
    tests: { ok: false, passed: 5, failed: 2, failures: ["short passwords are weak"] },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.dimensions.tests, 0);
  assert.ok(result.findings.some((f) => f.level === "fail" && f.message.includes("Automated tests failed")));
});

test("TEST 4: Unrelated files changed → warning / lower scope score", () => {
  const result = reviewChange({
    request: "change the signup button color",
    diff: {
      files: [
        { file: "index.html", add: 1, del: 0 },
        { file: "server.js", add: 10, del: 2 },
        { file: "db.js", add: 15, del: 5 },
        { file: "auth.js", add: 20, del: 10 },
      ],
      patch: `@@ -1,4 +1,4 @@`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.ok(result.dimensions.scope < 80, `Expected scope < 80, got ${result.dimensions.scope}`);
  assert.ok(result.findings.some((f) => f.level === "warn" && f.message.includes("Broad modification")));
});

test("TEST 5: .env changed → security warning/block", () => {
  const result = reviewChange({
    request: "add config",
    diff: {
      files: [{ file: ".env", add: 2, del: 0 }],
      patch: `+API_KEY=TEST_API_KEY_123456789\n+SECRET=xyz`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.verdict, "BLOCKED");
  assert.ok(result.dimensions.security <= 40, `Expected security <= 40, got ${result.dimensions.security}`);
  assert.ok(result.findings.some((f) => f.level === "fail" && f.message.includes(".env")));
});

test("TEST 6: package.json changed → dependency/config warning", () => {
  const result = reviewChange({
    request: "add new library",
    diff: {
      files: [{ file: "package.json", add: 1, del: 0 }],
      patch: `+    "axios": "^1.0.0"`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.ok(result.dimensions.regressionRisk < 80, `Expected regressionRisk < 80, got ${result.dimensions.regressionRisk}`);
  assert.ok(result.findings.some((f) => f.level === "warn" && f.message.includes("package.json was modified")));
});

test("TEST 7: Large diff → increased regression risk", () => {
  const result = reviewChange({
    request: "large refactor",
    diff: {
      files: [
        { file: "index.html", add: 40, del: 35 },
        { file: "styles.css", add: 60, del: 20 },
      ],
      patch: `@@ -1,50 +1,75 @@`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.ok(result.dimensions.regressionRisk < 90);
  assert.ok(result.dimensions.codeQuality < 90);
  assert.ok(result.findings.some((f) => f.level === "warn" && (f.message.includes("Significant code deletion") || f.message.includes("High diff volume"))));
});

test("TEST 8: Normal frontend change → no false security warning", () => {
  const result = reviewChange({
    request: "make button purple",
    diff: {
      files: [{ file: "styles.css", add: 1, del: 1 }],
      patch: `@@ -26,3 +26,3 @@
-  background: #f97316;
+  background: #9333ea;`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.dimensions.security, 100);
  assert.equal(result.status, "ready");
  assert.equal(result.verdict, "READY");
  assert.ok(!result.findings.some((f) => f.level === "fail"));
  assert.ok(result.findings.some((f) => f.level === "pass" && f.message.includes("No actual secrets detected")));
});

test("REGRESSION TEST 1: Added button UI text 'Sign up' → NO SECRET", () => {
  const result = reviewChange({
    request: "change create my account text to sign up",
    diff: {
      files: [{ file: "index.html", add: 1, del: 1 }],
      patch: `@@ -20,7 +20,7 @@
         <div class="field">
           <label>Password</label>
           <input type="password" name="password">
         </div>
-        <button type="submit" class="signup-btn">Create my account</button>
+        <button type="submit" class="signup-btn">Sign up</button>
         <p class="button-subtitle">Create your account in seconds</p>`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.dimensions.security, 100);
  assert.equal(result.status, "ready");
  assert.equal(result.verdict, "READY");
  assert.ok(result.score >= 90);
  assert.ok(!result.findings.some((f) => f.level === "fail"));
});

test("REGRESSION TEST 2: Added subtitle UI text → NO SECRET", () => {
  const result = reviewChange({
    request: "add subtitle",
    diff: {
      files: [{ file: "index.html", add: 1, del: 0 }],
      patch: `+        <p class="button-subtitle">Create your account in seconds</p>`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.dimensions.security, 100);
  assert.equal(result.status, "ready");
});

test("REGRESSION TEST 3: Added code line const label = 'API key' → NO SECRET", () => {
  const result = reviewChange({
    request: "add label",
    diff: {
      files: [{ file: "app.js", add: 1, del: 0 }],
      patch: `+const label = "API key";`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.dimensions.security, 100);
  assert.equal(result.status, "ready");
});

test("REGRESSION TEST 4: Realistic secret API key added → SECRET DETECTED", () => {
  const result = reviewChange({
    request: "add key",
    diff: {
      files: [{ file: "app.js", add: 1, del: 0 }],
      patch: `+const API_KEY = "sk-1234567890abcdef1234567890abcdef";`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.dimensions.security, 0);
  assert.equal(result.status, "blocked");
  assert.equal(result.verdict, "BLOCKED");
});

test("REGRESSION TEST 5: JWT token added → SECRET DETECTED", () => {
  const result = reviewChange({
    request: "add token",
    diff: {
      files: [{ file: "auth.js", add: 1, del: 0 }],
      patch: `+const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.dimensions.security, 0);
  assert.equal(result.status, "blocked");
});

test("REGRESSION TEST 6: Normal password form UI → NO SECRET", () => {
  const result = reviewChange({
    request: "add password field",
    diff: {
      files: [{ file: "index.html", add: 2, del: 0 }],
      patch: `+<label>Password</label>\n+<input type="password" name="password" placeholder="Enter your password">`,
    },
    tests: { ok: true, passed: 7, failed: 0 },
  });

  assert.equal(result.dimensions.security, 100);
  assert.equal(result.status, "ready");
});

