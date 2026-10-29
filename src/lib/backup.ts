import type { InterviewProject, InterviewSession, Preparation, UserProfile } from "./domain";
import type { StorageLike } from "./projectStorage";
import { validProject, validSession } from "./validation";
import { DRAFT_KEY, MAX_DRAFT_BYTES } from "./drafts";
import { emptyUserProfile, PROFILE_KEY, validUserProfile } from "./profileStorage";
import { emptyQuestionLibrary, MAX_QUESTION_LIBRARY_BYTES, QUESTION_LIBRARY_KEY, validQuestionLibrary, type QuestionLibraryState } from "./questionLibrary";
import { experienceVersion, type ExperiencePracticeSet } from "./experiencePractice";
import type { MaterialCollection } from "./materialCollection";

const PROJECT_KEY = "ai-interview-projects-v1";
const HISTORY_KEY = "ai-interview-prep-history-v1";
type BackupV1 = { format: "ai-interview-prep-backup"; version: 1; exportedAt: string; projects: InterviewProject[]; history: InterviewSession[]; drafts: Record<string, string>; };
type BackupV2 = Omit<BackupV1, "version"> & { version: 2; profile: UserProfile; };
type BackupV3 = Omit<BackupV2, "version"> & { version: 3; library: QuestionLibraryState; };
export type Backup = BackupV1 | BackupV2 | BackupV3;

function validCore(value: any): boolean {
  return value?.format === "ai-interview-prep-backup" && (value.version === 1 || value.version === 2 || value.version === 3)
    && Array.isArray(value.projects) && value.projects.every(validProject) && Array.isArray(value.history) && value.history.every(validSession)
    && value.drafts && typeof value.drafts === "object" && !Array.isArray(value.drafts) && Object.values(value.drafts).every(item => typeof item === "string")
    && new Set(value.projects.map((project: InterviewProject) => project.id)).size === value.projects.length
    && new Set(value.history.map((session: InterviewSession) => session.id)).size === value.history.length;
}

export function parseBackup(text: string): Backup {
  if (new Blob([text]).size > 5 * 1024 * 1024) throw new Error("备份超过 5MB 上限。");
  const backup = JSON.parse(text);
  if (!validCore(backup) || (backup.version >= 2 && !validUserProfile(backup.profile)) || (backup.version === 3 && !validQuestionLibrary(backup.library))) throw new Error("备份格式或内部材料无效，未写入任何数据。");
  return backup;
}

export function exportBackup(storage: StorageLike = localStorage): string {
  const rawProfile = storage.getItem(PROFILE_KEY); const rawLibrary = storage.getItem(QUESTION_LIBRARY_KEY);
  const backup: BackupV3 = {
    format: "ai-interview-prep-backup", version: 3, exportedAt: new Date().toISOString(),
    projects: JSON.parse(storage.getItem(PROJECT_KEY) || "[]"), history: JSON.parse(storage.getItem(HISTORY_KEY) || "[]"), drafts: JSON.parse(storage.getItem(DRAFT_KEY) || "{}"),
    profile: rawProfile ? JSON.parse(rawProfile) : emptyUserProfile(),
    library: rawLibrary ? JSON.parse(rawLibrary) : emptyQuestionLibrary(),
  };
  // Export exact stored data, including damaged records for recovery. Import validates strictly.
  return JSON.stringify(backup, null, 2);
}

function remapRecordedId(id: string, ids: Map<string, string>): string {
  for (const [original, replacement] of ids) if (id === original || id.startsWith(`${original}-followup`) && /^(?:-followup)+$/.test(id.slice(original.length))) return replacement + id.slice(original.length);
  return id;
}

function remapLibraryKey(key: string, ids: Map<string, string>, recordedIds: Map<string, string>) {
  const recorded = key.match(/^recorded:(.+)$/); if (recorded) return recordedIds.has(recorded[1]) ? `recorded:${recordedIds.get(recorded[1])}` : null;
  const project = key.match(/^project:([^:]+):question:(.+)$/); if (project) return ids.has(project[1]) ? `project:${ids.get(project[1])}:question:${remapRecordedId(project[2], recordedIds)}` : null;
  const history = key.match(/^history:([^:]+):turn:(\d+)$/); if (history) return ids.has(history[1]) ? `history:${ids.get(history[1])}:turn:${history[2]}` : null;
  return null;
}

