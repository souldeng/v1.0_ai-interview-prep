import type { InterviewProject, InterviewSession, Question } from "./domain";
import type { StorageLike } from "./projectStorage";
import type { ExperiencePracticeSet } from "./experiencePractice";
import { validMaterialCollection, type MaterialCollection } from "./materialCollection";
import { validConfirmedResumePracticeSet, type ConfirmedResumePracticeSet } from "./confirmedResumePractice";

export const QUESTION_LIBRARY_KEY = "ai-interview-question-library-v1";
// This existing key now also holds collected source text; quota errors still fail closed.
export const MAX_QUESTION_LIBRARY_BYTES = 2 * 1024 * 1024;

export interface AnswerReuseDraft {
  id: string;
  sourceKey: string;
  targetKey: string;
  sourceProjectId: string;
  targetProjectId: string;
  answer: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}

/** Batch imports can preserve their declared origin without creating another question bank. */
export type ImportedRecordSourceType = "user_recorded" | "ai_prediction";

export interface RecordedQuestion {
  id: string; question: string; projectId?: string; createdAt: string;
  /** 面经章节分类（如「A. 个人背景与职业选择」）；手动单题录入时无。 */
  category?: string;
  /** 原始面经中的顺序（从 1 开始）。 */
  order?: number;
  /** 原始面经记录 id（importSources），用于追溯来源。 */
  importSourceId?: string;
  /** 由哪道旧题目拆分而来（第九节：拆分保留旧记录，不覆盖原 ID）。 */
  splitFromId?: string;
  /** 缺失时兼容旧数据，按本人记录的真实面试题处理。 */
  sourceType?: ImportedRecordSourceType;
}

/** 批量导入原始文本，供题目追溯；不进入个人事实或岗位上下文。 */
export interface ImportedRecordSource { id: string; title: string; content: string; createdAt: string; feedback?: string[]; sourceType?: ImportedRecordSourceType; }

/** 已加入岗位专项题库的 AI 分析推荐题：按 analysisId+rowIndex 追溯，不按题目文本关联。 */
export interface JobRecommendedQuestion { id: string; projectId: string; analysisId: string; rowIndex: number; question: string; createdAt: string; }

export interface QuestionLibraryState {
  version: 1;
  favorites: string[];
  reuseDrafts: AnswerReuseDraft[];
  foundationReview?: Record<string, "new" | "learning" | "practiced">;
  recordedQuestions?: RecordedQuestion[];
  importSources?: ImportedRecordSource[];
  jobRecommendedQuestions?: JobRecommendedQuestion[];
  experienceSets?: ExperiencePracticeSet[];
  resumeSets?: ConfirmedResumePracticeSet[];
  collection?: MaterialCollection;
}

export type LibraryAnswerStatus = "unanswered" | "answered" | "final";
export interface LibraryQuestion {
  key: string;
  projectId: string | null;
  projectName: string;
  company: string;
  questionId: string;
  question: string;
  category: string;
  source: string;
  sourceType: Question["sourceType"] | "training";
  originalAnswer: string;
  suggestion: string;
  finalAnswer: string;
  finalAnswerUpdatedAt?: string;
  answerStatus: LibraryAnswerStatus;
  favorite: boolean;
  sessionId?: string;
  turnIndex?: number;
  recordedQuestionId?: string;
  recommendedQuestionId?: string;
  associatedProjectId?: string;
  /** 本人记录题目的面经分类、原始顺序与来源追溯。 */
  recordedCategory?: string;
  recordedOrder?: number;
  splitFromId?: string;
  importSourceId?: string;
}

