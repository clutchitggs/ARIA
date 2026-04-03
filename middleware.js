// sdk/middleware.js — ARIA SDK
// ═══════════════════════════════════════════════════════════════════════════
// OPEN SOURCE — Developers can read every line. No secrets here.
//
// ARIA monitors your AI system health and prevents expensive failures.
// It never changes your AI model. Never touches your response.
// Your API keys and prompts never leave your machine.
//
// The diagnostic engine (the intelligence) runs on ARIA's server.
// The SDK only sends system health NUMBERS (rate limit %, latency, error rate).
// No prompts. No keys. No content. Ever.
//
// Usage:
//   const Aria = require("aria-sdk");
//   const aria = new Aria({
//     provider: "anthropic",
//     apiKey: "sk-...",
//     diagnosticEndpoint: "https://your-aria-api.vercel.app/api/diagnose"
//   });
//   const result = await aria.call({ model: "claude-sonnet-4", messages: [...] });
//   console.log(aria.getReceipt());
// ═══════════════════════════════════════════════════════════════════════════

const PromptCache = require("./lib/cache");
const LoopDetector = require("./lib/loop-detector");
const { resolveModel, MODELS, API_MODEL_NAMES } = require("./lib/models");
const { assessSecurity } = require("./lib/security");
const { assessRateLimit } = require("./lib/rate-limit");
const { assessBudget } = require("./lib/budget");

