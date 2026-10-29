import type { ExperienceCard, InterviewProject, ResumeMaterial, UserProfile } from "./domain";
import type { StorageLike } from "./projectStorage";

export const PROFILE_KEY = "ai-interview-profile-v1";
export const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
export const MAX_RESUME_TEXT_BYTES = 512 * 1024;

function browserStorage(): StorageLike {
  if (typeof localStorage === "undefined") throw new Error("当前环境不支持本地存储。");
  return localStorage;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value: unknown, max = MAX_PROFILE_BYTES) => typeof value === "string" && new Blob([value]).size <= max;

export function validResumeMaterial(value: unknown): value is ResumeMaterial {
  return record(value) && typeof value.id === "string" && typeof value.fileName === "string" && typeof value.mimeType === "string"
    && typeof value.size === "number" && Number.isInteger(value.size) && value.size >= 0 && text(value.extractedText, MAX_RESUME_TEXT_BYTES)
    && (value.parser === "plain-text" || value.parser === "manual" || value.parser === "docx" || value.parser === "pdf" || value.parser === "ocr")
    && (value.initialExtractedText === undefined || text(value.initialExtractedText, MAX_RESUME_TEXT_BYTES))
    && (value.fileId === undefined || typeof value.fileId === "string") && (value.originalSaved === undefined || typeof value.originalSaved === "boolean")
    && (value.reviewedAt === undefined || date(value.reviewedAt)) && date(value.createdAt);
}

export function validExperienceCard(value: unknown): value is ExperienceCard {
  return record(value) && ["id", "title", "situation", "action", "result", "reflection"].every(key => typeof value[key] === "string")
    && typeof value.confirmed === "boolean" && (value.sourceResumeId === undefined || typeof value.sourceResumeId === "string")
    && (value.type === undefined || typeof value.type === "string") && (value.tools === undefined || typeof value.tools === "string") && (value.notes === undefined || typeof value.notes === "string")
    && (value.origin === undefined || value.origin === "manual" || value.origin === "ai")
    && (value.sourceQuotes === undefined || Array.isArray(value.sourceQuotes) && value.sourceQuotes.every(item => record(item) && typeof item.materialId === "string" && typeof item.quote === "string"))
    && date(value.createdAt) && date(value.updatedAt);
}

export function validUserProfile(value: unknown): value is UserProfile {
  return record(value) && value.version === 1 && text(value.supplementaryInfo)
    && Array.isArray(value.resumes) && value.resumes.every(validResumeMaterial)
    && Array.isArray(value.experiences) && value.experiences.every(validExperienceCard)
    && (value.aiExperienceExtractionConsent === undefined || typeof value.aiExperienceExtractionConsent === "boolean")
    && date(value.updatedAt);
}

export function emptyUserProfile(now = new Date()): UserProfile {
  return { version: 1, supplementaryInfo: "", resumes: [], experiences: [], updatedAt: now.toISOString() };
}

export function loadUserProfile(storage: StorageLike = browserStorage()): UserProfile {
  try {
    const raw = storage.getItem(PROFILE_KEY);
    if (!raw) return emptyUserProfile();
    const value = JSON.parse(raw);
    return validUserProfile(value) ? value : emptyUserProfile();
  } catch {
    return emptyUserProfile();
  }
}

export function saveUserProfile(profile: UserProfile, storage: StorageLike = browserStorage()): UserProfile {
  if (!validUserProfile(profile)) throw new Error("个人资料结构无效，未保存。");
  const raw = storage.getItem(PROFILE_KEY);
  if (raw) {
    const existing = JSON.parse(raw);
    if (!validUserProfile(existing)) throw new Error("已有个人资料损坏，请先导出文字与训练备份，避免覆盖。");
  }
  const encoded = JSON.stringify(profile);
  if (new Blob([encoded]).size > MAX_PROFILE_BYTES) throw new Error("个人资料超过约 2MB 的本地容量限制，请移除不需要的文本后重试。");
  storage.setItem(PROFILE_KEY, encoded);
  return profile;
}

export function materialLinkedExperiences(profile: UserProfile, materialId: string): ExperienceCard[] {
  return profile.experiences.filter(card => card.sourceResumeId === materialId || card.sourceQuotes?.some(source => source.materialId === materialId));
}

export function withoutResumeMaterial(profile: UserProfile, materialId: string): UserProfile {
  if (profile.resumes.filter(item => item.id === materialId).length !== 1) throw new Error("资料标识不存在或不唯一，未执行删除。");
  if (materialLinkedExperiences(profile, materialId).length) throw new Error("这份资料仍被经历卡引用，请先处理关联经历；不会自动删除或断开事实来源。");
  return { ...profile, resumes: profile.resumes.filter(item => item.id !== materialId), updatedAt: new Date().toISOString() };
}

export function materialFileIsShared(profile: UserProfile, material: ResumeMaterial, projects: InterviewProject[]): boolean {
  return Boolean(material.fileId && (profile.resumes.some(item => item.id !== material.id && item.fileId === material.fileId)
    || projects.some(project => project.materials?.some(item => item.fileId === material.fileId || item.parts?.some(part => part.fileId === material.fileId)))));
}

export function withoutExperienceCard(profile: UserProfile, cardId: string): UserProfile {
  if (profile.experiences.filter(card => card.id === cardId).length !== 1) throw new Error("经历标识不存在或不唯一，未执行删除。");
  return { ...profile, experiences: profile.experiences.filter(card => card.id !== cardId), updatedAt: new Date().toISOString() };
}