function browserStorage(): StorageLike {
  if (typeof localStorage === "undefined") throw new Error("当前环境不支持本地存储。");
  return localStorage;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const smallText = (value: unknown) => typeof value === "string" && new Blob([value]).size <= 12 * 1024;
const MAX_IMPORT_SOURCE_BYTES = 32 * 1024;
const MAX_IMPORT_SOURCES = 40;
const importedRecordSourceType = (value: unknown): value is ImportedRecordSourceType => value === "user_recorded" || value === "ai_prediction";

export function emptyQuestionLibrary(): QuestionLibraryState { return { version: 1, favorites: [], reuseDrafts: [] }; }

export function validQuestionLibrary(value: unknown): value is QuestionLibraryState {
  return record(value) && value.version === 1 && Array.isArray(value.favorites) && value.favorites.every(item => typeof item === "string" && item.length <= 300)
    && (value.collection === undefined || validMaterialCollection(value.collection))
    && (value.importSources === undefined || Array.isArray(value.importSources) && value.importSources.length <= MAX_IMPORT_SOURCES && value.importSources.every(item => record(item)
      && typeof item.id === "string" && /^import-[a-zA-Z0-9-]+$/.test(item.id) && typeof item.title === "string" && item.title.length <= 200
      && typeof item.content === "string" && item.content.trim() && new Blob([item.content]).size <= MAX_IMPORT_SOURCE_BYTES
      && date(item.createdAt) && (item.feedback === undefined || Array.isArray(item.feedback) && item.feedback.every(f => typeof f === "string" && f.trim() && f.length <= 1000))
      && (item.sourceType === undefined || importedRecordSourceType(item.sourceType)))
      && new Set(value.importSources.map(item => item.id)).size === value.importSources.length)
    && (value.recordedQuestions === undefined || Array.isArray(value.recordedQuestions) && value.recordedQuestions.every(item => record(item)
      && typeof item.id === "string" && /^recorded-[a-zA-Z0-9-]+$/.test(item.id) && typeof item.question === "string" && Boolean(item.question.trim()) && item.question.length <= 600
      && date(item.createdAt) && (item.projectId === undefined || typeof item.projectId === "string" && Boolean(item.projectId))
      && (item.category === undefined || typeof item.category === "string" && item.category.length <= 120)
      && (item.order === undefined || typeof item.order === "number" && Number.isInteger(item.order) && item.order >= 0)
      && (item.importSourceId === undefined || typeof item.importSourceId === "string" && Boolean(item.importSourceId))
      && (item.splitFromId === undefined || typeof item.splitFromId === "string" && Boolean(item.splitFromId))
      && (item.sourceType === undefined || importedRecordSourceType(item.sourceType)))
      && new Set(value.recordedQuestions.map(item => item.id)).size === value.recordedQuestions.length)
    && (value.jobRecommendedQuestions === undefined || Array.isArray(value.jobRecommendedQuestions) && value.jobRecommendedQuestions.length <= 100 && value.jobRecommendedQuestions.every(item => record(item)
      && typeof item.id === "string" && /^jobrec-[a-zA-Z0-9-]+$/.test(item.id)
      && typeof item.projectId === "string" && Boolean(item.projectId)
      && typeof item.analysisId === "string" && Boolean(item.analysisId)
      && typeof item.rowIndex === "number" && Number.isSafeInteger(item.rowIndex) && item.rowIndex >= 0 && item.rowIndex <= 11
      && typeof item.question === "string" && Boolean(item.question.trim()) && item.question.length <= 500
      && date(item.createdAt))
      && new Set(value.jobRecommendedQuestions.map(item => item.id)).size === value.jobRecommendedQuestions.length)
    && (value.foundationReview === undefined || record(value.foundationReview) && Object.entries(value.foundationReview).every(([id,status]) => id.startsWith("foundation-") && ["new", "learning", "practiced"].includes(String(status))))
    && (value.experienceSets === undefined || Array.isArray(value.experienceSets) && value.experienceSets.every(set => record(set)
      && ["id", "experienceId", "title", "contentVersion"].every(key => typeof set[key] === "string" && Boolean(set[key])) && date(set.createdAt)
      && Array.isArray(set.questions) && set.questions.length >= 3 && set.questions.length <= 200 && set.questions.every((q: unknown) => record(q)
        && typeof q.id === "string" && typeof q.text === "string" && Boolean(q.text.trim()) && q.text.length <= 300 && q.sourceType === "experience_practice"
        && typeof q.source === "string" && q.category === "经历复盘" && typeof q.technical === "boolean" && record(q.experienceOrigin)
        && q.experienceOrigin.experienceId === set.experienceId && q.experienceOrigin.setId === set.id && q.experienceOrigin.contentVersion === set.contentVersion && typeof q.experienceOrigin.basisQuote === "string")
      && new Set(set.questions.map((q: { id: string }) => q.id)).size === set.questions.length
      && (set.hiddenQuestionIds === undefined || Array.isArray(set.hiddenQuestionIds) && set.hiddenQuestionIds.every((id: unknown) => typeof id === "string" && (set.questions as Array<{id: string}>).some(q => q.id === id)))
      && set.questions.filter((q: {id: string}) => !(set.hiddenQuestionIds as string[] | undefined)?.includes(q.id)).length <= 20)
      && new Set(value.experienceSets.map(set => set.id)).size === value.experienceSets.length)
    && (value.resumeSets === undefined || Array.isArray(value.resumeSets) && value.resumeSets.every(validConfirmedResumePracticeSet)
      && new Set(value.resumeSets.map(set => set.id)).size === value.resumeSets.length)
    && Array.isArray(value.reuseDrafts) && value.reuseDrafts.every(item => record(item)
      && ["id", "sourceKey", "targetKey", "sourceProjectId", "targetProjectId", "createdAt", "updatedAt"].every(key => typeof item[key] === "string")
      && smallText(item.answer) && date(item.createdAt) && date(item.updatedAt) && (item.confirmedAt === undefined || date(item.confirmedAt)));
}

export function loadQuestionLibrary(storage: StorageLike = browserStorage()): QuestionLibraryState {
  try {
    const raw = storage.getItem(QUESTION_LIBRARY_KEY);
    if (!raw) return emptyQuestionLibrary();
    const parsed = JSON.parse(raw);
    return validQuestionLibrary(parsed) ? parsed : emptyQuestionLibrary();
  } catch { return emptyQuestionLibrary(); }
}

export function saveQuestionLibrary(state: QuestionLibraryState, storage: StorageLike = browserStorage()): QuestionLibraryState {
  if (!validQuestionLibrary(state)) throw new Error("题库索引结构无效，未保存。");
  const existing = storage.getItem(QUESTION_LIBRARY_KEY);
  if (existing && !validQuestionLibrary(JSON.parse(existing))) throw new Error("已有题库索引损坏，请先导出文字与训练备份，避免覆盖。");
  const encoded = JSON.stringify(state);
  if (new Blob([encoded]).size > MAX_QUESTION_LIBRARY_BYTES) throw new Error("题库与收集资料超过约2MB，本次未保存；请先备份并整理，已有记录仍保留。");
  storage.setItem(QUESTION_LIBRARY_KEY, encoded);
  return state;
}

export function projectQuestionKey(projectId: string, questionId: string) { return `project:${projectId}:question:${questionId}`; }
export function historyQuestionKey(sessionId: string, turnIndex: number) { return `history:${sessionId}:turn:${turnIndex}`; }

export function createRecordedQuestion(question: string, projectId?: string, now = new Date()): RecordedQuestion {
  if (!question.trim() || question.length > 600) throw new Error("请输入一道面试问题，最多600字；原文字保留。");
  return { id: `recorded-${crypto.randomUUID()}`, question, ...(projectId ? { projectId } : {}), createdAt: now.toISOString() };
}

export interface ImportedQuestionDraft {
  question: string;
  category?: string;
  order?: number;
  projectId?: string;
  /** 拆分历史题目时指向旧题目 id；旧记录保留原样，不覆盖原 ID。 */
  splitFromId?: string;
}

export function createImportSource(title: string, content: string, feedback: string[] = [], sourceType: ImportedRecordSourceType = "user_recorded", now = new Date()): ImportedRecordSource {
  if (!content.trim()) throw new Error("原始记录内容为空，未保存。");
  if (new Blob([content]).size > MAX_IMPORT_SOURCE_BYTES) throw new Error("原始记录超过32KB本地安全上限，未保存；请精简或分段导入。");
  return { id: `import-${crypto.randomUUID()}`, title: (title || (sourceType === "ai_prediction" ? "粘贴的 AI 预测题" : "粘贴的真实面试记录")).slice(0, 200), content, ...(feedback.length ? { feedback: feedback.filter(f => f.trim()).map(f => f.slice(0, 1000)) } : {}), sourceType, createdAt: now.toISOString() };
}

/** 批量保存用户确认后的候选题目；任一题目非法则整批失败，调用方保留预览以便重试。 */
export function createRecordedQuestions(drafts: ImportedQuestionDraft[], importSourceId?: string, sourceType: ImportedRecordSourceType = "user_recorded", now = new Date()): RecordedQuestion[] {
  if (!drafts.length) throw new Error("没有可保存的题目。");
  return drafts.map((draft, index) => {
    if (!draft.question.trim() || draft.question.length > 600) throw new Error(`第 ${index + 1} 题为空或超过600字上限，整批未保存；请在预览中精简后再导入。`);
    if (draft.category !== undefined && draft.category.length > 120) throw new Error(`第 ${index + 1} 题分类过长，整批未保存。`);
    return {
      id: `recorded-${crypto.randomUUID()}`, question: draft.question.trim(),
      ...(draft.category ? { category: draft.category } : {}), ...(draft.order !== undefined ? { order: draft.order } : {}),
      ...(importSourceId ? { importSourceId } : {}), ...(draft.splitFromId ? { splitFromId: draft.splitFromId } : {}),
      ...(draft.projectId ? { projectId: draft.projectId } : {}), sourceType, createdAt: now.toISOString(),
    };
  });
}

/** 推荐题在训练/题库中使用的稳定 ID（与 analysisPracticeQuestion 一致）。 */
export function recommendedQuestionKey(item: Pick<JobRecommendedQuestion, "projectId" | "analysisId" | "rowIndex">): string {
  return `analysis:${encodeURIComponent(item.projectId)}:${encodeURIComponent(item.analysisId)}:${item.rowIndex}`;
}

/** 将一道岗位分析推荐题加入岗位专项题库；同分析同行重复加入由调用方拦截。 */
export function createJobRecommendedQuestion(projectId: string, analysisId: string, rowIndex: number, question: string, now = new Date()): JobRecommendedQuestion {
  if (!projectId.trim() || !analysisId.trim()) throw new Error("推荐题缺少岗位或分析来源，未加入题库。");
  if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex > 11) throw new Error("推荐题行号无效，未加入题库。");
  const text = question.trim();
  if (!text || text.length > 500) throw new Error("推荐题内容为空或超过 500 字上限，未加入题库。");
  return { id: `jobrec-${crypto.randomUUID()}`, projectId, analysisId, rowIndex, question: text, createdAt: now.toISOString() };
}

