// sdk/lib/rate-limit.js — Rate Limit & Retry Prevention
// ═══════════════════════════════════════════════════════════════════════════
// Detects rate limit pressure, latency spikes, error rate elevation,
// and thundering herd risk. Returns throttle actions to prevent cascades.
// ═══════════════════════════════════════════════════════════════════════════

function assessRateLimit(state) {
  const issues = [];
  const actions = [];

  const rateLimitPct = parseFloat(state.rate_limit_percent);
  const errorRate = parseFloat(state.error_rate);
  const agentCount = parseInt(state.agent_count) || 1;
  const latencyMs = parseFloat(state.latency_ms);

  if (!isNaN(rateLimitPct) && rateLimitPct > 70) {
    issues.push({ type: "rate_limit_pressure", severity: Math.min(1, rateLimitPct / 100) });
    if (rateLimitPct > 90) {
      actions.push({ type: "throttle", action: "serialize_requests", detail: `Rate limit at ${rateLimitPct}% — serializing to prevent 429 storm`, delay_ms: 2000 });
    } else if (rateLimitPct > 80) {
      actions.push({ type: "throttle", action: "stagger_requests", detail: `Rate limit at ${rateLimitPct}% — staggering requests`, delay_ms: Math.round((rateLimitPct - 70) * 50) });
    } else {
      actions.push({ type: "throttle", action: "add_jitter", detail: `Rate limit at ${rateLimitPct}% — adding jitter`, delay_ms: Math.round((rateLimitPct - 70) * 30) });
    }
  }

  if (!isNaN(errorRate) && errorRate > 0.05) {
    issues.push({ type: "elevated_error_rate", severity: Math.min(1, errorRate * 2) });
    if (errorRate > 0.5) {
      actions.push({ type: "circuit_break", action: "pause_and_retry", detail: `Error rate ${(errorRate * 100).toFixed(0)}% — circuit breaker triggered`, delay_ms: Math.round(3000 + errorRate * 5000) });
    } else if (errorRate > 0.15) {
      actions.push({ type: "throttle", action: "exponential_backoff", detail: `Error rate ${(errorRate * 100).toFixed(0)}% — enforcing backoff with jitter`, delay_ms: Math.round(1000 + errorRate * 3000) });
    }
  }

  if (!isNaN(latencyMs) && latencyMs > 3000) {
    issues.push({ type: "latency_spike", severity: Math.min(1, latencyMs / 10000) });
    actions.push({ type: "throttle", action: "extend_timeout", detail: `Latency at ${latencyMs}ms — extending timeout to ${Math.round(latencyMs * 2.5)}ms`, delay_ms: 0 });
  }

  // Thundering herd
  if (agentCount > 2 && !isNaN(rateLimitPct) && rateLimitPct > 60) {
    const herdRisk = (agentCount / 10) * (rateLimitPct / 100);
    if (herdRisk > 0.3) {
      issues.push({ type: "thundering_herd_risk", severity: Math.min(1, herdRisk) });
      const staggerMs = Math.round(1000 / agentCount * (rateLimitPct / 100));
      actions.push({ type: "throttle", action: "stagger_agent_starts", detail: `${agentCount} agents at ${rateLimitPct}% — staggering starts by ${staggerMs}ms`, delay_ms: staggerMs * agentCount });
    }
  }

  return { issues, actions };
}

module.exports = { assessRateLimit };
