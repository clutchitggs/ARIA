# ARIA

**AI system health monitor. Detects expensive failures before they happen.**

ARIA sits between your app and your AI provider. It monitors system health in real-time and detects failures — agent loops, cascading rate limits, infrastructure degradation, security threats, budget overruns.

**Currently in shadow mode (pilot): ARIA observes only. It cannot block, change, throttle, or affect your app in any way. Your app runs exactly as if ARIA isn't there. Zero risk.**

---

## See It In Action

No API key needed. Run the demo:

```bash
git clone https://github.com/clutchitggs/ARIA.git
cd ARIA
npm install
node demo.js
```

Output:

```
  PHASE 1: Normal traffic (healthy system)
  [ 1] API call (healthy)             healthy
  [ 2] API call (healthy)             healthy

  PHASE 3: Agent stuck in a loop
  [ 7] API call (1st attempt)         healthy
  [ 8] API call (2nd attempt)         healthy — same call repeated...
  [ 9] LOOP BLOCKED                   DETECTED  saved $0.0540
       Agent stuck — same call 3x in 60s. Blocked to stop token burn.

  PHASE 5: Infrastructure degradation
  [12] INFRASTRUCTURE BLOCK           DETECTED  saved $0.0500
       Infrastructure failing (health: 22%). Call would fail.
  [14] BUDGET STOP                    DETECTED  saved $0.4500
       Budget exhausted — blocked expensive call.

  Total calls: 17 | Issues detected: 6 | Would have saved: $0.64
  Quality impact: ZERO
```

---

## What It Detects

| Failure Type | What Happens Without Detection | What ARIA Reports |
|---|---|---|
| Agent stuck in loop | Burns tokens for hours, nobody notices | "Loop detected — same call repeated 3x. Would save $X" |
| Rate limit cascade | Retries pile up, each costs more, system spirals | "Cascade conditions detected. Would prevent $X in retries" |
| Bad deployment (corrupted input) | AI hallucinates on garbage, you pay full price | "Invalid input detected. Would prevent $X wasted" |
| Budget exhausted | Expensive calls keep going, bill surprises you | "Budget at $0. Would block $X in calls" |
| Prompt injection | Attacker hijacks AI behavior | "Injection pattern detected. Would quarantine" |
| Infrastructure degraded | Calls fail silently, retries multiply | "System health degraded. Would prevent $X in failed calls" |

---

## How It Works

ARIA runs checks on every API call using:

- **Pattern detection** — identifies repeated calls (stuck agents), known attack signatures, and credential exposure
- **Health scoring** — monitors rate limits, latency, error rates, and budget in real-time
- **Threshold analysis** — determines when system conditions make API calls likely to fail or produce garbage
- **Signal correlation** — combines multiple weak signals to detect issues no single metric would catch (e.g., moderate rate pressure + rising latency + increasing errors = cascade imminent)

Local checks (loops, security, cache) run on your machine. Health scoring runs on ARIA's diagnostic API — it receives only numerical health indicators, never prompts or API keys.

---

## Validation

Tested across 4,985 synthetic cases (5 independent runs, different random inputs):

| Detection Type | Catch Rate | Notes |
|---|---|---|
| Agent loops | **100%** | Caught every stuck agent across all runs |
| Cascade failures | **100%** | Retry storms detected before amplification |
| Budget overruns | **100%** | Hard stop on exhausted budget |
| Rate limit storms | **94-100%** | Some edge cases with mild storms passed through |
| Injection attacks | **93-100%** | Depends on confidence score threshold |
| Corrupted input | **72-83%** | Weakest area — catches severe corruption, misses mild cases |
| **False positives** | **0** | Never blocked a healthy call across all 4,985 cases |

Synthetic validation proves the logic works. Real-world pilot in progress to validate on production traffic.

---

## How the Pilot Works

ARIA runs in **shadow mode**. This means:

- ARIA runs all its checks on every call
- ARIA logs what it **would have done** (blocked, warned, cached)
- ARIA **never actually does anything** — every call goes straight to your AI provider unchanged
- Your app behaves **exactly** as if ARIA isn't installed

**Think of it like a security camera that records but doesn't lock any doors.**

---

## Setup (5 minutes)

### 1. Install

```bash
npm install github:clutchitggs/ARIA
```

### 2. Add to Your Code

```js
const Aria = require("aria-sdk");

const aria = new Aria({
  provider: "anthropic",             // or "openai" or "google"
  apiKey: process.env.ANTHROPIC_API_KEY,
  diagnosticEndpoint: "https://aria-seven-umber.vercel.app/api/diagnose",
  shadow: true                       // pilot mode — observe only, zero effect
});

// Use instead of your normal API call
const result = await aria.call({
  model: "claude-sonnet-4",
  messages: [{ role: "user", content: "..." }],
  max_tokens: 1000
});

// result is your normal AI response — completely unchanged
```

### 3. Run Your App Normally

Your app works exactly as before. ARIA watches silently in the background. Let it run for a few days with your normal traffic — the more calls it observes, the more useful the data. No action needed from you.

---

## What Runs Where

**On your machine (this code — you can read every line):**
- Cache detection, loop detection, security scan, rate limit monitoring, budget tracking.
- Your API keys, prompts, and responses never leave your machine.

**On ARIA's server:**
- System health analysis only. Receives numbers: `{ rate_limit, latency, error_rate }`.
- Returns: `{ action: "would_block", reason: "infrastructure degraded" }`.
- **No prompts. No API keys. No content. Ever.**

**In shadow mode, nothing is blocked or changed regardless. Both local and remote checks are observation-only.**

---

## Configuration

```js
const aria = new Aria({
  // Required
  provider: "anthropic",                    // "anthropic" | "openai" | "google"
  apiKey: "sk-...",                         // your AI provider API key

  // Diagnostic engine
  diagnosticEndpoint: "https://aria-seven-umber.vercel.app/api/diagnose",

  // Optional
  shadow: true,                             // pilot mode — observe only (default: false)
  enabled: true,                            // set false to bypass ARIA entirely
  budget: { total: 100.00 },               // monthly budget in dollars
  context: {                                // system topology (improves detection)
    agent_count: 3,
    pipeline_depth: 2
  }
});
```

---

## Providers Supported

| Provider | Models |
|---|---|
| Anthropic | Claude Opus, Sonnet, Haiku |
| OpenAI | GPT-4o, GPT-4.1, o4-mini, etc. |
| Google | Gemini Pro, Flash |

---

## FAQ

**Can ARIA break my app?**
No. Shadow mode is observe-only — ARIA cannot block, delay, or change any call. Even if ARIA crashes or the diagnostic server is unreachable, your call goes through normally. Fail-safe by design.

**Can ARIA slow my app?**
The local checks add <1ms. The diagnostic check adds one lightweight HTTP call (~50-100ms) that runs in parallel. If that's a concern, you can disable diagnostics and keep only local observation.

**Can ARIA see my prompts?**
No. The diagnostic API only receives health numbers (rate limit %, latency ms, error rate). Your prompts, API keys, and responses stay on your machine. You can verify this by reading the source code.

**What if I don't like it?**
Remove the 3 lines. Your app goes back to exactly how it was.

---

## License

Business Source License 1.1 — Free to use in your apps. Cannot be used to build a competing product. Converts to Apache 2.0 in 2030. See LICENSE file for details.
