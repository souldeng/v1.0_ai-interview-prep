import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceTasks, createEvidencePreparation, evidenceQuestions, getSprintTasks, isEvidenceReady, renderPreparationBrief } from "./careerPlan";
import { createPreparation, finishSession, nextTurn, startSession } from "./interview";
import { createInterviewProject, toProjectQuestion, updateProjectFromSession } from "./projects";

const input = { company: "测试公司", jobTitle: "AI 产品经理", jobDescription: "负责需求调研；理解 RAG 与大模型；负责模型评测与指标；推进 POC 交付；协作研发团队。", candidateBackground: "我负责客户需求调研，完成访谈纪要。熟悉 RAG。", concerns: "担心没有正式产品经理经历。" };
const create = () => createInterviewProject(input, createPreparation(input.candidateBackground, input.jobDescription));

test("岗位证据来自原文，空背景不伪造优势，未提及主题不冒充 JD 要求", () => {
  const tasks = buildEvidenceTasks(input);
  for (const task of tasks.filter(task => task.kind === "job")) {
    assert.ok(input.jobDescription.includes(task.requirement));
    assert.ok(!task.background || input.candidateBackground.includes(task.background));
  }
  assert.equal(tasks[0].kind, "concern");
  assert.equal(tasks.find(task => task.id === "ai")?.background, "熟悉 RAG");
  assert.ok(buildEvidenceTasks({ ...input, candidateBackground: "" }).every(task => !task.background));
  assert.deepEqual(buildEvidenceTasks({ ...input, concerns: "", jobDescription: "负责需求调研" }).map(task => task.id), ["discovery"]);
});

test("准备时间控制待补清单，确认需要完整的本人材料", () => {
  const project = create();
  const tasks = buildEvidenceTasks(project);
  assert.equal(getSprintTasks(tasks, {}, 30).length, 2);
  assert.equal(getSprintTasks(tasks, {}, 60).length, 4);
  const complete = { action: "访谈", result: "纪要", reflection: "未负责研发", confirmed: true, updatedAt: "2026-09-18T00:00:00Z" };
  assert.equal(isEvidenceReady({ ...complete, result: " " }), false);
  assert.equal(getSprintTasks(tasks, { [tasks[0].id]: complete }, 30).some(task => task.id === tasks[0].id), false);
});

test("单卡三题专项可完成复盘，进度不会把追问重复计数", () => {
  let project = create();
  const task = buildEvidenceTasks(project)[0];
  const preparation = createEvidencePreparation(project, [task]);
  project = { ...project, questions: preparation.questions.map(toProjectQuestion), totalQuestions: 3 };
  let session = startSession(preparation);
  assert.equal(session.questions.length, 3);
  session = nextTurn(session, "我暂时没有这项经历。", { action: "follow_up", followUpQuestion: "准备怎么补足？" });
  project = updateProjectFromSession(project, session);
  assert.equal(project.completedQuestions, 1);
  while (session.status === "active") session = nextTurn(session, "我完成了访谈纪要，尚未负责研发，接下来会如实补足产品分析实践。", { action: "next" });
  project = updateProjectFromSession(project, session);
  assert.equal(project.completedQuestions, 3);
  assert.equal(project.totalQuestions, 3);
  assert.ok(finishSession(session).overall);
});

test("摘要不填造缺失经历；专项上下文携带本人补充与核验边界", () => {
  const project = create();
  const task = buildEvidenceTasks(project).find(task => task.id === "ai")!;
  project.evidenceNotes = { ai: { action: "阅读材料并搭建个人 Demo", result: "仅有本地演示", reflection: "没有生产上线经验", confirmed: true, updatedAt: "2026-09-18T00:00:00Z" } };
  const preparation = createEvidencePreparation(project, [task]);
  assert.match(preparation.resume.evidence.join(""), /没有生产上线经验/);
  assert.match(preparation.resume.evidence.join(""), /未经外部核验/);
  const brief = renderPreparationBrief(project, buildEvidenceTasks(project));
  assert.match(brief, /待补充/);
  assert.match(brief, /非第三方核验/);
  assert.equal(evidenceQuestions(task).length, 3);
});
