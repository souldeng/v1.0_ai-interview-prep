import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, nextTurn, skipCurrentQuestion, startSession } from "./interview";
import { createInterviewProject, updateProjectFromSession } from "./projects";
import { buildTrainingRecords, trainingQuestionStates } from "./trainingRecords";
import { validPreparation } from "./validation";

const resume = "候选人负责企业知识库需求访谈，并用 Python 整理评测记录。";
const jd = "AI 产品经理，负责需求分析、RAG 方案与跨团队协作。";

function activeSession(id: string, createdAt: string) {
  const preparation = createPreparation(resume, jd);
  let session = { ...startSession(preparation), id, createdAt };
  session = nextTurn(session, "我负责访谈并整理评测记录。", { action: "next" });
  session = skipCurrentQuestion(session);
  return {
    ...session,
    turns: [{ ...session.turns[0], finalAnswer: "我先说明访谈目标，再说明评测记录。" }],
  };
}

test("岗位会话与 history 中的归档副本按会话 ID 去重，并保留岗位归属", () => {
  const session = activeSession("session-shared", "2026-11-08T10:00:00.000Z");
  const project = updateProjectFromSession(createInterviewProject({
    company: "匿名公司",
    jobTitle: "AI 产品经理",
    jobDescription: jd,
    candidateBackground: resume,
    concerns: "",
  }, session.preparation), session);
  const independent = activeSession("session-independent", "2026-11-07T10:00:00.000Z");

  const records = buildTrainingRecords([project], [session, independent]);

  assert.equal(records.length, 2);
  assert.equal(records[0].session.id, "session-shared");
  assert.equal(records[0].storage, "project");
  assert.equal(records[0].project?.id, project.id);
  assert.equal(records[1].storage, "history");
});

test("记录统计沿用训练口径，已回答、已跳过、未开始相加等于总题数", () => {
  const session = activeSession("session-progress", "2026-11-08T10:00:00.000Z");
  const [record] = buildTrainingRecords([], [session]);
  const states = trainingQuestionStates(record.session);

  assert.deepEqual(record.totals, { total: 6, answered: 1, skipped: 1, unfinished: 4, finalAnswers: 1 });
  assert.equal(states.filter(item => item.status === "answered").length, 1);
  assert.equal(states.filter(item => item.status === "skipped").length, 1);
  assert.equal(states.filter(item => item.status === "unstarted").length, 4);
  assert.equal(states.filter(item => item.status === "answered").length + states.filter(item => item.status === "skipped").length + states.filter(item => item.status === "unstarted").length, record.totals.total);
});

test("历史记录缺少跳过与最终答案字段时仍可显示，并且不会虚构点评", () => {
  const session = activeSession("session-legacy", "2026-11-06T10:00:00.000Z");
  const legacy = { ...session, skippedQuestionIds: undefined, turns: [{ ...session.turns[0], finalAnswer: undefined, coachReviews: undefined, aiCoach: undefined }] };
  const [record] = buildTrainingRecords([], [legacy]);
  const [first] = trainingQuestionStates(record.session);

  assert.equal(record.totals.skipped, 0);
  assert.equal(record.totals.finalAnswers, 0);
  assert.equal(first.coachFeedback, undefined);
  assert.equal(first.finalAnswer, undefined);
});

test("AI 预测题独立训练在记录中保持预测来源，不归类为本人真实面经", () => {
  const preparation = createPreparation("", "");
  const question = { ...preparation.questions[0], id: "prediction-1", text: "如何说明检索评测的边界？", sourceType: "ai_prediction" as const, source: "AI 预测题；仅供练习。" };
  const session = startSession({ ...preparation, job: { ...preparation.job, title: "AI 预测题练习" }, questions: [question] }, 1);
  const [record] = buildTrainingRecords([], [session]);
  assert.equal(record.kind, "AI 预测题练习");
  assert.equal(record.sourceLabel, "AI 预测题");
});

test("逐题复盘只读取同一轮已保存的回答、点评、重答与最终答案，并保留实际恢复位置", () => {
  const session = activeSession("session-review", "2026-11-08T10:00:00.000Z");
  const feedback = {
    strengths: ["结构清楚"], issues: ["补充验证方式"], factRisks: [], suggestions: ["说明边界"],
    answerStructure: "先背景后行动", studyTopics: [], optimizedExample: "仅作表达参考", generatedAt: "2026-11-08T11:00:00.000Z",
  };
  const reviewed = {
    ...session,
    turns: [{ ...session.turns[0], revisions: [{ answer: "这是本轮重答", score: session.turns[0].score, createdAt: "2026-11-08T10:30:00.000Z" }], finalAnswer: "这是本轮最终答案", finalAnswerUpdatedAt: "2026-11-08T10:31:00.000Z", coachReviews: [{ answerVersion: 2, answer: "这是本轮重答", feedback }] }],
  };
  const [record] = buildTrainingRecords([], [reviewed]);
  const [first] = trainingQuestionStates(record.session);

  assert.equal(record.session.currentQuestionIndex, 2);
  assert.equal(first.turns[0].answer, "我负责访谈并整理评测记录。");
  assert.equal(first.turns[0].revisions?.[0].answer, "这是本轮重答");
  assert.equal(first.finalAnswer, "这是本轮最终答案");
  assert.deepEqual(first.coachFeedback, feedback);
});

test("同岗位多题训练保留结构化岗位归属，未关联与混合岗位不强行归属", () => {
  const preparation = createPreparation("", "");
  const question = { ...preparation.questions[0], id: "prediction-owned", text: "请说明政府事务岗位的项目推进方式。", sourceType: "ai_prediction" as const, source: "AI 预测题；仅供练习。" };
  const owned = startSession({ ...preparation, job: { ...preparation.job, title: "AI 预测题练习", projectId: "project-gov", projectName: "政府事务" }, questions: [question] }, 1);
  const [record] = buildTrainingRecords([], [owned]);
  assert.equal(record.storage, "history");
  assert.deepEqual(record.job, { projectId: "project-gov", name: "政府事务" });
  assert.equal(record.sourceLabel, "岗位专项 · 政府事务");
  // 无岗位归属的独立训练保持原分类，不因本次改动被强行归到某个岗位。
  const plain = startSession({ ...preparation, job: { ...preparation.job, title: "AI 预测题练习" }, questions: [question] }, 1);
  const [plainRecord] = buildTrainingRecords([], [plain]);
  assert.equal(plainRecord.job, undefined);
  assert.equal(plainRecord.sourceLabel, "AI 预测题");
});

test("岗位归属字段必须成对存在，只有一半的准备数据不被接受", () => {
  const preparation = createPreparation(resume, jd);
  assert.equal(validPreparation({ ...preparation, job: { ...preparation.job, projectId: "project-gov" } }), false);
  assert.equal(validPreparation({ ...preparation, job: { ...preparation.job, projectName: "政府事务" } }), false);
  assert.equal(validPreparation({ ...preparation, job: { ...preparation.job, projectId: "project-gov", projectName: "政府事务" } }), true);
});
