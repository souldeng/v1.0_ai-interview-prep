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
    assert.ok(result.user.indexOf("内置学习知识点_不能当作本人经历") > result.user.indexOf('"当前问题"'), "本题知识点属于动态块，不再打断前面的个人与岗位事实前缀");
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

test("训练序列化对同一资料集合换序稳定，内容和事实边界变化仍改变Prompt", () => {
  const original = { ...context,
    confirmedUserFacts: ["用户乙未负责上线", "用户甲负责访谈"],
    confirmedExperienceSources: ["b", "a"].map(id => ({ id, title: id, fields: { situation: "", action: id, tools: "", result: "", reflection: "未负责上线" } })),
    confirmedJobMaterials: [{ id: "b", title: "岗位参考乙", text: "要求乙" }, { id: "a", title: "岗位参考甲", text: "要求甲" }],
    thirdPartyInterviewMaterials: [{ id: "b", title: "第三方乙", text: "他人20个项目" }, { id: "a", title: "第三方甲", text: "他人案例" }],
    confirmedPreviousAnswers: ["较早回答", "较新回答"],
  };
  const swapped = { ...original, confirmedUserFacts: [...original.confirmedUserFacts].reverse(), confirmedExperienceSources: [...original.confirmedExperienceSources].reverse(), confirmedJobMaterials: [...original.confirmedJobMaterials].reverse(), thirdPartyInterviewMaterials: [...original.thirdPartyInterviewMaterials].reverse() };
  const before = JSON.stringify(original);
  assert.equal(contextForPrompt(original, true), contextForPrompt(swapped, true));
  assert.notEqual(contextForPrompt(original), contextForPrompt(swapped), "默认分析依据不改成训练顺序");
  assert.notEqual(contextForPrompt(original, true), contextForPrompt({ ...original, confirmedUserFacts: ["新版已确认事实"] }, true));
  const payload = JSON.parse(contextForPrompt(original, true));
  assert.deepEqual(payload.同岗位既有最终确认答案, original.confirmedPreviousAnswers, "时间顺序不是无序集合");
  assert.ok(!payload.A_用户本人已确认事实.join("").includes("20个"));
  assert.equal(JSON.stringify(original), before);
  const second = contextForPrompt({ ...original, currentQuestion: "变化的问题", userAnswer: "新的回答", foundationKnowledge: ["本题不同知识点"] }, true);
  const prefix = (value: string) => value.slice(0, value.indexOf('"当前问题"'));
  assert.equal(prefix(contextForPrompt(original, true)), prefix(second));
  assert.doesNotMatch(second, /原回答甲/);
});

test("流式CRLF跨网络块及不同usage尾帧均不漏算、不重复累加，空usage不覆盖有效值", () => {
  for (const choices of [[{ delta: {}, finish_reason: "stop" }], []]) {
    const stream = 'data: {"choices":[{"delta":{"content":"回答"}}]}\r\n\r\n' + `data: ${JSON.stringify({ choices, usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20, completion_tokens_details: { reasoning_tokens: 12 } } })}\r\n\r\n` + 'data: {"usage":{}}\r\n\r\ndata: [DONE]';
    for (let split = 0; split <= stream.length; split++) {
      const collector = new SseUsageCollector();
      collector.push(stream.slice(0, split), 10); collector.push(stream.slice(split), 20); collector.flush(20);
      assert.equal(collector.usage()?.cacheHitTokens, 80, `split ${split}`);
      assert.equal(collector.usage()?.outputTokens, 20);
      assert.equal(collector.usage()?.reasoningTokens, 12);
    }
  }
});

test("usage缺失、字段冲突或不一致不能制造零命中或完整计费，Responses别名可读取", () => {
  for (const raw of [undefined, {}, { prompt_tokens: 100, completion_tokens: 20 }, { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_tokens_details: { cached_tokens: 80 } }, { prompt_tokens: 100, prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 80 }, { prompt_tokens: 100, prompt_cache_hit_tokens: 101 }]) {
    const usage = extractTokenUsage(raw);
    assert.equal(usage.cacheHitTokens, null); assert.equal(usage.cacheMissTokens, null);
  }
  assert.equal(extractTokenUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 119 }).totalTokens, null);
  assert.equal(extractTokenUsage({ input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 80 } }).cacheMissTokens, 20);
  assert.equal(extractTokenUsage({ prompt_tokens: 100, prompt_cache_hit_tokens: 0 }).cacheHitTokens, 0, "明确报告的零必须保留");
});
