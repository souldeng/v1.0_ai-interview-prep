import type { Preparation, Question } from "./domain";
import type { InterviewContext } from "./interviewContext";
import { foundationQuestions, foundationToPracticeQuestion } from "./foundationQuestions";
import { createPreparation } from "./interview";

function uniqueQuestions(items: Question[]): Question[] {
  const seen = new Set<string>();
  return items.filter(item => { const key = item.text.replace(/[\s，。？！?！]/g, "").toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

export function trustedQuestionCandidates(context: InterviewContext): Question[] {
  const base = createPreparation(context.confirmedUserFacts.join("\n"), context.targetJob.jd);
  const jd = context.targetJob.jd.trim() ? base.questions.filter(item => item.sourceType === "jd").map(item => ({ ...item, id: `trusted-${item.id}`, source: `当前岗位 JD：${item.source}` })) : [];
  const personal = context.targetJob.jd.trim() ? base.questions.filter(item => item.sourceType === "resume").map(item => ({ ...item, id: `trusted-${item.id}` })) : [];
  const thirdParty = context.thirdPartyInterviewMaterials.flatMap(material => material.text.split(/[\n。]/).map(text => text.trim()).filter(text => /[？?]$/.test(text) && text.length >= 8).slice(0, 3).map((text, index): Question => ({ id: `third-${material.id}-${index}`, category: "方案与业务", text, source: `第三方面经“${material.title}”原题，仅供参考`, sourceType: "third_party", technical: /模型|RAG|Agent|API|技术/i.test(text) })));
  const roles = context.targetJob.title;
  const relevant = foundationQuestions.filter(item => item.applicableRoles.some(role => role === "AI 应用岗位" || roles.includes(role.replace(/^AI /,""))));
  const categories = [...new Set(relevant.map(item => item.category))];
  const foundation = categories.flatMap(category => relevant.filter(item => item.category === category).slice(0, 2)).map(foundationToPracticeQuestion);
  return uniqueQuestions([...jd, ...personal, ...thirdParty, ...foundation]).slice(0, 24);
}

export function selectLocalQuestions(candidates: Question[]): Question[] {
  const take = (source: Question["sourceType"], count: number) => candidates.filter(item => item.sourceType === source).slice(0, count);
  const chosen = uniqueQuestions([...take("jd", 3), ...take("resume", 1), ...take("third_party", 1), ...take("foundation", 4)]);
  return uniqueQuestions([...chosen, ...candidates]).slice(0, 6);
}

export function trustedPreparation(context: InterviewContext, questions: Question[]): Preparation {
  const original = createPreparation(context.confirmedUserFacts.join("\n"), context.targetJob.jd);
  return { ...original, job: { ...original.job, title: context.targetJob.title }, questions: questions.slice(0, 6) };
}