export function recordedPracticeQuestion(item: RecordedQuestion, projects: InterviewProject[]): Question {
  const project = projects.find(project => project.id === item.projectId);
  const sourceType = item.sourceType ?? "user_recorded";
  const origin = sourceType === "ai_prediction"
    ? "AI 预测题；仅供练习，不是企业真实面试记录、第三方面经或已确认个人事实。"
    : "本人记录的真实面试题；平台未独立验证面试发生。";
  return { id: item.id, text: item.question, category: "方案与业务", technical: false, sourceType,
    source: `${origin}${item.category ? `${sourceType === "ai_prediction" ? "题库分类" : "面经分类"}：${item.category}。` : ""}${item.order !== undefined ? `原始顺序：第${item.order}题。` : ""}${project ? `关联岗位：${project.jobTitle}（${project.id}）。` : item.projectId ? "原关联岗位不可用，本次可独立练习。" : "未关联岗位。"}记录时间：${item.createdAt}` };
}

function answerStatus(originalAnswer: string, finalAnswer: string): LibraryAnswerStatus {
  return finalAnswer.trim() ? "final" : originalAnswer.trim() ? "answered" : "unanswered";
}

function projectEntries(project: InterviewProject, favorites: Set<string>): LibraryQuestion[] {
  const session = project.session;
  const turns = session?.turns ?? [];
  const byQuestionId = new Map<string, { turn: InterviewSession["turns"][number]; index: number }>();
  turns.forEach((turn, index) => byQuestionId.set(turn.questionId, { turn, index }));
  const prepQuestions = new Map([...(session?.preparation.questions ?? project.preparation?.questions ?? []), ...(session?.questions ?? [])].map(question => [question.id, question]));
  const entries: LibraryQuestion[] = project.questions.map(question => {
    const found = byQuestionId.get(question.id);
    const turn = found?.turn;
    const key = projectQuestionKey(project.id, question.id);
    const originalAnswer = turn?.answer ?? question.userAnswer ?? "";
    const finalAnswer = turn?.finalAnswer ?? "";
    const sourceQuestion = prepQuestions.get(question.id);
    const sourceType: LibraryQuestion["sourceType"] = sourceQuestion?.sourceType ?? "training";
    return {
      key, projectId: project.id, projectName: project.jobTitle || "未命名岗位", company: project.company || "未填写公司", questionId: question.id,
      question: question.question, category: question.category || "未分类", source: sourceQuestion?.source ?? question.whyAsk ?? "岗位训练题",
      sourceType, originalAnswer, suggestion: turn?.aiCoach ? `AI 教练建议（需本人核对）：${turn.aiCoach.issues.join("；")} ${turn.aiCoach.suggestions.join("；")}` : turn?.score.referenceAnswer ?? "", finalAnswer,
      ...(turn?.finalAnswerUpdatedAt ? { finalAnswerUpdatedAt: turn.finalAnswerUpdatedAt } : {}), answerStatus: answerStatus(originalAnswer, finalAnswer),
      favorite: favorites.has(key), ...(session && found ? { sessionId: session.id, turnIndex: found.index } : {}),
    };
  });
  const followUpIds = new Set<string>();
  turns.forEach((turn, index) => {
    if (!turn.questionId.endsWith("-followup")) return;
    const baseKey = projectQuestionKey(project.id, turn.questionId);
    // Preserve existing keys; repeated legacy IDs need an additional immutable turn index.
    const key = followUpIds.has(turn.questionId) ? `${baseKey}:turn:${index}` : baseKey;
    followUpIds.add(turn.questionId);
    const recorded = session?.questions.find(question => question.id === turn.questionId && question.text === turn.question);
    entries.push({ key, projectId: project.id, projectName: project.jobTitle || "未命名岗位", company: project.company || "未填写公司", questionId: turn.questionId,
      question: turn.question, category: "追问", source: recorded?.source ?? "训练中的追问", sourceType: recorded?.sourceType ?? "training", originalAnswer: turn.answer, suggestion: turn.aiCoach ? `AI 教练建议（需本人核对）：${turn.aiCoach.issues.join("；")} ${turn.aiCoach.suggestions.join("；")}` : turn.score.referenceAnswer ?? "", finalAnswer: turn.finalAnswer ?? "",
      ...(turn.finalAnswerUpdatedAt ? { finalAnswerUpdatedAt: turn.finalAnswerUpdatedAt } : {}), answerStatus: answerStatus(turn.answer, turn.finalAnswer ?? ""), favorite: favorites.has(key), ...(session ? { sessionId: session.id, turnIndex: index } : {}),
    });
  });
  return entries;
}

