import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, nextTurn, startSession } from "./interview";
import { createInterviewProject, updateProjectFromSession } from "./projects";
import { buildLibraryQuestions, createReuseDraft, emptyQuestionLibrary, loadQuestionLibrary, saveQuestionLibrary, toggleLibraryFavorite } from "./questionLibrary";
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
