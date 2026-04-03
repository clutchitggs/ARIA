// sdk/lib/budget.js — Budget Monitor
// ═══════════════════════════════════════════════════════════════════════════
// Warns when AI spend is approaching or exceeding budget limits.
// Uses model pricing to estimate cost of pending requests.
// ═══════════════════════════════════════════════════════════════════════════

const { resolveModel } = require("./models");

function assessBudget(task, state) {
  const warnings = [];
  const budgetPct = parseFloat(state.budget_remaining_percent);
  if (isNaN(budgetPct)) return { warnings };

  const model = resolveModel(task.model);
  const inputTokens = parseFloat(task.input_tokens) || 2000;
  const outputTokens = parseFloat(task.output_tokens) || 1000;
  const agentCount = parseInt(state.agent_count) || 1;
  const pipelineDepth = parseInt(state.pipeline_depth) || 1;

  const modelCosts = model ? model.profile : { input_cost: 0.003, output_cost: 0.015 };
  const estimatedCost = ((inputTokens / 1000) * modelCosts.input_cost + (outputTokens / 1000) * modelCosts.output_cost) * agentCount * pipelineDepth;

  if (budgetPct < 5) {
    warnings.push({ level: "critical", message: `Budget at ${budgetPct}% — this request (est. $${estimatedCost.toFixed(4)}) may exceed remaining budget`, estimated_cost: estimatedCost });
  } else if (budgetPct < 15) {
    warnings.push({ level: "warning", message: `Budget at ${budgetPct}%`, estimated_cost: estimatedCost });
  }

  return { warnings };
}

module.exports = { assessBudget };
