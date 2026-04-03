// sdk/lib/security.js — Security Scanner
// ═══════════════════════════════════════════════════════════════════════════
// Blocks prompt injection, credential exposure, data exfiltration,
// and multi-signal security threats. Runs locally — no data leaves.
// ═══════════════════════════════════════════════════════════════════════════

function assessSecurity(state) {
  const issues = [];
  let blocked = false;
  let block_reason = null;

  const injectionRisk = parseFloat(state.injection_risk);
  if (!isNaN(injectionRisk) && injectionRisk > 0.7) {
    blocked = true;
    block_reason = "Prompt injection detected (confidence: " + (injectionRisk * 100).toFixed(0) + "%). Request quarantined.";
    issues.push({ type: "injection_blocked", severity: 1.0 });
  } else if (!isNaN(injectionRisk) && injectionRisk > 0.5) {
    issues.push({ type: "injection_risk_moderate", severity: injectionRisk });
  }

  if (state.credentials_in_input === true) {
    blocked = true;
    block_reason = "Credentials detected in input. Request blocked to prevent key exposure.";
    issues.push({ type: "credentials_blocked", severity: 1.0 });
  }

  if (state.exfiltration_risk === true) {
    blocked = true;
    block_reason = "Data exfiltration pattern detected. Outbound data flow blocked.";
    issues.push({ type: "exfiltration_blocked", severity: 1.0 });
  }

  // Multiple weak signals = block
  const signals = [
    !isNaN(injectionRisk) && injectionRisk > 0.5,
    state.credentials_in_input === true,
    state.exfiltration_risk === true,
    state.input_valid === false && (parseInt(state.missing_fields) || 0) > 3
  ].filter(Boolean).length;

  if (signals >= 2 && !blocked) {
    blocked = true;
    block_reason = `Multiple security signals detected (${signals} indicators). Blocked for review.`;
    issues.push({ type: "multi_signal_block", severity: 1.0 });
  }

  return { issues, blocked, block_reason };
}

module.exports = { assessSecurity };
