// Deterministic Risk Radar evaluator for CodePilot execution events.
// Evaluates risk strictly based on execution operations and changed files.
// NO LLM calls are made.

export function evaluateRisk(steps = [], files = []) {
  let hasBlocked = false;
  let maxLevel = "LOW"; // "LOW" | "MEDIUM" | "HIGH" | "BLOCKED"
  let blockedCount = 0;
  const operations = [];

  // Rules:
  // Read/Search → LOW
  // Edit/MultiEdit → LOW
  // Write → MEDIUM
  // npm test → LOW
  // package installation → MEDIUM
  // database/schema changes → HIGH
  // delete/rm → HIGH
  // git push → BLOCKED

  const stepList = Array.isArray(steps) ? steps : [];
  for (const s of stepList) {
    const raw = (typeof s === "string" ? s : s?.text || "").toLowerCase();
    const icon = s?.icon || "";
    let opLevel = "LOW";
    let category = "Read/Search";
    let rationale = "Safe read operation";

    if (raw.includes("git push") || raw.includes("push --") || raw.includes("push origin")) {
      opLevel = "BLOCKED";
      category = "git push";
      rationale = "Remote push operation blocked by safety policy";
      hasBlocked = true;
      blockedCount++;
    } else if (
      raw.includes("rm ") ||
      raw.includes("delete") ||
      raw.includes("rimraf") ||
      raw.includes("unlink") ||
      raw.includes("del ")
    ) {
      opLevel = "HIGH";
      category = "delete/rm";
      rationale = "File or resource deletion detected";
    } else if (
      raw.includes("schema") ||
      raw.includes("migration") ||
      raw.includes(".sql") ||
      raw.includes("database") ||
      raw.includes("alter table") ||
      raw.includes("drop table")
    ) {
      opLevel = "HIGH";
      category = "database/schema";
      rationale = "Database schema or migration change detected";
    } else if (
      raw.includes("npm i") ||
      raw.includes("npm install") ||
      raw.includes("yarn add") ||
      raw.includes("pnpm add") ||
      raw.includes("package.json")
    ) {
      opLevel = "MEDIUM";
      category = "package installation";
      rationale = "Dependency package modification";
    } else if (raw.startsWith("writing ") || icon === "write") {
      opLevel = "MEDIUM";
      category = "Write";
      rationale = "Creating new file in workspace";
    } else if (raw.includes("test") || (icon === "run" && raw.includes("npm test"))) {
      opLevel = "LOW";
      category = "npm test";
      rationale = "Automated test execution";
    } else if (raw.startsWith("editing ") || icon === "edit") {
      opLevel = "LOW";
      category = "Edit/MultiEdit";
      rationale = "In-place file edit within workspace sandbox";
    } else if (raw.startsWith("reading ") || raw.startsWith("searching ") || icon === "read" || icon === "search") {
      opLevel = "LOW";
      category = "Read/Search";
      rationale = "Read-only workspace inspection";
    } else {
      opLevel = "LOW";
      category = "Execution";
      rationale = "Standard workspace operation";
    }

    operations.push({
      text: typeof s === "string" ? s : s?.text || category,
      level: opLevel,
      category,
      rationale,
    });

    if (opLevel === "BLOCKED") {
      maxLevel = "BLOCKED";
    } else if (opLevel === "HIGH" && maxLevel !== "BLOCKED") {
      maxLevel = "HIGH";
    } else if (opLevel === "MEDIUM" && maxLevel !== "BLOCKED" && maxLevel !== "HIGH") {
      maxLevel = "MEDIUM";
    }
  }

  // Also verify touched files for database/schema or package changes
  const fileList = Array.isArray(files) ? files : [];
  for (const f of fileList) {
    const fn = (typeof f === "string" ? f : f?.file || "").toLowerCase();
    if (fn.includes("schema") || fn.endsWith(".sql") || fn.includes("migration")) {
      if (maxLevel !== "BLOCKED") maxLevel = "HIGH";
      operations.push({
        text: `Schema file touched: ${fn}`,
        level: "HIGH",
        category: "database/schema",
        rationale: "Database schema or migration file modified",
      });
    } else if (fn === "package.json" || fn === "package-lock.json") {
      if (maxLevel !== "BLOCKED" && maxLevel !== "HIGH") maxLevel = "MEDIUM";
      operations.push({
        text: `Dependency file touched: ${fn}`,
        level: "MEDIUM",
        category: "package installation",
        rationale: "Package manifest altered",
      });
    }
  }

  const filesTouched = fileList.length;
  const operationsCount = Math.max(operations.length, 1);

  return {
    level: maxLevel, // "LOW" | "MEDIUM" | "HIGH" | "BLOCKED"
    filesTouched,
    operationsCount,
    blockedCount,
    operations,
  };
}
