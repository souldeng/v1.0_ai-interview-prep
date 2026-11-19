import type { LlmFeature, RequestAccountingOptions } from "./llmUsage";

/** Server-owned, opt-in overrides. No client parameter can relax token/budget limits. */
export function modelRequestPolicy(provider: string, model: string, feature: LlmFeature, globalMax: number, env: NodeJS.ProcessEnv = process.env) {
  const deepseek = provider.trim().toLowerCase() === "deepseek" && ["deepseek-flash", "deepseek-v4-pro"].includes(model.trim().toLowerCase());
  const existingJsonTask = feature === "experience_question_generation" || feature === "resume_question_generation" || feature === "material_organization" || feature === "material_summary";
  const legacyJson = deepseek && model.trim().toLowerCase() === "deepseek-flash" && existingJsonTask;
  const prefix = `LLM_${feature.toUpperCase()}`;
  const requestedMax = Number(env[`${prefix}_MAX_OUTPUT_TOKENS`]);
  const defaultMax = feature === "experience_question_generation" || feature === "resume_question_generation" ? 2048 : feature === "material_organization" || feature === "material_summary" ? 6144 : globalMax;
  const taskMax = Number.isInteger(requestedMax) && requestedMax >= 1 && requestedMax <= 393216 ? requestedMax : defaultMax;
  const maxOutputTokens = Math.min(globalMax, taskMax);
  const configuredMode = env[`${prefix}_THINKING_MODE`]?.trim();
  const thinkingMode: RequestAccountingOptions["thinkingMode"] = deepseek && ["enabled", "disabled", "provider_default"].includes(configuredMode ?? "") ? configuredMode as RequestAccountingOptions["thinkingMode"] : legacyJson ? "disabled" : "provider_default";
  const requestedEffort = env[`${prefix}_REASONING_EFFORT`]?.trim();
  const reasoningEffort = deepseek && thinkingMode !== "disabled" && ["low", "high", "max"].includes(requestedEffort ?? "") ? requestedEffort as "low" | "high" | "max" : "not_set";
  return {
    parameters: { max_tokens: maxOutputTokens,
      ...(thinkingMode !== "provider_default" ? { thinking: { type: thinkingMode } } : {}),
      ...(reasoningEffort !== "not_set" ? { reasoning_effort: reasoningEffort } : {}),
      ...(legacyJson ? { response_format: { type: "json_object" } } : {}),
    },
    accounting: { maxOutputTokens, thinkingMode, reasoningEffort, jsonMode: legacyJson } satisfies RequestAccountingOptions,
  };
}
