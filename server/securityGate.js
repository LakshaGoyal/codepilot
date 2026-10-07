// Deterministic Security Gate for CodePilot.
// Evaluates actual execution operations, changed files, diff content, and workspace boundaries.
// Generates pre-ship safety verdicts without running secondary AI models or databases.

export function evaluateSecurityGate({ steps = [], diff = null, tests = null, workspace = "" } = {}) {
  const files = diff?.files || [];
  const patch = diff?.patch || "";
  const stepList = Array.isArray(steps) ? steps : [];
  const hasChanges = files.length > 0;

  // Case: No changes produced during run
  if (!hasChanges) {
    return {
      status: "no-change",
      level: "NOT EVALUATED",
      score: null,
      headline: "Security Gate Not Evaluated",
      reason: "No new code change was produced during this run.",
      checks: [
        { name: "Workspace boundary", status: "info", message: "Not evaluated (no changes)" },
        { name: "Secret protection", status: "info", message: "Not evaluated (no changes)" },
        { name: "Destructive operations", status: "info", message: "Not evaluated (no changes)" },
        { name: "External access", status: "info", message: "Not evaluated (no changes)" },
        { name: "Dependencies", status: "info", message: "Not evaluated (no changes)" },
        { name: "Configuration", status: "info", message: "Not evaluated (no changes)" },
        { name: "Git safety", status: "info", message: "Not evaluated (no changes)" },
      ],
      blockedReasons: [],
      warnings: [],
      filesTouched: 0,
      operationsCount: stepList.length,
    };
  }

  const blockedReasons = [];
  const warnings = [];
  const checks = [];

  const fileNames = files.map((f) => (typeof f === "string" ? f : f?.file || "").toLowerCase());
  const stepTexts = stepList.map((s) => (typeof s === "string" ? s : s?.text || "").toLowerCase());

  // ----------------------------------------------------
  // 1. WORKSPACE BOUNDARY CHECK
  // ----------------------------------------------------
  let boundaryPass = true;
  let boundaryMsg = "All file modifications remained inside workspace.";
  
  for (const fn of fileNames) {
    if (fn.startsWith("..") || fn.includes("/..") || fn.includes("\\..") || (fn.includes(":") && !fn.includes("workspace"))) {
      boundaryPass = false;
      const reason = `Attempted file modification outside workspace: ${fn}`;
      blockedReasons.push(reason);
      boundaryMsg = reason;
      break;
    }
  }
  for (const st of stepTexts) {
    if (st.includes("cd ..") || (st.includes("..") && (st.includes("rm ") || st.includes("del ") || st.includes("edit")))) {
      boundaryPass = false;
      const reason = `Attempted operation targeting outside workspace: ${st}`;
      blockedReasons.push(reason);
      boundaryMsg = reason;
      break;
    }
  }
  checks.push({
    name: "Workspace boundary",
    status: boundaryPass ? "pass" : "fail",
    message: boundaryMsg,
  });

  // ----------------------------------------------------
  // 2. SECRET / CREDENTIAL PROTECTION
  // ----------------------------------------------------
  let secretPass = true;
  let secretMsg = "No secrets or credentials detected.";
  const sensitiveFiles = fileNames.filter((f) =>
    f === ".env" ||
    f.startsWith(".env.") ||
    f.includes("credentials") ||
    f.includes("secrets") ||
    f.endsWith(".pem") ||
    f.endsWith(".key") ||
    f.includes("id_rsa")
  );

  if (sensitiveFiles.length > 0) {
    secretPass = false;
    const reason = `Sensitive credential file modified: ${sensitiveFiles.join(", ")}`;
    blockedReasons.push(reason);
    secretMsg = reason;
  }

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

  const hasSecretDiff = addedLines.some((line) => secretPatterns.some((p) => p.test(line)));
  if (hasSecretDiff) {
    secretPass = false;
    const reason = "Secret-like token or private key detected in code diff";
    blockedReasons.push(reason);
    secretMsg = reason;
  }

  checks.push({
    name: "Secret protection",
    status: secretPass ? "pass" : "fail",
    message: secretMsg,
  });

  // ----------------------------------------------------
  // 3. DESTRUCTIVE OPERATIONS
  // ----------------------------------------------------
  let destructivePass = true;
  let destructiveMsg = "No destructive operations detected.";
  for (const st of stepTexts) {
    if (
      st.includes("rm -rf") ||
      st.includes("rmdir") ||
      st.includes("remove-item -recurse") ||
      st.includes("format ") ||
      st.includes("mkfs") ||
      st.includes("drop database") ||
      st.includes("drop table")
    ) {
      destructivePass = false;
      const reason = `Destructive command detected: ${st}`;
      blockedReasons.push(reason);
      destructiveMsg = reason;
      break;
    }
  }
  checks.push({
    name: "Destructive commands",
    status: destructivePass ? "pass" : "fail",
    message: destructiveMsg,
  });

  // ----------------------------------------------------
  // 4. EXTERNAL ACCESS / SUSPICIOUS COMMANDS
  // ----------------------------------------------------
  let externalPass = true;
  let externalMsg = "No unauthorized external system access detected.";
  for (const st of stepTexts) {
    if (st.includes("/etc/") || st.includes("c:\\windows\\system32\\config") || st.includes("~/.ssh") || st.includes("curl | sh") || st.includes("wget | bash")) {
      externalPass = false;
      const reason = `Suspicious external system directory/network pipe accessed: ${st}`;
      blockedReasons.push(reason);
      externalMsg = reason;
      break;
    }
  }
  checks.push({
    name: "External access",
    status: externalPass ? "pass" : "fail",
    message: externalMsg,
  });

  // ----------------------------------------------------
  // 5. DEPENDENCY CHANGES
  // ----------------------------------------------------
  const depFiles = fileNames.filter((f) =>
    f === "package.json" ||
    f === "package-lock.json" ||
    f === "npm-shrinkwrap.json" ||
    f === "yarn.lock" ||
    f === "pnpm-lock.yaml"
  );
  let depStatus = "pass";
  let depMsg = "No dependency changes.";
  if (depFiles.length > 0) {
    depStatus = "warn";
    depMsg = `Dependency manifest modified (${depFiles.join(", ")})`;
    warnings.push(depMsg);
  }
  checks.push({
    name: "Dependencies",
    status: depStatus,
    message: depMsg,
  });

  // ----------------------------------------------------
  // 6. CONFIGURATION CHANGES
  // ----------------------------------------------------
  const configFiles = fileNames.filter((f) =>
    f.includes("vite.config") ||
    f.includes("webpack.config") ||
    f.includes("tsconfig") ||
    f.includes("next.config")
  );
  let configStatus = "pass";
  let configMsg = "Standard source files modified.";
  if (configFiles.length > 0) {
    configStatus = "warn";
    configMsg = `Build configuration modified (${configFiles.join(", ")})`;
    warnings.push(configMsg);
  }
  checks.push({
    name: "Configuration",
    status: configStatus,
    message: configMsg,
  });

  // ----------------------------------------------------
  // 7. GIT SAFETY
  // ----------------------------------------------------
  let gitPass = true;
  let gitMsg = "No unauthorized remote git operations.";
  for (const st of stepTexts) {
    if (st.includes("git push") || st.includes("push origin") || st.includes("push --")) {
      gitPass = false;
      const reason = "Automated git push detected (prohibited by safety gate)";
      blockedReasons.push(reason);
      gitMsg = reason;
      break;
    }
  }
  checks.push({
    name: "Git safety",
    status: gitPass ? "pass" : "fail",
    message: gitMsg,
  });

  // ----------------------------------------------------
  // OVERALL LEVEL & SCORE COMPUTATION
  // ----------------------------------------------------
  let level = "LOW";
  let score = 100;
  let status = "pass";
  let headline = "✓ Security Gate Passed · Low Risk Verified";

  if (blockedReasons.length > 0) {
    level = "BLOCKED";
    status = "blocked";
    score = 0;
    headline = `Security Gate Blocked: ${blockedReasons[0]}`;
  } else if (warnings.length > 0) {
    level = "MEDIUM";
    status = "review";
    score = depFiles.length > 0 ? 75 : 85;
    headline = `Human Review Required: ${warnings[0]}`;
  } else {
    level = "LOW";
    status = "pass";
    score = 100;
    headline = "✓ Passed All Deterministic Safety Checks";
  }

  return {
    status,
    level,
    score,
    headline,
    checks,
    blockedReasons,
    warnings,
    filesTouched: files.length,
    operationsCount: stepList.length,
  };
}