function mergeQuestionLibrary(current: QuestionLibraryState, incoming: QuestionLibraryState, ids: Map<string, string>, recordedIds: Map<string, string>, experienceSets: ExperiencePracticeSet[], collection?: MaterialCollection): QuestionLibraryState {
  const favorites = new Set(current.favorites);
  incoming.favorites.map(key => remapLibraryKey(key, ids, recordedIds)).filter((key): key is string => Boolean(key)).forEach(key => favorites.add(key));
  const reuseDrafts = [...current.reuseDrafts, ...incoming.reuseDrafts.flatMap(draft => {
    const sourceKey = remapLibraryKey(draft.sourceKey, ids, recordedIds); const targetKey = remapLibraryKey(draft.targetKey, ids, recordedIds);
    const sourceProjectId = ids.get(draft.sourceProjectId); const targetProjectId = ids.get(draft.targetProjectId);
    return sourceKey && targetKey && sourceProjectId && targetProjectId ? [{ ...draft, id: `import-${crypto.randomUUID()}`, sourceKey, targetKey, sourceProjectId, targetProjectId }] : [];
  })];
  return { version: 1, favorites: [...favorites], reuseDrafts, foundationReview: { ...(current.foundationReview ?? {}), ...(incoming.foundationReview ?? {}) },
    ...(collection || current.collection ? { collection: { materials: [...(current.collection?.materials ?? []), ...(collection?.materials ?? [])], analyses: [...(current.collection?.analyses ?? []), ...(collection?.analyses ?? [])], extractions: [...(current.collection?.extractions ?? []), ...(collection?.extractions ?? [])], activeMaterialIds: [...(current.collection?.activeMaterialIds ?? current.collection?.materials.map(m=>m.id) ?? []), ...(collection?.activeMaterialIds ?? collection?.materials.map(m=>m.id) ?? [])] } } : {}),
    ...((current.experienceSets || incoming.experienceSets) ? { experienceSets: [...(current.experienceSets ?? []), ...experienceSets] } : {}),
    ...((current.recordedQuestions || incoming.recordedQuestions) ? { recordedQuestions: [...(current.recordedQuestions ?? []), ...(incoming.recordedQuestions ?? []).map(item => ({ ...item, id: recordedIds.get(item.id)!, projectId: item.projectId ? ids.get(item.projectId) : undefined }))] } : {}) };
}

function mergeProfile(current: UserProfile, incoming: UserProfile, ids = new Map<string, string>()): UserProfile {
  const importedId = (value: string) => { if (!ids.has(value)) ids.set(value, `import-${crypto.randomUUID()}`); return ids.get(value)!; };
  const resumes = incoming.resumes.map(item => ({ ...item, id: importedId(item.id), fileId: undefined, originalSaved: false }));
  const experiences = incoming.experiences.map(item => ({ ...item, id: importedId(item.id), ...(item.sourceResumeId ? { sourceResumeId: importedId(item.sourceResumeId) } : {}),
    ...(item.sourceQuotes ? { sourceQuotes: item.sourceQuotes.map(quote => ({ ...quote, materialId: importedId(quote.materialId) })) } : {}) }));
  const supplementaryInfo = incoming.supplementaryInfo.trim()
    ? [current.supplementaryInfo.trim(), `【导入资料的补充信息】\n${incoming.supplementaryInfo.trim()}`].filter(Boolean).join("\n\n")
    : current.supplementaryInfo;
  return { ...current, supplementaryInfo, resumes: [...current.resumes, ...resumes], experiences: [...current.experiences, ...experiences], updatedAt: new Date().toISOString() };
}

