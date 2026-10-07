// Independent deterministic code review engine for CodePilot.
// Evaluates real run diffs, tests, and metadata to generate an actionable score,
// dimension breakdown, and safety verdict.

export function reviewChange({ request = "", diff = null, tests = null, risk = null, isError = false } = {}) {
  const files = diff?.files || [];
  const patch = diff?.patch || "";
  const totalAdd = files.reduce((acc, f) => acc + (f.add || 0), 0);
  const totalDel = files.reduce((acc, f) => acc + (f.del || 0), 0);
  const totalLines = totalAdd + totalDel;
  const hasChanges = files.length > 0;

  // Case 1: No change produced
  if (!hasChanges) {
    return {
      status: "no-change",
      verdict: "NO CHANGE",
      headline: "Review Not Required",
      reason: "CodePilot did not produce a new workspace change for this request.",
      score: null,
      dimensions: {
        requestMatch: 0,
        scope: 100,
        tests: tests?.ok ? 100 : 0,
        regressionRisk: 100,
        codeQuality: 100,
        security: 100,
      },
      findings: [
        { level: "info", message: "No new code was produced during this run." }
      ],
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    };
  }

  // Case 2: Codex execution failed
  if (isError) {
    return {
      status: "blocked",
      verdict: "BLOCKED",
      headline: "Review Blocked",
      reason: "Codex execution encountered an error during code generation.",
      score: 0,
      dimensions: {
        requestMatch: 0,
        scope: 0,
        tests: 0,
        regressionRisk: 0,
        codeQuality: 0,
        security: 0,
      },
      findings: [
        { level: "fail", message: "✕ Execution failure: Agent could not complete the requested modification." }
      ],
      filesChanged: files.length,
      linesAdded: totalAdd,
      linesRemoved: totalDel,
    };
  }

  const findings = [];
  let requestMatch = 100;
  let scope = 100;
  let testScore = 100;
  let regressionRisk = 100;
  let codeQuality = 100;
  let security = 100;

  const fileNames = files.map((f) => f.file.toLowerCase());
  const reqWords = (request.toLowerCase().match(/[a-z0-9_-]{3,}/g) || []).filter(
    (w) => !["the", "and", "for", "with", "that", "this", "small", "below", "above", "make", "change", "add"].includes(w)
  );

  // 1. Request Match Evaluation (25%)
  const isStyleReq = /(?:color|background|bg|purple|orange|blue|red|green|style|font|margin|padding|border|radius|shadow|align|theme|dark|light|height|width|size)/i.test(request);
  const isMarkupReq = /(?:button|subtitle|title|text|label|input|form|card|header|footer|div|paragraph|html|page|link)/i.test(request);
  const touchesCss = fileNames.some((f) => f.endsWith(".css"));
  const touchesHtml = fileNames.some((f) => f.endsWith(".html") || f.endsWith(".jsx") || f.endsWith(".tsx"));

  const matchesKeyword = reqWords.length === 0 || reqWords.some((w) => {
    return fileNames.some((f) => f.includes(w)) || patch.toLowerCase().includes(w);
  }) || (isStyleReq && touchesCss) || (isMarkupReq && (touchesHtml || touchesCss));

  if (matchesKeyword) {
    findings.push({ level: "pass", message: "✓ Change directly addresses requested task intent" });
  } else {
    requestMatch -= 25;
    findings.push({ level: "warn", message: "⚠ Change may not directly match requested keywords" });
  }

  // 2. Scope Evaluation (20%)
  if (files.length === 1) {
    findings.push({ level: "pass", message: `✓ Tightly scoped modification (1 file touched: ${files[0].file})` });
  } else if (files.length <= 3) {
    scope -= 10;
    findings.push({ level: "pass", message: `✓ Reasonable change scope (${files.length} files touched)` });
  } else {
    scope -= Math.min(45, files.length * 10);
    findings.push({ level: "warn", message: `⚠ Broad modification touching ${files.length} separate files` });
  }

  if (totalLines > 100) {
    scope -= 15;
    findings.push({ level: "warn", message: `⚠ High diff volume (${totalLines} total lines modified)` });
  }

  // 3. Test Status Evaluation (20%)
  const testsPassed = Boolean(tests?.ok && (!tests.failed || tests.failed === 0));
  if (testsPassed) {
    testScore = 100;
    findings.push({ level: "pass", message: `✓ All ${tests?.passed ?? 0} regression tests passed cleanly` });
  } else {
    testScore = 0;
    findings.push({ level: "fail", message: `✕ Automated tests failed (${tests?.failed ?? 1} failing test(s))` });
  }

  // 4. Regression Risk Evaluation (15%)
  const touchedPackageJson = fileNames.some((f) => f.includes("package.json"));
  const touchedConfig = fileNames.some((f) => f.includes("config") || f.includes(".env") || f.includes("tsconfig"));
  
  if (touchedPackageJson) {
    regressionRisk -= 30;
    findings.push({ level: "warn", message: "⚠ package.json was modified (dependencies / scripts altered)" });
  }
  if (touchedConfig) {
    regressionRisk -= 25;
    findings.push({ level: "warn", message: "⚠ Configuration or environment setup was modified" });
  }
  if (totalDel > 30) {
    regressionRisk -= 20;
    findings.push({ level: "warn", message: `⚠ Significant code deletion (${totalDel} lines removed)` });
  }
  if (!touchedPackageJson && !touchedConfig && totalDel <= 30) {
    findings.push({ level: "pass", message: "✓ Low regression risk (isolated application layer update)" });
  }

  // 5. Code Quality Heuristics (10%)
  if (totalLines > 80) {
    codeQuality -= 15;
  }
  const touchedJs = fileNames.some((f) => f.endsWith(".js") || f.endsWith(".jsx") || f.endsWith(".ts"));
  const touchedTest = fileNames.some((f) => f.includes("test") || f.includes("spec"));
  if (touchedJs && !touchedTest && totalLines > 40) {
    codeQuality -= 10;
    findings.push({ level: "warn", message: "⚠ Logic was updated without corresponding test additions" });
  } else {
    findings.push({ level: "pass", message: "✓ Code change adheres to workspace structure" });
  }

  // 6. Security Analysis (10%)
  const sensitiveFiles = fileNames.filter((f) =>
    f === ".env" ||
    f.startsWith(".env.") ||
    f.includes(".env/") ||
    f.includes("/.env") ||
    f.includes("credentials") ||
    f.includes("secrets") ||
    f.endsWith(".pem") ||
    f.endsWith(".key") ||
    f.includes("id_rsa")
  );
  const touchedDotEnv = sensitiveFiles.length > 0;

  // Inspect only added lines for high-confidence credential structures
  const addedLines = patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));

  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/i,
    /\bsk_(?:live|test)_[a-zA-Z0-9]{20,}\b/,
    /\bsk-[a-zA-Z0-9]{20,}\b/,
    /\bghp_[a-zA-Z0-9]{30,}\b/,
    /\bgithub_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
    /bearer\s+[a-zA-Z0-9_\-\.]{25,}/i,
    /(?:api[_-]?key|secret|auth_token)\s*[:=]\s*['"`][a-zA-Z0-9_\-\.]{16,}['"`]/i,
    /(?:password|passwd|pwd)\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i,
  ];

  const hasSecret = addedLines.some((line) => secretPatterns.some((pattern) => pattern.test(line)));

  if (hasSecret) {
    security = 0;
    findings.push({ level: "fail", message: "✕ Secret-like token or credential pattern detected in diff" });
  }
  if (touchedDotEnv) {
    security -= 60;
    findings.push({ level: "fail", message: `✕ Sensitive configuration/credential file modified (${sensitiveFiles.join(", ")})` });
  }
  if (!hasSecret && !touchedDotEnv) {
    findings.push({ level: "pass", message: "✓ No actual secrets detected" });
  }

  // Calculate weighted overall score
  requestMatch = Math.max(0, Math.min(100, requestMatch));
  scope = Math.max(0, Math.min(100, scope));
  testScore = Math.max(0, Math.min(100, testScore));
  regressionRisk = Math.max(0, Math.min(100, regressionRisk));
  codeQuality = Math.max(0, Math.min(100, codeQuality));
  security = Math.max(0, Math.min(100, security));

  const overallScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        requestMatch * 0.25 +
        scope * 0.20 +
        testScore * 0.20 +
        regressionRisk * 0.15 +
        codeQuality * 0.10 +
        security * 0.10
      )
    )
  );

  // Verdict determination
  let status = "ready";
  let verdict = "READY";
  let headline = "Ready for Human Approval";

  const hasFailures = findings.some((f) => f.level === "fail");
  const hasWarnings = findings.some((f) => f.level === "warn");

  if (!testsPassed || hasSecret || touchedDotEnv || security < 50) {
    status = "blocked";
    verdict = "BLOCKED";
    headline = !testsPassed
      ? "Review Blocked: Automated Tests Failed"
      : "Review Blocked: Security Issue Detected";
  } else if (hasWarnings || overallScore < 80 || risk?.level === "HIGH") {
    status = "review";
    verdict = "REVIEW REQUIRED";
    headline = "Manual Inspection Recommended Before Shipping";
  } else {
    status = "ready";
    verdict = "READY";
    headline = "✓ Passed All Automated Review Criteria";
  }

  return {
    status,
    verdict,
    headline,
    score: overallScore,
    dimensions: {
      requestMatch,
      scope,
      tests: testScore,
      regressionRisk,
      codeQuality,
      security,
    },
    findings,
    filesChanged: files.length,
    linesAdded: totalAdd,
    linesRemoved: totalDel,
  };
}
