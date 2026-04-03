// sdk/lib/models.js — Model Registry & Pricing
// ═══════════════════════════════════════════════════════════════════════════
// Model pricing and metadata. Used by the SDK to calculate costs and
// identify providers. No routing logic — just data.
// ═══════════════════════════════════════════════════════════════════════════

const MODELS = {
  "gpt-4.1-nano":     { provider: "openai",    capability: 0, input_cost: 0.0001,  output_cost: 0.0004,  context_window: 1047576 },
  "gpt-4.1-mini":     { provider: "openai",    capability: 2, input_cost: 0.0004,  output_cost: 0.0016,  context_window: 1047576 },
  "gpt-4.1":          { provider: "openai",    capability: 3, input_cost: 0.002,   output_cost: 0.008,   context_window: 1047576 },
  "gpt-4o":           { provider: "openai",    capability: 3, input_cost: 0.0025,  output_cost: 0.01,    context_window: 128000 },
  "gpt-4o-mini":      { provider: "openai",    capability: 1, input_cost: 0.00015, output_cost: 0.0006,  context_window: 128000 },
  "o4-mini":          { provider: "openai",    capability: 4, input_cost: 0.0011,  output_cost: 0.0044,  context_window: 200000 },
  "claude-haiku-4.5": { provider: "anthropic", capability: 1, input_cost: 0.001,   output_cost: 0.005,   context_window: 200000 },
  "claude-sonnet-4":  { provider: "anthropic", capability: 3, input_cost: 0.003,   output_cost: 0.015,   context_window: 200000 },
  "claude-opus-4":    { provider: "anthropic", capability: 4, input_cost: 0.015,   output_cost: 0.075,   context_window: 200000 },
  "gemini-2.5-flash": { provider: "google",    capability: 2, input_cost: 0.00015, output_cost: 0.001,   context_window: 1048576 },
  "gemini-2.5-pro":   { provider: "google",    capability: 4, input_cost: 0.00125, output_cost: 0.01,    context_window: 1048576 },
};

const MODEL_ALIASES = {
  "claude-haiku": "claude-haiku-4.5", "claude-haiku-4.5": "claude-haiku-4.5", "claude-haiku-4-5-20251001": "claude-haiku-4.5",
  "claude-sonnet": "claude-sonnet-4", "claude-sonnet-4": "claude-sonnet-4", "claude-sonnet-4-20250514": "claude-sonnet-4",
  "claude-opus": "claude-opus-4", "claude-opus-4": "claude-opus-4", "claude-opus-4-6": "claude-opus-4",
  "gemini-flash": "gemini-2.5-flash", "gemini-2.5-flash": "gemini-2.5-flash",
  "gemini-pro": "gemini-2.5-pro", "gemini-2.5-pro": "gemini-2.5-pro",
  "gpt-4.1-nano": "gpt-4.1-nano", "gpt-4.1-mini": "gpt-4.1-mini", "gpt-4.1": "gpt-4.1",
  "gpt-4o": "gpt-4o", "gpt-4o-mini": "gpt-4o-mini", "o4-mini": "o4-mini",
};

const API_MODEL_NAMES = {
  "claude-opus-4": "claude-opus-4-20250514", "claude-sonnet-4": "claude-sonnet-4-20250514",
  "claude-haiku-4.5": "claude-haiku-4-5-20251001",
  "gpt-4o": "gpt-4o", "gpt-4o-mini": "gpt-4o-mini", "gpt-4.1": "gpt-4.1",
  "gpt-4.1-mini": "gpt-4.1-mini", "gpt-4.1-nano": "gpt-4.1-nano", "o4-mini": "o4-mini",
  "gemini-2.5-flash": "gemini-2.5-flash", "gemini-2.5-pro": "gemini-2.5-pro",
};

function resolveModel(modelName) {
  const alias = MODEL_ALIASES[modelName];
  if (alias && MODELS[alias]) return { name: alias, profile: MODELS[alias] };
  if (MODELS[modelName]) return { name: modelName, profile: MODELS[modelName] };
  return null;
}

module.exports = { MODELS, MODEL_ALIASES, API_MODEL_NAMES, resolveModel };
