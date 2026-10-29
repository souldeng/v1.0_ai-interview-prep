import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildInterviewContext, contextForPrompt } from "../lib/interviewContext";
import { emptyUserProfile } from "../lib/profileStorage";
import { answerCoachPrompt, interviewerPrompt, jobAnalysisPrompt, questionSelectionPrompt } from "../lib/modelPrompts";
import { coachInterviewAnswer } from "./modelClient";
import { createUsageReport, extractTokenUsage, reserveUsage, settleUsage, SseUsageCollector } from "./llmUsage";

const context = { ...buildInterviewContext({ profile: emptyUserProfile() }), confirmedUserFacts: ["匿名用户甲负责访谈"], targetJob: { id: "job-a", title: "岗位甲", jd: "岗位甲的要求" }, foundationKnowledge: ["学习知识，不是个人事实"], confirmedPreviousAnswers: ["本人确认的表达"], currentQuestion: "请解释RAG", userAnswer: "原回答甲" };

test("训练请求公开调用复用稳定前缀，原答动态更新，且不更改分析依据序列化", async (t) => {
  const sent: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url: any, options: RequestInit) => {
    sent.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({ content: JSON.stringify({ strengths: [], issues: [], factRisks: [], suggestions: [], answerStructure: "解释机制", studyTopics: [], optimizedExample: "" }) }));
  });
  await coachInterviewAnswer(context);
  await coachInterviewAnswer({ ...context, currentQuestion: "请解释Agent", userAnswer: "原回答乙" });
  assert.deepEqual(sent[0].messages[0], sent[1].messages[0]);
  const prefix = (value: string) => value.slice(0, value.indexOf('"当前问题"'));
  assert.equal(prefix(sent[0].messages[1].content), prefix(sent[1].messages[1].content));
  assert.match(sent[1].messages[1].content, /请解释Agent.*原回答乙/);
  assert.doesNotMatch(sent[1].messages[1].content, /原回答甲/);
  const legacy = JSON.stringify({ "A_用户本人已确认事实": context.confirmedUserFacts, "B_当前岗位JD": context.targetJob, "B_已核对的其他岗位参考资料": context.confirmedJobMaterials, "C_第三方面经_绝非当前用户经历": context.thirdPartyInterviewMaterials, "当前问题": context.currentQuestion, "用户本轮原回答": context.userAnswer, "同岗位既有最终确认答案": context.confirmedPreviousAnswers, "内置学习知识点_不能当作本人经历": context.foundationKnowledge });
  assert.equal(contextForPrompt(context), legacy);
  assert.ok(jobAnalysisPrompt(context).user.endsWith(legacy));
});

test("同任务重复构造完全一致，其他用户和岗位不会复用前一份事实", () => {
  const variants = [interviewerPrompt, answerCoachPrompt, (input: typeof context) => questionSelectionPrompt(input, [{ id: "q", question: "题", source: "内置" }])];
  const other = { ...context, confirmedUserFacts: ["匿名用户乙整理记录"], targetJob: { id: "job-b", title: "岗位乙", jd: "岗位乙要求" } };
  for (const builder of variants) {
    assert.deepEqual(builder(context), builder(context));
    const result = builder(other);
    assert.doesNotMatch(result.user, /用户甲|岗位甲|job-a/);
    assert.match(result.user, /用户乙|岗位乙/);
    assert.ok(result.user.indexOf("内置学习知识点_不能当作本人经历") < result.user.indexOf('"当前问题"'));
  }
});

test("缓存已知样本与未知请求分开，分项费用/节省不重复包含思考Token", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "interview-cache-"));
  try {
    const log = path.join(dir, "usage.jsonl"), env = { LLM_USAGE_LOG_PATH: log, LLM_BUDGET_ENFORCEMENT: "false" };
    const start = new Date("2026-10-24T02:00:00Z");
    for (const usage of [{ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60, completion_tokens_details: { reasoning_tokens: 12 } }, { prompt_tokens: 100, completion_tokens: 20 }]) {
      const reserved = await reserveUsage({ feature: "interview_feedback", provider: "deepseek", model: "deepseek-flash", messages: [{ content: "匿名隐私不得进入日志" }] }, env, start);
      if (!reserved.accepted) throw new Error("expected accepted");
      await settleUsage(reserved.reservation, { status: "succeeded", durationMs: 1000, completedAt: "2026-10-24T02:00:01Z", usage: extractTokenUsage(usage), firstTokenLatencyMs: 200 }, env);
    }
    const { all } = await createUsageReport(log, start.toISOString(), { env });
    assert.equal(all.cacheKnownRequests, 1); assert.equal(all.cacheUnknownRequests, 1);
    assert.equal(all.cacheHitRate, 0.4); assert.equal(all.cacheHitTokens, 40); assert.equal(all.cacheMissTokens, 60);
    assert.equal(all.componentCostKnownRequests, 1);
    assert.ok(Math.abs(all.cacheHitCostCny + all.cacheMissCostCny + all.outputCostCny - 0.0001408) < 1e-12);
    assert.ok(Math.abs(all.allMissBaselineCostCny - all.knownCostCny - all.estimatedCacheSavingsCny) < 1e-12);
    assert.equal(all.reasoningTokens, 12); assert.equal(all.reasoningKnownRequests, 1);
    assert.equal(all.firstTokenKnownRequests, 2); assert.equal(all.averageFirstTokenLatencyMs, 200);
    assert.equal(all.byFeature.interview_feedback.cacheHitRate, 0.4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("流式首Token不把心跳/空角色/usage当内容；缓存缺失和异常字段不伪报0%", () => {
  const collector = new SseUsageCollector();
  collector.push(': keepalive\n\ndata: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n', 10);
  assert.equal(collector.firstTokenLatencyMs(), null);
  collector.push('data: {"choices":[{"delta":{"reasoning_content":"匿名思考"}}]}\n\n', 50);
  collector.push('data: {"choices":[{"delta":{"content":"正文"}}],"usage":{"prompt_tokens":8,"completion_tokens":4}}\n\n', 80);
  assert.equal(collector.firstTokenLatencyMs(), 50);
  assert.equal(collector.usage()?.cacheHitTokens, null);
  assert.equal(extractTokenUsage({ prompt_tokens: null, completion_tokens: null }).inputTokens, null);
});
