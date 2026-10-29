import assert from "node:assert/strict";
import test from "node:test";
import { emptyUserProfile, loadUserProfile, materialFileIsShared, PROFILE_KEY, saveUserProfile, withoutExperienceCard, withoutResumeMaterial } from "./profileStorage";
import { buildInterviewContext } from "./interviewContext";
import type { InterviewProject } from "./domain";
import type { StorageLike } from "./projectStorage";

function memory(): StorageLike {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("个人资料使用独立键保存，旧项目键不会被改写", () => {
  const storage = memory();
  storage.setItem("ai-interview-projects-v1", "[\"legacy\"]");
  const profile = emptyUserProfile(new Date("2026-10-11T00:00:00.000Z"));
  profile.supplementaryInfo = "仅供本人核对的补充信息";
  profile.resumes.push({ id: "resume-1", fileName: "resume.txt", mimeType: "text/plain", size: 10, extractedText: "负责项目交付", parser: "plain-text", createdAt: profile.updatedAt });
  saveUserProfile(profile, storage);
  assert.equal(storage.getItem("ai-interview-projects-v1"), "[\"legacy\"]");
  assert.equal(loadUserProfile(storage).resumes[0].extractedText, "负责项目交付");
  assert.ok(storage.getItem(PROFILE_KEY));
});

test("损坏的个人资料只降级为空资料，不覆盖原始存储", () => {
  const storage = memory();
  storage.setItem(PROFILE_KEY, "{broken");
  assert.deepEqual(loadUserProfile(storage).resumes, []);
  assert.equal(storage.getItem(PROFILE_KEY), "{broken");
});

test("旧资料记录可兼容读取，新附件元数据不会写入原文件", () => {
  const storage = memory();
  const profile = emptyUserProfile(new Date("2026-10-12T00:00:00.000Z"));
  profile.resumes.push({ id: "old", fileName: "old.pdf", mimeType: "application/pdf", size: 1, extractedText: "旧文字", parser: "pdf", createdAt: profile.updatedAt });
  profile.resumes.push({ id: "new", fileName: "new.png", mimeType: "image/png", size: 2, extractedText: "新文字", initialExtractedText: "初始文字", parser: "ocr", fileId: "new", originalSaved: true, reviewedAt: profile.updatedAt, createdAt: profile.updatedAt });
  saveUserProfile(profile, storage);
  assert.equal(loadUserProfile(storage).resumes[0].fileId, undefined);
  assert.equal(loadUserProfile(storage).resumes[1].originalSaved, true);
});

test("删除单份资料后保存刷新，不改另一份资料、经历和其他存储", () => {
  const storage = memory(); const profile = emptyUserProfile(new Date("2026-10-13T00:00:00Z"));
  profile.resumes = ["remove", "keep"].map(id => ({ id, fileName: `${id}.txt`, mimeType: "text/plain", size: 8, extractedText: `${id}本人原文`, parser: "plain-text", createdAt: profile.updatedAt }));
  storage.setItem("ai-interview-projects-v1", "岗位原文不变"); storage.setItem("ai-interview-prep-history-v1", "训练原文不变");
  saveUserProfile(profile, storage); saveUserProfile(withoutResumeMaterial(profile, "remove"), storage);
  assert.deepEqual(loadUserProfile(storage).resumes.map(item => item.id), ["keep"]);
  assert.equal(storage.getItem("ai-interview-projects-v1"), "岗位原文不变"); assert.equal(storage.getItem("ai-interview-prep-history-v1"), "训练原文不变");
  assert.equal(profile.resumes.length, 2);
});

test("已确认或待核对经历的来源引用均阻止资料删除，旧来源字段也保护", () => {
  const profile = emptyUserProfile(new Date("2026-10-13T00:00:00Z"));
  profile.resumes = [{ id: "source", fileName: "source.txt", mimeType: "text/plain", size: 8, extractedText: "本人访谈", parser: "plain-text", createdAt: profile.updatedAt }];
  for (const confirmed of [true, false]) for (const reference of [{ sourceResumeId: "source" }, { sourceQuotes: [{ materialId: "source", quote: "本人访谈" }] }]) {
    profile.experiences = [{ id: "linked", title: "访谈经历", situation: "", action: "本人访谈", result: "", reflection: "", confirmed, createdAt: profile.updatedAt, updatedAt: profile.updatedAt, ...reference }];
    const before = JSON.stringify(profile); assert.throws(() => withoutResumeMaterial(profile, "source"), /仍被经历卡引用/); assert.equal(JSON.stringify(profile), before);
  }
});

test("个人资料附件清理识别其他个人资料和岗位分图引用", () => {
  const profile = emptyUserProfile(new Date("2026-10-13T00:00:00Z"));
  const material = { id: "source", fileName: "source.txt", mimeType: "text/plain", size: 8, extractedText: "本人访谈", parser: "plain-text" as const, fileId: "original", createdAt: profile.updatedAt };
  profile.resumes = [material]; assert.equal(materialFileIsShared(profile, material, []), false);
  profile.resumes.push({ ...material, id: "other" }); assert.equal(materialFileIsShared(profile, material, []), true);
  profile.resumes.pop();
  const projects = [{ materials: [{ parts: [{ fileId: "original" }] }] }] as unknown as InterviewProject[];
  assert.equal(materialFileIsShared(profile, material, projects), true);
});

test("经历删除或撤销确认后，新上下文排除该事实且保留来源和其他经历", () => {
  const storage = memory(); const profile = emptyUserProfile(new Date("2026-10-13T00:00:00Z"));
  profile.resumes = [{ id: "source", fileName: "source.txt", mimeType: "text/plain", size: 8, extractedText: "本人访谈", fileId: "original", originalSaved: true, parser: "plain-text", createdAt: profile.updatedAt }];
  profile.experiences = ["remove", "keep"].map(id => ({ id, title: `${id}经历`, situation: "", action: `${id}本人行动`, result: "", reflection: "", confirmed: true, sourceResumeId: "source", createdAt: profile.updatedAt, updatedAt: profile.updatedAt }));
  saveUserProfile(withoutExperienceCard(profile, "remove"), storage);
  const restored = loadUserProfile(storage); assert.deepEqual(restored.resumes, profile.resumes);
  assert.deepEqual(buildInterviewContext({ profile: restored }).confirmedUserFacts, ["经历：keep经历；本人行动：keep本人行动"]);
  saveUserProfile({ ...profile, experiences: profile.experiences.map(card => card.id === "remove" ? { ...card, confirmed: false } : card) }, storage);
  assert.deepEqual(buildInterviewContext({ profile: loadUserProfile(storage) }).confirmedUserFacts, ["经历：keep经历；本人行动：keep本人行动"]);
});

test("删除经历的持久化失败，不覆盖已保存事实和资料", () => {
  const storage = memory(); const profile = emptyUserProfile(new Date("2026-10-13T00:00:00Z"));
  profile.experiences = [{ id: "retain", title: "保留的已确认经历", situation: "", action: "本人访谈", result: "", reflection: "", confirmed: true, createdAt: profile.updatedAt, updatedAt: profile.updatedAt }];
  saveUserProfile(profile, storage); const before = storage.getItem(PROFILE_KEY);
  assert.throws(() => saveUserProfile(withoutExperienceCard(profile, "retain"), { ...storage, setItem: () => { throw new Error("匿名写入失败"); } }), /匿名写入失败/);
  assert.equal(storage.getItem(PROFILE_KEY), before); assert.equal(loadUserProfile(storage).experiences[0].confirmed, true);
});