function historyEntries(history: InterviewSession[], favorites: Set<string>): LibraryQuestion[] {
  return history.flatMap(session => session.turns.map((turn, turnIndex) => {
    const sourceQuestion = [...session.questions, ...session.preparation.questions].find(question => question.id === turn.questionId && question.text === turn.question);
    const key = historyQuestionKey(session.id, turnIndex);
    // 岗位归属只读结构化字段（preparation.job.projectId），标题字符串不作为关系依据。
    const job = session.preparation.job;
    const ownerName = job.projectId && job.projectName?.trim() ? job.projectName.trim() : null;
    return { key, projectId: null, projectName: ownerName ?? (session.preparation.job.title || "独立训练记录"), company: ownerName ? "岗位专项训练" : "独立训练记录", questionId: turn.questionId,
      ...(job.projectId && ownerName ? { associatedProjectId: job.projectId } : {}),
      question: turn.question, category: sourceQuestion?.category ?? (turn.questionId.endsWith("-followup") ? "追问" : "未分类"), source: sourceQuestion?.source ?? "训练记录", sourceType: sourceQuestion?.sourceType ?? "training",
      originalAnswer: turn.answer, suggestion: turn.aiCoach ? `AI 教练建议（需本人核对）：${turn.aiCoach.issues.join("；")} ${turn.aiCoach.suggestions.join("；")}` : turn.score.referenceAnswer ?? "", finalAnswer: turn.finalAnswer ?? "", ...(turn.finalAnswerUpdatedAt ? { finalAnswerUpdatedAt: turn.finalAnswerUpdatedAt } : {}),
      answerStatus: answerStatus(turn.answer, turn.finalAnswer ?? ""), favorite: favorites.has(key), sessionId: session.id, turnIndex,
    };
  }));
}

