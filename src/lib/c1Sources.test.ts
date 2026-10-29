import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, nextTurn, startSession } from "./interview";
import { createInterviewProject, updateProjectFromSession } from "./projects";
import { buildLibraryQuestions, emptyQuestionLibrary } from "./questionLibrary";
import { questionSourceLabel } from "./questionSource";

test("旧主题与重复追问ID按已保存来源呈现，不猜测旧追问且不改写原记录", () => {
  const input = { company: "匿名企业", jobTitle: "匿名岗位", jobDescription: "需求分析", candidateBackground: "本人访谈", concerns: "" };
  const prep = createPreparation(input.candidateBackground, input.jobDescription);
  prep.questions = [{ ...prep.questions[0], id: "source-main", text: "主问题", sourceType: "foundation", source: "内置学习题" }];
  let session = nextTurn(startSession(prep), "本人原回答：需求分析。", { action: "follow_up", followUpQuestion: "旧追问一" });
  session = { ...session, turns: [...session.turns, { ...session.turns[0], questionId: "source-main-followup", question: "旧追问一", answer: "旧追问原答", followedUp: false }] };
  session = { ...session, questions: [{ ...session.questions[0], text: "当前追问二", sourceType: "ai_follow_up", source: "AI 基于本轮回答的追问" }], turns: [...session.turns, { ...session.turns[1], question: "当前追问二", answer: "当前追问原答" }] };
  const project = updateProjectFromSession(createInterviewProject(input, prep), session);
  const before = JSON.stringify(project);
  const entries = buildLibraryQuestions([project], [], emptyQuestionLibrary());
  assert.equal(questionSourceLabel(entries.find(q => q.question === "主问题")!), "内置基础题");
  assert.equal(questionSourceLabel(entries.find(q => q.question === "旧追问一")!), "来源未确认");
  assert.equal(questionSourceLabel(entries.find(q => q.question === "当前追问二")!), "AI 追问");
  assert.equal(new Set(entries.map(q => q.key)).size, entries.length);
  assert.equal(JSON.stringify(project), before);
});
