import assert from "node:assert/strict";
import test from "node:test";
import { attachCoachReview, currentCoachReview, evaluateEvidence, reviseTurn, saveFinalAnswer } from "./coaching";
import { createPreparation, nextTurn, startSession } from "./interview";
import type { CoachFeedback, Question } from "./domain";
import { exportBackup, parseBackup } from "./backup";
import { loadHistory, saveHistory } from "./storage";

const preparation = createPreparation("我负责需求访谈。", "需要理解 AI 应用。");
const knowledge: Question = { id: "anonymous-rag", text: "RAG 与 Agent 有什么区别？", category: "RAG / Agent / Prompt / 评测", technical: true, source: "内置学习题", sourceType: "foundation" };
const experience: Question = { ...knowledge, id: "anonymous-project", text: "请介绍一个真实项目，说明你的个人贡献。", category: "经历复盘", sourceType: "resume" };

test("知识回答不要求个人成果或 STAR，不把关键词当成掌握", () => {
  const score = evaluateEvidence("RAG 结合检索与生成，Agent 涉及任务与工具调用，评测部分我还不知道。", knowledge, preparation);
  assert.deepEqual(score.observations?.filter(item => ["action", "result"].includes(item.id)), []);
  assert.doesNotMatch(score.referenceAnswer, /我本人|项目成果|STAR/);
  assert.equal(score.observations?.find(item => item.id === "technical")?.status, "unknown");
  assert.match(score.referenceAnswer, /概念|原理/);
});

test("备份拒绝缺少回答快照的越界点评版本，不改变旧数据", () => {
  const session = nextTurn(startSession({ ...preparation, questions: [knowledge] }), "匿名原回答：先检索再生成。", { action: "next" });
  const corrupted = JSON.parse(JSON.stringify(session));
  corrupted.turns[0].coachReviews = [{ answerVersion: 99, feedback: { strengths: [], issues: [], factRisks: [], suggestions: [], answerStructure: "定义→原理", studyTopics: [], optimizedExample: "", generatedAt: "2026-10-14T00:00:00.000Z" } }];
  assert.throws(() => parseBackup(JSON.stringify({ format: "ai-interview-prep-backup", version: 1, projects: [], history: [corrupted], drafts: {} })), /无效/);
});

test("AI 点评按精确回答版本保存，重答和迟到反馈不会覆盖原文、历史或最终答案", () => {
  const prepared = { ...preparation, questions: [knowledge] };
  const original = nextTurn(startSession(prepared), "原回答：检索知识并交给模型生成。", { action: "next" });
  const feedback: CoachFeedback = { strengths: ["说明了检索"], issues: ["尚缺局限"], factRisks: [], suggestions: [], studyTopics: [], answerStructure: "概念→流程→边界", optimizedExample: "", generatedAt: "2026-10-14T00:00:00.000Z" };
  const reviewed = attachCoachReview(original, 0, 1, original.turns[0].answer, feedback);
  const rewritten = saveFinalAnswer(reviseTurn(reviewed, 0, "新回答：检索、生成与质量评测需要分开。"), 0, "本人最终答案：使用检索增强生成并评估局限。");
  assert.equal(currentCoachReview(rewritten.turns[0]), undefined);
  assert.equal(rewritten.turns[0].coachReviews?.length, 1);
  assert.throws(() => attachCoachReview(rewritten, 0, 1, original.turns[0].answer, feedback), /版本/);
  const latest = attachCoachReview(rewritten, 0, 2, rewritten.turns[0].revisions![0].answer, { ...feedback, strengths: ["新回答提到评测"] });
  assert.equal(currentCoachReview(latest.turns[0])?.feedback.strengths[0], "新回答提到评测");
  assert.equal(latest.turns[0].answer, "原回答：检索知识并交给模型生成。");
  assert.equal(latest.turns[0].finalAnswer, "本人最终答案：使用检索增强生成并评估局限。");
  assert.equal(latest.turns[0].coachReviews?.[0].feedback.strengths[0], "说明了检索");
  assert.throws(() => attachCoachReview(latest, 0, 2, latest.turns[0].revisions![0].answer, feedback), /已有/);
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const previousStorage = globalThis.localStorage;
  try {
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    saveHistory(latest);
    assert.equal(currentCoachReview(loadHistory()[0].turns[0])?.answerVersion, 2);
    assert.equal(parseBackup(exportBackup(storage)).history[0].turns[0].coachReviews?.length, 2);
  } finally { Object.defineProperty(globalThis, "localStorage", { value: previousStorage, configurable: true }); }
  // Legacy association is unknown: never reinterpret it as a current review.
  assert.equal(currentCoachReview({ ...original.turns[0], aiCoach: feedback }), undefined);
});

test("经历题保留职责指导，但假设方案不当作已完成的行动或成果", () => {
  const hypothetical = evaluateEvidence("如果由我负责，我会设计需求访谈，预期交付需求报告。", experience, preparation);
  assert.equal(hypothetical.observations?.find(item => item.id === "action")?.status, "missing");
  assert.equal(hypothetical.observations?.find(item => item.id === "result")?.status, "missing");
  assert.match(hypothetical.referenceAnswer, /假设/);
  const actual = evaluateEvidence("我负责需求访谈，产出需求清单，但没有负责上线。", experience, preparation);
  assert.equal(actual.observations?.find(item => item.id === "action")?.status, "provided");
  assert.equal(actual.observations?.find(item => item.id === "result")?.status, "provided");
});
