import assert from "node:assert/strict";
import test from "node:test";
import { exportBackup, importBackup, MAX_BACKUP_BYTES, parseBackup } from "./backup";
import { createConfirmedResumePracticeSet, confirmedResumeVersion, isResumePracticeQuestionCurrent, setConfirmedResumeQuestionHidden } from "./confirmedResumePractice";
import type { ExperienceCard, Preparation, UserProfile } from "./domain";
import { emptyUserProfile, loadUserProfile, saveUserProfile } from "./profileStorage";
import { createPreparation, startSession } from "./interview";
import { createInterviewProject } from "./projects";
import { loadProjects } from "./projectStorage";
import { createImportSource, createRecordedQuestions, emptyQuestionLibrary, loadQuestionLibrary, saveQuestionLibrary } from "./questionLibrary";
import type { StorageLike } from "./projectStorage";

function memory(): StorageLike {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}

const now = "2026-11-03T00:00:00.000Z";
const card = (id: string, type: string, action: string, tools: string): ExperienceCard => ({ id, title: id === "work" ? "客户需求澄清" : "个人知识库原型", type, situation: id === "work" ? "客户需求描述不完整" : "练习知识库方案表达", action, tools, result: id === "work" ? "形成需求清单" : "保留检索对照记录", reflection: id === "work" ? "先确认问题边界" : "不把原型说成上线项目", confirmed: true, createdAt: now, updatedAt: now });

function profile(): UserProfile {
  return { ...emptyUserProfile(new Date(now)), experiences: [
    card("work", "工作", "本人访谈客户并整理需求清单", "访谈提纲"),
    card("project", "项目", "本人整理公开资料并设计检索对照", "Python、向量检索"),
  ] };
}

test("整份简历题组导出导入仍在同一题库中，重映射后不误判为失效", () => {
  const original = profile();
  const generated = createConfirmedResumePracticeSet(original, [
    { text: "面对不完整需求时，你先做了哪些澄清？", focus: "practice", evidence: [{ experienceId: "work", fields: ["action"] }], whyAsk: "考察需求澄清。", capabilities: ["需求分析"], angles: ["个人贡献"], followUps: ["需求清单如何形成？"], missingAspects: ["业务价值"], coverage: ["work"] },
    { text: "知识库原型中，你如何使用检索对照检查理解？", focus: "practice", evidence: [{ experienceId: "project", fields: ["action", "tools"] }], whyAsk: "考察技术验证。", capabilities: ["技术实践"], angles: ["技术选型", "验证方式"], followUps: ["哪些结论仍待补充？"], missingAspects: ["真实Badcase"], coverage: ["project", "technical_evidence"] },
    { text: "客户访谈和知识库原型之间，哪些能力可以迁移？", focus: "practice", evidence: [{ experienceId: "work", fields: ["action"] }, { experienceId: "project", fields: ["action"] }], whyAsk: "考察能力迁移边界。", capabilities: ["能力迁移"], angles: ["个人贡献"], followUps: ["两段经历哪些事实不能混用？"], missingAspects: ["业务价值"], coverage: ["work", "project"] },
    { text: "你如何如实说明原型与真实交付之间的边界？", focus: "practice", evidence: [{ experienceId: "project", fields: ["reflection"] }], whyAsk: "考察事实边界。", capabilities: ["边界表达"], angles: ["业务价值"], followUps: ["哪些结果仍待核实？"], missingAspects: ["业务价值"], coverage: ["project"] },
  ]);
  const set = setConfirmedResumeQuestionHidden(generated, generated.questions[0].id, true);
  const source = memory();
  saveUserProfile(original, source);
  saveQuestionLibrary({ ...emptyQuestionLibrary(), resumeSets: [set] }, source);
  const target = memory();
  importBackup(exportBackup(source), target);
  const restoredProfile = loadUserProfile(target), restored = loadQuestionLibrary(target).resumeSets?.[0];
  assert.ok(restored);
  assert.notEqual(restored!.sources[0].experienceId, set.sources[0].experienceId);
  assert.equal(restored!.contentVersion, confirmedResumeVersion(restoredProfile));
  assert.ok(restored!.questions.every(question => isResumePracticeQuestionCurrent(restoredProfile, question)));
  assert.equal(restored!.hiddenQuestionIds?.length, 1);
  assert.ok(restored!.questions.some(question => question.id === restored!.hiddenQuestionIds?.[0]));
});

test("公开 JSON 备份不包含未确认候选经历，也不会读取未保存题组候选副本", () => {
  const source = memory(); const value = profile();
  const material = { id: "resume-candidate", fileName: "resume.txt", mimeType: "text/plain", size: 10, extractedText: "本人整理需求", parser: "plain-text" as const, reviewedAt: now, createdAt: now };
  value.resumes = [material];
  value.experienceCandidates = [{ id: "candidate", title: "候选经历", situation: "", action: "本人整理需求", result: "", reflection: "", sourceQuotes: [{ materialId: material.id, quote: "本人整理需求" }], sourceVersions: [{ materialId: material.id, contentVersion: "resume-material-v1-test" }], createdAt: now, updatedAt: now }];
  saveUserProfile(value, source);
  const backup = JSON.parse(exportBackup(source));
  assert.equal("experienceCandidates" in backup.profile, false);
});

