import assert from "node:assert/strict";
import test from "node:test";
import { createPreparation, nextTurn, startSession } from "./interview";
import { saveFinalAnswer } from "./coaching";
import { createInterviewProject } from "./projects";
import { emptyUserProfile } from "./profileStorage";
import { analysisFreshness, buildAnalysisBasis, createSavedAnalysis, saveProjectAnalysis } from "./jobAnalysis";
import { loadProjects, saveProject, type StorageLike } from "./projectStorage";
import { exportBackup, importBackup } from "./backup";
import type { JobAnalysisItem } from "./domain";

const now = "2026-10-14T00:00:00.000Z";
const input = { company: "匿名企业", jobTitle: "AI 方案岗位", jobDescription: "需要客户需求访谈能力。", candidateBackground: "旧背景", concerns: "" };
const project = { ...createInterviewProject(input, createPreparation(input.candidateBackground, input.jobDescription)), id: "anonymous-analysis" };
const profile = emptyUserProfile(new Date(now));
profile.experiences = [{ id: "anonymous-card", title: "需求访谈", situation: "客户调研", action: "我负责访谈", result: "需求记录", reflection: "", confirmed: true, createdAt: now, updatedAt: now }];
const rows: JobAnalysisItem[] = [{ requirement: "需求访谈", status: "direct", evidenceQuote: "我负责访谈", reason: "确认经历中出现了对应行动", studyTopic: "", practiceQuestion: "如何访谈？" }];

test("实际 JD 变化标记陈旧，更新时间和与分析无关的字段不误报变化", async () => {
  const basis = await buildAnalysisBasis(project, profile);
  const result = createSavedAnalysis(rows, basis, new Date(now));
  assert.equal(analysisFreshness(result, await buildAnalysisBasis({ ...project, updatedAt: "2026-10-15T00:00:00.000Z", company: "企业名称未进入当前模型输入", concerns: "界面备注改变", prepMinutes: 120 }, { ...profile, updatedAt: "2026-10-15T00:00:00.000Z" })), "current");
  assert.equal(analysisFreshness(result, await buildAnalysisBasis({ ...project, jobDescription: "改为要求模型评测能力。" }, profile)), "stale");
});

test("确认经历、核对参考、面经及实际进入上下文的最终答案变化会陈旧，未确认草稿不影响", async () => {
  const job = { ...project, materials: [
    { id: "reference", title: "企业业务资料", kind: "reference" as const, content: "企业提供客服工具", source: "manual_text" as const, reviewedAt: now, createdAt: now, updatedAt: now },
    { id: "third", title: "第三方面经", kind: "interview_experience" as const, content: "他人完成20个项目", source: "manual_text" as const, reviewedAt: now, createdAt: now, updatedAt: now },
  ] };
  const basis = await buildAnalysisBasis(job, profile);
  const result = createSavedAnalysis(rows, basis);
  const modified = { ...profile, experiences: [{ ...profile.experiences[0], action: "我负责需求核对" }] };
  assert.equal(analysisFreshness(result, await buildAnalysisBasis(job, modified), { project: job, profile: modified }), "stale");
  const revoked = { ...profile, experiences: [{ ...profile.experiences[0], confirmed: false }] };
  assert.equal(analysisFreshness(result, await buildAnalysisBasis(job, revoked), { project: job, profile: revoked }), "stale");
  for (const id of ["reference", "third"]) {
    const changed = { ...job, materials: job.materials.map(material => material.id === id ? { ...material, content: "对应资料的核对内容已修改" } : material) };
    assert.equal(analysisFreshness(result, await buildAnalysisBasis(changed, profile), { project: changed, profile }), "stale");
  }
  const pending = { ...profile, experiences: [...profile.experiences, { ...profile.experiences[0], id: "draft-card", confirmed: false, action: "未确认50个项目" }] };
  assert.equal(analysisFreshness(result, await buildAnalysisBasis(job, pending), { project: job, profile: pending }), "current");
  const answered = saveFinalAnswer(nextTurn(startSession(project.preparation!), "本人原回答：说明访谈行动与边界。", { action: "next" }), 0, "本人确认思路：访谈后整理需求与职责边界。");
  const withAnswer = { ...job, session: answered };
  const prior = createSavedAnalysis(rows, await buildAnalysisBasis(withAnswer, profile));
  const changedAnswer = { ...withAnswer, session: saveFinalAnswer(answered, 0, "本人修改后的思路：补充需求核对步骤与边界。") };
  assert.equal(analysisFreshness(prior, await buildAnalysisBasis(changedAnswer, profile), { project: changedAnswer, profile }), "stale");
});

