import assert from "node:assert/strict";
import test from "node:test";
import { generateConfirmedResumePracticeSet } from "./modelClient";
import { emptyUserProfile } from "../lib/profileStorage";

const now = "2026-11-03T00:00:00.000Z";
const profile = { ...emptyUserProfile(new Date(now)), experiences: [
  { id: "education", title: "AI 学习", type: "学习", situation: "转向 AI 应用", action: "完成检索课程作业", tools: "文档检索", result: "保存学习笔记", reflection: "区分学习与项目", confirmed: true, createdAt: now, updatedAt: now },
  { id: "work", title: "客户访谈", type: "工作", situation: "客户需求不完整", action: "本人访谈客户并整理需求清单", tools: "访谈提纲", result: "形成需求清单，未负责模型研发", reflection: "先澄清边界", confirmed: true, createdAt: now, updatedAt: now },
  { id: "project", title: "知识库原型", type: "项目", situation: "练习方案表达", action: "本人整理公开资料并设计检索对照", tools: "Python、向量检索", result: "保留对照记录", reflection: "不把原型说成上线项目", confirmed: true, createdAt: now, updatedAt: now },
  { id: "draft", title: "未确认项目", type: "项目", situation: "", action: "完成 99 个项目", result: "", reflection: "", confirmed: false, createdAt: now, updatedAt: now },
] };

const questions = [
  { text: "课程作业如何帮助你理解检索增强问答的边界？", focus: "knowledge", evidence: [{ experienceId: "education", fields: ["action"] }], whyAsk: "考察学习迁移。", capabilities: ["学习迁移"], angles: ["设计动机"], followUps: ["如何区分学习与项目？"], missingAspects: ["业务价值"], coverage: ["education"] },
  { text: "面对不完整需求时，你先做了哪些澄清？", focus: "practice", evidence: [{ experienceId: "work", fields: ["action"] }], whyAsk: "考察需求澄清。", capabilities: ["需求分析"], angles: ["个人贡献"], followUps: ["你的职责边界是什么？"], missingAspects: ["业务价值"], coverage: ["work"] },
  { text: "知识库原型中，你如何使用检索对照检查自己的理解？", focus: "practice", evidence: [{ experienceId: "project", fields: ["action", "tools"] }], whyAsk: "考察技术验证。", capabilities: ["技术实践"], angles: ["技术选型", "验证方式"], followUps: ["哪些证据仍待补充？"], missingAspects: ["真实Badcase"], coverage: ["project", "technical_evidence"] },
  { text: "客户访谈与知识库原型之间，你如何说明能力迁移的边界？", focus: "practice", evidence: [{ experienceId: "work", fields: ["action"] }, { experienceId: "project", fields: ["action"] }], whyAsk: "考察跨经历反思。", capabilities: ["能力迁移"], angles: ["个人贡献"], followUps: ["两段经历哪些事实不能混用？"], missingAspects: ["业务价值"], coverage: ["work", "project"] },
];

test("整份简历生成只发送确认卡，使用独立计量特征并保留跨经历字段锚点", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.feature, "resume_question_generation");
    assert.match(JSON.stringify(request.messages), /跨经历题/);
    assert.match(JSON.stringify(request.messages), /coverage 必须是与 evidence 对应/);
    assert.doesNotMatch(JSON.stringify(request.messages), /work\|project\|education/);
    assert.match(JSON.stringify(request.messages), /本人访谈客户并整理需求清单/);
    assert.doesNotMatch(JSON.stringify(request.messages), /完成 99 个项目/);
    return new Response(JSON.stringify({ content: JSON.stringify({ questions }) }));
  };
  try {
    const set = await generateConfirmedResumePracticeSet(profile);
    assert.equal(set.questions.length, 4);
    assert.equal(new Set(set.questions.at(-1)!.resumePracticeOrigin!.evidence.map(item => item.experienceId)).size, 2);
  } finally { globalThis.fetch = original; }
});

test("整份简历生成保留三道可核对题，结构损坏或截断不会覆盖旧题组", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify({ questions: [...questions.slice(0, 3), { ...questions[0], text: questions[0].text }] }) }));
  try {
    const partial = await generateConfirmedResumePracticeSet(profile);
    assert.equal(partial.questions.length, 3); assert.ok(partial.generationIssues?.some(issue => issue.reason === "duplicate"));
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify({ questions: "damaged" }) }));
    await assert.rejects(() => generateConfirmedResumePracticeSet(profile), /仅有 0 道|结构损坏/);
    globalThis.fetch = async () => new Response(JSON.stringify({ content: '{"questions":[', metrics: { finishReason: "length" } }));
    await assert.rejects(() => generateConfirmedResumePracticeSet(profile), /达到上限|截断/);
  }
  finally { globalThis.fetch = original; }
});
