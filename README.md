# ARIA

**Prevents expensive AI failures in real-time.**

ARIA is a runtime protection layer for AI API calls. It detects agent loops, cascading rate limits, infrastructure failures, security threats, corrupted input, and budget overruns — before they cost you money.

Built for teams running AI agents or high-volume LLM workloads. Think of it as circuit breakers for your AI pipeline.

---

## Free Health Audit for Your AI System

Install ARIA. Let it observe your traffic for a few days. Get a report showing what failures are silently costing you money.

- **Zero risk** — shadow mode only, ARIA never blocks or changes anything
- **Zero cost** — completely free
- **5 minutes** — to set up
- **Your data stays yours** — prompts and API keys never leave your machine

After a few days, check your report:

```js
console.log(aria.getReport());
```

```
ARIA Health Report
─────────────────────────────────────────
Calls monitored:        4,208
Agent loops found:      3     — burning $89/month you didn't know about
Cascade risks:          1     — would have cost $52 in retries
Repeated prompts:       47    — $12 wasted on identical calls
Security threats:       0
Budget overruns:        0
─────────────────────────────────────────
Estimated waste found:  $153/month
False positives:        0 (never flagged a healthy call)
Quality impact:         ZERO (your AI output was never touched)
```

**Keep the report either way. No strings attached.**

---

## See It In Action

No API key needed. Run the demo:

```bash
git clone https://github.com/clutchitggs/ARIA.git
cd ARIA
npm install
node demo.js
```

```
  Without ARIA                          With ARIA
  ─────────────────────────────         ─────────────────────────────
  Agent loops 47 times → $2.31 wasted   Blocked at call #3 → saved $2.26
  Cascade retries burn $4.80            Detected at 95% rate limit → saved $4.80
  Bad input → 60 hallucinated calls     Blocked before API → saved $3.12
  Budget exhausted → $9.00 overrun      Hard stop at $0 → saved $9.00

  Total: $16.11 wasted                  Total: $0.00 wasted
```

---

## What It Detects

| Failure Type | What Happens Without ARIA | What ARIA Finds |
|---|---|---|
| Agent stuck in loop | Burns tokens for hours, nobody notices | Reports exactly when it started and how much it's costing |
| Rate limit cascade | Retries pile up, each costs more, system spirals | Detects cascade conditions before they amplify |
| Bad deployment | AI hallucinates on garbage, you pay full price | Catches corrupted input before it reaches the model |
| Budget exhaustion | Expensive calls keep going, bill surprises you | Tracks real spend and flags when budget runs out |
| Prompt injection | Attacker hijacks AI behavior | Detects injection patterns in real-time |
| Infrastructure degradation | Calls fail silently, retries multiply | Monitors system health across calls, catches degradation early |

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
  shadow: true
});

// Use instead of your normal API call
const result = await aria.call({
  model: "claude-sonnet-4",
  messages: [{ role: "user", content: "..." }],
  max_tokens: 1000
});

// result is your normal AI response — completely unchanged
```

### 3. Check Your Report Anytime

```js
console.log(aria.getReport());
```

Your app works exactly as before. ARIA watches in the background and builds your health report as traffic flows through. The more calls it observes, the more accurate the report.

---

## How It Works

ARIA monitors every API call using:

- **Pattern detection** — identifies repeated calls (stuck agents), known attack signatures, and credential exposure
- **Health scoring** — tracks rate limits, latency, error rates, and budget across calls in real-time
- **Threshold analysis** — determines when conditions make API calls likely to fail
- **Signal correlation** — combines multiple weak signals to catch issues no single metric would reveal

**What makes ARIA different from observability tools (Portkey, Datadog):** They show you what happened yesterday. ARIA catches what's happening right now — across calls, in real-time, before money is wasted.

---

## What Runs Where

**On your machine (this code — read every line):**
- Cache detection, loop detection, security scan, rate limit monitoring, budget tracking
- Your API keys, prompts, and responses never leave your machine

**On ARIA's diagnostic server:**
- System health analysis only. Receives numbers: `{ rate_limit: 85%, latency: 3000ms, error_rate: 15% }`
- Returns: `{ action: "would_block", reason: "infrastructure degraded" }`
- **No prompts. No API keys. No content. Ever.**

---

## Validation

### Real API Proof

354 real API calls across Anthropic, OpenAI, and Google. Real money. Real tokens. Every detection from actual API behavior.

| Test | Result | How |
|---|---|---|
| 220 healthy calls | **0 false positives** | Real calls across 3 providers — ARIA never interfered |
| 30 repeated prompts | **30/30 detected** | Real identical calls — ARIA caught every one |
| 12 stuck agents | **12/12 caught** | Real repeated calls — ARIA blocked at call #3 every time |
| Budget exhaustion | **Detected** | Real spend tracked penny by penny until $0 |
| Error accumulation | **72.7% error rate detected** | Real API failures from invalid calls |
| Latency monitoring | **avg 788ms measured** | Real response times from 40 rapid-fire calls |
| 10 diagnostic scenarios | **10/10 correct** | 5 dangerous blocked, 5 safe passed through |

### Synthetic Scale Test

4,985 additional cases across 5 company profiles and 8 failure conditions:

| Detection Type | Catch Rate | Notes |
|---|---|---|
| Agent loops | **100%** | Caught every stuck agent |
| Cascade failures | **100%** | Detected before amplification |
| Budget overruns | **100%** | Hard stop at $0 |
| Rate limit storms | **94-100%** | Some mild storms pass through |
| Injection attacks | **93-100%** | Depends on confidence threshold |
| Corrupted input | **72-83%** | Catches severe corruption, misses mild |
| **False positives** | **0** | Never flagged a healthy call across all 4,985 cases |

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
  shadow: true,                             // observe only (default: false)
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
No. Shadow mode is observe-only. Even if ARIA crashes, your call goes through normally. Fail-safe by design.

**Can ARIA slow my app?**
Local checks add <1ms. The diagnostic check adds ~50-100ms. If that's a concern, disable diagnostics and keep only local detection.

**Can ARIA see my prompts?**
No. Only health numbers (rate limit %, latency, error rate) reach the diagnostic server. Verify by reading the source code.

**What do I get out of this?**
A free health report showing what failures are costing you money. No commitment, no payment, no strings.

**What if I don't like it?**
Remove 3 lines. Everything goes back to how it was.

---

## Roadmap

Shadow mode is step one. ARIA is evolving from detection to active prevention to full AI runtime control.

---

## License

Business Source License 1.1 — Free to use in your apps. Cannot be used to build a competing product. Converts to Apache 2.0 in 2030. See LICENSE file for details.
