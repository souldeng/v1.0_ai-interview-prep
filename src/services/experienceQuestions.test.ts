import assert from "node:assert/strict";
import { test } from "node:test";
import { extractExperienceCandidates, generateExperienceQuestions } from "./modelClient";
import type { ExperienceCard } from "../lib/domain";

const card: ExperienceCard = { id: "anonymous-card", title: "客户访谈", situation: "了解需求", action: "访谈并整理需求清单", result: "形成需求清单，没有负责研发或上线", reflection: "确认职责边界", confirmed: true, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z" };

test("候选经历提取将不完整 JSON 视为未使用结果，不暴露原始解析异常", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ content: '[{"title":"匿名候选","action":"访谈' }));
  try {
    await assert.rejects(() => extractExperienceCandidates([{ id: "anonymous-resume", fileName: "匿名资料.txt", mimeType: "text/plain", size: 10, extractedText: "本人访谈并整理需求清单", parser: "plain-text", reviewedAt: "2026-11-08T00:00:00Z", createdAt: "2026-11-08T00:00:00Z" }]), /候选经历模型返回的 JSON 不完整/);
  } finally { globalThis.fetch = original; }
});
test("专项生成只发送所选确认事实和独立业务标识，接收有原文依据的多道问题", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.feature, "experience_question_generation");
    assert.match(JSON.stringify(request.messages), /未负责.*未参与|不得.*预设/);
    assert.match(JSON.stringify(request.messages), /访谈并整理需求清单/);
    return new Response(JSON.stringify({ content: JSON.stringify({ questions: ["你如何访谈？", "你如何整理需求？", "你的职责边界是什么？"].map(text => ({ text, basisQuote: "访谈并整理需求清单" })) }) }));
  };
  try {
    const set = await generateExperienceQuestions(card);
    assert.equal(set.questions.length, 3);
    assert.equal(set.questions[2].text, "你的职责边界是什么？");
    assert.equal(set.questions[0].experienceOrigin?.experienceId, card.id);
    await assert.rejects(() => generateExperienceQuestions({ ...card, confirmed: false }), /确认/);
  } finally { globalThis.fetch = original; }
});

test("专项生成保留三道有依据题，少于三道、截断JSON和HTTP400不将失败当成题组", async () => {
  const original = globalThis.fetch;
  const good = ["如何访谈？", "如何整理？", "职责边界是什么？"].map(text => ({ text, basisQuote: card.action }));
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify({ questions: [...good, { text: good[0].text, basisQuote: card.action }] }) }));
    const partial = await generateExperienceQuestions(card);
    assert.equal(partial.questions.length, 3); assert.ok(partial.generationIssues?.some(issue => issue.reason === "duplicate"));
    for (const invalid of [{ questions: [good[0], good[0], good[2]] }, { questions: good.map(q => ({ ...q, basisQuote: "已上线20个项目" })) }, { questions: good.slice(0,2) }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(invalid) }));
      await assert.rejects(() => generateExperienceQuestions(card), /至少需要 3/);
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ content: '{"questions":[' }));
    await assert.rejects(() => generateExperienceQuestions(card));
    globalThis.fetch = async () => new Response(JSON.stringify({ content: '{"questions":[', metrics: { finishReason: "length" } }));
    await assert.rejects(() => generateExperienceQuestions(card), /达到上限|截断/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "do not echo provider internals" }), { status: 400 });
    await assert.rejects(() => generateExperienceQuestions(card), /400/);
  } finally { globalThis.fetch = original; }
});
