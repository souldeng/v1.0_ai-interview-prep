import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, nextTurn, startSession } from "./interview";
import { createInterviewProject, toProjectQuestion, updateProjectFromSession } from "./projects";
import { buildLibraryQuestions, createJobRecommendedQuestion, createReuseDraft, deleteExperienceSet, deleteJobRecommendedQuestion, deleteRecordedQuestion, deleteResumeSet, emptyQuestionLibrary, loadQuestionLibrary, saveQuestionLibrary, toggleLibraryFavorite, validQuestionLibrary } from "./questionLibrary";
import type { QuestionLibraryState } from "./questionLibrary";
import type { StorageLike } from "./projectStorage";
import { saveFinalAnswer } from "./coaching";
import { loadProjects, saveProject } from "./projectStorage";
import { questionExportLines } from "./interviewExport";

function memory(): StorageLike { const map = new Map<string, string>(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); } }; }
function project(id: string, title: string) {
  const input = { company: "测试公司", jobTitle: title, jobDescription: "要求 RAG 与项目协作。", candidateBackground: "我负责需求访谈。", concerns: "" };
  const prep = createPreparation(input.candidateBackground, input.jobDescription);
  return { project: { ...createInterviewProject(input, prep), id }, prep };
}

test("跨岗位题目按稳定岗位与题目 ID 索引，不会把相似题覆盖", () => {
  const first = project("job-a", "岗位 A"); const second = project("job-b", "岗位 B");
  const questions = buildLibraryQuestions([first.project, second.project], [], emptyQuestionLibrary());
  assert.equal(questions.filter(item => item.questionId === first.project.questions[0].id).length, 2);
  assert.notEqual(questions[0].key, questions.find(item => item.projectId === "job-b")?.key);
});

test("原回答、最终确认答案和收藏保持分离", () => {
  const item = project("job-a", "岗位 A");
  let session = nextTurn(startSession(item.prep), "这是原回答，说明本人行动。", { action: "next" });
  const beforeFinal = buildLibraryQuestions([updateProjectFromSession(item.project, session)], [], emptyQuestionLibrary()).find(value => value.turnIndex === 0)!;
  assert.equal(beforeFinal.answerStatus, "answered"); assert.equal(beforeFinal.finalAnswer, "");
  session = saveFinalAnswer(session, 0, "这是用户确认的最终答案。");
  const updated = updateProjectFromSession(item.project, session);
  const entry = buildLibraryQuestions([updated], [], emptyQuestionLibrary()).find(value => value.turnIndex === 0)!;
  assert.equal(entry.originalAnswer, "这是原回答，说明本人行动。"); assert.equal(entry.finalAnswer, "这是用户确认的最终答案。"); assert.equal(entry.answerStatus, "final");
  const favorited = toggleLibraryFavorite(emptyQuestionLibrary(), entry.key);
  assert.equal(buildLibraryQuestions([updated], [], favorited).find(value => value.key === entry.key)?.favorite, true);
});

test("主问题加追问时，主卡仍读取主轮回答而不是追问", () => {
  const item = project("job-a", "岗位 A");
  let session = nextTurn(startSession(item.prep), "主轮原回答：我负责需求访谈。", { action: "follow_up", followUpQuestion: "追问：具体产物是什么？" });
  session = nextTurn(session, "追问原回答：产物是一份需求记录。", { action: "next" });
  session = saveFinalAnswer(session, 0, "主轮最终答案：我负责访谈和需求梳理。");
  session = saveFinalAnswer(session, 1, "追问最终答案：产物是需求记录。");
  const updated = updateProjectFromSession(item.project, session);
  const main = buildLibraryQuestions([updated], [], emptyQuestionLibrary()).find(entry => entry.questionId === session.turns[0].questionId)!;
  assert.deepEqual([main.originalAnswer, main.finalAnswer, main.turnIndex, updated.questions[0].userAnswer], [
    "主轮原回答：我负责需求访谈。", "主轮最终答案：我负责访谈和需求梳理。", 0, "主轮原回答：我负责需求访谈。",
  ]);
});