export function importBackup(text: string, storage: StorageLike = localStorage): void {
  const backup = parseBackup(text);
  const old = [PROJECT_KEY, HISTORY_KEY, DRAFT_KEY, PROFILE_KEY, QUESTION_LIBRARY_KEY].map(key => ({ key, raw: storage.getItem(key) }));
  const currentCore = parseBackup(JSON.stringify({ format: "ai-interview-prep-backup", version: 1, projects: JSON.parse(old[0].raw || "[]"), history: JSON.parse(old[1].raw || "[]"), drafts: JSON.parse(old[2].raw || "{}") }));
  const currentProfile = old[3].raw ? JSON.parse(old[3].raw) : emptyUserProfile();
  const currentLibrary = old[4].raw ? JSON.parse(old[4].raw) : emptyQuestionLibrary();
  if (!validUserProfile(currentProfile)) throw new Error("已有个人资料损坏，请先保留原始备份，未执行导入。");
  if (!validQuestionLibrary(currentLibrary)) throw new Error("已有题库索引损坏，请先保留原始备份，未执行导入。");
  const ids = new Map<string, string>();
  const importedId = (value: string) => { if (!ids.has(value)) ids.set(value, `import-${crypto.randomUUID()}`); return ids.get(value)!; };
  const recordedIds = new Map(backup.version === 3 ? (backup.library.recordedQuestions ?? []).map(item => [item.id, `recorded-${crypto.randomUUID()}`]) : []);
  const profile = backup.version === 2 || backup.version === 3 ? mergeProfile(currentProfile, backup.profile, ids) : currentProfile;
  const experienceSets = backup.version === 3 ? (backup.library.experienceSets ?? []).map(set => {
    const setId = `experience-set-${crypto.randomUUID()}`, experienceId = importedId(set.experienceId);
    const originalCard = backup.profile.experiences.find(card => card.id === set.experienceId);
    const copyCard = profile.experiences.find(card => card.id === experienceId);
    // Only a matching original version can become the imported card's current version.
    const contentVersion = originalCard && copyCard && experienceVersion(originalCard) === set.contentVersion ? experienceVersion(copyCard) : set.contentVersion;
    const questions = set.questions.map((q,index) => {
      const id = `${setId}-q${index + 1}`; recordedIds.set(q.id, id);
      return { ...q, id, experienceOrigin: { ...q.experienceOrigin!, setId, experienceId, contentVersion } };
    });
    return { ...set, id: setId, experienceId, contentVersion, questions, ...(set.hiddenQuestionIds ? { hiddenQuestionIds: set.hiddenQuestionIds.map(id => recordedIds.get(id)!) } : {}) };
  }) : [];
  const incomingCollection = backup.version === 3 ? backup.library.collection : undefined;
  const version = (original: string) => { const [text, group, order] = JSON.parse(original); return JSON.stringify([text, group ? importedId(group) : "", order ?? 0]); };
  const collection: MaterialCollection | undefined = incomingCollection ? {
    ...(incomingCollection.activeMaterialIds ? { activeMaterialIds: incomingCollection.activeMaterialIds.map(importedId) } : {}),
    materials: incomingCollection.materials.map(m => ({ ...m, id: importedId(m.id), fileId: undefined, originalSaved: false, groupId: m.groupId ? importedId(m.groupId) : undefined, projectId: m.projectId ? importedId(m.projectId) : undefined,
      parts: m.parts?.map(p => ({ ...p, id: importedId(p.id), fileId: undefined, originalSaved: false })) })),
    extractions: incomingCollection.extractions?.map(i => ({ ...i, materialId: importedId(i.materialId), contentVersion: version(i.contentVersion) })),
    analyses: incomingCollection.analyses.map(a => {
      const id = importedId(a.id);
      const questions = a.questions.map(q => { const newId = `collected-question-${crypto.randomUUID()}`; recordedIds.set(q.id,newId); return { ...q, id: newId, collectionOrigin: { ...q.collectionOrigin!, materialId: importedId(q.collectionOrigin!.materialId), analysisId: id, contentVersion: version(q.collectionOrigin!.contentVersion) } }; });
      const conclusions = (key: "commonRequirements" | "topics" | "priorities") => a[key].map(row => ({ ...row, evidence: row.evidence.map(e => ({ ...e, materialId: importedId(e.materialId) })) }));
      return { ...a, id, items: a.items.map(i => ({ ...i, materialId: importedId(i.materialId), contentVersion: version(i.contentVersion) })), questions,
        ...(a.sources ? { sources:a.sources.map(s=>({...s,materialId:importedId(s.materialId),contentVersion:version(s.contentVersion)})) } : {}),
        ...(a.failures ? { failures:a.failures.map(f=>({...f,materialId:importedId(f.materialId)})) } : {}),
        ...(a.summaryMaterialIds ? { summaryMaterialIds:a.summaryMaterialIds.map(importedId) } : {}),
        commonRequirements: conclusions("commonRequirements"), topics: conclusions("topics"), priorities: conclusions("priorities"),
        ...(a.hiddenQuestionIds ? { hiddenQuestionIds: a.hiddenQuestionIds.map(q => recordedIds.get(q)!) } : {}) };
    }),
  } : undefined;
  const question = (item: Preparation["questions"][number]) => {
    const copySet = experienceSets.find(set => set.questions.some(q => q.id === remapRecordedId(item.id.replace(/(?:-followup)+$/, ""), recordedIds)));
    return { ...item, id: remapRecordedId(item.id, recordedIds), ...(item.collectionOrigin ? { collectionOrigin: { ...item.collectionOrigin, materialId: importedId(item.collectionOrigin.materialId), analysisId: importedId(item.collectionOrigin.analysisId), contentVersion: version(item.collectionOrigin.contentVersion) } } : {}), ...(item.experienceOrigin && copySet ? { experienceOrigin: { ...item.experienceOrigin, setId: copySet.id, experienceId: copySet.experienceId, contentVersion: copySet.contentVersion } } : {}) };
  };
  const preparation = (value: Preparation): Preparation => recordedIds.size ? { ...value, questions: value.questions.map(question) } : value;
  const session = (value: InterviewSession) => ({ ...value, id: importedId(value.id), ...(recordedIds.size ? {
    preparation: preparation(value.preparation), questions: value.questions.map(question),
    turns: value.turns.map(turn => ({ ...turn, questionId: remapRecordedId(turn.questionId, recordedIds) })),
  } : {}) });
  const projects = [...currentCore.projects, ...backup.projects.map(project => ({ ...project, id: importedId(project.id), company: project.company, jobTitle: `${project.jobTitle}（导入副本）`,
    ...(recordedIds.size ? { questions: project.questions.map(item => ({ ...item, id: remapRecordedId(item.id, recordedIds) })), ...(project.preparation ? { preparation: preparation(project.preparation) } : {}) } : {}),
    materials: project.materials?.map(material => ({ ...material, projectId: importedId(project.id), ...(material.collectionSourceId ? { collectionSourceId: importedId(material.collectionSourceId) } : {}), fileId: undefined, originalSaved: false,
      parts: material.parts?.map(part => ({ ...part, fileId: undefined, originalSaved: false })) })),
    ...(project.session ? { session: session(project.session) } : {}) }))];
  const history = [...currentCore.history, ...backup.history.map(session)];
  const drafts = { ...currentCore.drafts };
  for (const [key, value] of Object.entries(backup.drafts)) {
    const parts = key.split(":");
    if (["answer", "retry", "edit"].includes(parts[0]) && ids.has(parts[1])) { parts[1] = ids.get(parts[1])!; if (parts[0] === "answer" && parts[2]) parts[2] = remapRecordedId(parts[2], recordedIds); drafts[parts.join(":")] = value; }
    else if (key === "create") { if (drafts.create && drafts.create !== value) drafts[`recovered:${crypto.randomUUID()}:create`] = value; else drafts.create = value; }
    else if (value) drafts[`recovered:${crypto.randomUUID()}:${key}`] = value;
  }
  const library = backup.version === 3 ? mergeQuestionLibrary(currentLibrary, backup.library, ids, recordedIds, experienceSets, collection) : currentLibrary;
  if (!validQuestionLibrary(library)) throw new Error("导入后的题库或资料关联无效，原数据未改变。");
  if (projects.length > 20 || history.length > 20) throw new Error("导入后将超过 20 个项目或训练记录上限；原数据未改变。");
  const values = [JSON.stringify(projects), JSON.stringify(history), JSON.stringify(drafts), JSON.stringify(profile), JSON.stringify(library)];
  if (values.some((value, index) => new Blob([value]).size > (index === 2 ? MAX_DRAFT_BYTES : index === 4 ? MAX_QUESTION_LIBRARY_BYTES : 2 * 1024 * 1024))) throw new Error("导入后超过本地容量上限，原数据未改变。");
  const written: typeof old = [];
  try { old.forEach((entry, index) => { storage.setItem(entry.key, values[index]); written.push(entry); }); }
  catch {
    try { for (const entry of written.reverse()) entry.raw === null ? storage.removeItem(entry.key) : storage.setItem(entry.key, entry.raw); }
    catch { throw new Error("导入失败且回滚未完成，请保留备份并停止继续操作。"); }
    throw new Error("导入失败，已回滚本次写入。请检查浏览器存储空间。");
  }
}
