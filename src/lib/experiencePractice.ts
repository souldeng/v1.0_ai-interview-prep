import type { ExperienceCard, ExperienceField, Question, UserProfile } from "./domain";
import { buildInterviewContext, experienceSource } from "./interviewContext";
import type { QuestionLibraryState } from "./questionLibrary";
import type { StorageLike } from "./projectStorage";

export interface ExperiencePracticeSet {
  id: string;
  experienceId: string;
  title: string;
  contentVersion: string;
  createdAt: string;
  questions: Question[];
  hiddenQuestionIds?: string[];
  /** Non-fatal model-output issues from the generation that created this set. */
  generationIssues?: ExperienceGenerationIssue[];
}
export interface ExperienceQuestionInput { text: string; basisQuote?: string; basisField?: ExperienceField }
export interface ExperienceGenerationIssue { index: number; reason: "structure" | "duplicate" | "evidence"; message: string }

/** A recoverable candidate remains outside the public question-library backup until it is formally saved. */
export const PENDING_EXPERIENCE_SET_KEY = "ai-interview-experience-candidate-v1";

function candidateStorage(): StorageLike {
  if (typeof localStorage === "undefined") throw new Error("当前环境不支持本地存储。");
  return localStorage;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const dated = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function validExperiencePracticeSet(value: unknown): value is ExperiencePracticeSet {
  if (!record(value) || !["id", "experienceId", "title", "contentVersion"].every(key => typeof value[key] === "string" && Boolean(String(value[key]).trim())) || !dated(value.createdAt) || !Array.isArray(value.questions) || value.questions.length < 3 || value.questions.length > 200) return false;
  const questions = value.questions;
  const questionsValid = questions.every(question => record(question)
    && typeof question.id === "string" && Boolean(question.id) && typeof question.text === "string" && Boolean(question.text.trim()) && question.text.length <= 300
    && question.sourceType === "experience_practice" && question.category === "经历复盘" && typeof question.technical === "boolean" && record(question.experienceOrigin)
    && question.experienceOrigin.experienceId === value.experienceId && question.experienceOrigin.setId === value.id && question.experienceOrigin.contentVersion === value.contentVersion && typeof question.experienceOrigin.basisQuote === "string" && Boolean(question.experienceOrigin.basisQuote.trim()));
  const hiddenIds = value.hiddenQuestionIds;
  const hiddenValid = hiddenIds === undefined || Array.isArray(hiddenIds) && hiddenIds.every(id => typeof id === "string" && questions.some(question => record(question) && question.id === id));
  const issuesValid = value.generationIssues === undefined || Array.isArray(value.generationIssues) && value.generationIssues.every(issue => record(issue) && typeof issue.index === "number" && Number.isInteger(issue.index) && issue.index > 0 && ["structure", "duplicate", "evidence"].includes(String(issue.reason)) && typeof issue.message === "string" && Boolean(issue.message.trim()) && issue.message.length <= 300);
  return questionsValid && hiddenValid && issuesValid && new Set(questions.map(question => record(question) ? String(question.id) : "")).size === questions.length;
}

export function loadPendingExperiencePracticeSet(storage: StorageLike = candidateStorage()): ExperiencePracticeSet | null {
  try {
    const raw = storage.getItem(PENDING_EXPERIENCE_SET_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validExperiencePracticeSet(parsed) ? parsed : null;
  } catch { return null; }
}

export function savePendingExperiencePracticeSet(set: ExperiencePracticeSet, storage: StorageLike = candidateStorage()): void {
  if (!validExperiencePracticeSet(set)) throw new Error("候选专项题组结构无效，未保存。");
  storage.setItem(PENDING_EXPERIENCE_SET_KEY, JSON.stringify(set));
}

export function clearPendingExperiencePracticeSet(storage: StorageLike = candidateStorage()): void {
  storage.removeItem(PENDING_EXPERIENCE_SET_KEY);
}

export function isPendingExperiencePracticeSetCurrent(profile: UserProfile, set: ExperiencePracticeSet): boolean {
  const card = profile.experiences.find(item => item.id === set.experienceId);
  return Boolean(card?.confirmed && experienceVersion(card) === set.contentVersion);
}

/** Exact content comparison: changing timestamps alone does not invalidate a set. */
export function experienceVersion(card: ExperienceCard): string {
  return JSON.stringify([card.title, card.type ?? "", card.situation, card.action, card.tools ?? "", card.result, card.reflection, card.notes ?? "", card.sourceResumeId ?? "", card.sourceQuotes ?? []]);
}
export function currentExperienceSet(state: QuestionLibraryState, card: ExperienceCard): ExperiencePracticeSet | undefined {
  return card.confirmed ? [...(state.experienceSets ?? [])].reverse().find(set => set.experienceId === card.id && set.contentVersion === experienceVersion(card)) : undefined;
}
export const visibleExperienceQuestions = (set: ExperiencePracticeSet) => set.questions.filter(q => !set.hiddenQuestionIds?.includes(q.id));
export function setExperienceQuestionHidden(set: ExperiencePracticeSet, questionId: string, hidden: boolean): ExperiencePracticeSet {
  if (!set.questions.some(q => q.id === questionId)) throw new Error("题目不存在。");
  return { ...set, hiddenQuestionIds: hidden ? [...new Set([...(set.hiddenQuestionIds ?? []), questionId])] : (set.hiddenQuestionIds ?? []).filter(id => id !== questionId) };
}
const normalized = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const sourceFields: ExperienceField[] = ["situation", "action", "tools", "result", "reflection"];

function sourceQuote(card: ExperienceCard, input: ExperienceQuestionInput): string | null {
  const field = input.basisField;
  if (field && sourceFields.includes(field)) {
    const value = (card[field] ?? "").trim();
    if (!value) return null;
    if (input.basisQuote?.trim() && !value.includes(input.basisQuote.trim())) return null;
    return input.basisQuote?.trim() || value;
  }
  const quote = input.basisQuote?.trim();
  if (!quote) return null;
  return [card.title, ...sourceFields.map(key => card[key] ?? "")].some(value => value.includes(quote)) ? quote : null;
}

function questionKey(text: string) {
  return normalized(text);
}

function duplicates(key: string, seen: Set<string>) {
  return !key || seen.has(key) || [...seen].some(previous => previous.includes(key) || key.includes(previous));
}

function checkedInputs(card: ExperienceCard, inputs: unknown, existing: string[] = []) {
  if (!Array.isArray(inputs)) throw new Error("模型返回的专项题结构损坏，未保存本次结果。已有题组与回答仍保留。");
  const issues: ExperienceGenerationIssue[] = [];
  const seen = new Set(existing.map(questionKey));
  const valid: Array<{ text: string; basisQuote: string }> = [];
  for (const [index, raw] of inputs.entries()) {
    if (index >= 5) { issues.push({ index: index + 1, reason: "structure", message: "超过本次最多 5 道题，未采用。" }); continue; }
    if (!raw || typeof raw !== "object") { issues.push({ index: index + 1, reason: "structure", message: "题目字段不完整，未采用。" }); continue; }
    const input = raw as ExperienceQuestionInput;
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 300) { issues.push({ index: index + 1, reason: "structure", message: "题目正文无效，未采用。" }); continue; }
    const key = questionKey(input.text);
    if (duplicates(key, seen)) { issues.push({ index: index + 1, reason: "duplicate", message: "与本组已有题重复或过于相似，未采用。" }); continue; }
    const basisQuote = sourceQuote(card, input);
    if (!basisQuote) { issues.push({ index: index + 1, reason: "evidence", message: "未能对应到这段已确认经历的字段，未采用。" }); continue; }
    seen.add(key); valid.push({ text: input.text.trim(), basisQuote });
  }
  return { valid, issues };
}

function createQuestion(setId: string, card: ExperienceCard, contentVersion: string, input: { text: string; basisQuote: string }, index: number): Question {
  return {
    id: `${setId}-q${index + 1}`, text: input.text, category: "经历复盘", technical: false, sourceType: "experience_practice",
    source: `AI 根据已确认经历“${card.title}”生成的专项题，非企业真实原题。`,
    experienceOrigin: { experienceId: card.id, setId, contentVersion, basisQuote: input.basisQuote },
  };
}

export function appendExperienceQuestions(set: ExperiencePracticeSet, card: ExperienceCard, inputs: ExperienceQuestionInput[]) {
  if (!card.confirmed || card.id !== set.experienceId || experienceVersion(card) !== set.contentVersion) throw new Error("经历已变化或未确认，请重新生成题组。");
  if (visibleExperienceQuestions(set).length >= 20) throw new Error("当前已有20道题，请先整理题目或重新生成。");
  if (set.questions.length >= 200) throw new Error("本组保留的历史题目已达安全上限，请重新生成题组；旧历史仍保留。");
  const { valid, issues } = checkedInputs(card, inputs, set.questions.map(question => question.text));
  if (!valid.length) return { set: { ...set, generationIssues: issues }, added: 0 };
  const selected = valid.slice(0, Math.min(20 - visibleExperienceQuestions(set).length, 200 - set.questions.length));
  const questions = selected.map((item, index) => ({ ...createQuestion(set.id, card, set.contentVersion, item, set.questions.length + index), id: `${set.id}-q-${crypto.randomUUID()}` }));
  return { set: { ...set, questions: [...set.questions, ...questions], generationIssues: issues.length ? issues : undefined }, added: questions.length };
}
export function createExperienceSet(card: ExperienceCard, input: ExperienceQuestionInput[]): ExperiencePracticeSet {
  if (!card.confirmed) throw new Error("请先确认这段经历，再生成专项题。");
  const { valid, issues } = checkedInputs(card, input);
  if (valid.length < 3) throw new Error(`专项题仅有 ${valid.length} 道可核对题目，至少需要 3 道才会保存。${issues.length ? " 已说明未采用的题目原因；" : ""}已有题组与回答仍保留。`);
  const id = `experience-set-${crypto.randomUUID()}`, contentVersion = experienceVersion(card);
  return { id, experienceId: card.id, title: card.title, contentVersion, createdAt: new Date().toISOString(), questions: valid.map((item, index) => createQuestion(id, card, contentVersion, item, index)), ...(issues.length ? { generationIssues: issues } : {}) };
}
export function experiencePracticeContext(profile: UserProfile, question: Question, userAnswer?: string) {
  const origin = question.experienceOrigin;
  const card = origin ? profile.experiences.find(card => card.id === origin.experienceId && card.confirmed && experienceVersion(card) === origin.contentVersion) : undefined;
  const context = buildInterviewContext({ profile: { ...profile, experiences: [], supplementaryInfo: "" }, currentQuestion: question.text, userAnswer });
  // A single card is already bounded by profile validation. Keep its complete fields:
  // the general multi-card context's 1200-character cap could omit a late responsibility boundary.
  context.confirmedUserFacts = card ? [[`经历：${card.title}`, card.situation && `背景：${card.situation}`, card.action && `本人行动：${card.action}`,
    card.tools && `工具与方法：${card.tools}`, card.result && `结果或证据：${card.result}`, card.reflection && `复盘：${card.reflection}`].filter(Boolean).join("；")] : [];
  context.targetJob.title = "个人经历专项练习";
  context.confirmedExperienceSources = card ? [experienceSource(card)] : [];
  return context;
}