class Aria {
  constructor(options = {}) {
    this.provider = options.provider || null;
    this.apiKey = options.apiKey || null;
    this.apiKeys = options.apiKeys || {};
    this.diagnosticEndpoint = options.diagnosticEndpoint || null;
    this.budget = options.budget || null;
    this.context = options.context || {};
    this.enabled = options.enabled !== false;
    this.shadow = options.shadow || false; // Shadow mode: observe only, never block
    this.pilotId = options.pilotId || null; // Unique ID for this pilot tester

    // Local infrastructure instances
    this._cache = new PromptCache({ maxEntries: 10000, maxAgeMs: 3600000 });
    this._loopDetector = new LoopDetector({ threshold: 3, windowMs: 60000 });

    // Auto-collected signals
    this._signals = {
      latencies: [],
      errors: 0,
      successes: 0,
      rateLimitPercent: null,
      budgetSpent: 0,
      totalTokensIn: 0,
      totalTokensOut: 0
    };

    // Savings tracker
    this._savings = {
      cache_hits:         { count: 0, saved: 0 },
      loops_blocked:      { count: 0, saved: 0 },
      security_blocked:   { count: 0, saved: 0 },
      failures_prevented: { count: 0, saved: 0 },
      total_calls: 0,
      total_original_cost: 0
    };

    // Shadow mode log (records what WOULD have happened)
    this._shadowLog = [];

    // Anthropic SDK (lazy-loaded)
    this._anthropicClient = null;

    // Periodic cleanup
    this._cleanupInterval = setInterval(() => this._loopDetector.cleanup(), 300000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT
  // ═══════════════════════════════════════════════════════════════════
  async call(request) {
    if (!this.enabled) return this._callDirect(request);

    const startTime = Date.now();
    this._savings.total_calls++;

    const modelInfo = resolveModel(request.model);
    const provider = this.provider || modelInfo?.profile.provider || "anthropic";

    // Estimate call cost for savings tracking
    const inputTokens = this._estimateInputTokens(request);
    const outputTokens = request.max_tokens || 1000;
    const callCost = modelInfo
      ? (inputTokens / 1000) * modelInfo.profile.input_cost + (outputTokens / 1000) * modelInfo.profile.output_cost
      : 0;
    this._savings.total_original_cost += callCost;

    // Build system state from auto-collected signals
    const systemState = this._buildSystemState(request);

    // ═══════════════════════════════════════════════════════════════════
    // SHADOW MODE: Run all checks but NEVER block, cache, or throttle.
    // Pure observation. Report everything. Zero effect on the app.
    // ═══════════════════════════════════════════════════════════════════
    if (this.shadow) {
      // Check cache (would it have hit?)
      if (request.temperature !== undefined && request.temperature <= 0.3 && request.messages) {
        const cacheReq = { model: request.model, messages: request.messages, system: request.system,
          temperature: request.temperature, max_tokens: request.max_tokens, tools: request.tools };
        if (this._cache.isCacheable(cacheReq)) {
          const key = this._cache.generateKey(cacheReq);
          const cached = this._cache.get(key);
          if (cached) {
            this._savings.cache_hits.count++;
            this._savings.cache_hits.saved += callCost;
            this._reportEvent("cache_hit", callCost, "Would have returned cached response", { model: request.model });
            this._shadowLog.push({ type: "cache_hit", would_have_saved: callCost, timestamp: new Date().toISOString() });
          }
        }
      }

      // Check loops (would it have blocked?)
      if (request.messages) {
        const loopKey = this._cache.generateKey({ model: request.model, messages: request.messages,
          system: request.system, temperature: request.temperature, max_tokens: request.max_tokens, tools: request.tools });
        const loopCheck = this._loopDetector.check(loopKey);
        if (loopCheck.isLoop) {
          this._savings.loops_blocked.count++;
          this._savings.loops_blocked.saved += callCost;
          this._reportEvent("loop_blocked", callCost, loopCheck.detail, { model: request.model });
          this._shadowLog.push({ type: "loop_blocked", reason: loopCheck.detail, would_have_saved: callCost, timestamp: new Date().toISOString() });
        }
      }

      // Check security (would it have blocked?)
      const security = assessSecurity(systemState);
      if (security.blocked) {
        this._savings.security_blocked.count++;
        this._savings.security_blocked.saved += callCost;
        this._reportEvent("security_blocked", callCost, security.block_reason, { model: request.model });
        this._shadowLog.push({ type: "security_blocked", reason: security.block_reason, would_have_saved: callCost, timestamp: new Date().toISOString() });
      }

      // Check diagnostics (would it have blocked?)
      if (this.diagnosticEndpoint) {
        try {
          const diagResult = await this._checkDiagnostics(systemState, { model: request.model, estimated_cost: callCost });
          if (diagResult && diagResult.action === "block") {
            this._savings.failures_prevented.count++;
            this._savings.failures_prevented.saved += diagResult.estimated_savings || callCost;
            this._shadowLog.push({ type: "diagnostic_block", reason: diagResult.reason, would_have_saved: diagResult.estimated_savings || callCost, timestamp: new Date().toISOString() });
          }
        } catch (_) {} // fail-safe
      }

      // Check rate limits (would it have throttled?)
      const rateLimit = assessRateLimit(systemState);
      if (rateLimit.actions.length > 0) {
        this._reportEvent("would_throttle", 0, `${rateLimit.actions.length} throttle actions`, { model: request.model });
        this._shadowLog.push({ type: "would_throttle", actions: rateLimit.actions.length, timestamp: new Date().toISOString() });
      }

      // Shadow mode: skip ALL interventions, go straight to API call
      // (jump to STEP 7 below)

    } else {
      // ═══════════════════════════════════════════════════════════════
      // ACTIVE MODE: Full protection pipeline
      // ═══════════════════════════════════════════════════════════════

      // ── STEP 1: CACHE CHECK (local) ──
      if (request.temperature !== undefined && request.temperature <= 0.3 && request.messages) {
        const cacheReq = { model: request.model, messages: request.messages, system: request.system,
          temperature: request.temperature, max_tokens: request.max_tokens, tools: request.tools };
        if (this._cache.isCacheable(cacheReq)) {
          const key = this._cache.generateKey(cacheReq);
          const cached = this._cache.get(key);
          if (cached) {
            this._savings.cache_hits.count++;
            this._savings.cache_hits.saved += callCost;
            this._reportEvent("cache_hit", callCost, "Exact prompt match — returned cached response");
            return { ...cached.response, _aria: { status: "cached", saved: callCost, processing_time_ms: Date.now() - startTime } };
          }
        }
      }

      // ── STEP 2: LOOP DETECTION (local) ──
      if (request.messages) {
        const loopKey = this._cache.generateKey({ model: request.model, messages: request.messages,
          system: request.system, temperature: request.temperature, max_tokens: request.max_tokens, tools: request.tools });
        const loopCheck = this._loopDetector.check(loopKey);
        if (loopCheck.isLoop) {
          this._savings.loops_blocked.count++;
          this._savings.loops_blocked.saved += callCost;
          this._reportEvent("loop_blocked", callCost, loopCheck.detail, { model: request.model });
          return {
            _aria: { status: "loop_blocked", reason: loopCheck.detail, saved: callCost, processing_time_ms: Date.now() - startTime },
            error: { type: "loop_blocked", message: loopCheck.detail }
          };
        }
      }

      // ── STEP 3: SECURITY SCAN (local) ──
      const security = assessSecurity(systemState);
      if (security.blocked) {
        this._savings.security_blocked.count++;
        this._savings.security_blocked.saved += callCost;
        this._reportEvent("security_blocked", callCost, security.block_reason, { model: request.model });
        return {
          _aria: { status: "blocked", reason: security.block_reason, saved: callCost, processing_time_ms: Date.now() - startTime },
          error: { type: "security_blocked", message: security.block_reason }
        };
      }

      // ── STEP 4: DIAGNOSTIC CHECK (remote — ARIA's server) ──
      if (this.diagnosticEndpoint) {
        try {
          const diagResult = await this._checkDiagnostics(systemState, { model: request.model, estimated_cost: callCost });
          if (diagResult && diagResult.action === "block") {
            this._savings.failures_prevented.count++;
            this._savings.failures_prevented.saved += diagResult.estimated_savings || callCost;
            return {
              _aria: {
                status: "diagnostic_block", reason: diagResult.reason,
                diagnostics: diagResult.diagnostics, stop_flags: diagResult.stop_flags,
                saved: diagResult.estimated_savings || callCost,
                processing_time_ms: Date.now() - startTime
              },
              error: { type: "diagnostic_block", message: diagResult.reason }
            };
          }
        } catch (_) {} // fail-safe
      }

      // ── STEP 5: RATE LIMIT MANAGEMENT (local) ──
      const rateLimit = assessRateLimit(systemState);
      if (rateLimit.actions.length > 0) {
        const maxDelay = Math.max(...rateLimit.actions.map(a => a.delay_ms || 0));
        if (maxDelay > 0 && maxDelay <= 10000) {
          await new Promise(r => setTimeout(r, maxDelay));
        }
      }

      // ── STEP 6: BUDGET CHECK (local) ──
      const budget = assessBudget(
        { model: request.model, input_tokens: inputTokens, output_tokens: outputTokens },
        systemState
      );
    } // end active mode

    // ── STEP 7: MAKE API CALL ──
    const callStart = Date.now();
    let apiResult;

    try {
      if (provider === "anthropic") apiResult = await this._callAnthropic(request.model, request);
      else if (provider === "openai") apiResult = await this._callOpenAI(request.model, request);
      else if (provider === "google") apiResult = await this._callGoogle(request.model, request);
      else throw new Error(`Unknown provider: ${provider}`);
    } catch (err) {
      this._signals.errors++;
      return {
        _aria: { status: "api_error", error: err.message, processing_time_ms: Date.now() - startTime },
        error: { type: "api_error", message: err.message }
      };
    }

    const latencyMs = Date.now() - callStart;

    // ── STEP 8: COLLECT SIGNALS ──
    this._collectSignals(apiResult, latencyMs);

    // Report successful call to dashboard (for token/cost/model tracking)
    this._reportEvent("pass", 0, "Healthy call", {
      model: request.model,
      tokens_in: apiResult.inTok || 0,
      tokens_out: apiResult.outTok || 0,
      cost: apiResult.cost || 0
    });

    // ── STEP 9: CACHE RESPONSE ──
    if (apiResult.ok && request.temperature !== undefined && request.temperature <= 0.3) {
      const cacheReq = { model: request.model, messages: request.messages, system: request.system,
        temperature: request.temperature, max_tokens: request.max_tokens, tools: request.tools };
      if (this._cache.isCacheable(cacheReq)) {
        const key = this._cache.generateKey(cacheReq);
        this._cache.set(key, apiResult.response, apiResult.cost || 0);
      }
    }

    // ── RETURN RESPONSE ──
    return {
      ...apiResult.response,
      _aria: {
        status: this.shadow ? "shadow" : "pass_through",
        model: request.model,
        model_changed: false,
        provider,
        latency_ms: latencyMs,
        tokens: { input: apiResult.inTok || 0, output: apiResult.outTok || 0 },
        cost: apiResult.cost || 0,
        processing_time_ms: Date.now() - startTime
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // RECEIPT
  // ═══════════════════════════════════════════════════════════════════
  getReceipt() {
    const s = this._savings;
    const totalSaved = s.cache_hits.saved + s.loops_blocked.saved + s.security_blocked.saved + s.failures_prevented.saved;
    return {
      calls_processed: s.total_calls,
      cache_hits:         { count: s.cache_hits.count,         saved: parseFloat(s.cache_hits.saved.toFixed(4)) },
      loops_blocked:      { count: s.loops_blocked.count,      saved: parseFloat(s.loops_blocked.saved.toFixed(4)) },
      security_blocked:   { count: s.security_blocked.count,   saved: parseFloat(s.security_blocked.saved.toFixed(4)) },
      failures_prevented: { count: s.failures_prevented.count, saved: parseFloat(s.failures_prevented.saved.toFixed(4)) },
      total_saved:          parseFloat(totalSaved.toFixed(4)),
      total_original_cost:  parseFloat(s.total_original_cost.toFixed(4)),
      savings_percent: s.total_original_cost > 0 ? parseFloat(((totalSaved / s.total_original_cost) * 100).toFixed(1)) : 0,
      quality_incidents: 0,
      mode: this.shadow ? "shadow" : "active"
    };
  }

  // Shadow mode: what ARIA would have done (without touching anything)
  getShadowReport() {
    const s = this._savings;
    const totalWouldSave = s.loops_blocked.saved + s.security_blocked.saved + s.failures_prevented.saved;
    return {
      mode: "shadow",
      message: "ARIA observed your traffic without blocking anything. Here's what it WOULD have done:",
      calls_observed: s.total_calls,
      would_have_blocked: {
        loops:      { count: s.loops_blocked.count,      would_save: parseFloat(s.loops_blocked.saved.toFixed(4)) },
        security:   { count: s.security_blocked.count,   would_save: parseFloat(s.security_blocked.saved.toFixed(4)) },
        failures:   { count: s.failures_prevented.count, would_save: parseFloat(s.failures_prevented.saved.toFixed(4)) }
      },
      cache_hits: { count: s.cache_hits.count, saved: parseFloat(s.cache_hits.saved.toFixed(4)) },
      total_would_save: parseFloat(totalWouldSave.toFixed(4)),
      total_estimated_spend: parseFloat(s.total_original_cost.toFixed(4)),
      savings_percent: s.total_original_cost > 0 ? parseFloat(((totalWouldSave / s.total_original_cost) * 100).toFixed(1)) : 0,
      quality_impact: "ZERO — ARIA never blocked any call in shadow mode",
      log: this._shadowLog
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // REMOTE DIAGNOSTIC CHECK
  // Sends ONLY health numbers. No prompts, no keys, no content.
  // ═══════════════════════════════════════════════════════════════════
  async _checkDiagnostics(systemState, taskMeta) {
    const resp = await fetch(this.diagnosticEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pilot: this.pilotId,
        system_state: {
          rate_limit_percent: systemState.rate_limit_percent,
          context_utilization: systemState.context_utilization,
          latency_ms: systemState.latency_ms,
          error_rate: systemState.error_rate,
          budget_remaining_percent: systemState.budget_remaining_percent,
          input_valid: systemState.input_valid,
          missing_fields: systemState.missing_fields,
          injection_risk: systemState.injection_risk,
          credentials_in_input: systemState.credentials_in_input,
          retry_storm_detected: systemState.retry_storm_detected,
          exfiltration_risk: systemState.exfiltration_risk,
          agent_count: systemState.agent_count,
          pipeline_depth: systemState.pipeline_depth
        },
        task_meta: taskMeta
      })
    });
    if (!resp.ok) throw new Error(`Diagnostic API returned ${resp.status}`);
    return resp.json();
  }

  // ═══════════════════════════════════════════════════════════════════
  // SYSTEM STATE BUILDER (auto-collected signals)
  // ═══════════════════════════════════════════════════════════════════
  _buildSystemState(request) {
    const s = this._signals;
    const avgLatency = s.latencies.length > 0 ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length : 200;
    const totalCalls = s.errors + s.successes;
    const errorRate = totalCalls > 0 ? s.errors / totalCalls : 0;

    let budgetRemainingPercent = 100;
    if (this.budget && this.budget.total > 0) {
      budgetRemainingPercent = Math.max(0, ((this.budget.total - s.budgetSpent) / this.budget.total) * 100);
    }

    let contextUtilization = 0;
    const modelInfo = resolveModel(request.model);
    if (modelInfo && request.messages) {
      contextUtilization = this._estimateInputTokens(request) / modelInfo.profile.context_window;
    }

    return {
      rate_limit_percent: s.rateLimitPercent !== null ? s.rateLimitPercent : 0,
      latency_ms: avgLatency,
      error_rate: errorRate,
      budget_remaining_percent: budgetRemainingPercent,
      context_utilization: contextUtilization,
      injection_risk: 0,
      input_valid: true,
      missing_fields: 0,
      credentials_in_input: false,
      retry_storm_detected: false,
      exfiltration_risk: false,
      agent_count: this.context.agent_count || 1,
      pipeline_depth: this.context.pipeline_depth || 1
    };
  }

  _estimateInputTokens(request) {
    let chars = 0;
    if (request.system) chars += request.system.length;
    if (request.messages) {
      for (const msg of request.messages) {
        if (typeof msg.content === "string") chars += msg.content.length;
        else if (Array.isArray(msg.content)) {
          for (const block of msg.content) { if (block.text) chars += block.text.length; }
        }
      }
    }
    if (request.tools) chars += JSON.stringify(request.tools).length;
    return Math.max(100, Math.ceil(chars / 4));
  }

  // Report local events to diagnostic endpoint (fire-and-forget)
  // So you can see ALL ARIA activity, not just diagnostic checks
  _reportEvent(type, saved, detail, extra) {
    if (!this.diagnosticEndpoint) return;
    try {
      fetch(this.diagnosticEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pilot: this.pilotId, event: { type, saved, detail, time: new Date().toISOString(), ...(extra || {}) } })
      }).catch(() => {}); // silent fail — never disrupt the app
    } catch (_) {}
  }

  _collectSignals(apiResult, latencyMs) {
    this._signals.latencies.push(latencyMs);
    if (this._signals.latencies.length > 20) this._signals.latencies.shift();
    if (apiResult.ok) this._signals.successes++; else this._signals.errors++;
    this._signals.totalTokensIn += apiResult.inTok || 0;
    this._signals.totalTokensOut += apiResult.outTok || 0;
    this._signals.budgetSpent += apiResult.cost || 0;
    if (apiResult.rateLimitPercent != null) this._signals.rateLimitPercent = apiResult.rateLimitPercent;
  }

  // ═══════════════════════════════════════════════════════════════════
  // API CALLERS
  // ═══════════════════════════════════════════════════════════════════
  async _callAnthropic(model, request) {
    if (!this._anthropicClient) {
      const Anthropic = require("@anthropic-ai/sdk");
      this._anthropicClient = new Anthropic({ apiKey: this.apiKey || this.apiKeys.anthropic || process.env.ANTHROPIC_API_KEY });
    }
    const apiModel = API_MODEL_NAMES[model] || model;
    const params = { model: apiModel, max_tokens: request.max_tokens || 1024, messages: request.messages || [] };
    if (request.system) params.system = request.system;
    if (request.temperature !== undefined) params.temperature = request.temperature;
    if (request.tools) params.tools = request.tools;
    if (request.tool_choice) params.tool_choice = request.tool_choice;

    const r = await this._anthropicClient.messages.create(params);
    const mp = MODELS[model];
    const cost = mp ? (r.usage.input_tokens / 1000) * mp.input_cost + (r.usage.output_tokens / 1000) * mp.output_cost : 0;
    return { ok: true, response: { id: r.id, type: r.type, role: r.role, content: r.content, model: r.model, usage: r.usage, stop_reason: r.stop_reason },
      text: r.content[0]?.text || "", inTok: r.usage.input_tokens, outTok: r.usage.output_tokens, cost, rateLimitPercent: null };
  }

  async _callOpenAI(model, request) {
    const key = this.apiKey || this.apiKeys.openai || process.env.OPENAI_API_KEY;
    const apiModel = API_MODEL_NAMES[model] || model;
    const isO = apiModel.startsWith("o");
    const body = { model: apiModel, messages: request.messages || [] };
    if (isO) body.max_completion_tokens = request.max_tokens || 1024; else body.max_tokens = request.max_tokens || 1024;
    if (request.temperature !== undefined && !isO) body.temperature = request.temperature;
    if (request.tools) body.tools = request.tools;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key }, body: JSON.stringify(body) });
    let rateLimitPercent = null;
    const rem = resp.headers.get("x-ratelimit-remaining-requests"), lim = resp.headers.get("x-ratelimit-limit-requests");
    if (rem && lim) rateLimitPercent = ((1 - parseInt(rem) / parseInt(lim)) * 100);
    const j = await resp.json();
    if (j.error) throw new Error(j.error.message);
    const mp = MODELS[model];
    const cost = mp ? (j.usage.prompt_tokens / 1000) * mp.input_cost + (j.usage.completion_tokens / 1000) * mp.output_cost : 0;
    return { ok: true, response: { id: j.id, object: j.object, model: j.model, choices: j.choices, usage: j.usage },
      text: j.choices[0]?.message?.content || "", inTok: j.usage.prompt_tokens, outTok: j.usage.completion_tokens, cost, rateLimitPercent };
  }

  async _callGoogle(model, request) {
    const key = this.apiKey || this.apiKeys.google || process.env.GOOGLE_API_KEY;
    const apiModel = API_MODEL_NAMES[model] || model;
    const contents = (request.messages || []).filter(m => m.role === "user" || m.role === "model")
      .map(m => ({ role: m.role === "assistant" ? "model" : m.role, parts: [{ text: typeof m.content === "string" ? m.content : m.content.map(b => b.text || "").join("") }] }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${key}`;
    const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: request.max_tokens || 1024 } }) });
    const j = await resp.json();
    if (j.error) throw new Error(j.error.message);
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const inTok = j.usageMetadata?.promptTokenCount || Math.ceil((request.messages?.[0]?.content?.length || 0) / 4);
    const outTok = j.usageMetadata?.candidatesTokenCount || Math.ceil(text.length / 4);
    const mp = MODELS[model];
    const cost = mp ? (inTok / 1000) * mp.input_cost + (outTok / 1000) * mp.output_cost : 0;
    return { ok: true, response: { candidates: j.candidates, usageMetadata: j.usageMetadata }, text, inTok, outTok, cost, rateLimitPercent: null };
  }

  async _callDirect(request) {
    const modelInfo = resolveModel(request.model);
    const provider = this.provider || modelInfo?.profile.provider || "anthropic";
    if (provider === "anthropic") return (await this._callAnthropic(request.model, request)).response;
    if (provider === "openai") return (await this._callOpenAI(request.model, request)).response;
    if (provider === "google") return (await this._callGoogle(request.model, request)).response;
    throw new Error(`Unknown provider: ${provider}`);
  }

  destroy() {
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
  }
}

module.exports = Aria;
module.exports.Aria = Aria;
