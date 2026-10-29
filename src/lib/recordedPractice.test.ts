import assert from "node:assert/strict";
import test from "node:test";
import { buildLibraryQuestions, createRecordedQuestion, emptyQuestionLibrary, loadQuestionLibrary, recordedPracticeQuestion, saveQuestionLibrary, validQuestionLibrary, QUESTION_LIBRARY_KEY } from "./questionLibrary";
import { questionSourceLabel } from "./questionSource";
import { buildInterviewContext } from "./interviewContext";
import { emptyUserProfile } from "./profileStorage";
import { trustedPreparation } from "./trustedPreparation";
import { nextTurn, startSession } from "./interview";
import { reviseTurn, saveFinalAnswer } from "./coaching";
import type { StorageLike } from "./projectStorage";
import { loadProjects, saveProject } from "./projectStorage";
import { createInterviewProject, updateProjectFromSession } from "./projects";
import { exportBackup, importBackup, parseBackup } from "./backup";

function memory(): StorageLike { const items = new Map<string, string>(); return { getItem: key => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); }, removeItem: key => { items.delete(key); } }; }

test("手录真实题读回本人保存思路并精确定位主回答，追问/重答不会替换原答", () => {
  const item = createRecordedQuestion("请介绍一次需求访谈与本人职责。"), storage = memory();
  saveQuestionLibrary({ ...emptyQuestionLibrary(), recordedQuestions: [item] }, storage);
  const state = loadQuestionLibrary(storage);
  const prep = trustedPreparation(buildInterviewContext({ profile: emptyUserProfile() }), [recordedPracticeQuestion(state.recordedQuestions![0], [])]);
  let session = nextTurn(startSession(prep), "原答：本人访谈客户并整理需求清单。", { action: "follow_up", followUpQuestion: "你的职责边界是什么？" });
  session = nextTurn(session, "追问原答：没有负责模型研发或上线。", { action: "next" });
  session = reviseTurn(session, 0, "重答：只说明本人负责的访谈与需求清单。");
  session = saveFinalAnswer(session, 0, "成熟思路：先说明职责，再说明需求清单和边界。");
  session = saveFinalAnswer(session, 1, "追问思路：不补写未确认的团队职责。");
  const entry = buildLibraryQuestions([], [session], state).find(entry => entry.recordedQuestionId === item.id)!;
  assert.deepEqual([entry.originalAnswer, entry.finalAnswer, entry.answerStatus, entry.turnIndex, entry.sessionId], ["原答：本人访谈客户并整理需求清单。", "成熟思路：先说明职责，再说明需求清单和边界。", "final", 0, session.id]);
  assert.equal(entry.sourceType, "user_recorded");
  assert.equal(buildLibraryQuestions([], [session], state).filter(entry => entry.questionId === item.id).length, 1);
  assert.equal(session.turns[0].revisions![0].answer, "重答：只说明本人负责的访谈与需求清单。");
});

test("真实题原文/ID读回，空白超长及重复ID拒绝，写入失败不覆盖既有题库", () => {
  const storage = memory(), item = createRecordedQuestion("  如何开展客户访谈？\n保留这一行。  ");
  assert.equal(validQuestionLibrary(emptyQuestionLibrary()), true);
  assert.throws(() => createRecordedQuestion("  \n "), /请输入/);
  assert.throws(() => createRecordedQuestion("题".repeat(601)), /最多600/);
  const state = { ...emptyQuestionLibrary(), recordedQuestions: [item] };
  saveQuestionLibrary(state, storage);
  assert.equal(loadQuestionLibrary(storage).recordedQuestions![0].question, "  如何开展客户访谈？\n保留这一行。  ");
  assert.equal(loadQuestionLibrary(storage).recordedQuestions![0].id, item.id);
  assert.throws(() => saveQuestionLibrary({ ...state, recordedQuestions: [item, item] }, storage), /无效/);
  const before = storage.getItem(QUESTION_LIBRARY_KEY);
  assert.throws(() => saveQuestionLibrary({ ...state, recordedQuestions: [...state.recordedQuestions, createRecordedQuestion("新的真实问题？")] }, { ...storage, setItem: () => { throw new Error("匿名题库配额失败"); } }), /配额失败/);
  assert.equal(storage.getItem(QUESTION_LIBRARY_KEY), before);
});

