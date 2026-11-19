import type { CoachFeedback, ExperienceField, Question, ReferenceBasis } from "./domain";
import type { InterviewContext } from "./interviewContext";

export const deepDiveAngles = ["设计动机", "技术选型", "个人贡献", "实现流程", "真实Badcase", "验证方式", "业务价值"] as const;
const fields: ExperienceField[] = ["situation", "action", "tools", "result", "reflection"];
const normalize = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const text = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= max;

/** Verifies source membership and shape, not the semantic truth of model wording. */
export function validateProjectQuestions(context: InterviewContext, response: unknown): Question[] {
  const raw = response as { questions?: unknown };
  if (!raw || !Array.isArray(raw.questions) || raw.questions.length < 3 || raw.questions.length > 6) throw new Error("岗位深挖题须为3–6题，未使用本次结果。");
  const seen = new Set<string>();
  const questions = raw.questions.map((item: any): Question => {
    const source = context.confirmedExperienceSources?.find(s => s.id === item?.experienceId);
    if (!source || !text(item.text, 450) || !text(item.requirementQuote, 500) || !context.targetJob.jd.includes(item.requirementQuote)
      || !text(item.evidenceQuote, 3000) || !Object.values(source.fields).some(value => value === item.evidenceQuote)
      || !text(item.whyAsk, 600) || !Array.isArray(item.angles) || !item.angles.length || !item.angles.every((a: any) => deepDiveAngles.includes(a))
      || !Array.isArray(item.followUps) || item.followUps.length < 1 || item.followUps.length > 3 || !item.followUps.every((q: unknown) => text(q, 250))) throw new Error("岗位深挖题缺少有效JD或已确认经历依据，未使用本次结果。");
    const key = normalize(item.text);
    if (seen.has(key)) throw new Error("岗位深挖题重复，未使用本次结果。");
    seen.add(key);
    const wording = [item.text, item.whyAsk, ...item.followUps].join("\n");
    const facts = Object.values(source.fields).join("\n");
    // Narrow failure checks, not a claim to verify every natural-language presupposition.
    const unsupportedNumbers = (wording.match(/\d+(?:\.\d+)?%?/g) ?? []).filter(n => !facts.includes(n));
    const strengthensUnknown = /未提供|未记录|待补充/.test(facts) && /(?:还没有|没有|尚无|无)(?:通过率|业务节省|上线证据|量化成果|量化结果|用户学习效果|学习效果|录用结果)/.test(wording);
    const changesResponsibility = /未负责|没有负责/.test(facts) && /未参与|没有参与/.test(wording) && !/未参与|没有参与/.test(facts);
    if (unsupportedNumbers.length || strengthensUnknown || changesResponsibility) throw new Error("岗位题出现无依据数字或加强了未知/职责否定，未使用本次结果。");
    return { id: `project-deep-${crypto.randomUUID()}`, category: "经历复盘", technical: true, sourceType: "resume", text: item.text.trim(),
      source: `AI 岗位项目深挖｜${source.title}；JD：${item.requirementQuote}；经历原文：${item.evidenceQuote}`,
      projectDeepDive: { experienceId: source.id, experienceTitle: source.title, experienceSnapshot: JSON.stringify(source), requirementQuote: item.requirementQuote, evidenceQuote: item.evidenceQuote, whyAsk: item.whyAsk, angles: [...new Set<string>(item.angles)], followUps: item.followUps } };
  });
  if (deepDiveAngles.some(angle => !questions.some(q => q.projectDeepDive!.angles.includes(angle)))) throw new Error("岗位深挖题未覆盖必要角度，未使用本次结果。");
  return questions;
}

/** Model chooses whole fields; it cannot write or shorten personal claims, remove negations,
 * borrow numbers from another project, or turn a suggestion into a completed action. */
export function groundedReference(context: InterviewContext, question: Question | undefined, selection: unknown, missing: unknown): Pick<CoachFeedback, "optimizedExample" | "referenceBasis" | "referenceUncertainties"> {
  const empty = { optimizedExample: "", referenceBasis: [], referenceUncertainties: ["待核实：没有可用于本题的完整确认经历字段，请补充依据后重新获取建议。"] };
  if (!question || !Array.isArray(selection) || selection.length !== 1) return empty;
  const requested = selection[0];
  const source = context.confirmedExperienceSources?.find(s => s.id === requested?.experienceId);
  const boundId = question.projectDeepDive?.experienceId ?? question.experienceOrigin?.experienceId;
  if (!source || boundId && source.id !== boundId || !Array.isArray(requested.fields) || !requested.fields.length || !requested.fields.every((f: any) => fields.includes(f))) return empty;
  // Preserve the full responsibility boundary even when the model only selects a result.
  const selected = new Set<ExperienceField>([...requested.fields, "action", "reflection"]);
  const basis: ReferenceBasis[] = fields.filter(field => selected.has(field) && source.fields[field].trim()).map(field => ({ experienceId: source.id, title: source.title, field, quote: source.fields[field] }));
  if (!basis.length) return empty;
  const labels: Record<ExperienceField, string> = { situation: "当时的背景是", action: "我在其中的行动是", tools: "具体的工具与方法是", result: "我能确认的结果或产物是", reflection: "我的复盘是" };
  const unknown = Array.isArray(missing) ? [...new Set(missing.filter((a: any): a is string => deepDiveAngles.includes(a)))] : [];
  return { optimizedExample: `我想用「${source.title}」这段经历来说明。\n${basis.map(b => `${labels[b.field]}：${b.quote}`).join("\n")}`,
    referenceBasis: basis, referenceUncertainties: ["待核实：本题涉及的具体代码、指标、职责分工和因果结论，只有已列出的确认原文可用；原文未说明的部分不能补写。", ...unknown.map(a => `待核实：${a}尚需补充本题对应的个人证据。`)] };
}
