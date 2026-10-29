import assert from "node:assert/strict";
import test from "node:test";
import { analysisPracticeOrigin, analysisPracticeQuestion } from "./analysisPractice";
import { createInterviewProject, toProjectQuestion, updateProjectFromSession } from "./projects";
import { createPreparation, nextTurn, startSession } from "./interview";
import { trustedPreparation } from "./trustedPreparation";
import { buildInterviewContext } from "./interviewContext";
import { emptyUserProfile } from "./profileStorage";
import { loadProjects, saveProject } from "./projectStorage";
import { buildLibraryQuestions, emptyQuestionLibrary } from "./questionLibrary";
import { questionSourceLabel } from "./questionSource";
import { exportBackup, importBackup } from "./backup";
import { coachInterviewAnswer } from "../services/modelClient";
import { readFileSync } from "node:fs";

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const input = { company: "匿名", jobTitle: "需求岗位", jobDescription: "需要AI项目经验，不代表用户拥有。", candidateBackground: "旧线索不是确认事实。", concerns: "" };
const exact = " 请说明一次真实需求访谈经历；\n如何界定本人职责？ ";
function fixture(id = "job-A") {
  return { ...createInterviewProject(input, createPreparation("", input.jobDescription)), id, aiAnalyses: [{ id: "analysis-A", generatedAt: "2026-10-18T00:00:00.000Z", rows: [
    { requirement: "需求访谈", status: "unknown" as const, evidenceQuote: "", reason: "", studyTopic: "", practiceQuestion: exact },
    { requirement: "无推荐", status: "unknown" as const, evidenceQuote: "", reason: "", studyTopic: "", practiceQuestion: " " },
  ] }] };
}
const selection = { projectId: "job-A", analysisId: "analysis-A", rowIndex: 0 };

test("推荐题保留整段原文和稳定来源，各岗位/分析/行不串ID且不重写原项目", () => {
  const project = fixture(), before = JSON.stringify(project);
  const question = analysisPracticeQuestion(project, selection);
  assert.equal(question.text, exact);
  assert.equal(question.id, "analysis:job-A:analysis-A:0");
  assert.equal(questionSourceLabel(question), "AI 分析推荐");
  assert.match(question.source, /非企业面试原题[\s\S]*job-A[\s\S]*analysis-A[\s\S]*分析依据未知/);
  assert.deepEqual(analysisPracticeOrigin(question), selection);
  assert.equal(analysisPracticeQuestion(project, selection).id, question.id);
  const other = analysisPracticeQuestion(fixture("job-B"), { ...selection, projectId: "job-B" });
  assert.notEqual(other.id, question.id);
  const another = { ...project, aiAnalyses: [{ ...project.aiAnalyses[0], id: "analysis-B" }] };
  assert.notEqual(analysisPracticeQuestion(another, { ...selection, analysisId: "analysis-B" }).id, question.id);
  assert.equal(JSON.stringify(project), before);
});

test("不存在/空问题/跨岗位引用均拒绝；旧ID和损坏的来源不被猜测为分析推荐", () => {
  for (const selected of [{ ...selection, projectId: "job-B" }, { ...selection, analysisId: "missing" }, ...[-1, 0.5, 1, 2, NaN].map(rowIndex => ({ ...selection, rowIndex }))]) {
    assert.throws(() => analysisPracticeQuestion(fixture(), selected), /不一致|不存在/);
  }
  for (const q of [undefined, { id: "old-id", sourceType: "analysis_recommendation" as const }, { id: "analysis:job-A:analysis-A:0", sourceType: "jd" as const }, { id: "analysis:%broken:analysis-A:0", sourceType: "analysis_recommendation" as const }]) assert.equal(analysisPracticeOrigin(q), null);
});

test("推荐题复用原会话/岗位读回、题库索引与备份副本；不迁移旧题ID或反推副本来源", () => {
  const project = fixture(), profile = emptyUserProfile();
  const question = analysisPracticeQuestion(project, selection);
  const prepared = trustedPreparation(buildInterviewContext({ project, profile }), [question]);
  const session = nextTurn(startSession(prepared), "本人只说明实际确认过的职责与行动。", { action: "next" });
  const value = updateProjectFromSession({ ...project, questions: [toProjectQuestion(question)], totalQuestions: 1 }, session);
  const storage = memory(); saveProject(value, storage);
  const restored = loadProjects(storage)[0];
  assert.equal(restored.session!.turns[0].question, exact);
  assert.equal(restored.preparation!.id, project.preparation!.id);
  const entry = buildLibraryQuestions([restored], [], emptyQuestionLibrary())[0];
  assert.equal(entry.originalAnswer, session.turns[0].answer);
  assert.equal(questionSourceLabel(entry), "AI 分析推荐");
  const target = memory(); importBackup(exportBackup(storage), target);
  const copied = loadProjects(target)[0];
  assert.notEqual(copied.id, restored.id);
  assert.equal(copied.session!.preparation.questions[0].id, question.id);
  assert.equal(analysisPracticeOrigin(copied.session!.preparation.questions[0])!.projectId, restored.id, "导入副本不猜测重映射旧来源，不能当作新岗位原分析入口");
  assert.deepEqual(copied.session!.turns[0], restored.session!.turns[0]);
});

test("推荐经历题仍通过P1-F边界，JD与模型的团队扩写不成为正式示例或个人事实", async () => {
  const project = fixture(), profile = emptyUserProfile();
  const context = buildInterviewContext({ project, profile, currentQuestion: exact, userAnswer: "我访谈客户，研发由同事负责，我没有负责模型研发或上线。" });
  const raw = JSON.parse(readFileSync(new URL("../../test-fixtures/public-coach/experience-semantic-expansion.json", import.meta.url), "utf8"));
  const bad = JSON.parse(raw.requests[0].body.content);
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ content: JSON.stringify(bad) }));
    const result = await coachInterviewAnswer(context, analysisPracticeQuestion(project, selection));
    assert.equal(result.optimizedExample, "");
    assert.doesNotMatch(result.answerStructure, /由同事负责/);
    assert.ok(!result.suggestions.some(item => item === bad.suggestions[0]));
    assert.deepEqual(context.confirmedUserFacts, []);
    assert.deepEqual(profile.experiences, []);
  } finally { globalThis.fetch = previous; }
});
