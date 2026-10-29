import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewProject } from "./domain";
import { buildInterviewContext, contextForPrompt } from "./interviewContext";
import { emptyUserProfile } from "./profileStorage";
import { coachAnswerMode } from "./modelPrompts";
import { selectLocalQuestions, trustedQuestionCandidates, trustedPreparation } from "./trustedPreparation";

const now = "2026-10-12T00:00:00.000Z";
const profile = emptyUserProfile(new Date(now));
profile.experiences = [
  { id: "self", title: "本人项目", situation: "客户需求", action: "我负责需求调研", result: "形成方案文档", reflection: "未负责模型训练", confirmed: true, createdAt: now, updatedAt: now },
  { id: "draft", title: "未确认经历", situation: "", action: "我完成 50 个项目", result: "", reflection: "", confirmed: false, createdAt: now, updatedAt: now },
];
const project = { id: "job-1", jobTitle: "AI 解决方案工程师", jobDescription: "需要 3 年 AI 项目经验。要求理解 RAG。", materials: [
  { id: "third", kind: "interview_experience", title: "他人面经", content: "我上一家公司落地了 20 个 AI 项目。如何评估 RAG？", source: "manual_text", reviewedAt: now, createdAt: now, updatedAt: now },
  { id: "draft-jd", kind: "job_description", title: "未核对 JD", content: "需要 10 年算法经验。", source: "manual_text", createdAt: now, updatedAt: now },
] } as unknown as InterviewProject;

test("Context Builder 严格隔离已确认事实、JD、面经与未核对资料", () => {
  const context = buildInterviewContext({ project, profile });
  assert.match(context.confirmedUserFacts.join(""), /我负责需求调研/);
  assert.doesNotMatch(context.confirmedUserFacts.join(""), /50 个|3 年|20 个/);
  assert.match(context.targetJob.jd, /3 年 AI 项目经验/);
  assert.doesNotMatch(context.targetJob.jd, /10 年/);
  assert.match(context.thirdPartyInterviewMaterials[0].text, /20 个 AI 项目/);
  assert.match(contextForPrompt(context), /第三方面经_绝非当前用户经历/);
});

test("新训练准备只使用确认型经历，面经问题标为第三方来源", () => {
  const context = buildInterviewContext({ project, profile });
  const candidates = trustedQuestionCandidates(context);
  assert.ok(candidates.some(item => item.sourceType === "third_party" && item.text.includes("评估 RAG")));
  const prepared = trustedPreparation(context, candidates.slice(0, 6));
  assert.doesNotMatch(prepared.resume.raw, /20 个|50 个|3 年/);
  assert.match(prepared.job.raw, /3 年 AI 项目经验/);
});

test("没有 JD 也能从内置题库进行独立训练", () => {
  const context = buildInterviewContext({ profile });
  const questions = trustedQuestionCandidates(context);
  assert.ok(questions.length > 0 && questions.every(item => item.sourceType === "foundation"));
});

test("JD 推导题是自然的知识或场景提问，不拼接条款并强迫真实项目", () => {
  const context = buildInterviewContext({ project: { ...project, jobDescription: "3、持续关注大模型、多模态生成及智能剪辑技术的发展，理解技术应用。" }, profile });
  const questions = trustedQuestionCandidates(context).filter(item => item.sourceType === "jd");
  assert.ok(questions.length > 0);
  assert.match(questions[0].text, /如何.*比较|如何.*选择/);
  for (const question of questions) {
    assert.doesNotMatch(question.text, /针对「|满足岗位要求：|结合一个真实项目|3、持续关注/);
    assert.equal(question.sourceType, "jd");
  }
  assert.match(questions[0].source, /多模态/);
});

test("岗位训练复用已确认经历提问，不把 JD、候选经历或第三方成果当本人经历", () => {
  const candidates = trustedQuestionCandidates(buildInterviewContext({ project, profile }));
  const personal = selectLocalQuestions(candidates).filter(item => item.sourceType === "resume");
  assert.ok(personal.length > 0);
  assert.match(personal.map(item => item.source).join(""), /我负责需求调研/);
  assert.doesNotMatch(personal.map(item => item.text + item.source).join(""), /50 个|20 个|3 年/);
});

test("新的 JD 知识与场景题沿用原教练分流，不误标为本人真实经历题", () => {
  const context = buildInterviewContext({ project, profile });
  const questions = trustedQuestionCandidates(context).filter(item => item.sourceType === "jd");
  for (const question of questions) assert.notEqual(coachAnswerMode(context, question), "experience", question.text);
  const personal = trustedQuestionCandidates(context).find(item => item.sourceType === "resume")!;
  assert.equal(coachAnswerMode(context, personal), "experience");
});