test("两岗位同问句具有独立身份与思路；未关联或已删岗位不伪造来源，四类题源分开", () => {
  const profile = emptyUserProfile(), prep = trustedPreparation(buildInterviewContext({ profile }), []);
  const input = { company: "匿名", jobTitle: "岗位", jobDescription: "", candidateBackground: "", concerns: "" };
  const a = { ...createInterviewProject(input, prep), id: "job-A" }, b = { ...createInterviewProject(input, prep), id: "job-B" };
  const qa = createRecordedQuestion("如何开展客户访谈？", a.id), qb = createRecordedQuestion("如何开展客户访谈？", b.id), solo = createRecordedQuestion("独立真实问题？");
  assert.notEqual(qa.id, qb.id);
  const aPrep = trustedPreparation(buildInterviewContext({ profile, project: a }), [recordedPracticeQuestion(qa, [a, b])]);
  const answered = saveFinalAnswer(nextTurn(startSession(aPrep), "A原答：我负责访谈。", { action: "next" }), 0, "A确认思路：只说明本人负责部分。");
  const activeA = { ...createInterviewProject(input, aPrep), id: a.id };
  const entries = buildLibraryQuestions([updateProjectFromSession(activeA, answered), b], [], { ...emptyQuestionLibrary(), recordedQuestions: [qa, qb, solo] });
  assert.equal(entries.find(item => item.recordedQuestionId === qa.id)!.finalAnswer, "A确认思路：只说明本人负责部分。");
  assert.equal(entries.find(item => item.recordedQuestionId === qb.id)!.finalAnswer, "");
  assert.equal(entries.find(item => item.recordedQuestionId === qb.id)!.associatedProjectId, "job-B");
  assert.match(recordedPracticeQuestion(solo, [a, b]).source, /未关联岗位/);
  assert.match(recordedPracticeQuestion(qa, [b]).source, /原关联岗位不可用/);
  assert.deepEqual(["user_recorded", "analysis_recommendation", "third_party", "foundation"].map(sourceType => questionSourceLabel({ sourceType })), ["本人记录的真实面试问题", "AI 分析推荐", "第三方面经", "内置基础题"]);
  assert.deepEqual(buildInterviewContext({ profile, currentQuestion: "我落地了20个AI项目吗？" }).confirmedUserFacts, []);
});

test("真实题备份导入在题库写入失败时回滚已有资料，不产生半份导入数据", () => {
  const source = memory(), target = memory();
  saveQuestionLibrary({ ...emptyQuestionLibrary(), recordedQuestions: [createRecordedQuestion("备份中的匿名题目？")] }, source);
  saveQuestionLibrary({ ...emptyQuestionLibrary(), recordedQuestions: [createRecordedQuestion("原浏览器中的匿名题目？")] }, target);
  const keys = ["ai-interview-projects-v1", "ai-interview-prep-history-v1", "ai-interview-drafts-v1", "ai-interview-profile-v1", QUESTION_LIBRARY_KEY];
  const before = keys.map(key => target.getItem(key));
  let failed = false;
  assert.throws(() => importBackup(exportBackup(source), { ...target, setItem: (key, value) => { if (key === QUESTION_LIBRARY_KEY && !failed) { failed = true; throw new Error("匿名存储失败"); } target.setItem(key, value); } }), /已回滚/);
  assert.deepEqual(keys.map(key => target.getItem(key)), before);
  assert.equal(loadQuestionLibrary(target).recordedQuestions![0].question, "原浏览器中的匿名题目？");
});

test("新真实题随原备份保留，导入副本独立关联岗位/主问追问，旧备份不清掉现有题目", () => {
  const storage = memory(), profile = emptyUserProfile(), input = { company: "匿名企业", jobTitle: "匿名方案岗", jobDescription: "", candidateBackground: "", concerns: "" };
  const base = trustedPreparation(buildInterviewContext({ profile }), []);
  const project = createInterviewProject(input, base);
  const item = createRecordedQuestion("你如何进行客户需求访谈？", project.id);
  const prep = trustedPreparation(buildInterviewContext({ profile, project }), [recordedPracticeQuestion(item, [project])]);
  let session = nextTurn(startSession(prep), "本人访谈并形成清单。", { action: "follow_up", followUpQuestion: "职责边界是什么？" });
  session = nextTurn(session, "本人没有负责研发或上线。", { action: "next" });
  session = saveFinalAnswer(session, 0, "本人确认思路：职责、清单及责任边界。");
  saveProject(updateProjectFromSession(project, session), storage);
  storage.setItem("ai-interview-prep-history-v1", JSON.stringify([session]));
  saveQuestionLibrary({ ...emptyQuestionLibrary(), recordedQuestions: [item], favorites: [`recorded:${item.id}`] }, storage);
  const backup = exportBackup(storage); parseBackup(backup); importBackup(backup, storage);
  const state = loadQuestionLibrary(storage);
  assert.equal(state.recordedQuestions?.length, 2);
  const copy = state.recordedQuestions!.find(question => question.id !== item.id)!;
  assert.deepEqual(state.recordedQuestions![0], item);
  assert.equal(copy.question, "你如何进行客户需求访谈？");
  const imported = loadProjects(storage).find(value => value.id !== project.id)!;
  assert.equal(copy.projectId, imported.id);
  assert.equal(imported.session!.preparation.questions[0].id, copy.id);
  assert.equal(imported.session!.turns[0].questionId, copy.id);
  assert.equal(imported.session!.turns[1].questionId, `${copy.id}-followup`);
  assert.equal(imported.session!.turns[0].finalAnswer, "本人确认思路：职责、清单及责任边界。");
  assert.ok(state.favorites.includes(`recorded:${copy.id}`));
  assert.equal(JSON.stringify(loadProjects(storage).find(value => value.id === project.id)!.session), JSON.stringify(session));
  importBackup(JSON.stringify({ format: "ai-interview-prep-backup", version: 3, exportedAt: "2026-10-19T00:00:00.000Z", projects: [], history: [], drafts: {}, profile, library: emptyQuestionLibrary() }), storage);
  assert.equal(loadQuestionLibrary(storage).recordedQuestions?.length, 2);
});
