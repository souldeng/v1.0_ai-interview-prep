import type { ConfirmedExperienceSource, ExperienceCard, InterviewProject, Question, UserProfile } from "./domain";
import { usableMaterial } from "./jobMaterialFlow";

export interface InterviewContext {
  confirmedUserFacts: string[];
  confirmedExperienceSources?: ConfirmedExperienceSource[];
  targetJob: { id: string | null; title: string; jd: string };
  confirmedJobMaterials: Array<{ id: string; title: string; text: string }>;
  thirdPartyInterviewMaterials: Array<{ id: string; title: string; text: string }>;
  currentQuestion?: string;
  userAnswer?: string;
  confirmedPreviousAnswers: string[];
  foundationKnowledge: string[];
}

const cap = (value: string, max: number) => value.trim().slice(0, max);

export function experienceSource(card: ExperienceCard): ConfirmedExperienceSource {
  return { id: card.id, title: card.title, fields: { situation: card.situation, action: card.action, tools: card.tools ?? "", result: card.result, reflection: card.reflection } };
}

/** The only source builder used by model tasks and new trusted preparations. */
export function buildInterviewContext(input: {
  project?: InterviewProject | null;
  profile: UserProfile;
  currentQuestion?: string;
  userAnswer?: string;
  foundationKnowledge?: string[];
  question?: Question;
}): InterviewContext {
  const { project, profile } = input;
  const origin = input.question?.projectDeepDive;
  const cards = profile.experiences.filter(card => card.confirmed && (!origin || card.id === origin.experienceId && JSON.stringify(experienceSource(card)) === origin.experienceSnapshot)).slice(0, 20);
  const confirmedUserFacts = cards.map(card => [
    `经历：${card.title}`, card.situation && `背景：${card.situation}`, card.action && `本人行动：${card.action}`,
    card.tools && `工具与方法：${card.tools}`, card.result && `结果或证据：${card.result}`, card.reflection && `复盘：${card.reflection}`,
  ].filter(Boolean).join("；"));
  const materials = (project?.materials ?? []).filter(usableMaterial);
  const jd = [project?.jobDescription ?? "", ...materials.filter(item => item.kind === "job_description").map(item => item.content)].filter(Boolean).join("\n");
  return {
    confirmedUserFacts,
    confirmedExperienceSources: cards.map(experienceSource),
    targetJob: { id: project?.id ?? null, title: project?.jobTitle ?? "AI 应用岗位基础练习", jd: cap(jd, 8000) },
    confirmedJobMaterials: materials.filter(item => item.kind === "reference").slice(0, 6).map(item => ({ id: item.id, title: item.title, text: cap(item.content, 2500) })),
    thirdPartyInterviewMaterials: materials.filter(item => item.kind === "interview_experience").slice(0, 6).map(item => ({ id: item.id, title: item.title, text: cap(item.content, 2500) })),
    ...(input.currentQuestion ? { currentQuestion: cap(input.currentQuestion, 600) } : {}),
    ...(input.userAnswer ? { userAnswer: cap(input.userAnswer, 6000) } : {}),
    confirmedPreviousAnswers: (project?.session?.turns ?? []).filter(turn => turn.finalAnswer?.trim()).slice(-5).map(turn => cap(`${turn.question}\n${turn.finalAnswer}`, 1000)),
    foundationKnowledge: (input.foundationKnowledge ?? []).slice(0, 5).map(item => cap(item, 500)),
  };
}

/** Labels remain explicit even when some sections are empty. */
export function contextForPrompt(context: InterviewContext, dynamicLast = false): string {
  // Only unordered sets in the training wire format are canonicalized. Selection,
  // chronological answers, field contents and persisted analysis fingerprints stay intact.
  const sorted = <T,>(items: T[], key: (item: T) => string) => [...items].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  const training = dynamicLast;
  const stable = {
    "A_用户本人已确认事实": training ? sorted(context.confirmedUserFacts, item => item) : context.confirmedUserFacts,
    "B_当前岗位JD": context.targetJob,
    "B_已核对的其他岗位参考资料": training ? sorted(context.confirmedJobMaterials, item => JSON.stringify([item.id, item.title, item.text])) : context.confirmedJobMaterials,
    "C_第三方面经_绝非当前用户经历": training ? sorted(context.thirdPartyInterviewMaterials, item => JSON.stringify([item.id, item.title, item.text])) : context.thirdPartyInterviewMaterials,
  };
  // Keep the default byte-for-byte compatible with persisted analysis fingerprints.
  // Training can reuse the same fact prefix while the current question/answer changes.
  if (dynamicLast) return JSON.stringify({ ...stable,
    "A_可校验的完整经历字段": sorted(context.confirmedExperienceSources ?? [], item => JSON.stringify([item.id, item.title, item.fields])),
    "同岗位既有最终确认答案": context.confirmedPreviousAnswers,
    "当前问题": context.currentQuestion ?? "",
    "内置学习知识点_不能当作本人经历": context.foundationKnowledge,
    "用户本轮原回答": context.userAnswer ?? "",
  });
  return JSON.stringify({
    ...stable,
    "当前问题": context.currentQuestion ?? "",
    "用户本轮原回答": context.userAnswer ?? "",
    "同岗位既有最终确认答案": context.confirmedPreviousAnswers,
    "内置学习知识点_不能当作本人经历": context.foundationKnowledge,
  });
}
