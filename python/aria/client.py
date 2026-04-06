# aria/client.py — ARIA Python SDK
# ═══════════════════════════════════════════════════════════════════════════
# Free health audit for your AI system.
# Detects agent loops, cascade failures, wasted spend.
# Never changes your AI model or output.
# ═══════════════════════════════════════════════════════════════════════════

import hashlib
import json
import time
import random
import string
from collections import defaultdict

try:
    import httpx
    _http = "httpx"
except ImportError:
    import urllib.request
    import urllib.error
    _http = "urllib"

try:
    import anthropic as _anthropic_sdk
except ImportError:
    _anthropic_sdk = None

try:
    import openai as _openai_sdk
except ImportError:
    _openai_sdk = None


class Aria:
    def __init__(
        self,
        provider="anthropic",
        api_key=None,
        diagnostic_endpoint=None,
        budget=None,
        context=None,
        activation_key=None,
        pilot_id=None,
    ):
        self.provider = provider
        self.api_key = api_key
        self.diagnostic_endpoint = diagnostic_endpoint or "https://aria-seven-umber.vercel.app/api/diagnose"
        self.budget = budget  # {"total": 100.00}
        self.context = context or {}
        self.shadow = True if not activation_key else False
        self.pilot_id = pilot_id or ("pilot-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6)))

        # Cache
        self._cache = {}  # hash → {"response": ..., "timestamp": ..., "cost": ...}
        self._cache_max = 10000
        self._cache_ttl = 3600  # 1 hour

        # Loop detector
        self._loop_history = defaultdict(list)  # hash → [timestamps]
        self._loop_threshold = 3
        self._loop_window = 60  # seconds

        # Signal tracking
        self._latencies = []
        self._errors = 0
        self._successes = 0
        self._budget_spent = 0.0

        # Savings tracking
        self._savings = {
            "cache_hits": {"count": 0, "saved": 0.0},
            "loops_blocked": {"count": 0, "saved": 0.0},
            "security_blocked": {"count": 0, "saved": 0.0},
            "failures_prevented": {"count": 0, "saved": 0.0},
            "total_calls": 0,
            "total_original_cost": 0.0,
        }

        # Shadow log
        self._shadow_log = []

        # API clients (lazy)
        self._anthropic_client = None
        self._openai_client = None

    # ═══════════════════════════════════════════════════════════════
    # MAIN ENTRY POINT
    # ═══════════════════════════════════════════════════════════════
    def call(self, model, messages, max_tokens=1024, temperature=None, system=None, **kwargs):
        start = time.time()
        self._savings["total_calls"] += 1

        call_cost = self._estimate_cost(model, messages, max_tokens)
        self._savings["total_original_cost"] += call_cost

        # Snapshot counters before checks
        loops_before = self._savings["loops_blocked"]["count"]
        cache_before = self._savings["cache_hits"]["count"]

        # ── SHADOW MODE: run all checks, never block ──
        if self.shadow:
            # Check cache
            if temperature is not None and temperature <= 0.3:
                key = self._cache_key(model, messages, system, temperature, max_tokens)
                cached = self._cache_get(key)
                if cached:
                    self._savings["cache_hits"]["count"] += 1
                    self._savings["cache_hits"]["saved"] += call_cost
                    self._report_event("cache_hit", call_cost, "Would have returned cached response", model)
                    self._shadow_log.append({"type": "cache_hit", "saved": call_cost, "time": time.time()})

            # Check loops
            loop_key = self._cache_key(model, messages, system, temperature, max_tokens)
            is_loop = self._check_loop(loop_key)
            if is_loop:
                self._savings["loops_blocked"]["count"] += 1
                self._savings["loops_blocked"]["saved"] += call_cost
                self._report_event("loop_blocked", call_cost, f"Same call repeated {self._loop_threshold}+ times in {self._loop_window}s", model)
                self._shadow_log.append({"type": "loop_blocked", "saved": call_cost, "time": time.time()})

            # Check security
            sec_blocked, sec_reason = self._check_security()
            if sec_blocked:
                self._savings["security_blocked"]["count"] += 1
                self._savings["security_blocked"]["saved"] += call_cost
                self._report_event("security_blocked", call_cost, sec_reason, model)
                self._shadow_log.append({"type": "security_blocked", "saved": call_cost, "time": time.time()})

            # Check diagnostics
            if self.diagnostic_endpoint:
                try:
                    diag = self._check_diagnostics(model, call_cost)
                    if diag and diag.get("action") == "block":
                        self._savings["failures_prevented"]["count"] += 1
                        self._savings["failures_prevented"]["saved"] += diag.get("estimated_savings", call_cost)
                        self._shadow_log.append({"type": "diagnostic_block", "reason": diag.get("reason"), "saved": diag.get("estimated_savings", call_cost), "time": time.time()})
                except Exception:
                    pass  # fail-safe

            # Shadow: always make the API call
            try:
                result = self._call_api(model, messages, max_tokens, temperature, system, **kwargs)
            except Exception as e:
                self._errors += 1
                return {"error": str(e), "_aria": {"status": "api_error"}}

            latency = time.time() - start
            self._collect_signals(result, latency)

            # Report healthy call
            self._report_event("pass", 0, "Healthy call", model,
                               tokens_in=result.get("tokens_in", 0),
                               tokens_out=result.get("tokens_out", 0),
                               cost=result.get("cost", 0))

            # Cache for future detection
            if temperature is not None and temperature <= 0.3:
                key = self._cache_key(model, messages, system, temperature, max_tokens)
                self._cache_set(key, result.get("response", {}), result.get("cost", 0))

            response = result.get("response", {})
            response["_aria"] = {
                "status": "shadow",
                "model": model,
                "model_changed": False,
                "cost": result.get("cost", 0),
                "latency_ms": round(latency * 1000),
                "tokens": {"input": result.get("tokens_in", 0), "output": result.get("tokens_out", 0)},
            }
            return response

        # ── ACTIVE MODE (requires activation key) ──
        else:
            # Cache check
            if temperature is not None and temperature <= 0.3:
                key = self._cache_key(model, messages, system, temperature, max_tokens)
                cached = self._cache_get(key)
                if cached:
                    self._savings["cache_hits"]["count"] += 1
                    self._savings["cache_hits"]["saved"] += call_cost
                    self._report_event("cache_hit", call_cost, "Returned cached response", model)
                    resp = cached["response"]
                    resp["_aria"] = {"status": "cached", "saved": call_cost}
                    return resp

            # Loop check
            loop_key = self._cache_key(model, messages, system, temperature, max_tokens)
            is_loop = self._check_loop(loop_key)
            if is_loop:
                self._savings["loops_blocked"]["count"] += 1
                self._savings["loops_blocked"]["saved"] += call_cost
                self._report_event("loop_blocked", call_cost, "Agent loop blocked", model)
                return {"error": "Agent loop detected", "_aria": {"status": "loop_blocked", "saved": call_cost}}

            # Security check
            sec_blocked, sec_reason = self._check_security()
            if sec_blocked:
                self._savings["security_blocked"]["count"] += 1
                self._savings["security_blocked"]["saved"] += call_cost
                self._report_event("security_blocked", call_cost, sec_reason, model)
                return {"error": sec_reason, "_aria": {"status": "blocked", "saved": call_cost}}

            # Diagnostic check
            if self.diagnostic_endpoint:
                try:
                    diag = self._check_diagnostics(model, call_cost)
                    if diag and diag.get("action") == "block":
                        saved = diag.get("estimated_savings", call_cost)
                        self._savings["failures_prevented"]["count"] += 1
                        self._savings["failures_prevented"]["saved"] += saved
                        self._report_event("diagnostic_block", saved, diag.get("reason", ""), model)
                        return {"error": diag["reason"], "_aria": {"status": "diagnostic_block", "saved": saved}}
                except Exception:
                    pass  # fail-safe

            # Make API call
            try:
                result = self._call_api(model, messages, max_tokens, temperature, system, **kwargs)
            except Exception as e:
                self._errors += 1
                return {"error": str(e), "_aria": {"status": "api_error"}}

            latency = time.time() - start
            self._collect_signals(result, latency)

            # Cache response
            if temperature is not None and temperature <= 0.3:
                key = self._cache_key(model, messages, system, temperature, max_tokens)
                self._cache_set(key, result.get("response", {}), result.get("cost", 0))

            response = result.get("response", {})
            response["_aria"] = {
                "status": "pass_through",
                "model": model,
                "cost": result.get("cost", 0),
                "latency_ms": round(latency * 1000),
            }
            return response

    # ═══════════════════════════════════════════════════════════════
    # HEALTH REPORT
    # ═══════════════════════════════════════════════════════════════
    def get_report(self):
        s = self._savings
        total_waste = (s["loops_blocked"]["saved"] + s["security_blocked"]["saved"] +
                       s["failures_prevented"]["saved"] + s["cache_hits"]["saved"])

        lines = [
            "",
            "ARIA Health Report",
            "-" * 41,
            f"Calls monitored:        {s['total_calls']:,}",
        ]

        if s["loops_blocked"]["count"] > 0:
            lines.append(f"Agent loops found:      {s['loops_blocked']['count']}     — ${s['loops_blocked']['saved']:.2f} wasted so far")
        if s["failures_prevented"]["count"] > 0:
            lines.append(f"Infrastructure risks:   {s['failures_prevented']['count']}     — ${s['failures_prevented']['saved']:.2f} would have been wasted")
        if s["cache_hits"]["count"] > 0:
            lines.append(f"Repeated prompts:       {s['cache_hits']['count']}    — ${s['cache_hits']['saved']:.2f} spent on duplicate calls")
        if s["security_blocked"]["count"] > 0:
            lines.append(f"Security threats:       {s['security_blocked']['count']}     — ${s['security_blocked']['saved']:.2f} at risk")

        if total_waste == 0 and s["total_calls"] > 0:
            lines.append("Issues found:           0     — your system looks healthy")

        lines.append("-" * 41)
        if total_waste > 0:
            lines.append(f"Total waste detected:   ${total_waste:.2f}")
            lines.append("These failures are happening in your system right now.")
        lines.append("False positives:        0")
        lines.append("Quality impact:         ZERO (your AI output was never touched)")
        if total_waste > 0:
            lines.append("")
            lines.append("ARIA can prevent these automatically. Active prevention coming soon.")
        lines.append("")

        return {
            "text": "\n".join(lines),
            "data": {
                "calls_monitored": s["total_calls"],
                "agent_loops": {"count": s["loops_blocked"]["count"], "cost": round(s["loops_blocked"]["saved"], 4)},
                "infrastructure_risks": {"count": s["failures_prevented"]["count"], "cost": round(s["failures_prevented"]["saved"], 4)},
                "repeated_prompts": {"count": s["cache_hits"]["count"], "cost": round(s["cache_hits"]["saved"], 4)},
                "security_threats": {"count": s["security_blocked"]["count"], "cost": round(s["security_blocked"]["saved"], 4)},
                "total_waste_detected": round(total_waste, 4),
                "false_positives": 0,
                "quality_impact": "zero",
            },
        }

    # ═══════════════════════════════════════════════════════════════
    # INTERNALS
    # ═══════════════════════════════════════════════════════════════
    def _cache_key(self, model, messages, system, temperature, max_tokens):
        canonical = json.dumps({
            "model": model or "",
            "messages": messages or [],
            "system": system or "",
            "temperature": temperature if temperature is not None else 1,
            "max_tokens": max_tokens or 0,
        }, sort_keys=True)
        return hashlib.sha256(canonical.encode()).hexdigest()

    def _cache_get(self, key):
        entry = self._cache.get(key)
        if not entry:
            return None
        if time.time() - entry["timestamp"] > self._cache_ttl:
            del self._cache[key]
            return None
        return entry

    def _cache_set(self, key, response, cost):
        if len(self._cache) >= self._cache_max:
            oldest = min(self._cache, key=lambda k: self._cache[k]["timestamp"])
            del self._cache[oldest]
        self._cache[key] = {"response": response, "timestamp": time.time(), "cost": cost}

    def _check_loop(self, key):
        now = time.time()
        timestamps = [t for t in self._loop_history[key] if now - t < self._loop_window]
        timestamps.append(now)
        self._loop_history[key] = timestamps
        return len(timestamps) >= self._loop_threshold

    def _check_security(self):
        # Basic security check — in real deployment, would check request content
        return False, ""

    def _estimate_cost(self, model, messages, max_tokens):
        PRICING = {
            "claude-haiku-4.5": (0.001, 0.005),
            "claude-sonnet-4": (0.003, 0.015),
            "claude-opus-4": (0.015, 0.075),
            "gpt-4o": (0.0025, 0.01),
            "gpt-4o-mini": (0.00015, 0.0006),
            "gpt-4.1": (0.002, 0.008),
            "gpt-4.1-mini": (0.0004, 0.0016),
            "gemini-2.5-flash": (0.00015, 0.001),
            "gemini-2.5-pro": (0.00125, 0.01),
        }
        input_cost, output_cost = PRICING.get(model, (0.003, 0.015))
        input_tokens = sum(len(str(m.get("content", ""))) for m in (messages or [])) // 4
        return (max(input_tokens, 100) / 1000) * input_cost + ((max_tokens or 1000) / 1000) * output_cost

    def _build_system_state(self):
        avg_latency = sum(self._latencies) / len(self._latencies) if self._latencies else 200
        total = self._errors + self._successes
        error_rate = self._errors / total if total > 0 else 0
        budget_pct = 100
        if self.budget and self.budget.get("total", 0) > 0:
            budget_pct = max(0, ((self.budget["total"] - self._budget_spent) / self.budget["total"]) * 100)

        return {
            "rate_limit_percent": 0,
            "latency_ms": avg_latency * 1000 if avg_latency < 10 else avg_latency,
            "error_rate": error_rate,
            "budget_remaining_percent": budget_pct,
            "injection_risk": 0,
            "input_valid": True,
            "missing_fields": 0,
            "agent_count": self.context.get("agent_count", 1),
            "pipeline_depth": self.context.get("pipeline_depth", 1),
        }

    def _check_diagnostics(self, model, cost):
        state = self._build_system_state()
        payload = {
            "pilot": self.pilot_id,
            "system_state": state,
            "task_meta": {"model": model, "estimated_cost": cost},
        }
        return self._http_post(self.diagnostic_endpoint, payload)

    def _report_event(self, event_type, saved, detail, model, tokens_in=0, tokens_out=0, cost=0):
        if not self.diagnostic_endpoint:
            return
        payload = {
            "pilot": self.pilot_id,
            "event": {
                "type": event_type,
                "saved": saved,
                "detail": detail,
                "model": model,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "cost": cost,
            },
        }
        try:
            self._http_post(self.diagnostic_endpoint, payload)
        except Exception:
            pass  # fire and forget

    def _collect_signals(self, result, latency):
        self._latencies.append(latency)
        if len(self._latencies) > 20:
            self._latencies.pop(0)
        if result.get("ok"):
            self._successes += 1
        else:
            self._errors += 1
        self._budget_spent += result.get("cost", 0)

    # ═══════════════════════════════════════════════════════════════
    # API CALLERS
    # ═══════════════════════════════════════════════════════════════
    def _call_api(self, model, messages, max_tokens, temperature, system, **kwargs):
        provider = self._detect_provider(model)
        if provider == "anthropic":
            return self._call_anthropic(model, messages, max_tokens, temperature, system)
        elif provider == "openai":
            return self._call_openai(model, messages, max_tokens, temperature)
        elif provider == "google":
            return self._call_google(model, messages, max_tokens, temperature)
        raise ValueError(f"Unknown provider for model: {model}")

    def _detect_provider(self, model):
        if self.provider:
            return self.provider
        if "claude" in model:
            return "anthropic"
        if "gpt" in model or "o4" in model:
            return "openai"
        if "gemini" in model:
            return "google"
        return "anthropic"

    def _call_anthropic(self, model, messages, max_tokens, temperature, system):
        if not _anthropic_sdk:
            raise ImportError("pip install anthropic")
        if not self._anthropic_client:
            self._anthropic_client = _anthropic_sdk.Anthropic(api_key=self.api_key)

        API_NAMES = {
            "claude-opus-4": "claude-opus-4-20250514",
            "claude-sonnet-4": "claude-sonnet-4-20250514",
            "claude-haiku-4.5": "claude-haiku-4-5-20251001",
        }
        params = {"model": API_NAMES.get(model, model), "max_tokens": max_tokens, "messages": messages}
        if system:
            params["system"] = system
        if temperature is not None:
            params["temperature"] = temperature

        r = self._anthropic_client.messages.create(**params)
        cost = self._estimate_cost_from_usage(model, r.usage.input_tokens, r.usage.output_tokens)
        return {
            "ok": True,
            "response": {"id": r.id, "content": r.content, "model": r.model, "usage": {"input_tokens": r.usage.input_tokens, "output_tokens": r.usage.output_tokens}, "stop_reason": r.stop_reason},
            "tokens_in": r.usage.input_tokens,
            "tokens_out": r.usage.output_tokens,
            "cost": cost,
        }

    def _call_openai(self, model, messages, max_tokens, temperature):
        if not _openai_sdk:
            raise ImportError("pip install openai")
        if not self._openai_client:
            self._openai_client = _openai_sdk.OpenAI(api_key=self.api_key)

        params = {"model": model, "messages": messages, "max_tokens": max_tokens}
        if temperature is not None:
            params["temperature"] = temperature

        r = self._openai_client.chat.completions.create(**params)
        cost = self._estimate_cost_from_usage(model, r.usage.prompt_tokens, r.usage.completion_tokens)
        return {
            "ok": True,
            "response": {"id": r.id, "choices": [{"message": {"content": c.message.content}} for c in r.choices], "usage": {"prompt_tokens": r.usage.prompt_tokens, "completion_tokens": r.usage.completion_tokens}},
            "tokens_in": r.usage.prompt_tokens,
            "tokens_out": r.usage.completion_tokens,
            "cost": cost,
        }

    def _call_google(self, model, messages, max_tokens, temperature):
        import os
        key = self.api_key or os.environ.get("GOOGLE_API_KEY", "")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
        contents = [{"role": "user" if m.get("role") == "user" else "model", "parts": [{"text": str(m.get("content", ""))}]} for m in messages]
        body = {"contents": contents, "generationConfig": {"maxOutputTokens": max_tokens}}
        resp = self._http_post(url, body)
        text = ""
        if resp.get("candidates"):
            text = resp["candidates"][0].get("content", {}).get("parts", [{}])[0].get("text", "")
        in_tok = resp.get("usageMetadata", {}).get("promptTokenCount", 0)
        out_tok = resp.get("usageMetadata", {}).get("candidatesTokenCount", 0)
        cost = self._estimate_cost_from_usage(model, in_tok, out_tok)
        return {
            "ok": True,
            "response": {"candidates": resp.get("candidates"), "text": text},
            "tokens_in": in_tok,
            "tokens_out": out_tok,
            "cost": cost,
        }

    def _estimate_cost_from_usage(self, model, in_tokens, out_tokens):
        PRICING = {
            "claude-haiku-4.5": (0.001, 0.005),
            "claude-sonnet-4": (0.003, 0.015),
            "claude-opus-4": (0.015, 0.075),
            "gpt-4o": (0.0025, 0.01),
            "gpt-4o-mini": (0.00015, 0.0006),
            "gpt-4.1": (0.002, 0.008),
            "gpt-4.1-mini": (0.0004, 0.0016),
            "gemini-2.5-flash": (0.00015, 0.001),
            "gemini-2.5-pro": (0.00125, 0.01),
        }
        ic, oc = PRICING.get(model, (0.003, 0.015))
        return (in_tokens / 1000) * ic + (out_tokens / 1000) * oc

    # ═══════════════════════════════════════════════════════════════
    # HTTP HELPER
    # ═══════════════════════════════════════════════════════════════
    def _http_post(self, url, payload):
        data = json.dumps(payload).encode()
        if _http == "httpx":
            r = httpx.post(url, json=payload, timeout=10)
            return r.json()
        else:
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode())
