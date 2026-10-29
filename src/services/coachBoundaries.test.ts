import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { coachInterviewAnswer } from "./modelClient";
import { buildInterviewContext } from "../lib/interviewContext";
import type { Question } from "../lib/domain";

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../test-fixtures/public-coach/${path}`, import.meta.url), "utf8"));
const source = read("03-experience.json");
const prior = read("experience-internal-note.json");
const priorFeedback = JSON.parse(prior.requests.find((r: any) => r.phase === "revised").body.content);
const context = buildInterviewContext({ ...source.fixture, currentQuestion: source.question, userAnswer: source.revisedAnswer });
const closeout = read("experience-semantic-expansion.json");
const syntheticFeedback = closeout.requests.map((request: any) => JSON.parse(request.body.content));

test("P1-F：即使模型替身返回自然的职责扩写，经历题也不提供可复用完整示例", async () => {
  const previous = globalThis.fetch;
  const before = JSON.stringify(context);
  try {
    for (const feedback of syntheticFeedback) {
      globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(feedback) }));
      const result = await coachInterviewAnswer(context, source.fixture.project.preparation.questions[0]);
      assert.equal(result.optimizedExample, "", "不依赖关键词命中；自然措辞也不能绕过经历示例关闭策略");
      assert.ok(result.factRisks.some(risk => /经历题.*不自动生成/.test(risk)), "必须说明产品取舍，而非伪称模型已验证");
    }
    assert.equal(JSON.stringify(context), before, "本轮自述和模型输出均不能修改确认资料");
  } finally { globalThis.fetch = previous; }
});

test("P1-F：虚构坏框架与用途建议不能进入经历题的正式表达指导", async () => {
  const previous = globalThis.fetch;
  try {
    for (const feedback of [...syntheticFeedback, priorFeedback]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(feedback) }));
      const result = await coachInterviewAnswer(context, source.fixture.project.preparation.questions[0]);
      assert.equal(result.answerStructure, "先说明本人已确认的职责与行动，再说明已确认的产物及责任边界。没有确认的部分暂不补写；无需凑完整 STAR，也不必补量化指标。");
      assert.deepEqual(result.suggestions, [
        "选取与当前问题有关、本人已经确认的行动和产物，用简短口语说明；关闭参考后重新说一遍，不把复述建议当作独立掌握。",
        "本轮新增的负责人、用途、数字和行动先与经历资料核对，确认前不写入正式经历回答；未来方案另用“如果由我负责，我会……”表达。",
      ]);
      assert.deepEqual(result.strengths, feedback.strengths, "仍保留针对实际回答的讨论，不伪称已经核验");
      assert.deepEqual(result.issues, feedback.issues);
      assert.ok(result.factRisks.some(risk => /其余 AI 点评仅供讨论/.test(risk)));
    }
  } finally { globalThis.fetch = previous; }
});

test("P1-F：明确的未来方案继续教学，回答中出现如果不能放开真实经历保护", async () => {
  const previous = globalThis.fetch;
  const hypothetical = read("06-hypothetical.json");
  const input = buildInterviewContext({ ...hypothetical.fixture, currentQuestion: hypothetical.question, userAnswer: hypothetical.originalAnswer });
  const feedback = { strengths: [], issues: [], factRisks: [], studyTopics: ["小范围验证"], suggestions: ["先确定需要验证的问题，再说明数据范围。"], answerStructure: "如果由我负责，我会先整理数据，使用小范围试点检查检索与回答，再决定下一步。", optimizedExample: "如果由我负责，我会先确定试点问题，再整理相应资料并检查回答依据。" };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(feedback) }));
    const result = await coachInterviewAnswer(input, hypothetical.fixture.project.preparation.questions[0]);
    assert.equal(result.answerStructure, feedback.answerStructure, "明确未来方案不能退化成真实经历的通用框架");
    assert.deepEqual(result.suggestions, feedback.suggestions);
    assert.match(result.optimizedExample, /未来假设方案[\s\S]*不是已完成经历/);
    assert.ok(result.optimizedExample.endsWith(feedback.optimizedExample));
    const actual = await coachInterviewAnswer({ ...context, userAnswer: "如果由我负责会先整理数据。但请点评我的真实经历。" }, source.fixture.project.preparation.questions[0]);
    assert.equal(actual.optimizedExample, "", "分流看问题，不因回答中的假设措辞跳过保护");
  } finally { globalThis.fetch = previous; }
});

test("P1-F：知识教学保留，缺题型和混合经历题保守处理且不改变输入来源", async () => {
  const previous = globalThis.fetch;
  const question: Question = { id: "rag-understanding", text: "RAG 的检索与生成分别如何评测？", technical: true, category: "技术理解", source: "内置学习题", sourceType: "foundation" };
  const input = { ...context, currentQuestion: question.text, userAnswer: "我还没有独立完成过 RAG 评测。", confirmedPreviousAnswers: ["我上线了多个项目。"] };
  const feedback = { strengths: [], issues: ["需要区分检索和生成。"], factRisks: [], suggestions: ["先检查找到的制度是否相关，再检查回答是否依据制度。"], answerStructure: "例如询问请假制度，先找对制度，再依据制度回答。找到证据却答错和没有找到证据有什么区别？", studyTopics: ["检索与生成的分层评测"], optimizedExample: "检索质量关注证据是否相关，生成质量关注回答是否依据证据。" };
  const before = JSON.stringify(input);
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(feedback) }));
    const result = await coachInterviewAnswer(input, question);
    assert.equal(result.answerStructure, feedback.answerStructure);
    assert.deepEqual(result.suggestions, feedback.suggestions);
    assert.equal(result.optimizedExample, feedback.optimizedExample);
    assert.equal((await coachInterviewAnswer(input)).optimizedExample, "", "缺少题型时不假定为知识题");
    for (const mixed of [
      { ...question, text: "请结合真实经历说明 RAG 评测。" },
      { ...question, text: "说说你的贡献。", category: "经历复盘" as const },
      { ...question, text: "介绍一下自己。", technical: false, sourceType: "resume" as const },
    ]) assert.equal((await coachInterviewAnswer(input, mixed)).optimizedExample, "");
    assert.equal(JSON.stringify(input), before, "既有最终答案、本轮学习自述和 A 不互相升级");
  } finally { globalThis.fetch = previous; }
});

test("P1-F：请求不再要求生成经历示例，历史最终答案只供表达参考而非确认事实", async () => {
  const prompt = await outgoing();
  assert.match(prompt, /经历题[\s\S]*optimizedExample[\s\S]*空字符串/);
  assert.match(prompt, /answerStructure[\s\S]*suggestions[\s\S]*程序[\s\S]*保守/);
  assert.match(prompt, /最终[\s\S]*答案[\s\S]*表达参考[\s\S]*不是 A/);
});

async function outgoing(input = context) {
  const previous = globalThis.fetch;
  let body: { messages: Array<{ role: string; content: string }> };
  try {
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: JSON.stringify({ ...priorFeedback, optimizedExample: "" }) }));
    };
    await coachInterviewAnswer(input, input.currentQuestion === source.question ? source.fixture.project.preparation.questions[0] : undefined);
    return body!.messages.map(message => message.content).join("\n");
  } finally { globalThis.fetch = previous; }
}

test("虚构反例3：内部核对说明不能作为优化面试示例返回，其余讨论与风险仍保留", async () => {
  const previous = globalThis.fetch;
  try {
    const examples = [priorFeedback.optimizedExample, "资料中没有依据，请确认或删除。", "量化成果未提供。", "A 中未确认。", "请人工核验后使用。"];
    for (const example of examples) {
      globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify({ ...priorFeedback, optimizedExample: example }) }));
      const result = await coachInterviewAnswer(context, source.fixture.project.preparation.questions[0]);
      assert.equal(result.optimizedExample, "", "不能把核对提醒交给用户照读，也不能自动删词后冒充自然答案");
      assert.ok(result.factRisks.some(risk => /内部.*核对/.test(risk)), "必须说明示例未展示，不能静默丢弃");
      assert.deepEqual(result.strengths, priorFeedback.strengths);
      assert.notEqual(result.answerStructure, priorFeedback.answerStructure, "P1-F 经历题不再转交旧自由生成框架");
    }
    const natural = "我负责客户需求访谈并形成需求清单，没有负责模型研发或上线。";
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify({ ...priorFeedback, optimizedExample: natural }) }));
    const result = await coachInterviewAnswer(context);
    assert.equal(result.optimizedExample, "", "P1-F 不对模型个人陈述作语义认证，正常措辞也不自动变成完整经历示例");
    assert.ok(!result.factRisks.some(risk => /内部事实核对说明/.test(risk)));
  } finally { globalThis.fetch = previous; }
});

test("反例B：本轮自述可作对话输入但不升级确认资料，未记载不等于虚构或应删除", async () => {
  const selfReport = "我还没有独立完成过 RAG 评测。";
  const input = { ...context, currentQuestion: "检索与生成分别怎么评测？", userAnswer: selfReport };
  const prompt = await outgoing(input);
  assert.match(prompt, /已确认事实[\s\S]*本轮自述[\s\S]*模型假设[\s\S]*完全未知/);
  assert.match(prompt, /自述[\s\S]*不自动升级[\s\S]*已确认/);
  assert.match(prompt, /不因[\s\S]*未记载[\s\S]*虚构[\s\S]*删除/);
  const data = JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1));
  assert.equal(data.用户本轮原回答, selfReport);
  assert.ok(!data.A_用户本人已确认事实.some((fact: string) => fact.includes(selfReport)));
});

test("虚构反例3：请求将事实提醒与自然面试示例隔离，信息不足不凑完整STAR", async () => {
  const prompt = await outgoing();
  assert.match(prompt, /factRisks[\s\S]*内部事实提醒[\s\S]*optimizedExample[\s\S]*自然/);
  assert.match(prompt, /optimizedExample[\s\S]*不得包含[\s\S]*资料中没有依据，请确认或删除/);
  assert.match(prompt, /信息不足[\s\S]*简短[\s\S]*不[\s\S]*STAR/);
  assert.doesNotMatch(prompt, /无法依据 A 的任何数字或成果须写/);
});

test("虚构反例3未确认用途：可能用途不能补成既成事实，资料未记载能力不能推断不会", async () => {
  assert.match(priorFeedback.answerStructure, /便于后续核对优先级/);
  const prompt = await outgoing();
  assert.match(prompt, /可能的业务用途[\s\S]*不等于[\s\S]*已发生/);
  assert.match(prompt, /未记录[\s\S]*能力[\s\S]*不等于[\s\S]*没有/);
  assert.match(prompt, /未知用途[\s\S]*询问[\s\S]*不代填/);
});
