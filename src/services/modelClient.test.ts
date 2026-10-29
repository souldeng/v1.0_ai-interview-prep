import assert from "node:assert/strict";
import test from "node:test";
import { buildInterviewContext } from "../lib/interviewContext";
import { emptyUserProfile } from "../lib/profileStorage";
import { analyzeJobWithModel, coachInterviewAnswer, selectInterviewQuestionIds } from "./modelClient";

const now = "2026-10-12T00:00:00.000Z";
const profile = emptyUserProfile(new Date(now));
profile.experiences.push({ id: "fact", title: "本人方案", situation: "客户需求", action: "我负责访谈", result: "输出方案文档", reflection: "", confirmed: true, createdAt: now, updatedAt: now });
const context = buildInterviewContext({ profile });

async function withModel(content: unknown, run: () => Promise<void>) {
  const original = globalThis.fetch;
  try { globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(content) }), { status: 200 }); await run(); }
  finally { globalThis.fetch = original; }
}

test("岗位 AI 分析缺少本人原句证据时降级为无法判断", async () => {
  await withModel({ requirements: [{ requirement: "3 年 AI 经验", status: "direct", evidenceQuote: "我有三年 AI 项目经验", reason: "", studyTopic: "", practiceQuestion: "" }] }, async () => {
    const rows = await analyzeJobWithModel(context); assert.equal(rows[0].status, "unknown"); assert.equal(rows[0].evidenceQuote, "");
  });
});

test("模型选题仅接受已有候选 ID，答案教练拦截无依据的数字", async () => {
  await withModel({ ids: ["valid", "invalid", "valid"] }, async () => assert.deepEqual(await selectInterviewQuestionIds(context, [{ id: "valid", question: "题", source: "内置" }]), ["valid"]));
  await withModel({ strengths: [], issues: [], factRisks: [], suggestions: [], answerStructure: "背景→行动→结果", studyTopics: [], optimizedExample: "我完成了 20 个项目。" }, async () => {
    const coach = await coachInterviewAnswer(context); assert.equal(coach.optimizedExample, ""); assert.match(coach.factRisks.join(""), /资料中没有依据/);
  });
  await withModel({ strengths: [], issues: [], factRisks: [], suggestions: [], answerStructure: "背景→行动→结果", studyTopics: [], optimizedExample: "我曾主导大型客户上线。" }, async () => {
    const coach = await coachInterviewAnswer(context); assert.match(coach.factRisks.join(""), /个人细节尚未被程序逐句核实/);
  });
});
