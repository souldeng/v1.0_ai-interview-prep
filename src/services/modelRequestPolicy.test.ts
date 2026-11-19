import assert from "node:assert/strict";
import test from "node:test";
import { modelRequestPolicy } from "./modelRequestPolicy";
import { LLM_FEATURES } from "./llmUsage";

test("未配置分任务参数时保留所有已有输出预算/思考策略，不一律关闭或缩短", () => {
  for (const feature of LLM_FEATURES) {
    const result = modelRequestPolicy("deepseek", "deepseek-flash", feature, 12288, {});
    const simple = ["experience_question_generation", "resume_question_generation", "material_organization", "material_summary"].includes(feature);
    assert.equal(result.accounting.thinkingMode, simple ? "disabled" : "provider_default");
    assert.equal(result.accounting.reasoningEffort, "not_set");
    assert.equal(result.parameters.max_tokens, feature === "experience_question_generation" || feature === "resume_question_generation" ? 2048 : simple ? 6144 : 12288);
  }
  assert.equal(modelRequestPolicy("deepseek", "deepseek-v4-pro", "interview_feedback", 16384, {}).parameters.max_tokens, 16384);
});

test("显式分任务低强度只作用于目标任务，受全局上限约束，元数据与发送参数一致", () => {
  const env = { LLM_INTERVIEW_FOLLOWUP_MAX_OUTPUT_TOKENS: "2048", LLM_INTERVIEW_FOLLOWUP_THINKING_MODE: "enabled", LLM_INTERVIEW_FOLLOWUP_REASONING_EFFORT: "low" };
  const policy = modelRequestPolicy("deepseek", "deepseek-flash", "interview_followup", 12288, env);
  assert.deepEqual(policy.parameters, { max_tokens: 2048, thinking: { type: "enabled" }, reasoning_effort: "low" });
  assert.deepEqual(policy.accounting, { maxOutputTokens: 2048, thinkingMode: "enabled", reasoningEffort: "low", jsonMode: false });
  assert.equal(modelRequestPolicy("deepseek", "deepseek-flash", "interview_feedback", 12288, env).parameters.max_tokens, 12288);
  assert.equal(modelRequestPolicy("deepseek", "deepseek-flash", "interview_followup", 1000, env).parameters.max_tokens, 1000);
  assert.equal(modelRequestPolicy("compatible", "other-model", "interview_followup", 12288, env).parameters.thinking, undefined);
});

test("无效参数退回原设置，关闭思考时不发送不适用的effort", () => {
  const disabled = modelRequestPolicy("deepseek", "deepseek-flash", "interview_feedback", 12288, { LLM_INTERVIEW_FEEDBACK_THINKING_MODE: "disabled", LLM_INTERVIEW_FEEDBACK_REASONING_EFFORT: "high" });
  assert.equal(disabled.parameters.reasoning_effort, undefined);
  const bad = modelRequestPolicy("deepseek", "deepseek-flash", "interview_feedback", 12288, { LLM_INTERVIEW_FEEDBACK_MAX_OUTPUT_TOKENS: "0", LLM_INTERVIEW_FEEDBACK_THINKING_MODE: "invalid", LLM_INTERVIEW_FEEDBACK_REASONING_EFFORT: "invalid" });
  assert.deepEqual(bad.parameters, { max_tokens: 12288 });
});