test("AI 预测题的来源类型、原文和题目关联可随 G8 备份恢复", () => {
  const source = memory(), target = memory();
  const importSource = createImportSource("匿名 AI 预测题", "## A. 方案题\n1. 如何解释评测边界？", [], "ai_prediction", new Date(now));
  const [question] = createRecordedQuestions([{ question: "如何解释评测边界？", category: "A. 方案题", order: 1 }], importSource.id, "ai_prediction", new Date(now));
  saveQuestionLibrary({ ...emptyQuestionLibrary(), importSources: [importSource], recordedQuestions: [question] }, source);
  importBackup(exportBackup(source), target);
  const restored = loadQuestionLibrary(target);
  assert.equal(restored.importSources?.length, 1);
  assert.equal(restored.recordedQuestions?.length, 1);
  assert.equal(restored.importSources?.[0].sourceType, "ai_prediction");
  assert.equal(restored.recordedQuestions?.[0].sourceType, "ai_prediction");
  assert.equal(restored.recordedQuestions?.[0].importSourceId, restored.importSources?.[0].id);
  assert.equal(restored.importSources?.[0].content, importSource.content);
});

test("超出解析上限时备份导出明确失败且不写入任何数据", () => {
  let writeAttempts = 0;
  const storage: StorageLike = {
    getItem: key => key === "ai-interview-drafts-v1" ? JSON.stringify({ draft: "x".repeat(MAX_BACKUP_BYTES) }) : null,
    setItem: () => { writeAttempts += 1; },
    removeItem: () => { writeAttempts += 1; },
  };
  assert.throws(() => exportBackup(storage), /超过 5MB 上限/);
  assert.equal(writeAttempts, 0);
});

test("损坏 JSON 与不兼容版本在写入前给出清晰错误", () => {
  assert.throws(() => parseBackup("{"), /不是有效的 JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ format: "ai-interview-prep-backup", version: 4 })), /不支持备份版本 4/);
});

test("恢复中途写入失败时回滚已写字段并保留原始值", () => {
  const backup = exportBackup(memory());
  const values = new Map<string, string>([
    ["ai-interview-projects-v1", JSON.stringify([])],
    ["ai-interview-prep-history-v1", JSON.stringify([])],
  ]);
  const before = new Map(values);
  let failHistoryWrite = true;
  const storage: StorageLike = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === "ai-interview-prep-history-v1" && failHistoryWrite) {
        failHistoryWrite = false;
        throw new Error("quota");
      }
      values.set(key, value);
    },
    removeItem: key => { values.delete(key); },
  };

  assert.throws(() => importBackup(backup, storage), /已回滚/);
  assert.deepEqual(values, before);
});

test("恢复数据无法回滚时明确报告部分写入风险", () => {
  const source = memory();
  source.setItem("ai-interview-drafts-v1", JSON.stringify({ create: "incoming" }));
  const backup = exportBackup(source);
  const originalDraft = JSON.stringify({ create: "existing" });
  const values = new Map<string, string>([
    ["ai-interview-projects-v1", JSON.stringify([])],
    ["ai-interview-prep-history-v1", JSON.stringify([])],
    ["ai-interview-drafts-v1", originalDraft],
  ]);
  let failLibraryWrite = true;
  let failDraftRollback = true;
  const storage: StorageLike = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      if (key === "ai-interview-question-library-v1" && failLibraryWrite) {
        failLibraryWrite = false;
        throw new Error("quota");
      }
      if (key === "ai-interview-drafts-v1" && value === originalDraft && failDraftRollback) {
        failDraftRollback = false;
        throw new Error("storage unavailable");
      }
      values.set(key, value);
    },
    removeItem: key => { values.delete(key); },
  };

  assert.throws(() => importBackup(backup, storage), /回滚未完成/);
});

test("岗位归属随备份恢复：备份内岗位改写为导入副本 id，指向备份外岗位的归属整对丢弃", () => {
  const source = memory(), target = memory();
  const preparation = createPreparation("", "岗位职责：推进跨部门政策沟通。");
  const project = { ...createInterviewProject({ company: "匿名集团", jobTitle: "政府事务", jobDescription: "岗位职责：推进跨部门政策沟通。", candidateBackground: "", concerns: "" }, preparation), id: "project-gov" };
  const owned: Preparation = { ...preparation, job: { ...preparation.job, projectId: "project-gov", projectName: "政府事务" } };
  const orphan: Preparation = { ...preparation, job: { ...preparation.job, projectId: "project-gone", projectName: "已删除岗位" } };
  source.setItem("ai-interview-projects-v1", JSON.stringify([project]));
  source.setItem("ai-interview-prep-history-v1", JSON.stringify([{ ...startSession(owned, 3), id: "session-inside" }, { ...startSession(orphan, 3), id: "session-outside" }]));

  importBackup(exportBackup(source), target);

  const copied = loadProjects(target).find(item => item.jobTitle.includes("政府事务"));
  const history = JSON.parse(target.getItem("ai-interview-prep-history-v1")!);
  assert.equal(history.length, 2);
  const jobs: Preparation["job"][] = history.map((item: { preparation: Preparation }) => item.preparation.job);
  const inside = jobs.find(job => job.projectId);
  const outside = jobs.find(job => !job.projectId);
  assert.ok(copied);
  // 备份内的岗位：projectId 改写为导入副本，名称保留，可继续按岗位筛选。
  assert.ok(inside);
  assert.equal(inside!.projectId, copied!.id);
  assert.notEqual(inside!.projectId, "project-gov");
  assert.equal(inside!.projectName, "政府事务");
  // 指向上一份备份里已不存在的岗位：整对丢弃，不留下悬空 id。
  assert.ok(outside);
  assert.equal(outside!.projectName, undefined);
});
