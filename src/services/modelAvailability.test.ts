import assert from "node:assert/strict";
import test from "node:test";
import { coachInterviewAnswer, decideInterviewTurn } from "./modelClient";
import { createPreparation } from "../lib/interview";
import { buildInterviewContext } from "../lib/interviewContext";
import { emptyUserProfile } from "../lib/profileStorage";

const context = buildInterviewContext({ profile: emptyUserProfile(), currentQuestion: "RAG 与 Agent 有什么区别？", userAnswer: "RAG 检索知识，Agent 我还不理解。" });
const feedback = { strengths: ["提到了检索"], issues: ["尚未解释 Agent"], factRisks: [], suggestions: [], answerStructure: "概念→差异→例子", studyTopics: [], optimizedExample: "" };

test("教练45秒返回的有效反馈可被接收，而非在旧30秒边界丢弃", async t => {
  const previous = globalThis.fetch;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    globalThis.fetch = async (_url, init) => new Promise<Response>((resolve, reject) => {
      setTimeout(() => resolve(new Response(JSON.stringify({ content: JSON.stringify(feedback) }))), 45_000);
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    const pending = coachInterviewAnswer(context, { id: "rag-agent", text: context.currentQuestion!, category: "技术理解", source: "匿名", sourceType: "foundation", technical: true });
    const received = assert.doesNotReject(pending);
    t.mock.timers.tick(45_000);
    await received;
    assert.equal((await pending).answerStructure, "概念→差异→例子");
  } finally { globalThis.fetch = previous; t.mock.timers.reset(); }
});

test("用户取消后即使网络替身迟到返回，也不能收到成功点评", async () => {
  const previous = globalThis.fetch;
  const controller = new AbortController();
  let release!: (value: Response) => void;
  try {
    globalThis.fetch = async () => new Promise<Response>(resolve => { release = resolve; });
    const pending = coachInterviewAnswer(context, undefined, { signal: controller.signal });
    const rejected = assert.rejects(pending, /已取消/);
    controller.abort();
    release(new Response(JSON.stringify({ content: JSON.stringify(feedback) })));
    await rejected;
  } finally { globalThis.fetch = previous; }
});

test("调用方不能把教练等待配置成零、无限或超出五分钟", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(feedback) }));
    for (const timeoutMs of [0, Infinity, 300_001]) {
      await assert.rejects(() => coachInterviewAnswer(context, undefined, { timeoutMs }), /等待上限/);
    }
  } finally { globalThis.fetch = previous; }
});

test("追问请求明确选用追问预算，不误用较长的教练预算", async () => {
  const previous = globalThis.fetch;
  let task: string | undefined;
  let feature: string | undefined;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      task = body.task;
      feature = body.feature;
      return new Response(JSON.stringify({ content: JSON.stringify({ action: "follow_up", followUpQuestion: "能举一个例子吗？" }) }));
    };
    const result = await decideInterviewTurn({ id: "q", text: context.currentQuestion!, technical: true, category: "技术理解", source: "匿名", sourceType: "foundation" }, context.userAnswer!, createPreparation("", "理解AI应用"), context);
    assert.equal(result?.action, "follow_up");
    assert.equal(task, "interviewer");
    assert.equal(feature, "interview_followup");
  } finally { globalThis.fetch = previous; }
});

test("代理先返回504时，调用方得到明确超时提示而非不明服务错误", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "代理等待到期" }), { status: 504 });
    await assert.rejects(() => coachInterviewAnswer(context), /超时/);
  } finally { globalThis.fetch = previous; }
});
