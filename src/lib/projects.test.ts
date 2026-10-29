import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, nextTurn, startSession } from "./interview";
import { createInterviewProject, editInterviewProject, updateProjectFromSession, validateInterviewProject } from "./projects";
import { validJobMaterial, validProject } from "./validation";

const input = {
  company: "  星云科技  ",
  jobTitle: "  AI 产品经理  ",
  jobDescription: "负责 AI 产品规划、需求分析和数据指标设计，要求有跨团队协作经验。",
  candidateBackground: "有三年 ToB 售前与解决方案经验，参与过企业知识库项目。",
  concerns: "担心被追问产品指标。",
};

test("创建面试只强制岗位名称和 JD", () => {
  assert.deepEqual(validateInterviewProject({ ...input, company: "", candidateBackground: "", concerns: "" }), {});
  assert.deepEqual(validateInterviewProject({ ...input, jobTitle: "", jobDescription: "" }), {
    jobTitle: "请填写目标岗位名称。",
    jobDescription: "请粘贴目标岗位 JD。",
  });
});

test("项目保存结构化输入和可延展的问题字段", () => {
  const preparation = createPreparation(input.candidateBackground, input.jobDescription);
  const project = createInterviewProject(input, preparation, new Date("2026-09-18T10:00:00.000Z"));
  assert.equal(project.company, "星云科技");
  assert.equal(project.jobTitle, "AI 产品经理");
  assert.equal(project.totalQuestions, Math.min(preparation.questions.length, 6));
  assert.equal(project.questions[0].status, "unanswered");
  assert.ok(project.questions[0].answerGuide.length > 0);
});

test("练习后更新项目进度和最后练习时间", () => {
  const preparation = createPreparation(input.candidateBackground, input.jobDescription);
  const project = createInterviewProject(input, preparation);
  const session = nextTurn(startSession(preparation), "我负责知识库项目需求调研，并与算法和交付团队协作完成方案验证。", { action: "next" });
  const updated = updateProjectFromSession(project, session, new Date("2026-09-18T12:00:00.000Z"));
  assert.equal(updated.status, "practicing");
  assert.equal(updated.completedQuestions, 1);
  assert.notEqual(updated.questions[0].status, "unanswered");
  assert.equal(updated.lastPracticedAt, "2026-09-18T12:00:00.000Z");
});

test("只开始训练不会伪造最后练习时间", () => {
  const preparation = createPreparation(input.candidateBackground, input.jobDescription);
  const project = createInterviewProject(input, preparation);
  const updated = updateProjectFromSession(project, startSession(preparation), new Date("2026-09-18T12:00:00.000Z"));
  assert.equal(updated.status, "practicing");
  assert.equal(updated.completedQuestions, 0);
  assert.equal(updated.lastPracticedAt, null);
});

test("岗位资料保留来源边界，且旧项目无需材料字段仍兼容", () => {
  const preparation = createPreparation(input.candidateBackground, input.jobDescription);
  const project = createInterviewProject(input, preparation);
  assert.equal(validProject(project), true);
  const material = { id: "material-1", kind: "interview_experience", title: "他人面经", content: "候选人记录", category: "technical", source: "screenshot", sourceFileName: "note.png", sourceMimeType: "image/png", sourceDataUrl: "data:image/png;base64,AA==", createdAt: project.createdAt, updatedAt: project.updatedAt } as const;
  assert.equal(validJobMaterial(material), true);
  assert.equal(validProject({ ...project, materials: [material] }), true);
  assert.equal(validJobMaterial({ ...material, sourceDataUrl: "https://example.com/source.png" }), false);
});

test("编辑岗位元数据不创建新 ID，也不丢失原资料、答案和训练会话", () => {
  const preparation = createPreparation(input.candidateBackground, input.jobDescription);
  const created = createInterviewProject(input, preparation);
  const session = nextTurn(startSession(preparation), "我负责已确认的需求调研和方案推进。", { action: "next" });
  const original = { ...updateProjectFromSession(created, session), materials: [{ id: "material-1", kind: "job_description" as const, title: "已核对 JD", content: "需要产品经验", source: "manual_text" as const, createdAt: created.createdAt, updatedAt: created.updatedAt }] };
  const edited = editInterviewProject(original, { ...input, jobTitle: "新版 AI 产品经理" }, new Date("2026-10-12T12:00:00.000Z"));
  assert.equal(edited.id, original.id);
  assert.equal(edited.createdAt, original.createdAt);
  assert.deepEqual(edited.materials, original.materials);
  assert.deepEqual(edited.session, original.session);
  assert.deepEqual(edited.questions, original.questions);
  assert.equal(edited.jobTitle, "新版 AI 产品经理");
  assert.equal(validProject(edited), true);
});
