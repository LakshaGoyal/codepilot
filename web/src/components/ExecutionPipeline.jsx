import { useState, useMemo } from "react";
import { evaluateRisk } from "../lib/risk.js";
import { explainWhy, parseStepDetails } from "../lib/why.js";
import { reviewChange } from "../lib/codeReview.js";
import { evaluateSecurityGate } from "../lib/securityGate.js";

const ICONS = {
  read: "◔",
  edit: "✎",
  search: "⌕",
  run: "▶",
  plan: "☰",
  tool: "◆",
};

export const StepIcon = ({ icon }) => (
  <span className={`step-icon ${icon}`}>{ICONS[icon] || "•"}</span>
);

function DiffViewer({ patch, truncated }) {
  if (!patch) return <div className="diff-empty">No diff generated.</div>;
  const lines = patch
    .split("\n")
    .filter((l) => !/^(diff --git|index |--- |\+\+\+ |new file mode|similarity)/.test(l));

  return (
    <pre className="pipeline-diff-box">
      {lines.map((l, i) => {
        const cls = l.startsWith("@@")
          ? "hunk"
          : l.startsWith("+")
          ? "add"
          : l.startsWith("-")
          ? "del"
          : "";
        return (
          <span key={i} className={`diff-line ${cls}`}>
            {l || " "}
          </span>
        );
      })}
      {truncated && <span className="diff-truncated">… diff truncated to fit message</span>}
    </pre>
  );
}

