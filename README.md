# ARIA

**Free health audit for your AI system. Find out what failures are silently costing you money.**

ARIA monitors your AI API calls and detects agent loops, cascading rate limits, infrastructure failures, security threats, corrupted input, and budget overruns — things you're probably paying for right now without knowing.

Built for teams running AI agents or high-volume LLM workloads. Think of it as circuit breakers for your AI pipeline.

---

## What You Get

Install ARIA. Let it observe your traffic for a few days. Get a report showing what's going wrong.

- **Zero risk** — observe only, ARIA never blocks or changes anything
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
Agent loops found:      3     — $14.80 wasted so far
Infrastructure risks:   1     — $6.20 would have been wasted
Repeated prompts:       47    — $3.40 spent on duplicate calls
─────────────────────────────────────────
Total waste detected:   $24.40
False positives:        0 (never flagged a healthy call)
Quality impact:         ZERO (your AI output was never touched)
```

**Keep the report. No strings attached.**

---

## See It In Action

No API key needed:

```bash
git clone https://github.com/clutchitggs/ARIA.git
cd ARIA
npm install
node demo.js
```

```
  PHASE 3: Agent stuck in a loop
  [ 7] API call (1st attempt)         healthy
  [ 8] API call (2nd attempt)         healthy — same call repeated...
  [ 9] LOOP DETECTED                  $0.0540 would be wasted
       Agent stuck — same call 3x in 60s.

  PHASE 5: Infrastructure degradation
  [12] INFRA RISK DETECTED            $0.0500 would be wasted
       System overloaded — call would likely fail.
  [14] BUDGET EXHAUSTED               $0.4500 would be wasted
       Budget at $0 — expensive call would overrun.

  Total calls: 17 | Issues detected: 6 | Waste found: $0.64
  Quality impact: ZERO
```

---

## Why This Matters

Agent loops are the failure everyone knows about — your agent repeats the same call 100 times and the bill spikes. Easy to spot.

**The expensive failures are the ones you can't see:**

Your app hits a rate limit. Your retry logic resends the failed calls. Those retries add more traffic. More calls fail. More retries. Each retry resends the full conversation context — paying for all tokens again. In 10 minutes, you've spent 5x your normal cost and got mostly errors.

You look at your bill and think "busy day." What actually happened: your system amplified its own failure, and $160 of that $200 bill was pure waste. If something had detected the cascade at the start and paused for 2 minutes, you'd have spent $45.

This is what Gartner means when they say 40% of AI agent projects get canceled due to cost overruns. It's not that AI is expensive — it's that failures multiply silently.

ARIA watches for these patterns across calls, in real-time.

---

## What It Detects

| Failure Type | What's Happening | What ARIA Tells You |
|---|---|---|
| Agent stuck in loop | Same call repeating, burning tokens for hours | Exactly when it started and how much it's costing |
| Rate limit cascade | Retries piling up, each costing more | Cascade conditions before they amplify |
| Bad deployment | AI confidently hallucinating on garbage data | Corrupted input before it reaches the model |
| Budget exhaustion | Expensive calls keep going past your limit | Real spend tracked, flagged when budget runs out |
| Prompt injection | Someone trying to hijack your AI | Injection patterns detected in real-time |
| Infrastructure degradation | Calls failing silently, retries multiplying | System health degrading across calls |

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
  diagnosticEndpoint: "https://aria-seven-umber.vercel.app/api/diagnose"
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

- **Pattern detection** — identifies repeated calls (stuck agents), attack signatures, and credential exposure
- **Health scoring** — tracks rate limits, latency, error rates, and budget across calls
- **Threshold analysis** — determines when conditions make API calls likely to fail
- **Signal correlation** — combines multiple weak signals to catch issues no single metric would reveal

Local checks (loops, security, cache) run on your machine. System health analysis runs on ARIA's diagnostic server — it receives only numbers (rate limit %, latency, error rate), never prompts or API keys.

---

## Validation

### Real API Proof

354 real API calls across Anthropic, OpenAI, and Google. Real money. Real tokens.

| Test | Result | How |
|---|---|---|
| 220 healthy calls | **0 false positives** | Real calls across 3 providers — ARIA never interfered |
| 30 repeated prompts | **30/30 detected** | Real identical calls — caught every one |
| 12 stuck agents | **12/12 caught** | Real repeated calls — caught at call #3 every time |
| Budget exhaustion | **Detected** | Real spend tracked penny by penny until $0 |
| Error accumulation | **72.7% error rate detected** | Real API failures from invalid calls |
| Latency monitoring | **avg 788ms measured** | Real response times from 40 rapid-fire calls |
| 10 diagnostic scenarios | **10/10 correct** | 5 dangerous detected, 5 safe passed through |

### Scale Test

4,985 additional synthetic cases across 5 company profiles and 8 failure conditions:

| Detection Type | Catch Rate | Notes |
|---|---|---|
| Agent loops | **100%** | Caught every stuck agent |
| Cascade failures | **100%** | Detected before amplification |
| Budget overruns | **100%** | Flagged at $0 |
| Rate limit storms | **94-100%** | Some mild storms pass through |
| Injection attacks | **93-100%** | Depends on confidence threshold |
| Corrupted input | **72-83%** | Catches severe, misses mild |
| **False positives** | **0** | Never flagged a healthy call |

---

## Configuration

```js
const aria = new Aria({
  provider: "anthropic",                    // "anthropic" | "openai" | "google"
  apiKey: "sk-...",                         // your AI provider API key
  diagnosticEndpoint: "https://aria-seven-umber.vercel.app/api/diagnose",

  // Optional
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
No. ARIA only observes. Even if ARIA crashes, your call goes through normally. Fail-safe by design.

**Can ARIA slow my app?**
Local checks add <1ms. The diagnostic check adds ~50-100ms. If that's a concern, skip the diagnostic endpoint and keep only local detection.

**Can ARIA see my prompts?**
No. Only health numbers reach the diagnostic server. Verify by reading the source code.

**What do I get out of this?**
A free health report showing what failures are costing you money. No commitment, no payment, no strings.

**What if I don't like it?**
Remove 3 lines. Everything goes back to how it was.

---

## What's Next

ARIA currently detects and reports. Active prevention — where ARIA stops failures before they happen — is being built based on pilot feedback. If your report shows issues you want fixed automatically, let us know. You'll be first in line.

---

## License

Business Source License 1.1 — Free to use in your apps. Cannot be used to build a competing product. See LICENSE for details.