/** Builds a read-only index from existing project/session records. No question or answer is generated here. */
export function buildLibraryQuestions(projects: InterviewProject[], history: InterviewSession[], state: QuestionLibraryState): LibraryQuestion[] {
  const favorites = new Set(state.favorites);
  const entries = [...projects.flatMap(project => projectEntries(project, favorites)), ...historyEntries(history, favorites)];
  const sessions = new Map([...history, ...projects.flatMap(project => project.session ? [project.session] : [])].map(session => [session.id, session]));
  const recorded = (state.recordedQuestions ?? []).map((item): LibraryQuestion => {
    const project = projects.find(project => project.id === item.projectId), question = recordedPracticeQuestion(item, projects), key = `recorded:${item.id}`;
    const latest = entries.filter(entry => entry.sourceType === question.sourceType && entry.questionId === item.id && entry.question === item.question && entry.turnIndex !== undefined && entry.sessionId)
      .sort((left, right) => (sessions.get(right.sessionId!)?.createdAt ?? "").localeCompare(sessions.get(left.sessionId!)?.createdAt ?? ""))[0];
    return { originalAnswer: "", suggestion: "", finalAnswer: "", answerStatus: "unanswered", ...latest, key, projectId: latest ? latest.projectId : project?.id ?? null, ...(item.projectId ? { associatedProjectId: item.projectId } : {}), projectName: project?.jobTitle ?? (item.projectId ? "原关联岗位不可用" : "未关联岗位"), company: project?.company ?? "未填写公司",
      recordedQuestionId: item.id, questionId: item.id, question: item.question, category: question.category, source: question.source, sourceType: question.sourceType,
      ...(item.category ? { recordedCategory: item.category } : {}), ...(item.order !== undefined ? { recordedOrder: item.order } : {}),
      ...(item.splitFromId ? { splitFromId: item.splitFromId } : {}), ...(item.importSourceId ? { importSourceId: item.importSourceId } : {}),
      favorite: favorites.has(key) };
  });
  const recordedIds = new Set((state.recordedQuestions ?? []).map(item => item.id));
  const recommended = (state.jobRecommendedQuestions ?? []).map((item): LibraryQuestion => {
    const project = projects.find(p => p.id === item.projectId);
    const questionId = recommendedQuestionKey(item);
    const latest = entries.filter(entry => entry.sourceType === "analysis_recommendation" && entry.questionId === questionId && entry.turnIndex !== undefined && entry.sessionId)
      .sort((left, right) => (sessions.get(right.sessionId!)?.createdAt ?? "").localeCompare(sessions.get(left.sessionId!)?.createdAt ?? ""))[0];
    return { originalAnswer: "", suggestion: "", finalAnswer: "", answerStatus: "unanswered", ...latest,
      key: `jobrec:${item.id}`, projectId: latest ? latest.projectId : item.projectId, associatedProjectId: item.projectId,
      projectName: project?.jobTitle ?? "原关联岗位不可用", company: project?.company ?? "未填写公司",
      questionId, question: item.question, category: "方案与业务",
      source: latest?.source ?? "AI 岗位分析推荐（非企业面试原题）；已加入岗位专项题库。", sourceType: "analysis_recommendation",
      favorite: favorites.has(`jobrec:${item.id}`), recommendedQuestionId: item.id };
  });
  const recommendedTrainedIds = new Set((state.jobRecommendedQuestions ?? []).map(item => recommendedQuestionKey(item)));
  return [...recorded, ...recommended, ...entries.filter(entry => !((entry.sourceType === "user_recorded" || entry.sourceType === "ai_prediction") && recordedIds.has(entry.questionId)) && !(entry.sourceType === "analysis_recommendation" && recommendedTrainedIds.has(entry.questionId)))]
    .sort((left, right) => (right.finalAnswerUpdatedAt ?? "").localeCompare(left.finalAnswerUpdatedAt ?? ""));
}

