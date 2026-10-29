import assert from "node:assert/strict";
import { test } from "node:test";
import { generateExperienceQuestions } from "./modelClient";
import type { ExperienceCard } from "../lib/domain";

const card: ExperienceCard = { id: "anonymous-card", title: "客户访谈", situation: "了解需求", action: "访谈并整理需求清单", result: "形成需求清单，没有负责研发或上线", reflection: "确认职责边界", confirmed: true, createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z" };
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

test("专项生成拒绝重复题、无原文依据、截断JSON和HTTP400，不将失败当成题组", async () => {
  const original = globalThis.fetch;
  const good = ["如何访谈？", "如何整理？", "职责边界是什么？"].map(text => ({ text, basisQuote: card.action }));
  try {
    for (const invalid of [{ questions: [good[0], good[0], good[2]] }, { questions: good.map(q => ({ ...q, basisQuote: "已上线20个项目" })) }, { questions: good.slice(0,2) }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(invalid) }));
      await assert.rejects(() => generateExperienceQuestions(card), /3–5/);
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ content: '{"questions":[' }));
    await assert.rejects(() => generateExperienceQuestions(card));
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "do not echo provider internals" }), { status: 400 });
    await assert.rejects(() => generateExperienceQuestions(card), /400/);
  } finally { globalThis.fetch = original; }
});
