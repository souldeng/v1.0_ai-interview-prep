import assert from "node:assert/strict";
import test from "node:test";
import { coachInterviewAnswer } from "./modelClient";
import { buildInterviewContext } from "../lib/interviewContext";
import { emptyUserProfile } from "../lib/profileStorage";
import type { Question } from "../lib/domain";

const context = buildInterviewContext({ profile: emptyUserProfile(), currentQuestion: "RAG 与 Agent 有什么区别？", userAnswer: "RAG 是检索增强，Agent 我还不理解。" });
const knowledge: Question = { id: "anonymous-rag", text: context.currentQuestion, category: "技术理解", source: "内置题", sourceType: "foundation", technical: true };
const feedback = { strengths: ["提到检索"], issues: ["需要解释工具调用"], factRisks: [], suggestions: ["补充二者区别"], answerStructure: "概念→流程→局限", studyTopics: ["Agent 工具调用"], optimizedExample: "" };

test("缺字段或空回答思路的模型响应不冒充成功点评", async () => {
  const previous = globalThis.fetch;
  try {
    for (const invalid of [{ strengths: [], issues: [], answerStructure: "", optimizedExample: "" }, { ...feedback, suggestions: "错误字段" }, { ...feedback, answerStructure: "   " }]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(invalid) }), { status: 200 });
      await assert.rejects(() => coachInterviewAnswer(context), /格式无效/);
    }
  } finally { globalThis.fetch = previous; }
});

test("教练网络调用有超时边界，不会无限等待", async t => {
  const previous = globalThis.fetch;
  let signal: AbortSignal | undefined;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal as AbortSignal;
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    const pending = coachInterviewAnswer(context, knowledge, { timeoutMs: 30_000 });
    assert.ok(signal instanceof AbortSignal, "请求必须带可终止的信号");
    const rejected = assert.rejects(pending, /超时/);
    t.mock.timers.tick(30_000);
    await rejected;
  } finally { globalThis.fetch = previous; t.mock.timers.reset(); }
});

test("知识与经历题点评请求区分侧重点，并保留问题与原回答", async () => {
  const previous = globalThis.fetch;
  const prompts: string[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      prompts.push(JSON.parse(String(init?.body)).messages[1].content);
      return new Response(JSON.stringify({ content: JSON.stringify(feedback) }), { status: 200 });
    };
    await coachInterviewAnswer(context, knowledge);
    assert.match(prompts[0], /知识.*不强制.*STAR/);
    assert.match(prompts[0], /RAG 是检索增强，Agent 我还不理解/);
    assert.match(prompts[0], /不能.*掌握|不.*掌握/);
    await coachInterviewAnswer({ ...context, currentQuestion: "请介绍一个真实项目，说明个人贡献。" }, { ...knowledge, technical: false, category: "经历复盘", sourceType: "resume", text: "请介绍一个真实项目，说明个人贡献。" });
    assert.match(prompts[1], /个人职责.*行动.*结果/);
    assert.match(prompts[1], /假设.*已完成/);
  } finally { globalThis.fetch = previous; }
});
