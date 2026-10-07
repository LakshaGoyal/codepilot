// Deterministic "Why?" explanation generator for execution events.
// Generates clear, explainable developer rationale without invoking any LLM.

export function explainWhy(step = {}) {
  const text = (step.text || "").trim();
  const lower = text.toLowerCase();
  const file = step.file || "";

  // 1. Reading
  if (lower.startsWith("reading ") || step.icon === "read") {
    const target = file || text.replace(/^reading\s+/i, "").trim();
    if (target.endsWith(".html")) {
      return "CodePilot inspected the page structure to locate the requested UI element.";
    }
    if (target.endsWith(".css")) {
      return "CodePilot inspected stylesheet selectors and properties to identify styling definitions.";
    }
    if (target.endsWith(".js") || target.endsWith(".jsx") || target.endsWith(".ts") || target.endsWith(".tsx")) {
      return "CodePilot inspected component logic and module structure to locate the implementation.";
    }
    if (target.endsWith(".json")) {
      return "CodePilot examined configuration and scripts to understand project settings.";
    }
    return `CodePilot inspected ${target || "the file"} to locate relevant code and understand current context.`;
  }

  // 2. Searching
  if (lower.startsWith("searching ") || step.icon === "search") {
    const query = text.replace(/^searching\s+/i, "").replace(/[“”"]/g, "").trim();
    return `CodePilot searched the workspace to locate the existing ${query ? `“${query}”` : "requested"} implementation.`;
  }

  // 3. Editing
  if (lower.startsWith("editing ") || step.icon === "edit") {
    const target = file || text.replace(/^editing\s+/i, "").trim();
    if (target.endsWith(".css")) {
      return "CodePilot changed the stylesheet because the requested visual behavior is controlled there.";
    }
    if (target.endsWith(".html")) {
      return "CodePilot updated the HTML markup to modify the requested element text and structure.";
    }
    if (target.endsWith(".js") || target.endsWith(".jsx") || target.endsWith(".ts")) {
      return "CodePilot updated application logic to implement the requested behavior.";
    }
    return `CodePilot modified ${target || "the file"} to apply the requested changes.`;
  }

  // 4. Writing
  if (lower.startsWith("writing ") || step.icon === "write") {
    const target = file || text.replace(/^writing\s+/i, "").trim();
    return `CodePilot created ${target || "a new file"} to implement newly required functionality.`;
  }

  // 5. Running
  if (lower.startsWith("running ") || step.icon === "run") {
    if (lower.includes("test")) {
      return "CodePilot ran the existing test suite to verify the change.";
    }
    if (lower.includes("build")) {
      return "CodePilot executed the build process to verify bundle compilation.";
    }
    return `CodePilot executed command “${text.replace(/^running\s+/i, "").trim()}” to carry out workspace tasks.`;
  }

  // 6. Planning / Reasoning
  if (lower.includes("plan") || step.icon === "plan") {
    return "CodePilot evaluated the prompt and formulated an execution plan for workspace changes.";
  }

  return "CodePilot performed this operation to carry out the user's requested workspace task.";
}

export function parseStepDetails(step = {}) {
  const text = (step.text || "").trim();
  let action = "Action";
  let file = null;

  const match = text.match(/^(Reading|Searching|Editing|Writing|Running)\s+(.+)$/i);
  if (match) {
    action = match[1];
    file = match[2].replace(/[“”"]/g, "").trim();
  } else if (text.toLowerCase().includes("plan")) {
    action = "Planning";
    file = null;
  } else {
    action = text;
  }

  return {
    icon: step.icon || "tool",
    action,
    file,
    rawText: text,
    timestamp: step.at
      ? new Date(step.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
      : null,
  };
}
