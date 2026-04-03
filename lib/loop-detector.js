// api/loop-detector.js — Agent Loop Detector
// ═══════════════════════════════════════════════════════════════════════════
// Detects when an agent is making the same call repeatedly (stuck in a loop).
// This burns tokens for zero value. Block it after K identical calls in T seconds.
// ═══════════════════════════════════════════════════════════════════════════

class LoopDetector {
  constructor({ threshold = 3, windowMs = 60000 } = {}) {
    this.threshold = threshold;   // how many identical calls = loop
    this.windowMs = windowMs;     // time window to check
    this.history = new Map();     // hash → [timestamp, timestamp, ...]
    this.stats = { loopsDetected: 0, callsBlocked: 0, costSaved: 0 };
  }

  // Record a call and check if it's a loop
  // Returns: { isLoop: boolean, count: number, detail: string }
  check(hash, { allowRepeat = false } = {}) {
    if (allowRepeat) return { isLoop: false, count: 0 };

    const now = Date.now();
    let timestamps = this.history.get(hash) || [];

    // Clean old entries outside the window
    timestamps = timestamps.filter(t => now - t < this.windowMs);

    // Add current call
    timestamps.push(now);
    this.history.set(hash, timestamps);

    if (timestamps.length >= this.threshold) {
      this.stats.loopsDetected++;
      this.stats.callsBlocked++;
      return {
        isLoop: true,
        count: timestamps.length,
        detail: `Same call repeated ${timestamps.length} times in ${Math.round(this.windowMs / 1000)}s — agent appears stuck in a loop`
      };
    }

    return { isLoop: false, count: timestamps.length };
  }

  recordSaving(cost) {
    this.stats.costSaved += cost;
  }

  getStats() {
    return {
      loops_detected: this.stats.loopsDetected,
      calls_blocked: this.stats.callsBlocked,
      cost_saved: parseFloat(this.stats.costSaved.toFixed(6))
    };
  }

  // Periodic cleanup to prevent memory leaks
  cleanup() {
    const now = Date.now();
    for (const [hash, timestamps] of this.history.entries()) {
      const valid = timestamps.filter(t => now - t < this.windowMs);
      if (valid.length === 0) this.history.delete(hash);
      else this.history.set(hash, valid);
    }
  }
}

module.exports = LoopDetector;
