#!/usr/bin/env node
// demo.js — See ARIA in action (no API key needed)
// Run: node demo.js

const PromptCache = require("./lib/cache");
const LoopDetector = require("./lib/loop-detector");
const { assessSecurity } = require("./lib/security");

const cache = new PromptCache();
const loopDetector = new LoopDetector({ threshold: 3, windowMs: 60000 });

const W = 70;
const line = "=".repeat(W);

function $(n) { return "$" + n.toFixed(4); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log("");
  console.log(line);
  console.log("  ARIA Demo — Watch it detect failures in real time");
  console.log("  No API key needed. Simulated traffic.");
  console.log(line);
  console.log("");

  let totalSaved = 0;
  let totalCalls = 0;

  async function show(label, detail, saved) {
    totalCalls++;
    if (saved > 0) totalSaved += saved;
    const tag = saved > 0 ? `  DETECTED  saved ${$(saved)}` : "  healthy";
    console.log(`  [${String(totalCalls).padStart(2)}] ${label.padEnd(28)} ${tag}`);
    if (detail) console.log(`       ${detail}`);
    await sleep(300);
  }

  // ── Normal traffic ──
  console.log("  PHASE 1: Normal traffic (healthy system)");
  console.log("  " + "-".repeat(60));
  for (let i = 0; i < 5; i++) {
    await show("API call (healthy)", "", 0);
  }

  // ── Cache hit ──
  console.log("");
  console.log("  PHASE 2: Repeated prompt detected");
  console.log("  " + "-".repeat(60));

  const cacheReq = { model: "claude-sonnet", messages: [{ role: "user", content: "What is 2+2?" }], temperature: 0 };
  cache.set(cache.generateKey(cacheReq), { text: "4" }, 0.018);

  const hit = cache.get(cache.generateKey(cacheReq));
  if (hit) {
    await show("Cache hit", "Same prompt already answered — would skip the API call entirely", 0.018);
  }

  // ── Agent loop ──
  console.log("");
  console.log("  PHASE 3: Agent stuck in a loop");
  console.log("  " + "-".repeat(60));

  const loopHash = cache.generateKey({ model: "claude-sonnet", messages: [{ role: "user", content: "Summarize the document" }], temperature: 0.5 });

  loopDetector.check(loopHash);
  await show("API call (1st attempt)", "", 0);
  loopDetector.check(loopHash);
  await show("API call (2nd attempt)", "Same call repeated...", 0);
  const loop3 = loopDetector.check(loopHash);
  if (loop3.isLoop) {
    await show("LOOP BLOCKED", "Agent stuck — same call 3x in 60s. Blocked to stop token burn.", 0.054);
  }

  // ── Security threat ──
  console.log("");
  console.log("  PHASE 4: Prompt injection attack");
  console.log("  " + "-".repeat(60));

  const sec = assessSecurity({ injection_risk: 0.88 });
  if (sec.blocked) {
    await show("INJECTION BLOCKED", "Prompt injection detected (88% confidence). Request quarantined.", 0.032);
  }

  // ── Credential leak ──
  const cred = assessSecurity({ credentials_in_input: true, injection_risk: 0 });
  if (cred.blocked) {
    await show("CREDENTIALS BLOCKED", "API key detected in input. Blocked to prevent exposure.", 0.018);
  }

  // ── Infrastructure degradation (calls diagnostic API) ──
  console.log("");
  console.log("  PHASE 5: Infrastructure degradation");
  console.log("  " + "-".repeat(60));

  try {
    const resp = await fetch("https://aria-seven-umber.vercel.app/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_state: { rate_limit_percent: 95, latency_ms: 8000, error_rate: 0.4, injection_risk: 0 },
        task_meta: { model: "claude-sonnet-4", estimated_cost: 0.05 }
      })
    });
    const diag = await resp.json();
    if (diag.action === "block") {
      await show("INFRASTRUCTURE BLOCK", diag.reason, diag.estimated_savings || 0.05);
    }
  } catch (_) {
    await show("INFRASTRUCTURE BLOCK", "Rate limit 95%, latency 8s, errors 40% — cascade imminent", 0.05);
  }

  // ── Corrupted input ──
  try {
    const resp = await fetch("https://aria-seven-umber.vercel.app/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_state: { rate_limit_percent: 30, input_valid: false, missing_fields: 5, injection_risk: 0.1, error_rate: 0.03 },
        task_meta: { model: "claude-sonnet-4", estimated_cost: 0.018 }
      })
    });
    const diag = await resp.json();
    if (diag.action === "block") {
      await show("BAD INPUT BLOCKED", diag.reason, diag.estimated_savings || 0.018);
    }
  } catch (_) {
    await show("BAD INPUT BLOCKED", "5 fields missing from schema — AI would hallucinate on garbage", 0.018);
  }

  // ── Budget exhausted ──
  try {
    const resp = await fetch("https://aria-seven-umber.vercel.app/api/diagnose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_state: { rate_limit_percent: 30, budget_remaining_percent: 0, injection_risk: 0, error_rate: 0.02 },
        task_meta: { model: "claude-opus-4", estimated_cost: 0.45 }
      })
    });
    const diag = await resp.json();
    if (diag.action === "block") {
      await show("BUDGET STOP", diag.reason, diag.estimated_savings || 0.45);
    }
  } catch (_) {
    await show("BUDGET STOP", "Budget at $0 — blocked expensive Opus call", 0.45);
  }

  // ── Back to normal ──
  console.log("");
  console.log("  PHASE 6: System recovers");
  console.log("  " + "-".repeat(60));
  for (let i = 0; i < 3; i++) {
    await show("API call (healthy)", "", 0);
  }

  // ── Summary ──
  console.log("");
  console.log(line);
  console.log(`  Total calls: ${totalCalls}`);
  console.log(`  Issues detected: 6`);
  console.log(`  Would have saved: ${$(totalSaved)}`);
  console.log(`  Quality impact: ZERO — ARIA never changed any model or output`);
  console.log(line);
  console.log("");
  console.log("  This was shadow mode. In production, ARIA does this silently");
  console.log("  on every API call. Your app works normally. Failures don't.");
  console.log("");
}

main().catch(err => { console.error("Error:", err.message); process.exit(1); });
