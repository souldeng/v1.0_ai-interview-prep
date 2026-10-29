import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { coachInterviewAnswer } from "./modelClient";
import { buildInterviewContext } from "../lib/interviewContext";

// Fully fictional adversarial inputs; not real model outputs or quality evidence.
function example(id: string) {
  return JSON.parse(readFileSync(new URL(`../../test-fixtures/public-coach/${id}.json`, import.meta.url), "utf8"));
}
async function coachRequest(id: string, revised = false) {
  const source = example(id);
  const context = buildInterviewContext({ ...source.fixture, currentQuestion: source.question, userAnswer: revised ? source.revisedAnswer : source.originalAnswer });
  const previous = globalThis.fetch;
  let request: { messages: Array<{ content: string }> };
  try {
    globalThis.fetch = async (_url, init) => {
      request = JSON.parse(String(init?.body));
      // This response only exercises the public request/structure boundary, not teaching quality.
      return new Response(JSON.stringify({ content: JSON.stringify({ strengths: [], issues: [], factRisks: [], suggestions: [], studyTopics: [], answerStructure: "请求边界测试", optimizedExample: "" }) }));
    };
    await coachInterviewAnswer(context, source.fixture.project.preparation.questions[0]);
    return { prompt: request!.messages.map(message => message.content).join("\n"), system: request!.messages[0].content, context };
  } finally { globalThis.fetch = previous; }
}

test("虚构反例3：教练请求保护未负责与未提供的程度，不能补上线负责人或参与情况", async () => {
  const { prompt, context } = await coachRequest("03-experience");
  assert.ok(context.confirmedUserFacts.some(fact => fact.includes("没有负责模型研发或上线")));
  assert.match(prompt, /未负责[\s\S]*不等于[\s\S]*未参与/);
  assert.match(prompt, /未提供[\s\S]*不等于[\s\S]*没有[\s\S]*成果/);
  assert.match(prompt, /不得推断[\s\S]*谁负责[\s\S]*上线/);
  assert.match(prompt, /资料中没有依据，请确认或删除/);
});

test("虚构反例6：假设方案可用于教学，但示例不得将设想变成个人履历或借用第三方成果", async () => {
  const { prompt, context } = await coachRequest("06-hypothetical");
  assert.match(prompt, /假设性技术方案[\s\S]*如果[\s\S]*与真实经历分开/);
  assert.match(prompt, /知识示例[\s\S]*不必[\s\S]*个人经历/);
  assert.equal(context.userAnswer, "我没有做过 RAG 项目。如果由我负责，我会先整理数据并做小范围验证。");
  assert.doesNotMatch(context.confirmedUserFacts.join(" "), /20个|50个/);
  assert.match(context.thirdPartyInterviewMaterials[0].text, /20个/);
});

test("虚构反例2与5：错误或不知道时先教一个缺口，用小例子和短追问而非指标清单", async () => {
  for (const id of ["02-rag-evaluation", "05-dont-know"]) {
    const { prompt } = await coachRequest(id);
    assert.match(prompt, /一个最关键[\s\S]*简单[\s\S]*小例子[\s\S]*简短追问/);
    assert.match(prompt, /不以[\s\S]*指标[\s\S]*公式[\s\S]*入门/);
    assert.match(prompt, /answerStructure[\s\S]*小例子[\s\S]*追问/);
    assert.match(prompt, /BLEU[\s\S]*词面[\s\S]*不等于[\s\S]*流畅/);
  }
});

test("虚构反例4：正确机制不因缺术语被判错，术语齐全也不能代替理解", async () => {
  const { prompt, context } = await coachRequest("04-discovery", true);
  assert.match(context.userAnswer!, /有出处的回答还是自动操作/);
  assert.doesNotMatch(context.userAnswer!, /RAG|Agent/);
  assert.match(prompt, /缺少[\s\S]*术语[\s\S]*不能[\s\S]*判错/);
  assert.match(prompt, /知识理解不足[\s\S]*表达不完整[\s\S]*分开/);
  assert.match(prompt, /不要求[\s\S]*每道题[\s\S]*JD[\s\S]*所有技术/);
});

test("虚构反例6重答：禁止隐瞒提示依赖，表达润色与无提示迁移验证分开", async () => {
  const { prompt, context } = await coachRequest("06-hypothetical", true);
  assert.match(context.userAnswer!, /^根据提示/);
  assert.match(prompt, /不得[\s\S]*隐藏[\s\S]*提示依赖/);
  assert.match(prompt, /关闭参考[\s\S]*变形题/);
  assert.match(prompt, /复述[\s\S]*不代表[\s\S]*知识迁移/);
  assert.match(prompt, /正式面试[\s\S]*表达[\s\S]*学习[\s\S]*分开/);
  assert.match(prompt, /接受提示后的回答不能认定为独立掌握/);
});

test("虚构反例5：默认反馈短而可操作，扩展移入已有详情字段且不压掉事实风险", async () => {
  const { prompt } = await coachRequest("05-dont-know");
  assert.match(prompt, /strengths[\s\S]*最多[\s\S]*2/);
  assert.match(prompt, /issues[\s\S]*最关键[\s\S]*1/);
  assert.match(prompt, /进阶[\s\S]*studyTopics/);
  assert.match(prompt, /factRisks[\s\S]*不[\s\S]*省略/);
  assert.match(prompt, /不强制 STAR、个人成果或量化指标/);
});

test("虚构反例3固定回归反例：高优先级约束逐句保留原词，未提供不能简写成无或没有", async () => {
  const { system } = await coachRequest("03-experience", true);
  assert.match(system, /逐句[\s\S]*对照 A/);
  assert.match(system, /未提供[\s\S]*不得[\s\S]*无[\s\S]*没有/);
  assert.match(system, /上线负责人[\s\S]*未知/);
  assert.match(system, /strengths[\s\S]*optimizedExample/);
});

test("虚构反例5固定回归反例：教学小例子不用虚构数字触发现有个人成果防线", async () => {
  const { prompt } = await coachRequest("05-dont-know", true);
  assert.match(prompt, /教学小例子[\s\S]*避免[\s\S]*具体数字/);
  assert.match(prompt, /占位[\s\S]*制度规定的天数/);
});
