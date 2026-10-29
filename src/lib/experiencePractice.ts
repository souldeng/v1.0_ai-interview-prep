import type { ExperienceCard, Question, UserProfile } from "./domain";
import { buildInterviewContext } from "./interviewContext";
import type { QuestionLibraryState } from "./questionLibrary";

export interface ExperiencePracticeSet {
  id: string;
  experienceId: string;
  title: string;
  contentVersion: string;
  createdAt: string;
  questions: Question[];
  hiddenQuestionIds?: string[];
}
export interface ExperienceQuestionInput { text: string; basisQuote: string }

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
export function appendExperienceQuestions(set: ExperiencePracticeSet, card: ExperienceCard, inputs: ExperienceQuestionInput[]) {
  if (!card.confirmed || card.id !== set.experienceId || experienceVersion(card) !== set.contentVersion) throw new Error("经历已变化或未确认，请重新生成题组。");
  if (visibleExperienceQuestions(set).length >= 20) throw new Error("当前已有20道题，请先整理题目或重新生成。");
  if (set.questions.length >= 200) throw new Error("本组保留的历史题目已达安全上限，请重新生成题组；旧历史仍保留。");
  if (!Array.isArray(inputs) || inputs.length > 5) throw new Error("追加题目格式无效。");
  const seen = new Set(set.questions.map(q => normalized(q.text)));
  const fresh = inputs.filter(item => { if (!item || typeof item.text !== "string") throw new Error("追加题目格式无效。"); const key = normalized(item.text); if (seen.has(key)) return false; seen.add(key); return true; });
  if (!fresh.length) return { set, added: 0 };
  // Reuse the same source validation as initial generation, including for a short result.
  const basis = [card.title, card.situation, card.action, card.tools, card.result, card.reflection].filter(Boolean).join("\n");
  if (fresh.some(q => !q.text.trim() || q.text.length > 300 || typeof q.basisQuote !== "string" || !q.basisQuote.trim() || !basis.includes(q.basisQuote))) throw new Error("新题缺少所选经历依据，未追加。");
  const selected = fresh.slice(0, Math.min(20 - visibleExperienceQuestions(set).length, 200 - set.questions.length));
  const questions = selected.map(item => ({ ...set.questions[0], id: `${set.id}-q-${crypto.randomUUID()}`, text: item.text.trim(), experienceOrigin: { experienceId: card.id, setId: set.id, contentVersion: set.contentVersion, basisQuote: item.basisQuote } }));
  return { set: { ...set, questions: [...set.questions, ...questions] }, added: questions.length };
}
export function createExperienceSet(card: ExperienceCard, input: ExperienceQuestionInput[]): ExperiencePracticeSet {
  if (!card.confirmed) throw new Error("请先确认这段经历，再生成专项题。");
  const basis = [card.title, card.situation, card.action, card.tools, card.result, card.reflection].filter(Boolean).join("\n");
  if (!Array.isArray(input) || input.length < 3 || input.length > 5 || input.some(item => !item || typeof item.text !== "string" || !item.text.trim() || item.text.length > 300 || typeof item.basisQuote !== "string" || !item.basisQuote.trim() || !basis.includes(item.basisQuote))
    || new Set(input.map(item => item.text.replace(/[\s，。？！!?]/g, ""))).size !== input.length) throw new Error("专项题须为3–5道不同问题，且每题有对应经历原文依据；未保存本次结果。");
  const id = `experience-set-${crypto.randomUUID()}`, contentVersion = experienceVersion(card);
  return { id, experienceId: card.id, title: card.title, contentVersion, createdAt: new Date().toISOString(), questions: input.map((item,index) => ({
    id: `${id}-q${index + 1}`, text: item.text.trim(), category: "经历复盘", technical: false, sourceType: "experience_practice",
    source: `AI 根据已确认经历“${card.title}”生成的专项题，非企业真实原题。`,
    experienceOrigin: { experienceId: card.id, setId: id, contentVersion, basisQuote: item.basisQuote },
  })) };
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
  return context;
}