test("同一旧追问 ID 的多轮回答分别可索引、保存刷新和导出", () => {
  const item = project("job-a", "岗位 A");
  let session = nextTurn(startSession(item.prep), "主轮独立原回答：我负责访谈。", { action: "follow_up", followUpQuestion: "追问一：产物是什么？" });
  session = nextTurn(session, "追问一原回答：产物是需求记录。", { action: "next" });
  session = { ...session, turns: [...session.turns, { ...session.turns[1], question: "追问二：边界是什么？", answer: "追问二原回答：未承担研发。" }] };
  const snapshot = JSON.stringify(session);
  let entries = buildLibraryQuestions([updateProjectFromSession(item.project, session)], [], emptyQuestionLibrary()).filter(entry => entry.turnIndex !== undefined);
  assert.equal(new Set(entries.map(entry => entry.key)).size, 3);
  for (const entry of entries) session = saveFinalAnswer(session, entry.turnIndex!, ["主轮成熟思路：先说明本人访谈行动。", "追问一成熟思路：说明需求记录产物。", "追问二成熟思路：如实说明未承担研发。"][entry.turnIndex!]);
  const storage = memory(); saveProject(updateProjectFromSession(item.project, session), storage);
  entries = buildLibraryQuestions(loadProjects(storage), [], emptyQuestionLibrary()).filter(entry => entry.turnIndex !== undefined);
  // The library sorts by final-answer update time, not by training round.
  assert.deepEqual([0, 1, 2].map(index => entries.find(entry => entry.turnIndex === index)!.originalAnswer), ["主轮独立原回答：我负责访谈。", "追问一原回答：产物是需求记录。", "追问二原回答：未承担研发。"]);
  const secondFollowUp = entries.find(entry => entry.turnIndex === 2)!;
  assert.match(questionExportLines({ ...secondFollowUp, projectName: secondFollowUp.projectName }).join("\n"), /追问二成熟思路：如实说明未承担研发。/);
  assert.equal(JSON.parse(snapshot).turns[0].finalAnswer, undefined);
});

test("引用复制确认答案为独立目标草稿，存储刷新后可读回", () => {
  const first = project("job-a", "岗位 A"); const second = project("job-b", "岗位 B");
  let session = nextTurn(startSession(first.prep), "这是一段原回答。", { action: "next" }); session = saveFinalAnswer(session, 0, "这是来源岗位的最终确认答案。");
  const sourceProject = updateProjectFromSession(first.project, session);
  const entries = buildLibraryQuestions([sourceProject, second.project], [], emptyQuestionLibrary());
  const source = entries.find(item => item.projectId === "job-a" && item.finalAnswer)!; const target = entries.find(item => item.projectId === "job-b")!;
  const draft = createReuseDraft(source, target, new Date("2026-10-11T00:00:00.000Z"));
  const state = { ...emptyQuestionLibrary(), reuseDrafts: [draft] }; const storage = memory(); saveQuestionLibrary(state, storage);
  const restored = loadQuestionLibrary(storage); assert.equal(restored.reuseDrafts[0].answer, "这是来源岗位的最终确认答案。"); assert.equal(restored.reuseDrafts[0].targetProjectId, "job-b");
  assert.equal(buildLibraryQuestions([sourceProject, second.project], [], restored).find(item => item.projectId === "job-b")?.finalAnswer, "");
});

test("推荐题加入岗位专项题库：来源可追溯、训练后与训练记录合并且不产生重复条目", () => {
  const item = project("job-a", "岗位 A");
  const rec = createJobRecommendedQuestion("job-a", "analysis-1", 0, "推荐题：如何为一个虚构对话产品设计评测集？");
  assert.equal(rec.id.startsWith("jobrec-"), true);
  const state = { ...emptyQuestionLibrary(), jobRecommendedQuestions: [rec] };
  assert.equal(validQuestionLibrary(state), true);
  // 未训练时条目可见并归属岗位
  const before = buildLibraryQuestions([item.project], [], state).find(entry => entry.recommendedQuestionId === rec.id)!;
  assert.equal(before.projectId, "job-a");
  assert.equal(before.questionId, "analysis:job-a:analysis-1:0");
  assert.equal(before.answerStatus, "unanswered");
  assert.equal(before.sourceType, "analysis_recommendation");
  // 工厂拒绝非法输入
  assert.throws(() => createJobRecommendedQuestion("", "analysis-1", 0, "题"));
  assert.throws(() => createJobRecommendedQuestion("job-a", "analysis-1", 12, "题"));
  assert.throws(() => createJobRecommendedQuestion("job-a", "analysis-1", 0, "   "));
  assert.equal(validQuestionLibrary({ ...state, jobRecommendedQuestions: [{ ...rec, id: "bad-id" }] }), false);
  // 训练后：题库条目与训练记录合并为一条，原答/最终答案可读，不产生互不关联副本
  const question = { id: "analysis:job-a:analysis-1:0", text: "推荐题：如何为一个虚构对话产品设计评测集？", category: "方案与业务" as const, technical: false, sourceType: "analysis_recommendation" as const, source: "AI 岗位分析推荐（非企业面试原题）" };
  let session = startSession({ ...item.prep, questions: [question] });
  session = nextTurn(session, "训练原答：本人设计评测集并核对覆盖。", { action: "next" });
  session = saveFinalAnswer(session, 0, "训练最终答案：评测集覆盖三组场景。");
  const trainedProject = updateProjectFromSession({ ...item.project, questions: session.questions.map(toProjectQuestion), totalQuestions: 1 }, session);
  const entries = buildLibraryQuestions([trainedProject], [], state);
  const merged = entries.filter(entry => entry.questionId === "analysis:job-a:analysis-1:0");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].recommendedQuestionId, rec.id);
  assert.equal(merged[0].originalAnswer, "训练原答：本人设计评测集并核对覆盖。");
  assert.equal(merged[0].finalAnswer, "训练最终答案：评测集覆盖三组场景。");
  assert.equal(merged[0].answerStatus, "final");
});

