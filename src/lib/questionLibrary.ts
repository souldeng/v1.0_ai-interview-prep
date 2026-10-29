import type { InterviewProject, InterviewSession, Question } from "./domain";
import type { StorageLike } from "./projectStorage";
import type { ExperiencePracticeSet } from "./experiencePractice";
import { validMaterialCollection, type MaterialCollection } from "./materialCollection";

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

export interface RecordedQuestion { id: string; question: string; projectId?: string; createdAt: string; }

export interface QuestionLibraryState {
  version: 1;
  favorites: string[];
  reuseDrafts: AnswerReuseDraft[];
  foundationReview?: Record<string, "new" | "learning" | "practiced">;
  recordedQuestions?: RecordedQuestion[];
  experienceSets?: ExperiencePracticeSet[];
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
  associatedProjectId?: string;
}

function browserStorage(): StorageLike {
  if (typeof localStorage === "undefined") throw new Error("当前环境不支持本地存储。");
  return localStorage;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const smallText = (value: unknown) => typeof value === "string" && new Blob([value]).size <= 12 * 1024;

export function emptyQuestionLibrary(): QuestionLibraryState { return { version: 1, favorites: [], reuseDrafts: [] }; }

export function validQuestionLibrary(value: unknown): value is QuestionLibraryState {
  return record(value) && value.version === 1 && Array.isArray(value.favorites) && value.favorites.every(item => typeof item === "string" && item.length <= 300)
    && (value.collection === undefined || validMaterialCollection(value.collection))
    && (value.recordedQuestions === undefined || Array.isArray(value.recordedQuestions) && value.recordedQuestions.every(item => record(item)
      && typeof item.id === "string" && /^recorded-[a-zA-Z0-9-]+$/.test(item.id) && typeof item.question === "string" && Boolean(item.question.trim()) && item.question.length <= 600
      && date(item.createdAt) && (item.projectId === undefined || typeof item.projectId === "string" && Boolean(item.projectId)))
      && new Set(value.recordedQuestions.map(item => item.id)).size === value.recordedQuestions.length)
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

export function recordedPracticeQuestion(item: RecordedQuestion, projects: InterviewProject[]): Question {
  const project = projects.find(project => project.id === item.projectId);
  return { id: item.id, text: item.question, category: "方案与业务", technical: false, sourceType: "user_recorded",
    source: `本人手动记录；平台未独立验证面试发生。${project ? `关联岗位：${project.jobTitle}（${project.id}）。` : item.projectId ? "原关联岗位不可用，本次可独立练习。" : "未关联岗位。"}记录时间：${item.createdAt}` };
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
    return { key, projectId: null, projectName: session.preparation.job.title || "独立训练记录", company: "独立训练记录", questionId: turn.questionId,
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
    const latest = entries.filter(entry => entry.sourceType === "user_recorded" && entry.questionId === item.id && entry.question === item.question && entry.turnIndex !== undefined && entry.sessionId)
      .sort((left, right) => (sessions.get(right.sessionId!)?.createdAt ?? "").localeCompare(sessions.get(left.sessionId!)?.createdAt ?? ""))[0];
    return { originalAnswer: "", suggestion: "", finalAnswer: "", answerStatus: "unanswered", ...latest, key, projectId: latest ? latest.projectId : project?.id ?? null, ...(item.projectId ? { associatedProjectId: item.projectId } : {}), projectName: project?.jobTitle ?? (item.projectId ? "原关联岗位不可用" : "未关联岗位"), company: project?.company ?? "未填写公司",
      recordedQuestionId: item.id, questionId: item.id, question: item.question, category: question.category, source: question.source, sourceType: question.sourceType,
      favorite: favorites.has(key) };
  });
  const recordedIds = new Set((state.recordedQuestions ?? []).map(item => item.id));
  return [...recorded, ...entries.filter(entry => !(entry.sourceType === "user_recorded" && recordedIds.has(entry.questionId)))]
    .sort((left, right) => (right.finalAnswerUpdatedAt ?? "").localeCompare(left.finalAnswerUpdatedAt ?? ""));
}

export function toggleLibraryFavorite(state: QuestionLibraryState, key: string): QuestionLibraryState {
  const favorites = new Set(state.favorites);
  favorites.has(key) ? favorites.delete(key) : favorites.add(key);
  return { ...state, favorites: [...favorites] };
}

export function createReuseDraft(source: LibraryQuestion, target: LibraryQuestion, now = new Date()): AnswerReuseDraft {
  if (!source.projectId || !target.projectId || !source.finalAnswer.trim()) throw new Error("只能引用岗位中已由用户确认的最终答案。");
  if (source.projectId === target.projectId) throw new Error("请选择另一个岗位中的题目作为引用目标。");
  const timestamp = now.toISOString();
  return { id: `reuse-${crypto.randomUUID()}`, sourceKey: source.key, targetKey: target.key, sourceProjectId: source.projectId, targetProjectId: target.projectId, answer: source.finalAnswer.trim(), createdAt: timestamp, updatedAt: timestamp };
}
