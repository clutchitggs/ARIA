# ARIA

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](#)
[![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white)](#)
[![Providers](https://img.shields.io/badge/providers-Anthropic%20%C2%B7%20OpenAI%20%C2%B7%20Google-7c3aed)](#supported-providers)

**Guardrails for AI agents — detect failures and stop them before they burn your money.**

ARIA sits between your app and your AI provider. It catches agent loops, cascading retries, budget overruns, corrupted input, and infrastructure failures, and can block them in real-time.

Built for developers and teams running AI agents or high-volume LLM workloads.

---

## See it in action

![ARIA blocking an agent loop in real-time](demo.gif)

---

## Setup (5 minutes)

### Node.js

```bash
npm install github:clutchitggs/ARIA
```

```js
const Aria = require("aria-sdk");

const aria = new Aria({
  provider: "anthropic",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const result = await aria.call({
  model: "claude-sonnet-4",
  messages: [{ role: "user", content: "..." }],
  max_tokens: 1000,
});
```

### Python

```bash
pip install git+https://github.com/clutchitggs/ARIA.git#subdirectory=python
```

```python
from aria import Aria

aria = Aria(
    provider="anthropic",
    api_key=os.environ["ANTHROPIC_API_KEY"],
)

result = aria.call(
    model="claude-sonnet-4",
    messages=[{"role": "user", "content": "..."}],
    max_tokens=1000,
)
```

That's it. ARIA wraps every call, runs detection, and (in prevention mode) blocks calls that would fail or waste money before they hit the provider.

---

## Health report

After running for a while, check what ARIA caught:

```python
print(aria.get_report()["text"])
```

```
ARIA Health Report
-----------------------------------------
Calls monitored:        4,208
Agent loops found:      3     — $14.80 wasted so far
Infrastructure risks:   1     — $6.20 would have been wasted
Repeated prompts:       47    — $3.40 spent on duplicate calls
-----------------------------------------
Total waste detected:   $24.40
False positives:        0
Quality impact:         ZERO (your AI output was never touched)
```

---

## Two modes

### Detection (default — safe, zero-risk)

ARIA observes traffic and reports what it finds. Doesn't block or change anything. Good way to see what's happening in your system before flipping the switch.

```python
aria = Aria(provider="anthropic", api_key="...")
```

### Prevention (active blocking)

ARIA actively blocks loops, enforces budgets, prevents cascades. Same detection engine; now it intervenes. Pass an `activationKey` (Node.js) / `activation_key` (Python) to flip from shadow mode to active blocking — any non-empty string enables it today; the parameter exists so a future release can scope prevention to a token / pilot ID without breaking the API.

```python
aria = Aria(provider="anthropic", api_key="...", activation_key="enable")
```

Prevention mode blocks:
- **Agent loops** — caught at call #3, before call #100
- **Duplicate calls** — cached response returned instantly, $0 cost
- **Budget overruns** — hard stop when budget hits $0
- **Cascade failures** — blocked when infrastructure health degrades
- **Corrupted input** — blocked before it reaches the model
- **Prompt injection** — quarantined before it hijacks your agent

---

## How it works

ARIA monitors every API call using:

- **Pattern detection** — identifies stuck agents, repeated calls, attack signatures
- **Cross-call tracking** — monitors rate limits, latency, error rates, and budget across calls (not per-call — across the whole session)
- **Signal correlation** — combines weak signals to catch cascades no single metric would reveal
- **Active intervention** — in prevention mode, blocks calls that would fail or waste money

**Where each check runs.** Loops, cache, and basic rate-limit shaping run **locally** on your machine. Optional security signals (injection risk, credentials in input, exfiltration risk) and infrastructure-health analysis can be evaluated on a remote diagnostic endpoint that receives only **numbers** (rate-limit %, latency, error rate, content metrics) — never prompts or API keys. Set `diagnosticEndpoint: null` (Node.js) / `diagnostic_endpoint=None` (Python) to run fully local; security signals are not evaluated in that mode.

---

## Why this matters

Agent loops are the failure everyone knows about — your agent repeats the same call 100 times and the bill spikes. Easy to spot.

**The expensive failures are the ones you can't see:**

Your app hits a rate limit. Your retry logic resends the failed calls. Those retries add more traffic. More calls fail. More retries. Each retry resends the full conversation context — paying for all tokens again. In 10 minutes, you've spent 5× your normal cost and got mostly errors.

You look at your bill and think "busy day." What actually happened: your system amplified its own failure, and $160 of that $200 bill was pure waste. If something had paused at the start, you'd have spent $45.

40% of AI agent projects get canceled due to cost overruns (Gartner). It's not that AI is expensive — it's that failures multiply silently.

---

## Status & validation

ARIA is a working library exercised by the author against real API traffic across Anthropic, OpenAI, and Google providers, plus a synthetic scenario harness covering the failure modes it claims to detect — agent loops, cascade failures, budget overruns, rate-limit storms, and injection attempts.

What was observed during development:

- **Agent loops, cascade failures, budget overruns** — caught reliably under default thresholds.
- **Rate-limit storms, injection attempts** — caught under the tested scenarios.
- **Healthy traffic** — not interfered with under the mix that was tested.

This is **author-side validation**, not a published benchmark. A reproducible test suite that anyone can run against their own keys is the planned next step; it will replace the qualitative summary above with concrete numbers.

---

## Supported providers

| Provider | Models |
|---|---|
| Anthropic | Claude Opus, Sonnet, Haiku |
| OpenAI    | GPT-4o, GPT-4.1, o4-mini, etc. |
| Google    | Gemini Pro, Flash |

---

## FAQ

**Can ARIA break my app?**
In detection mode: impossible — it only observes. In prevention mode: ARIA is fail-safe. If ARIA itself errors or the optional diagnostic endpoint is unreachable, your call goes through normally.

**Can ARIA slow my app?**
Local checks add < 1 ms. The optional diagnostic check adds ~50–100 ms. Disable the diagnostic endpoint if latency matters more than security signals.

**Can ARIA see my prompts?**
Local checks see them on your machine (the wrapper runs in your process). The optional remote diagnostic endpoint receives only numeric health metrics — no prompts, no API keys. Read the source to verify, or set the diagnostic endpoint to null to keep everything local.

**What if I don't like it?**
Remove three lines. Everything goes back to how it was.

---

## License

MIT — see [LICENSE](LICENSE).