test("删除题目/题组只移除题库索引与对应收藏，不牵连其它数据", () => {
  const rec = createJobRecommendedQuestion("job-a", "analysis-1", 0, "推荐题：如何设计评测集？");
  const now = "2026-11-12T00:00:00.000Z";
  const state = { ...emptyQuestionLibrary(),
    favorites: ["recorded:recorded-x", "recorded:recorded-y", `jobrec:${rec.id}`],
    recordedQuestions: [
      { id: "recorded-x", question: "本人题一", createdAt: now },
      { id: "recorded-y", question: "本人题二", createdAt: now },
    ],
    jobRecommendedQuestions: [rec],
    experienceSets: [{ id: "set-1", experienceId: "card-1", title: "专项一", contentVersion: "v1", createdAt: now, questions: [] }],
    resumeSets: [{ id: "rset-1", title: "简历题组", createdAt: now, contentVersion: "v1", sources: [], questions: [] }],
  } as unknown as QuestionLibraryState;
  const afterRec = deleteRecordedQuestion(state, "recorded-x");
  assert.equal(afterRec.recordedQuestions!.length, 1);
  assert.deepEqual(afterRec.favorites, ["recorded:recorded-y", `jobrec:${rec.id}`]);
  assert.equal(afterRec.jobRecommendedQuestions!.length, 1);
  assert.throws(() => deleteRecordedQuestion(afterRec, "recorded-x"));
  const afterJobRec = deleteJobRecommendedQuestion(afterRec, rec.id);
  assert.equal(afterJobRec.jobRecommendedQuestions, undefined);
  assert.equal(afterJobRec.favorites.includes(`jobrec:${rec.id}`), false);
  const afterExpSet = deleteExperienceSet(afterJobRec, "set-1");
  assert.equal(afterExpSet.experienceSets, undefined);
  const afterResumeSet = deleteResumeSet(afterExpSet, "rset-1");
  assert.equal(afterResumeSet.resumeSets, undefined);
  assert.equal(validQuestionLibrary(afterResumeSet), true);
  assert.throws(() => deleteResumeSet(afterResumeSet, "rset-1"));
  // 删除操作不触碰 reuseDrafts 等其它字段
  const withDraft = { ...afterResumeSet, reuseDrafts: [] };
  assert.deepEqual(deleteRecordedQuestion(withDraft, "recorded-y").reuseDrafts, []);
});

test("岗位多题训练的回答在题库中显示岗位并可按岗位筛选，最终答案仍写入独立记录", () => {
  const preparation = createPreparation("", "");
  const question = { ...preparation.questions[0], id: "recorded-gov-1", text: "请说明政府事务岗位的对外沟通策略。", sourceType: "ai_prediction" as const, source: "AI 预测题；仅供练习。" };
  const owned = { ...preparation, job: { ...preparation.job, title: "AI 预测题练习", projectId: "project-gov", projectName: "政府事务" }, questions: [question] };
  const session = nextTurn(startSession(owned, 1), "先说明沟通对象，再说明节奏。", { action: "next" });
  const entries = buildLibraryQuestions([], [session], emptyQuestionLibrary());
  const entry = entries.find(item => item.questionId === question.id)!;
  assert.equal(entry.projectName, "政府事务");
  assert.equal(entry.associatedProjectId, "project-gov");
  // 岗位归属只是显示与筛选依据，不伪造岗位会话 ID，最终答案仍写入独立历史。
  assert.equal(entry.projectId, null);
  assert.equal(entry.sessionId, session.id);
  const filtered = entries.filter(item => (item.associatedProjectId ?? item.projectId) === "project-gov");
  assert.equal(filtered.length, 1);
});
