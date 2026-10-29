import assert from "node:assert/strict";
import test from "node:test";
import type { InterviewProject, UserProfile } from "../../lib/domain";
import { confirmedExperienceText, jobRequirementText, thirdPartyInterviewNotes } from "./EvidenceAnalysis";

const project = { jobDescription: "要求具备 RAG 与项目协作经验。", materials: [{ id: "jd", kind: "job_description", title: "补充 JD", content: "要求负责客户沟通。", source: "manual_text", reviewedAt: "2026-10-11T00:00:00.000Z", createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" }, { id: "note", kind: "interview_experience", title: "他人记录", content: "可能会问技术细节。", category: "technical", source: "manual_text", reviewedAt: "2026-10-11T00:00:00.000Z", createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" }] } as unknown as InterviewProject;
const profile = { experiences: [{ id: "confirmed", title: "本人项目", situation: "客户场景", action: "本人负责方案", result: "交付文档", reflection: "补充指标", confirmed: true, createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" }, { id: "draft", title: "草稿", situation: "", action: "不应出现", result: "", reflection: "", confirmed: false, createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" }] } as unknown as UserProfile;

test("可信分析只汇总已确认经历，且将 JD 与第三方面经分开", () => {
  const evidence = confirmedExperienceText(profile);
  assert.match(evidence, /本人负责方案/);
  assert.doesNotMatch(evidence, /不应出现/);
  assert.match(jobRequirementText(project), /客户沟通/);
  assert.equal(thirdPartyInterviewNotes(project)[0].title, "他人记录");
});