export default function ExecutionPipeline({
  run,
  messages = [],
  agent,
  onShip,
  onDiscard,
  onSendCommand,
}) {
  const [expandedDiff, setExpandedDiff] = useState(true);
  const [whyOpenIndex, setWhyOpenIndex] = useState(null);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [activeStage, setActiveStage] = useState(null);

  // Extract all completed result cards and shipped events
  const resultMessages = useMemo(
    () => messages.filter((m) => m.kind === "agent_result"),
    [messages]
  );
  const shippedMessages = useMemo(
    () => messages.filter((m) => m.kind === "agent_event" && m.data?.kind === "shipped"),
    [messages]
  );
  const discardedMessages = useMemo(
    () => messages.filter((m) => m.kind === "agent_event" && m.data?.kind === "discarded"),
    [messages]
  );

  // Determine current active or selected run
  const activeResultMsg = useMemo(() => {
    if (selectedRunId) {
      return resultMessages.find((m) => m.data?.runId === selectedRunId) || resultMessages[resultMessages.length - 1];
    }
    return resultMessages[resultMessages.length - 1] || null;
  }, [resultMessages, selectedRunId]);

  // Are we currently in an active run, or looking at a completed result, or in standby?
  const isWorking = Boolean(run);
  const currentRunId = isWorking ? run.runId : activeResultMsg?.data?.runId || null;

  // Shipped / Discarded info for this run
  const shippedEvent = useMemo(() => {
    if (!currentRunId) return shippedMessages[shippedMessages.length - 1] || null;
    return shippedMessages.find(
      (m) =>
        m.data?.runId === currentRunId ||
        (activeResultMsg && m.data?.prompt === activeResultMsg.data?.prompt) ||
        (activeResultMsg && m.sentAt >= activeResultMsg.sentAt)
    ) || null;
  }, [shippedMessages, currentRunId, activeResultMsg]);

  const discardedEvent = useMemo(() => {
    if (!currentRunId) return discardedMessages[discardedMessages.length - 1] || null;
    return discardedMessages.find(
      (m) =>
        m.sentAt >= (activeResultMsg?.sentAt || 0) ||
        (m.data?.runId && m.data?.runId === currentRunId)
    ) || null;
  }, [discardedMessages, currentRunId, activeResultMsg]);

  const isShipped = Boolean(shippedEvent);
  const isDiscarded = Boolean(discardedEvent && !isShipped);

  // Diff & Result data
  const files = activeResultMsg?.data?.files || [];
  const patch = activeResultMsg?.data?.patch || "";
  const truncated = Boolean(activeResultMsg?.data?.truncated);
  const totalAdd = files.reduce((acc, f) => acc + (f.add || 0), 0);
  const totalDel = files.reduce((acc, f) => acc + (f.del || 0), 0);
  const hasChanges = files.length > 0;
  const isError = Boolean(activeResultMsg?.data?.isError);

  // Derive execution steps
  const steps = useMemo(() => {
    if (isWorking && run?.steps) return run.steps;
    if (activeResultMsg?.data?.stepsList) return activeResultMsg.data.stepsList;
    if (hasChanges) {
      const fSteps = files.map((f) => ({
        icon: "edit",
        text: `Editing ${f.file}`,
      }));
      return [
        { icon: "plan", text: "Planning the change" },
        ...fSteps,
        { icon: "run", text: "Running npm test" },
      ];
    }
    return [];
  }, [isWorking, run, activeResultMsg, files, hasChanges]);

  // Prompt and user info
  const prompt = isWorking ? run.prompt : activeResultMsg?.data?.prompt || "";
  const requestedBy = isWorking ? run.by : activeResultMsg?.data?.by || "User";
  const startedAt = isWorking ? run.startedAt : activeResultMsg ? activeResultMsg.sentAt - (activeResultMsg.data?.ms || 0) : null;
  const timeFormatted = startedAt
    ? new Date(startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : "";

  // Test data
  const tests = activeResultMsg?.data?.tests || null;
  const testsOk = tests?.ok === true;
  const testsFailed = tests ? tests.ok === false || (tests.failed && tests.failed > 0) : false;

  // Risk Radar evaluation (deterministic)
  const risk = useMemo(() => {
    return evaluateRisk(steps, files);
  }, [steps, files]);

  // AI Code Review evaluation
  const review = useMemo(() => {
    if (activeResultMsg?.data?.review) return activeResultMsg.data.review;
    if (!hasChanges) {
      return reviewChange({ request: prompt, diff: null, tests, isError });
    }
    return reviewChange({ request: prompt, diff: { files, patch }, tests, risk, isError });
  }, [activeResultMsg, prompt, files, patch, tests, risk, isError, hasChanges]);

  // 🛡️ Security Gate evaluation
  const security = useMemo(() => {
    if (activeResultMsg?.data?.security) return activeResultMsg.data.security;
    if (!hasChanges) {
      return evaluateSecurityGate({ steps, diff: null, tests, workspace: "workspace" });
    }
    return evaluateSecurityGate({ steps, diff: { files, patch }, tests, workspace: "workspace" });
  }, [activeResultMsg, steps, files, patch, tests, hasChanges]);

  // Validation rules (gated by diff, tests, review status, and security gate status)
  const hasReviewableDiff = hasChanges && !isError && testsOk && review.status !== "blocked" && security.status !== "blocked";

  // Standby state check
  const isStandby = !isWorking && !activeResultMsg;

  // Helper to toggle Why? panels
  const toggleWhy = (idx) => {
    setWhyOpenIndex(whyOpenIndex === idx ? null : idx);
  };

  // Stage status determination
  const commandStageStatus = isStandby ? "pending" : "completed";
  const planningStageStatus = isStandby
    ? "pending"
    : isWorking && steps.length <= 1
    ? "active"
    : "completed";
  const executingStageStatus = isStandby
    ? "pending"
    : isWorking && (!steps[steps.length - 1]?.text?.toLowerCase().includes("test") || steps.length < 2)
    ? "active"
    : isError
    ? "failed"
    : "completed";
  const testingStageStatus = isStandby
    ? "pending"
    : isWorking && steps[steps.length - 1]?.text?.toLowerCase().includes("test")
    ? "active"
    : tests
    ? testsOk
      ? hasChanges
        ? "completed"
        : "failed"
      : "failed"
    : "pending";
  const diffStageStatus = isStandby
    ? "pending"
    : isWorking
    ? "pending"
    : isError
    ? "failed"
    : hasChanges
    ? "completed"
    : "failed";
  const reviewStageStatus = isStandby
    ? "pending"
    : isWorking
    ? "pending"
    : !hasChanges
    ? "no-change"
    : review.status === "blocked"
    ? "failed"
    : review.status === "review"
    ? "warning"
    : "completed";
  const securityStageStatus = isStandby
    ? "pending"
    : isWorking
    ? "pending"
    : !hasChanges
    ? "no-change"
    : security.status === "blocked"
    ? "failed"
    : security.status === "review"
    ? "warning"
    : "completed";
  const approvalStageStatus = isStandby
    ? "pending"
    : isShipped
    ? "completed"
    : isDiscarded
    ? "failed"
    : isError || !hasChanges || testsFailed || review.status === "blocked" || security.status === "blocked"
    ? "failed"
    : hasReviewableDiff
    ? "active"
    : "pending";
  const shippedStageStatus = isStandby ? "pending" : isShipped ? "completed" : "pending";

  // Pipeline stages for the horizontal bar
  const pipelineStages = [
    { key: "command", label: "COMMAND", status: commandStageStatus },
    { key: "plan", label: "PLAN", status: planningStageStatus },
    { key: "execute", label: "EXECUTE", status: executingStageStatus },
    { key: "test", label: "TEST", status: testingStageStatus },
    { key: "diff", label: "DIFF", status: diffStageStatus },
    { key: "review", label: "REVIEW", status: reviewStageStatus },
    { key: "security", label: "SECURITY", status: securityStageStatus },
    { key: "approval", label: "APPROVAL", status: approvalStageStatus },
    { key: "ship", label: "SHIP", status: shippedStageStatus },
  ];

  const stageNodeChar = (status) => {
    if (status === "completed") return "✓";
    if (status === "active") return "●";
    if (status === "failed") return "✕";
    if (status === "warning") return "⚠";
    return "○";
  };

  return (
    <div className="execution-pipeline">
      {/* Pipeline Header */}
      <div className="pipeline-header">
        <div className="pipeline-title-group">
          <h2 className="pipeline-title">
            {isStandby ? "CODEPILOT" : "CURRENT RUN"}
          </h2>
          <span
            className={`pipeline-live-indicator ${
              isWorking
                ? "running"
                : isShipped
                ? "shipped"
                : isStandby
                ? "idle"
                : isError || !hasChanges
                ? "bad"
                : "completed"
            }`}
          >
            {isWorking
              ? "● EXECUTING"
              : isShipped
              ? "✓ SHIPPED"
              : isStandby
              ? "READY"
              : isError
              ? "✕ FAILED"
              : isDiscarded
              ? "DISCARDED"
              : !hasChanges
              ? "NO CHANGES"
              : "✓ COMPLETED"}
          </span>
        </div>

        {/* Run Selector if multiple runs exist */}
        {resultMessages.length > 1 && (
          <div className="run-history-selector">
            <span className="selector-label">History</span>
            <select
              value={currentRunId || ""}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="run-select"
              aria-label="Select run"
            >
              {isWorking && <option value={run.runId}>Active: {run.runId}</option>}
              {resultMessages.map((m, idx) => (
                <option key={m.data?.runId || idx} value={m.data?.runId}>
                  #{idx + 1} {m.data?.runId} · {m.data?.prompt?.slice(0, 24)}...
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ─── Standby Hero ─── */}
      {isStandby && (
        <div className="pipeline-standby-banner">
          <div className="standby-text">
            <h3>AI Code Control Center</h3>
            <p>
              AI executes. CodePilot verifies. You decide.<br />
              Send a command to <b>@{agent.name}</b> to begin.
            </p>
          </div>
          <div className="standby-suggestions">
            <button
              className="standby-chip"
              onClick={() => onSendCommand?.(`@${agent.name} change the signup button text to "Create account"`)}
            >
              @{agent.name} change the signup button text to "Create account"
            </button>
            <button
              className="standby-chip"
              onClick={() => onSendCommand?.(`@${agent.name} make the signup button orange`)}
            >
              @{agent.name} make the signup button orange
            </button>
          </div>
        </div>
      )}

      {/* ─── Current Run Info ─── */}
      {!isStandby && (
        <div className="pipeline-stage stage-hero" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '28px 0' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '6px' }}>
            {currentRunId && <span className="stage-run-id">{currentRunId}</span>}
          </div>
          <blockquote className="command-prompt">"{prompt}"</blockquote>
          <div className="command-meta">
            <span className="meta-item">
              Requested by <b>{requestedBy}</b>
            </span>
            {timeFormatted && <span className="meta-item timestamp">{timeFormatted}</span>}
          </div>
        </div>
      )}

      {/* ─── Horizontal Pipeline Bar ─── */}
      {!isStandby && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0',
          padding: '24px 0', borderBottom: '1px solid rgba(255,255,255,0.08)',
          overflowX: 'auto',
          animation: 'cp-fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {pipelineStages.map((stage, i) => (
            <div key={stage.key} style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto' }}>
              <button
                type="button"
                onClick={() => setActiveStage(activeStage === stage.key ? null : stage.key)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                  padding: '8px 12px', border: 'none', background: 'transparent',
                  cursor: 'pointer', transition: 'opacity 0.2s',
                  opacity: activeStage && activeStage !== stage.key ? 0.4 : 1,
                }}
                aria-label={`${stage.label} stage: ${stage.status}`}
              >
                <span style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  border: `1.5px solid ${stage.status === 'completed' || stage.status === 'active' ? '#fff' : stage.status === 'failed' ? '#ff4444' : stage.status === 'warning' ? '#e5a120' : '#555'}`,
                  background: stage.status === 'completed' ? '#fff' : stage.status === 'active' ? '#fff' : 'transparent',
                  boxShadow: stage.status === 'active' ? '0 0 0 3px rgba(255,255,255,0.15)' : 'none',
                  animation: stage.status === 'active' ? 'cp-stage-pulse 2s ease-in-out infinite' : 'none',
                  transition: 'all 0.3s',
                }} />
                <span style={{
                  fontSize: '10px', fontWeight: '500',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: stage.status === 'completed' || stage.status === 'active' ? '#fff' : stage.status === 'failed' ? '#ff4444' : stage.status === 'warning' ? '#e5a120' : '#555',
                  fontFamily: 'var(--font)',
                  whiteSpace: 'nowrap',
                }}>
                  {stage.label}
                </span>
              </button>
              {i < pipelineStages.length - 1 && (
                <div style={{
                  width: '24px', height: '1px',
                  background: pipelineStages[i + 1].status === 'completed' || pipelineStages[i + 1].status === 'active' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)',
                  transition: 'background 0.3s',
                  marginTop: '-18px',
                }} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Stage Details ─── */}
      <div className="pipeline-stream">

        {/* ──── EXECUTION DETAILS ──── */}
        {(!activeStage || activeStage === 'execute') && !isStandby && (
          <div className={`pipeline-stage stage-3 ${executingStageStatus}`}
               style={{ animation: 'cp-fadeUp 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <div className="stage-marker">
              <span className="stage-num">03</span>
              <span className={`stage-node ${executingStageStatus}`}>
                {stageNodeChar(executingStageStatus)}
              </span>
              <div className="stage-v-line" />
            </div>
            <div className="stage-card">
              <div className="stage-card-header">
                <div className="stage-header-title">
                  <span className="stage-label">EXECUTION</span>
                  <span className="stage-count">({steps.length} events)</span>
                </div>
                <span className="stage-status-badge">{executingStageStatus.toUpperCase()}</span>
              </div>
              {steps.length === 0 ? (
                <p className="stage-empty-text">
                  {activeResultMsg && !hasChanges
                    ? "Codex made no workspace modifications."
                    : "No execution events recorded."}
                </p>
              ) : (
                <div className="execution-events-list">
                  {steps.map((st, i) => {
                    const details = parseStepDetails(st);
                    const isCurrent = isWorking && i === steps.length - 1;
                    const whyText = explainWhy(st);
                    const isWhyOpen = whyOpenIndex === i;
                    return (
                      <div key={i} className={`execution-event-row ${isCurrent ? "is-current" : ""}`}>
                        <div className="event-primary-row">
                          <div className="event-left">
                            <StepIcon icon={details.icon} />
                            <span className="event-action">{details.action}</span>
                            {details.file && <code className="event-file">{details.file}</code>}
                          </div>
                          <div className="event-right">
                            {details.timestamp && (
                              <span className="event-time">{details.timestamp}</span>
                            )}
                            <span className={`event-status-pill ${isCurrent ? "active" : "completed"}`}>
                              {isCurrent ? "● ACTIVE" : "✓"}
                            </span>
                            <button
                              type="button"
                              className={`why-btn ${isWhyOpen ? "open" : ""}`}
                              onClick={() => toggleWhy(i)}
                              title="Why this step?"
                              aria-label="Explain step rationale"
                            >
                              WHY?
                            </button>
                          </div>
                        </div>
                        {isWhyOpen && (
                          <div className="why-panel">
                            <div className="why-header">
                              <span className="why-badge">WHY THIS STEP</span>
                            </div>
                            <p className="why-body">{whyText}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ──── TESTING STAGE ──── */}
        {(!activeStage || activeStage === 'test') && !isStandby && (
          <div className={`pipeline-stage stage-4 ${testingStageStatus}`}>
            <div className="stage-marker">
              <span className="stage-num">04</span>
              <span className={`stage-node ${testingStageStatus}`}>
                {stageNodeChar(testingStageStatus)}
              </span>
              <div className="stage-v-line" />
            </div>
            <div className="stage-card">
              <div className="stage-card-header">
                <span className="stage-label">TESTING</span>
                <span
                  className={`stage-status-badge ${
                    testsOk && hasChanges ? "ok" : testsOk && !hasChanges ? "bad" : testsFailed ? "bad" : ""
                  }`}
                >
                  {testsOk && hasChanges
                    ? "PASS"
                    : testsOk && !hasChanges
                    ? "NO CODE CHANGE"
                    : testsFailed
                    ? "FAIL"
                    : testingStageStatus.toUpperCase()}
                </span>
              </div>
              {isWorking && testingStageStatus === "active" ? (
                <div className="testing-active-state">
                  <span className="spinner" />
                  <span>Running tests…</span>
                </div>
              ) : tests ? (
                <div className={`testing-results ${testsOk && hasChanges ? "is-passed" : "is-failed"}`}>
                  <div className="testing-metrics-grid">
                    <div className="test-metric passed">
                      <span className="metric-val">{tests.passed ?? 0}</span>
                      <span className="metric-lbl">PASSED</span>
                    </div>
                    <div className={`test-metric ${tests.failed > 0 ? "failed" : "zero"}`}>
                      <span className="metric-val">{tests.failed ?? 0}</span>
                      <span className="metric-lbl">FAILED</span>
                    </div>
                    <div className="test-metric duration">
                      <span className="metric-val">{tests.ms ?? 0}ms</span>
                      <span className="metric-lbl">DURATION</span>
                    </div>
                  </div>
                  {testsOk && !hasChanges && !isWorking && (
                    <div className="testing-failures-box no-change-warning">
                      <span className="failures-title">⚠ Tests passed but no code change was produced.</span>
                    </div>
                  )}
                  {tests.failures && tests.failures.length > 0 && (
                    <div className="testing-failures-box">
                      <span className="failures-title">FAILING TESTS</span>
                      <ul className="failures-list">
                        {tests.failures.map((f, fi) => (
                          <li key={fi}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="stage-empty-text">Awaiting test execution…</p>
              )}
            </div>
          </div>
        )}

        {/* ──── DIFF STAGE ──── */}
        {(!activeStage || activeStage === 'diff') && !isStandby && (
          <div className={`pipeline-stage stage-5 ${diffStageStatus}`}>
            <div className="stage-marker">
              <span className="stage-num">05</span>
              <span className={`stage-node ${diffStageStatus}`}>
                {stageNodeChar(diffStageStatus)}
              </span>
              <div className="stage-v-line" />
            </div>
            <div className="stage-card">
              <div className="stage-card-header">
                <div className="stage-header-title">
                  <span className="stage-label">CHANGESET</span>
                  {hasChanges ? (
                    <span className="diff-stats-pill">
                      <b className="plus">+{totalAdd}</b> <b className="minus">−{totalDel}</b> in {files.length} file{files.length > 1 ? "s" : ""}
                    </span>
                  ) : !isWorking && activeResultMsg ? (
                    <span className="stage-status-badge bad">NO CHANGES</span>
                  ) : null}
                </div>
                {hasChanges && (
                  <button
                    type="button"
                    className="diff-toggle-btn"
                    onClick={() => setExpandedDiff(!expandedDiff)}
                    aria-label={expandedDiff ? "Collapse diff" : "Expand diff"}
                  >
                    {expandedDiff ? "COLLAPSE ▲" : "VIEW DIFF ▼"}
                  </button>
                )}
              </div>
              {hasChanges ? (
                <div className="diff-content-area">
                  <div className="diff-files-list">
                    {files.map((f) => (
                      <div key={f.file} className="diff-file-item">
                        <span className="file-name">{f.file}</span>
                        <span className="file-stats">
                          <span className="plus">+{f.add}</span>
                          <span className="minus">−{f.del}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  {expandedDiff && <DiffViewer patch={patch} truncated={truncated} />}
                </div>
              ) : !isWorking && activeResultMsg ? (
                <div className="diff-no-change-card">
                  <p className="no-change-headline">CODEPILOT DID NOT MODIFY THE WORKSPACE</p>
                  <p className="no-change-reason">
                    {activeResultMsg.data?.summary || "Execution completed without producing code changes."}
                  </p>
                </div>
              ) : (
                <p className="stage-empty-text">No workspace diff available.</p>
              )}
            </div>
          </div>
        )}

        {/* ──── AI CODE REVIEW ──── */}
        {(!activeStage || activeStage === 'review') && !isStandby && (
          <div className={`pipeline-stage stage-6 ${reviewStageStatus}`}>
            <div className="stage-marker">
              <span className="stage-num">06</span>
              <span className={`stage-node ${reviewStageStatus}`}>
                {stageNodeChar(reviewStageStatus)}
              </span>
              <div className="stage-v-line" />
            </div>
            <div className="stage-card review-stage-card">
              <div className="stage-card-header">
                <div className="stage-header-title">
                  <span className="stage-label">AI CODE REVIEW</span>
                  {hasChanges && review.score !== null && (
                    <span className={`review-score-pill score-${review.status}`}>
                      {review.score} / 100
                    </span>
                  )}
                </div>
                <span
                  className={`stage-status-badge ${
                    review.status === "ready"
                      ? "ok"
                      : review.status === "review"
                      ? "warning"
                      : review.status === "no-change"
                      ? ""
                      : "bad"
                  }`}
                >
                  {review.verdict}
                </span>
              </div>
              {isWorking ? (
                <div className="review-loading-state">
                  <span className="spinner" />
                  <span>Analyzing changes…</span>
                </div>
              ) : !hasChanges && activeResultMsg ? (
                <div className="review-no-change-box">
                  <p className="review-no-change-headline">CODE REVIEW</p>
                  <p className="review-no-change-sub">Not required — no code was produced.</p>
                </div>
              ) : hasChanges ? (
                <div className="review-body">
                  <div className="review-dimensions-grid">
                    <div className="dimension-item">
                      <span className="dim-label">REQUEST MATCH</span>
                      <span className="dim-bar-wrap">
                        <div className="dim-bar-fill" style={{ width: `${review.dimensions.requestMatch}%` }} />
                      </span>
                      <span className="dim-score">{review.dimensions.requestMatch}</span>
                    </div>
                    <div className="dimension-item">
                      <span className="dim-label">SCOPE</span>
                      <span className="dim-bar-wrap">
                        <div className="dim-bar-fill" style={{ width: `${review.dimensions.scope}%` }} />
                      </span>
                      <span className="dim-score">{review.dimensions.scope}</span>
                    </div>
                    <div className="dimension-item">
                      <span className="dim-label">TESTS</span>
                      <span className="dim-bar-wrap">
                        <div
                          className={`dim-bar-fill ${review.dimensions.tests === 100 ? "ok" : "bad"}`}
                          style={{ width: `${review.dimensions.tests}%` }}
                        />
                      </span>
                      <span className="dim-score">{review.dimensions.tests}</span>
                    </div>
                    <div className="dimension-item">
                      <span className="dim-label">REGRESSION RISK</span>
                      <span className="dim-bar-wrap">
                        <div className="dim-bar-fill" style={{ width: `${review.dimensions.regressionRisk}%` }} />
                      </span>
                      <span className="dim-score">{review.dimensions.regressionRisk}</span>
                    </div>
                    <div className="dimension-item">
                      <span className="dim-label">CODE QUALITY</span>
                      <span className="dim-bar-wrap">
                        <div className="dim-bar-fill" style={{ width: `${review.dimensions.codeQuality}%` }} />
                      </span>
                      <span className="dim-score">{review.dimensions.codeQuality}</span>
                    </div>
                    <div className="dimension-item">
                      <span className="dim-label">SECURITY</span>
                      <span className="dim-bar-wrap">
                        <div
                          className={`dim-bar-fill ${review.dimensions.security >= 80 ? "ok" : "bad"}`}
                          style={{ width: `${review.dimensions.security}%` }}
                        />
                      </span>
                      <span className="dim-score">{review.dimensions.security}</span>
                    </div>
                  </div>
                  <div className="review-findings-list">
                    <span className="findings-title">FINDINGS</span>
                    {review.findings.map((f, fi) => (
                      <div key={fi} className={`review-finding-row ${f.level}`}>
                        <span className="finding-icon">
                          {f.level === "pass" ? "✓" : f.level === "warn" ? "⚠" : f.level === "fail" ? "✕" : "ℹ"}
                        </span>
                        <span className="finding-msg">{f.message}</span>
                      </div>
                    ))}
                  </div>
                  <div className={`review-verdict-banner ${review.status}`}>
                    <span className="verdict-tag">VERDICT</span>
                    <span className="verdict-headline">{review.headline}</span>
                  </div>
                </div>
              ) : (
                <p className="stage-empty-text">Awaiting diff for review…</p>
              )}
            </div>
          </div>
        )}

        {/* ──── SECURITY GATE ──── */}
        {(!activeStage || activeStage === 'security') && !isStandby && (
          <div className={`pipeline-stage stage-7 ${securityStageStatus}`}>
            <div className="stage-marker">
              <span className="stage-num">07</span>
              <span className={`stage-node ${securityStageStatus}`}>
                {stageNodeChar(securityStageStatus)}
              </span>
              <div className="stage-v-line" />
            </div>
            <div className="stage-card security-gate-card">
              <div className="stage-card-header">
                <div className="stage-header-title">
                  <span className="stage-label">SECURITY GATE</span>
                  {hasChanges && security.score !== null && (
                    <span className={`security-score-pill level-${security.level.toLowerCase()}`}>
                      {security.score} / 100
                    </span>
                  )}
                </div>
                <span
                  className={`stage-status-badge ${
                    security.level === "LOW"
                      ? "ok"
                      : security.level === "MEDIUM"
                      ? "warning"
                      : security.status === "no-change"
                      ? ""
                      : "bad"
                  }`}
                >
                  {security.level === "LOW" ? "PASSED" : security.level}
                </span>
              </div>
              {isWorking ? (
                <div className="security-loading-state">
                  <span className="spinner" />
                  <span>Running security checks…</span>
                </div>
              ) : !hasChanges && activeResultMsg ? (
                <div className="security-no-change-box">
                  <p className="security-no-change-headline">SECURITY GATE</p>
                  <p className="security-no-change-sub">Not evaluated — no code change produced.</p>
                </div>
              ) : hasChanges ? (
                <div className="security-gate-body">
                  <div className="security-checks-list">
                    {security.checks.map((chk, ci) => (
                      <div key={ci} className={`security-check-row ${chk.status}`}>
                        <div className="check-left">
                          <span className="check-icon">
                            {chk.status === "pass" ? "✓" : chk.status === "warn" ? "⚠" : chk.status === "fail" ? "✕" : "ℹ"}
                          </span>
                          <span className="check-name">{chk.name}</span>
                        </div>
                        <span className="check-msg">{chk.message}</span>
                        <span className={`check-badge ${chk.status}`}>
                          {chk.status === "pass" ? "PASS" : chk.status === "warn" ? "WARN" : "FAIL"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {security.blockedReasons && security.blockedReasons.length > 0 && (
                    <div className="security-blocked-box">
                      <span className="blocked-title">CRITICAL POLICY VIOLATIONS — SHIP BLOCKED</span>
                      <ul className="blocked-list">
                        {security.blockedReasons.map((br, bi) => (
                          <li key={bi}>{br}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className={`security-verdict-banner ${security.status}`}>
                    <span className="verdict-tag">STATUS</span>
                    <span className="verdict-headline">{security.headline}</span>
                  </div>
                </div>
              ) : (
                <p className="stage-empty-text">Awaiting execution data…</p>
              )}
            </div>
          </div>
        )}

        {/* ──── HUMAN APPROVAL ──── */}
        {(!activeStage || activeStage === 'approval') && !isStandby && (
          <div className={`pipeline-stage stage-8 ${approvalStageStatus}`}>
            <div className="stage-marker">
              <span className="stage-num">08</span>
              <span className={`stage-node ${approvalStageStatus}`}>
                {stageNodeChar(approvalStageStatus)}
              </span>
              <div className="stage-v-line" />
            </div>
            <div className="stage-card approval-card">
              <div className="stage-card-header">
                <span className="stage-label">HUMAN APPROVAL</span>
                <span
                  className={`stage-status-badge ${
                    isShipped
                      ? "ok"
                      : isDiscarded
                      ? "bad"
                      : isError || !hasChanges || testsFailed || review.status === "blocked" || security.status === "blocked"
                      ? "bad"
                      : security.status === "review" || review.status === "review"
                      ? "warning"
                      : "ok"
                  }`}
                >
                  {isShipped
                    ? "SHIPPED"
                    : isDiscarded
                    ? "DISCARDED"
                    : isError
                    ? "EXECUTION FAILED"
                    : !hasChanges
                    ? "NO CHANGES"
                    : testsFailed
                    ? "TESTS FAILED"
                    : security.status === "blocked"
                    ? "SECURITY BLOCKED"
                    : review.status === "blocked"
                    ? "REVIEW BLOCKED"
                    : security.status === "review" || review.status === "review"
                    ? "REVIEW REQUIRED"
                    : "READY"}
                </span>
              </div>

              {/* Approval status and checklist */}
              {hasReviewableDiff && !isShipped && !isDiscarded && (
                <div style={{ margin: '8px 0 16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  <p style={{ margin: '0 0 12px', fontWeight: '500', fontSize: '14px', color: '#fff', letterSpacing: '-0.01em' }}>
                    READY FOR HUMAN APPROVAL
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px' }}>
                    <span>✓ Executed the requested change</span>
                    <span>✓ Passed regression tests</span>
                    <span>✓ Reviewed the changes</span>
                    <span>✓ Passed security checks</span>
                  </div>
                </div>
              )}

              <p className="approval-headline">
                {isShipped
                  ? "Changes approved and committed to repository."
                  : isDiscarded
                  ? "Changes discarded. Working tree restored."
                  : isError
                  ? `Execution failed: ${activeResultMsg.data?.summary || "Unknown error"}`
                  : !hasChanges && activeResultMsg
                  ? activeResultMsg.data?.summary || "Execution completed without code changes."
                  : testsFailed
                  ? "Tests failed. Fix errors before shipping."
                  : security.status === "blocked"
                  ? `Ship blocked by Security Gate: ${security.headline}`
                  : review.status === "blocked"
                  ? `Ship blocked by Code Review: ${review.headline}`
                  : security.status === "review" || review.status === "review"
                  ? "Security/Review findings require human inspection."
                  : hasReviewableDiff
                  ? ""
                  : "Awaiting execution…"}
              </p>

              <div className="approval-actions">
                {hasReviewableDiff && (
                  <>
                    <button
                      type="button"
                      className="btn ghost view-diff-btn"
                      onClick={() => setExpandedDiff(true)}
                      aria-label="View diff"
                    >
                      VIEW DIFF
                    </button>

                    <button
                      type="button"
                      className="btn ghost undo-btn"
                      disabled={isWorking || isShipped || isDiscarded || !activeResultMsg}
                      onClick={() => activeResultMsg && onDiscard?.(activeResultMsg)}
                      aria-label="Undo changes"
                    >
                      REJECT
                    </button>

                    <button
                      type="button"
                      className="btn ship ship-it-btn"
                      disabled={isWorking || isShipped || !activeResultMsg}
                      onClick={() => activeResultMsg && onShip?.(activeResultMsg)}
                      aria-label="Ship changes"
                    >
                      {isShipped ? "✓ SHIPPED" : "SHIP IT"}
                    </button>
                  </>
                )}

                {(!hasChanges || isError || review.status === "blocked") && !isWorking && activeResultMsg && !isShipped && (
                  <button
                    type="button"
                    className="btn ship try-again-btn"
                    onClick={() => onSendCommand?.(prompt)}
                    aria-label="Try again"
                  >
                    TRY AGAIN
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ──── SHIPPED ──── */}
        {(!activeStage || activeStage === 'ship') && !isStandby && (
          <div className={`pipeline-stage stage-9 ${shippedStageStatus}`}>
            <div className="stage-marker">
              <span className="stage-num">09</span>
              <span className={`stage-node ${shippedStageStatus}`}>
                {shippedStageStatus === "completed" ? "✓" : "○"}
              </span>
            </div>
            <div className={`stage-card ${isShipped ? "is-shipped-card" : ""}`}>
              <div className="stage-card-header">
                <span className="stage-label">SHIPPED</span>
                {isShipped && <span className="shipped-badge">✓ SHIPPED</span>}
              </div>
              {isShipped ? (
                <div className="shipped-payload">
                  <div className="shipped-status-line">
                    <span className="check-mark">✓</span>
                    <span className="shipped-title">COMMITTED TO REPOSITORY</span>
                  </div>
                  <div className="shipped-meta-grid">
                    <div className="shipped-item">
                      <span className="item-label">Commit</span>
                      <code className="commit-sha">{shippedEvent.data?.sha}</code>
                    </div>
                    <div className="shipped-item">
                      <span className="item-label">Files</span>
                      <span className="item-val">{shippedEvent.data?.files || files.length}</span>
                    </div>
                    <div className="shipped-item">
                      <span className="item-label">Approved by</span>
                      <span className="item-val author">{shippedEvent.data?.by || requestedBy}</span>
                    </div>
                  </div>
                  <p className="shipped-desc">
                    Working tree clean. Changes verified and committed.
                  </p>
                </div>
              ) : (
                <p className="stage-empty-text">Awaiting approval…</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
