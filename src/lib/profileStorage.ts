import type { ExperienceCandidate, ExperienceCandidateSourceVersion, ExperienceCard, InterviewProject, ResumeMaterial, UserProfile } from "./domain";
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

function versionDigest(value: string): string {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${value.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export function resumeMaterialVersion(material: ResumeMaterial): string {
  return `resume-material-v1-${versionDigest(JSON.stringify([material.id, material.extractedText, material.reviewedAt ?? ""]))}`;
}

function validCandidateSourceVersion(value: unknown): value is ExperienceCandidateSourceVersion {
  return record(value) && typeof value.materialId === "string" && Boolean(value.materialId)
    && typeof value.contentVersion === "string" && Boolean(value.contentVersion) && value.contentVersion.length <= 200;
}

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
    && (value.candidateSourceVersions === undefined || Array.isArray(value.candidateSourceVersions) && value.candidateSourceVersions.length > 0
      && value.candidateSourceVersions.every(validCandidateSourceVersion)
      && new Set(value.candidateSourceVersions.map(item => item.materialId)).size === value.candidateSourceVersions.length)
    && date(value.createdAt) && date(value.updatedAt);
}

export function validExperienceCandidate(value: unknown): value is ExperienceCandidate {
  if (!record(value) || !["id", "title", "situation", "action", "result", "reflection"].every(key => typeof value[key] === "string")) return false;
  const title = value.title as string;
  const sourceQuotes = Array.isArray(value.sourceQuotes) ? value.sourceQuotes : [];
  const sourceVersions = Array.isArray(value.sourceVersions) ? value.sourceVersions : [];
  return Boolean(value.id) && Boolean(title.trim()) && title.length <= 120
    && (value.type === undefined || typeof value.type === "string") && (value.tools === undefined || typeof value.tools === "string") && (value.notes === undefined || typeof value.notes === "string")
    && sourceQuotes.length > 0 && sourceQuotes.every(item => record(item) && typeof item.materialId === "string" && Boolean(item.materialId) && typeof item.quote === "string" && Boolean(item.quote))
    && sourceVersions.length > 0 && sourceVersions.every(validCandidateSourceVersion)
    && new Set(sourceVersions.map(item => (item as ExperienceCandidateSourceVersion).materialId)).size === sourceVersions.length
    && sourceQuotes.every(item => record(item) && sourceVersions.some(source => validCandidateSourceVersion(source) && source.materialId === item.materialId))
    && date(value.createdAt) && date(value.updatedAt);
}

export function validUserProfile(value: unknown): value is UserProfile {
  return record(value) && value.version === 1 && text(value.supplementaryInfo)
    && Array.isArray(value.resumes) && value.resumes.every(validResumeMaterial)
    && Array.isArray(value.experiences) && value.experiences.every(validExperienceCard)
    && (value.experienceCandidates === undefined || Array.isArray(value.experienceCandidates) && value.experienceCandidates.length <= 40
      && value.experienceCandidates.every(validExperienceCandidate)
      && new Set(value.experienceCandidates.map(candidate => candidate.id)).size === value.experienceCandidates.length)
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

export function materialLinkedExperienceCandidates(profile: UserProfile, materialId: string): ExperienceCandidate[] {
  return (profile.experienceCandidates ?? []).filter(candidate => candidate.sourceVersions.some(source => source.materialId === materialId));
}

function sourcesCurrent(profile: UserProfile, sources: ExperienceCandidateSourceVersion[]): boolean {
  return sources.length > 0 && sources.every(source => {
    const material = profile.resumes.find(item => item.id === source.materialId);
    return Boolean(material?.reviewedAt && resumeMaterialVersion(material) === source.contentVersion);
  });
}

export function isExperienceCandidateCurrent(profile: UserProfile, candidate: ExperienceCandidate): boolean {
  return sourcesCurrent(profile, candidate.sourceVersions)
    && candidate.sourceQuotes.every(quote => profile.resumes.find(item => item.id === quote.materialId)?.extractedText.includes(quote.quote));
}

export function isCandidateDraftCurrent(profile: UserProfile, card: ExperienceCard): boolean {
  return card.candidateSourceVersions === undefined || sourcesCurrent(profile, card.candidateSourceVersions);
}

export function addExperienceCandidates(profile: UserProfile, candidates: ExperienceCandidate[]): UserProfile {
  const existing = profile.experienceCandidates ?? [];
  const signature = (candidate: ExperienceCandidate) => JSON.stringify([
    candidate.title.trim().toLocaleLowerCase(),
    [...candidate.sourceVersions].sort((left, right) => left.materialId.localeCompare(right.materialId)).map(source => [source.materialId, source.contentVersion]),
    [...candidate.sourceQuotes].sort((left, right) => `${left.materialId}:${left.quote}`.localeCompare(`${right.materialId}:${right.quote}`)).map(quote => [quote.materialId, quote.quote]),
  ]);
  const seen = new Set(existing.map(signature));
  const additions = candidates.filter(candidate => !seen.has(signature(candidate)) && (seen.add(signature(candidate)), true));
  const next = [...existing, ...additions];
  if (next.length > 40) throw new Error("候选经历达到 40 条上限；请先处理或放弃已有候选，未覆盖任何内容。");
  return { ...profile, ...(next.length ? { experienceCandidates: next } : {}), updatedAt: new Date().toISOString() };
}

export function withoutExperienceCandidate(profile: UserProfile, candidateId: string): UserProfile {
  const candidates = profile.experienceCandidates ?? [];
  if (candidates.filter(candidate => candidate.id === candidateId).length !== 1) throw new Error("候选经历不存在或不唯一，未执行放弃操作。");
  const next = candidates.filter(candidate => candidate.id !== candidateId);
  return { ...profile, ...(next.length ? { experienceCandidates: next } : { experienceCandidates: undefined }), updatedAt: new Date().toISOString() };
}

export function withoutResumeMaterial(profile: UserProfile, materialId: string): UserProfile {
  if (profile.resumes.filter(item => item.id === materialId).length !== 1) throw new Error("资料标识不存在或不唯一，未执行删除。");
  if (materialLinkedExperiences(profile, materialId).length) throw new Error("这份资料仍被经历卡引用，请先处理关联经历；不会自动删除或断开事实来源。");
  if (materialLinkedExperienceCandidates(profile, materialId).length) throw new Error("这份资料仍被候选经历引用，请先处理或放弃候选；不会自动删除候选依据。");
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