function memory(): StorageLike { const values = new Map<string, string>(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } }; }
test("追加分析读回隔离岗位，保留原字段、历次结果及请求等待时已保存的新资料；配额失败不改存储", async () => {
  const storage = memory(); const other = { ...project, id: "anonymous-other" };
  saveProject(project, storage); saveProject(other, storage);
  const result = createSavedAnalysis(rows, await buildAnalysisBasis(project, profile));
  // Another UI operation has saved this job while analysis was in flight.
  saveProject({ ...project, jobDescription: "用户已经修改的新JD", concerns: "不得覆盖" }, storage);
  saveProjectAnalysis(project.id, result, storage);
  const restored = loadProjects(storage).find(item => item.id === project.id)!;
  assert.equal(restored.jobDescription, "用户已经修改的新JD"); assert.equal(restored.concerns, "不得覆盖");
  assert.equal(restored.aiAnalyses?.[0].rows[0].requirement, "需求访谈");
  assert.equal(loadProjects(storage).find(item => item.id === other.id)?.aiAnalyses, undefined);
  const next = createSavedAnalysis([{ ...rows[0], requirement: "重新生成的要求" }], await buildAnalysisBasis(restored, profile));
  saveProjectAnalysis(project.id, next, storage);
  assert.deepEqual(loadProjects(storage).find(item => item.id === project.id)!.aiAnalyses!.map(item => item.rows[0].requirement), ["需求访谈", "重新生成的要求"]);
  const before = loadProjects(storage);
  assert.throws(() => saveProjectAnalysis(project.id, createSavedAnalysis(rows, result.basis!), { ...storage, setItem: () => { throw new Error("匿名配额不足"); } }), /配额/);
  assert.deepEqual(loadProjects(storage), before);
});

test("新分析随现有备份副本保留，原岗位旧字段仍兼容；来源不能恢复时不猜测有效", async () => {
  const storage = memory(); saveProject(project, storage);
  saveProjectAnalysis(project.id, createSavedAnalysis(rows, await buildAnalysisBasis(project, profile)), storage);
  const target = memory(); importBackup(exportBackup(storage), target);
  const copied = loadProjects(target)[0];
  assert.equal(copied.aiAnalyses?.[0].rows[0].requirement, "需求访谈");
  assert.equal(analysisFreshness(copied.aiAnalyses![0], await buildAnalysisBasis(copied, profile)), "unknown");
  const legacy = memory(); saveProject(project, legacy); assert.equal(loadProjects(legacy)[0].aiAnalyses, undefined);
});

test("缺少依据及无法恢复来源都标未知，不凭相同文字猜测有效", async () => {
  const basis = await buildAnalysisBasis(project, profile);
  const result = createSavedAnalysis(rows, basis, new Date(now));
  assert.equal(analysisFreshness({ ...result, basis: undefined }, basis), "unknown");
  // Replacing the card with an identical-text card must not silently claim the original source is recoverable.
  const replaced = { ...profile, experiences: [{ ...profile.experiences[0], id: "different-source-card" }] };
  assert.equal(analysisFreshness(result, await buildAnalysisBasis(project, replaced)), "unknown");
});
