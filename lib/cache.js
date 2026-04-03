// api/cache.js — LRU Prompt Cache
// ═══════════════════════════════════════════════════════════════════════════
// Zero quality risk: returns the exact same response the model gave before.
// If the exact same prompt was sent before → return cached response instantly.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require("crypto");

class PromptCache {
  constructor({ maxEntries = 10000, maxAgeMs = 3600000 } = {}) {
    this.maxEntries = maxEntries;
    this.maxAgeMs = maxAgeMs;
    this.cache = new Map(); // hash → { response, timestamp, hitCount, costSaved }
    this.stats = { hits: 0, misses: 0, totalCostSaved: 0, evictions: 0 };
  }

  // Build a deterministic hash from the request fields that affect output
  generateKey(request) {
    const canonical = {
      model: request.model || "",
      messages: request.messages || [],
      system: request.system || "",
      temperature: request.temperature ?? 1,
      max_tokens: request.max_tokens || 0,
      tools: request.tools || [],
      tool_choice: request.tool_choice || null
    };
    const str = JSON.stringify(canonical);
    return crypto.createHash("sha256").update(str).digest("hex");
  }

  // Check if a request should be cached
  // Don't cache high-temperature creative requests (output varies)
  isCacheable(request) {
    const temp = request.temperature ?? 1;
    // Cache if temperature is 0 (deterministic) or if explicitly marked cacheable
    // Also cache temp <= 0.3 since output variation is minimal
    return temp <= 0.3 || request.cache === true;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.maxAgeMs) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Hit — move to end of Map (most recent) for LRU ordering
    this.cache.delete(key);
    entry.hitCount++;
    this.cache.set(key, entry);
    this.stats.hits++;
    return { response: entry.response, age: Date.now() - entry.timestamp };
  }

  set(key, response, estimatedCost) {
    // Evict if at capacity
    if (this.cache.size >= this.maxEntries) {
      // Delete the oldest entry (first key in Map = least recently used)
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      hitCount: 0,
      costSaved: estimatedCost || 0
    });
  }

  recordSaving(cost) {
    this.stats.totalCostSaved += cost;
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      entries: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hit_rate: total > 0 ? parseFloat((this.stats.hits / total * 100).toFixed(1)) : 0,
      total_cost_saved: parseFloat(this.stats.totalCostSaved.toFixed(6)),
      evictions: this.stats.evictions
    };
  }

  clear() {
    this.cache.clear();
  }
}

module.exports = PromptCache;