export function toggleLibraryFavorite(state: QuestionLibraryState, key: string): QuestionLibraryState {
  const favorites = new Set(state.favorites);
  favorites.has(key) ? favorites.delete(key) : favorites.add(key);
  return { ...state, favorites: [...favorites] };
}

/** 删除题目/题组：只移除题库索引记录；训练历史、原答、点评与最终答案保存在会话中，不受影响（E-03/F-05 保护边界）。 */
export function deleteRecordedQuestion(state: QuestionLibraryState, id: string): QuestionLibraryState {
  const list = state.recordedQuestions ?? [];
  const next = list.filter(item => item.id !== id);
  if (next.length === list.length) throw new Error("题目不存在或已删除，未更改任何数据。");
  return { ...state, favorites: state.favorites.filter(key => key !== `recorded:${id}`), recordedQuestions: next.length ? next : undefined };
}
export function deleteJobRecommendedQuestion(state: QuestionLibraryState, id: string): QuestionLibraryState {
  const list = state.jobRecommendedQuestions ?? [];
  const next = list.filter(item => item.id !== id);
  if (next.length === list.length) throw new Error("题目不存在或已删除，未更改任何数据。");
  return { ...state, favorites: state.favorites.filter(key => key !== `jobrec:${id}`), jobRecommendedQuestions: next.length ? next : undefined };
}
export function deleteExperienceSet(state: QuestionLibraryState, id: string): QuestionLibraryState {
  const list = state.experienceSets ?? [];
  const next = list.filter(item => item.id !== id);
  if (next.length === list.length) throw new Error("题组不存在或已删除，未更改任何数据。");
  return { ...state, experienceSets: next.length ? next : undefined };
}
export function deleteResumeSet(state: QuestionLibraryState, id: string): QuestionLibraryState {
  const list = state.resumeSets ?? [];
  const next = list.filter(item => item.id !== id);
  if (next.length === list.length) throw new Error("题组不存在或已删除，未更改任何数据。");
  return { ...state, resumeSets: next.length ? next : undefined };
}

export function createReuseDraft(source: LibraryQuestion, target: LibraryQuestion, now = new Date()): AnswerReuseDraft {
  if (!source.projectId || !target.projectId || !source.finalAnswer.trim()) throw new Error("只能引用岗位中已由用户确认的最终答案。");
  if (source.projectId === target.projectId) throw new Error("请选择另一个岗位中的题目作为引用目标。");
  const timestamp = now.toISOString();
  return { id: `reuse-${crypto.randomUUID()}`, sourceKey: source.key, targetKey: target.key, sourceProjectId: source.projectId, targetProjectId: target.projectId, answer: source.finalAnswer.trim(), createdAt: timestamp, updatedAt: timestamp };
}
