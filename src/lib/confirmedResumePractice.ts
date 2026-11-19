import type { CoachFeedback, ExperienceCard, ExperienceField, Question, ResumeEvidenceKind, ResumePracticeOrigin, ResumeQuestionFocus, UserProfile } from "./domain";
import { buildInterviewContext, type InterviewContext } from "./interviewContext";
import { experienceVersion } from "./experiencePractice";
import type { StorageLike } from "./projectStorage";

export const resumeDeepDiveAngles = ["设计动机", "技术选型", "个人贡献", "实现流程", "真实Badcase", "验证方式", "业务价值"] as const;
type ResumeDeepDiveAngle = typeof resumeDeepDiveAngles[number];
const fields: ExperienceField[] = ["situation", "action", "tools", "result", "reflection"];
const kinds: ResumeEvidenceKind[] = ["education", "work", "project", "technical_evidence", "other"];
const MAX_EVIDENCE_QUOTE_CHARS = 12_000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown, max: number): value is string => typeof value === "string" && Boolean(value.trim()) && value.length <= max;
const normalized = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
const technicalSignal = /(?:\b(?:python|javascript|typescript|java|sql|html|css|react|node(?:\.js)?|docker|kubernetes|git|api|rag|llm|agent|embedding|vector|poc)\b|代码|编程|开发|算法|数据库|模型|检索|向量|部署|工程|前端|后端|机器学习|深度学习|提示词)/i;

/** A compact change detector for local staleness, not an identity or security hash. */
function versionDigest(value: string): string {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${value.length.toString(36)}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export interface ConfirmedResumePracticeSource {
  experienceId: string;
  title: string;
  contentVersion: string;
  kinds: ResumeEvidenceKind[];
}

export interface ConfirmedResumePracticeSet {
  id: string;
  kind: "confirmed_resume";
  title: string;
  contentVersion: string;
  sources: ConfirmedResumePracticeSource[];
  createdAt: string;
  questions: Question[];
  hiddenQuestionIds?: string[];
  /** Reasons why individual model candidates were not saved. They contain no model prompt or personal facts. */
  generationIssues?: ResumeGenerationIssue[];
}

/**
 * A recovery copy for a generated set that has not entered `resumeSets` yet.
 * It intentionally lives outside the exported question-library state: candidates
 * can contain unconfirmed material and must not be included in public backups.
 */
export const PENDING_CONFIRMED_RESUME_SET_KEY = "ai-interview-confirmed-resume-candidate-v1";

function candidateStorage(): StorageLike {
  if (typeof localStorage === "undefined") throw new Error("当前环境不支持本地存储。");
  return localStorage;
}

export interface ResumeQuestionInput {
  text?: string;
  evidence?: Array<{ experienceId?: string; fields?: ExperienceField[] }>;
  focus?: ResumeQuestionFocus;
  whyAsk?: string;
  capabilities?: string[];
  angles?: ResumeDeepDiveAngle[];
  followUps?: string[];
  missingAspects?: ResumeDeepDiveAngle[];
  coverage?: ResumeEvidenceKind[];
}
export interface ResumeGenerationIssue { index: number; reason: "structure" | "duplicate" | "evidence" | "safety" | "coverage"; message: string }

export function resumeQuestionFocus(question: Pick<Question, "resumePracticeOrigin">): ResumeQuestionFocus {
  return question.resumePracticeOrigin?.focus === "knowledge" ? "knowledge" : "practice";
}

/** Reuses the existing one-question training flow; no question set or new persisted store is created. */
export function resumeIntroductionQuestion(minutes: 1 | 3): Question {
  const duration = minutes === 1 ? "1 分钟" : "3 分钟";
  return {
    id: `resume-introduction-${minutes}m`,
    category: "转岗动机 / 能力迁移",
    text: `请用约 ${duration} 做自我介绍：只选择已确认经历中最相关的背景、行动或学习内容，说明转向目标方向的原因与当前边界；不要补写未确认的成果。`,
    source: "基于当前已确认简历的自我介绍练习",
    sourceType: "resume",
    technical: false,
  };
}

/** Keeps long confirmed-card text out of the question-library index while still invalidating on any card change. */
export function resumeSourceVersion(card: ExperienceCard): string {
  return `resume-card-v1-${versionDigest(experienceVersion(card))}`;
}

export function resumePracticeSetVersion(sources: ConfirmedResumePracticeSource[]): string {
  return `resume-set-v1-${versionDigest(JSON.stringify([...sources].sort((left, right) => left.experienceId.localeCompare(right.experienceId)).map(source => [source.experienceId, source.contentVersion, source.kinds])))}`;
}

function usable(card: ExperienceCard) {
  return card.confirmed && fields.some(field => Boolean((card[field] ?? "").trim()));
}

/** Classifies only user-confirmed card labels and explicit technical mechanisms. Unknown labels remain other. */
export function conservativeResumeKinds(card: ExperienceCard): ResumeEvidenceKind[] {
  const label = (card.type ?? "").trim().toLowerCase();
  const result: ResumeEvidenceKind[] = [];
  if (/教育|学历|学位|学校|课程|学习|培训|研究/.test(label)) result.push("education");
  if (/工作|任职|职位|岗位|实习|职业|公司/.test(label)) result.push("work");
  if (/项目|产品|作品|poc|交付|系统|平台|开发/.test(label)) result.push("project");
  if (card.tools?.trim() && card.action.trim() && technicalSignal.test([card.type, card.tools, card.action].filter(Boolean).join("\n"))) result.push("technical_evidence");
  return result.length ? result : ["other"];
}

export function eligibleConfirmedResumeCards(profile: UserProfile): ExperienceCard[] {
  return profile.experiences.filter(usable).sort((left, right) => left.id.localeCompare(right.id));
}

export function confirmedResumeSources(profile: UserProfile): ConfirmedResumePracticeSource[] {
  return eligibleConfirmedResumeCards(profile).map(card => ({ experienceId: card.id, title: card.title, contentVersion: resumeSourceVersion(card), kinds: conservativeResumeKinds(card) }));
}

export function confirmedResumeVersion(profile: UserProfile): string {
  return resumePracticeSetVersion(confirmedResumeSources(profile));
}

function allFacts(cards: ExperienceCard[]) {
  return cards.flatMap(card => [card.title, ...fields.map(field => card[field] ?? "")]).filter(Boolean).join("\n");
}

function unsupportedWording(value: string, basis: string) {
  const numbers = (value.match(/\d+(?:\.\d+)?%?/g) ?? []).filter(number => !basis.includes(number));
  const strengthensUnknown = /未提供|未记录|待补充/.test(basis) && /(?:还没有|没有|尚无|无)(?:通过率|业务节省|上线证据|量化成果|量化结果|用户学习效果|学习效果|录用结果)/.test(value);
  const changesResponsibility = /未负责|没有负责/.test(basis) && /未参与|没有参与/.test(value) && !/未参与|没有参与/.test(basis);
  return Boolean(numbers.length || strengthensUnknown || changesResponsibility);
}

function evidenceFrom(input: ResumeQuestionInput, cards: ExperienceCard[]) {
  if (!Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 2) throw new Error("整份简历题缺少有效事实依据，未使用本次结果。");
  const evidence: ResumePracticeOrigin["evidence"] = [];
  const seen = new Set<string>();
  for (const item of input.evidence) {
    const card = cards.find(candidate => candidate.id === item?.experienceId);
    if (!card || !Array.isArray(item?.fields) || !item.fields.length || item.fields.length > 2 || !item.fields.every(field => fields.includes(field))) throw new Error("整份简历题引用了无效经历字段，未使用本次结果。");
    for (const field of item.fields) {
      const quote = (card[field] ?? "").trim(), key = `${card.id}:${field}`;
      if (!quote || quote.length > MAX_EVIDENCE_QUOTE_CHARS || seen.has(key)) throw new Error("整份简历题的依据字段无效或过长，未使用本次结果。");
      seen.add(key); evidence.push({ experienceId: card.id, contentVersion: resumeSourceVersion(card), field, quote });
    }
  }
  return evidence;
}

function hasTechnicalTopic(card: ExperienceCard, evidence: ResumePracticeOrigin["evidence"]) {
  const quoted = evidence.filter(item => item.experienceId === card.id).map(item => item.quote);
  return technicalSignal.test([card.title, card.type, card.tools ?? "", ...quoted].join("\n"));
}

function uniqueText(values: unknown, maximum: number, itemMaximum: number) {
  return Array.isArray(values) ? [...new Set(values.filter((item): item is string => text(item, itemMaximum)).map(item => item.trim()))].slice(0, maximum) : [];
}

function uniqueAngles(values: unknown) {
  return Array.isArray(values) ? [...new Set(values.filter((item): item is ResumeDeepDiveAngle => typeof item === "string" && resumeDeepDiveAngles.includes(item as ResumeDeepDiveAngle)))].slice(0, 3) : [];
}

function defaultQuestionMetadata(focus: ResumeQuestionFocus, titles: string) {
  return {
    whyAsk: `围绕已确认经历「${titles}」，了解你的判断、边界与复盘。`,
    capabilities: focus === "knowledge" ? ["技术理解与验证"] : ["事实表达与复盘"],
    angles: focus === "knowledge" ? ["技术选型", "验证方式"] as ResumeDeepDiveAngle[] : ["个人贡献", "实现流程"] as ResumeDeepDiveAngle[],
    followUps: focus === "knowledge" ? ["你会如何验证这个理解在具体场景中是否成立？"] : ["请结合已确认经历，补充你的判断依据与责任边界。"],
  };
}

function actualCoverage(input: ResumeQuestionInput, cards: ExperienceCard[], evidence: ResumePracticeOrigin["evidence"], focus: ResumeQuestionFocus): ResumeEvidenceKind[] {
  const evidenceCards = [...new Set(evidence.map(item => item.experienceId))].map(id => cards.find(card => card.id === id)!);
  const allowed = new Set(evidenceCards.flatMap(conservativeResumeKinds));
  const requested = Array.isArray(input.coverage) ? [...new Set(input.coverage.filter((kind): kind is ResumeEvidenceKind => kinds.includes(kind as ResumeEvidenceKind) && allowed.has(kind as ResumeEvidenceKind)))] : [];
  if (requested.length) return requested;
  const derived = [...allowed].filter((kind): kind is ResumeEvidenceKind => focus === "knowledge" || kind !== "technical_evidence");
  return derived.length ? derived : ["other"];
}

function validPracticeTechnicalEvidence(cards: ExperienceCard[], evidence: ResumePracticeOrigin["evidence"], coverage: ResumeEvidenceKind[]) {
  if (!coverage.includes("technical_evidence")) return true;
  return [...new Set(evidence.map(item => item.experienceId))].some(id => {
    const source = cards.find(card => card.id === id)!;
    const referenced = evidence.filter(item => item.experienceId === id).map(item => item.field);
    return conservativeResumeKinds(source).includes("technical_evidence") && referenced.includes("action") && referenced.includes("tools");
  });
}

/** Builds a whole-confirmed-resume set. It is the validation seam for local facts, per-question de-duplication and stale snapshots. */
export function createConfirmedResumePracticeSet(profile: UserProfile, input: ResumeQuestionInput[]): ConfirmedResumePracticeSet {
  const cards = eligibleConfirmedResumeCards(profile);
  if (!cards.length) throw new Error("请先确认至少一段含个人事实的经历，再生成整份简历专项。 ");
  if (cards.length > 20) throw new Error("当前已确认经历超过 20 段，无法在一组 10 题内可靠覆盖；请先整理或分批确认后再生成。 ");
  const maximumQuestions = cards.length === 1 ? 6 : 10;
  if (!Array.isArray(input)) throw new Error("整份简历题返回结构损坏，未使用本次结果。已有题组与回答仍保留。");
  const sourceKinds = new Set(cards.flatMap(conservativeResumeKinds));
  const requiredKinds = [...sourceKinds].filter(kind => kind !== "other");
  const seen = new Set<string>();
  const id = `resume-set-${crypto.randomUUID()}`;
  const issues: ResumeGenerationIssue[] = [];
  const questions: Question[] = [];
  for (const [index, raw] of input.entries()) {
    if (index >= maximumQuestions) { issues.push({ index: index + 1, reason: "structure", message: `超过本组最多 ${maximumQuestions} 道题，未采用。` }); continue; }
    if (!record(raw)) { issues.push({ index: index + 1, reason: "structure", message: "题目对象不完整，未采用。" }); continue; }
    const item = raw as ResumeQuestionInput;
    if (!text(item.text, 380)) { issues.push({ index: index + 1, reason: "structure", message: "题目正文无效，未采用。" }); continue; }
    const key = normalized(item.text);
    if (!key || seen.has(key) || [...seen].some(previous => previous.includes(key) || key.includes(previous))) { issues.push({ index: index + 1, reason: "duplicate", message: "与已采用题目重复或过于相似，未采用。" }); continue; }
    let evidence: ResumePracticeOrigin["evidence"];
    try { evidence = evidenceFrom(item, cards); }
    catch (error) { issues.push({ index: index + 1, reason: "evidence", message: error instanceof Error ? error.message.replace("，未使用本次结果。", "") : "事实依据无效，未采用。" }); continue; }
    if (item.focus !== "knowledge" && item.focus !== "practice") { issues.push({ index: index + 1, reason: "structure", message: "未标明知识题或个人实践题，未采用。" }); continue; }
    const focus: ResumeQuestionFocus = item.focus;
    const evidenceCardIds = [...new Set(evidence.map(entry => entry.experienceId))];
    const evidenceCards = cards.filter(card => evidenceCardIds.includes(card.id));
    const coverage = actualCoverage(item, cards, evidence, focus);
    if (focus === "knowledge" && !evidenceCards.some(card => hasTechnicalTopic(card, evidence))) { issues.push({ index: index + 1, reason: "evidence", message: "技术知识题没有引用明确出现的技术主题，未采用。" }); continue; }
    const declaredCoverage = Array.isArray(item.coverage) && item.coverage.some(kind => coverage.includes(kind as ResumeEvidenceKind));
    if (focus === "practice" && evidenceCards.some(card => conservativeResumeKinds(card).includes("technical_evidence")) && !declaredCoverage) { issues.push({ index: index + 1, reason: "structure", message: "涉及技术经历的个人实践题缺少类别标记，未采用。" }); continue; }
    if (focus === "practice" && !validPracticeTechnicalEvidence(cards, evidence, coverage)) { issues.push({ index: index + 1, reason: "evidence", message: "技术实践题没有同时引用同一经历的本人行动与工具/方法，未采用。" }); continue; }
    const titles = evidenceCards.map(card => card.title).join("、");
    const defaults = defaultQuestionMetadata(focus, titles);
    const whyAsk = text(item.whyAsk, 500) ? item.whyAsk.trim() : defaults.whyAsk;
    const capabilities = uniqueText(item.capabilities, 3, 80); const angles = uniqueAngles(item.angles);
    const followUps = uniqueText(item.followUps, 3, 220); const missingAspects = uniqueAngles(item.missingAspects);
    const wording = [item.text, whyAsk, ...(capabilities.length ? capabilities : defaults.capabilities), ...(followUps.length ? followUps : defaults.followUps)].join("\n");
    if (unsupportedWording(wording, allFacts(evidenceCards))) { issues.push({ index: index + 1, reason: "safety", message: "题目或说明包含无依据数字、职责或成果，未采用。" }); continue; }
    seen.add(key);
    questions.push({
      id: `${id}-q${questions.length + 1}`, text: item.text.trim(), category: focus === "knowledge" ? "技术理解" : "经历复盘", technical: focus === "knowledge" || coverage.includes("technical_evidence"), sourceType: "experience_practice",
      source: `AI 根据整份已确认简历生成｜依据：${titles}；非企业真实原题。`,
      resumePracticeOrigin: { setId: id, evidence, whyAsk, capabilities: capabilities.length ? capabilities : defaults.capabilities, angles: angles.length ? angles : defaults.angles, followUps: followUps.length ? followUps : defaults.followUps, missingAspects, coverage, focus },
    });
  }
  if (questions.length < 3) throw new Error(`整份简历题仅有 ${questions.length} 道可核对题目，至少需要 3 道才会保存。${issues.length ? " 其余题目因格式、重复或事实依据问题未采用；" : ""}已有题组与回答仍保留。`);
  const covered = new Set(questions.flatMap(question => question.resumePracticeOrigin!.coverage));
  const uncoveredKinds = requiredKinds.filter(kind => !covered.has(kind));
  if (uncoveredKinds.length) issues.push({ index: 0, reason: "coverage", message: `本组尚未覆盖的经历类别：${uncoveredKinds.join("、")}。可在下次生成时补充。` });
  const referencedCards = new Set(questions.flatMap(question => question.resumePracticeOrigin!.evidence.map(evidence => evidence.experienceId)));
  const missingCards = cards.filter(card => !referencedCards.has(card.id));
  if (missingCards.length) issues.push({ index: 0, reason: "coverage", message: `本组尚未涉及：${missingCards.map(card => card.title).join("、")}。可在下次生成时补充。` });
  return { id, kind: "confirmed_resume", title: "整份已确认简历专项", contentVersion: confirmedResumeVersion(profile), sources: confirmedResumeSources(profile), createdAt: new Date().toISOString(), questions, ...(issues.length ? { generationIssues: issues } : {}) };
}

export function visibleConfirmedResumeQuestions(set: ConfirmedResumePracticeSet) {
  return set.questions.filter(question => !set.hiddenQuestionIds?.includes(question.id));
}

export function setConfirmedResumeQuestionHidden(set: ConfirmedResumePracticeSet, questionId: string, hidden: boolean): ConfirmedResumePracticeSet {
  if (!set.questions.some(question => question.id === questionId)) throw new Error("题目不存在。 ");
  return { ...set, hiddenQuestionIds: hidden ? [...new Set([...(set.hiddenQuestionIds ?? []), questionId])] : (set.hiddenQuestionIds ?? []).filter(id => id !== questionId) };
}

export function isResumePracticeQuestionCurrent(profile: UserProfile, question: Question): boolean {
  const origin = question.resumePracticeOrigin;
  if (!origin?.evidence.length) return false;
  return origin.evidence.every(item => {
    const card = profile.experiences.find(candidate => candidate.id === item.experienceId);
    return Boolean(card?.confirmed && resumeSourceVersion(card) === item.contentVersion && card[item.field] === item.quote);
  });
}

/** Supplies only this question's still-current confirmed cards to the existing training and coach prompts. */
export function confirmedResumePracticeContext(profile: UserProfile, question: Question, userAnswer?: string): InterviewContext {
  const origin = question.resumePracticeOrigin;
  const ids = [...new Set(origin?.evidence.map(item => item.experienceId) ?? [])];
  const cards = ids.map(id => profile.experiences.find(card => card.id === id)).filter((card): card is ExperienceCard => Boolean(card));
  const safeProfile = isResumePracticeQuestionCurrent(profile, question) && cards.length === ids.length
    ? { ...profile, experiences: cards, supplementaryInfo: "" }
    : { ...profile, experiences: [], supplementaryInfo: "" };
  const context = buildInterviewContext({ profile: safeProfile, currentQuestion: question.text, userAnswer });
  context.targetJob.title = "整份已确认简历专项练习";
  return context;
}

export function groundedResumeReference(context: InterviewContext, question: Question): Pick<CoachFeedback, "optimizedExample" | "referenceBasis" | "referenceUncertainties"> {
  const origin = question.resumePracticeOrigin;
  const empty = { optimizedExample: "", referenceBasis: [], referenceUncertainties: ["待核实：当前题目的确认经历已变化、撤销确认或无法读取，未生成旧事实参考。"] };
  if (!origin?.evidence.length) return empty;
  const byId = new Map((context.confirmedExperienceSources ?? []).map(source => [source.id, source]));
  const directBasis = origin.evidence.flatMap(item => {
    const source = byId.get(item.experienceId);
    return source && source.fields[item.field] === item.quote ? [{ experienceId: source.id, title: source.title, field: item.field, quote: item.quote }] : [];
  });
  if (directBasis.length !== origin.evidence.length) return empty;
  const basis = [...directBasis];
  for (const sourceId of new Set(directBasis.map(item => item.experienceId))) {
    const source = byId.get(sourceId)!;
    for (const field of ["action", "reflection"] as ExperienceField[]) {
      if (source.fields[field].trim() && source.fields[field].length <= 800 && !basis.some(item => item.experienceId === source.id && item.field === field)) basis.push({ experienceId: source.id, title: source.title, field, quote: source.fields[field] });
    }
  }
  const labels: Record<ExperienceField, string> = { situation: "当时的背景是", action: "我确认的行动是", tools: "确认的工具与方法是", result: "我确认的结果或产物是", reflection: "我的复盘是" };
  const exampleLines: string[] = [];
  let remaining = 4000, currentSource = "", omitted = false;
  for (const item of basis) {
    const prefix = currentSource === item.experienceId ? "" : `「${item.title}」\n`;
    const line = `${labels[item.field]}：${item.quote}`;
    const candidate = `${prefix}${line}${exampleLines.length ? "\n" : ""}`;
    if (candidate.length > remaining) { omitted = true; continue; }
    exampleLines.push(`${prefix}${line}`); remaining -= candidate.length; currentSource = item.experienceId;
  }
  const example = exampleLines.join("\n");
  return {
    optimizedExample: example ? `我会把不同经历分开说明，只使用已确认的事实：\n${example}` : "",
    referenceBasis: basis,
    referenceUncertainties: ["待核实：未列出的代码细节、指标、职责分工、因果关系和项目成果不能补写。", ...(omitted ? ["提示：较长确认字段未放入可复制示例，请在上方完整事实依据中核对后再自行组织口语表达。"] : []), ...origin.missingAspects.map(angle => `待核实：${angle}尚需补充对应的个人证据。`)],
  };
}

export function validConfirmedResumePracticeSet(value: unknown): value is ConfirmedResumePracticeSet {
  if (!record(value) || value.kind !== "confirmed_resume" || !text(value.id, 200) || !text(value.title, 200) || !text(value.contentVersion, 200) || !text(value.createdAt, 80) || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.sources) || !Array.isArray(value.questions)) return false;
  const sources = value.sources as unknown[];
  if (sources.length < 1 || new Set(sources.map(source => record(source) ? source.experienceId : "")).size !== sources.length) return false;
  if (!sources.every(source => record(source) && text(source.experienceId, 200) && text(source.title, 200) && text(source.contentVersion, 200) && Array.isArray(source.kinds) && source.kinds.length && source.kinds.every(kind => kinds.includes(kind as ResumeEvidenceKind)))) return false;
  const typedSources = sources as ConfirmedResumePracticeSource[];
  if (value.contentVersion !== resumePracticeSetVersion(typedSources)) return false;
  const sourceVersions = new Map(typedSources.map(source => [source.experienceId, source.contentVersion]));
  const sourceKinds = new Map(typedSources.map(source => [source.experienceId, source.kinds]));
  const questions = value.questions as unknown[];
  if (questions.length < 3 || questions.length > (sources.length === 1 ? 6 : 10) || new Set(questions.map(question => record(question) ? question.id : "")).size !== questions.length) return false;
  const validQuestion = (question: unknown) => {
    if (!record(question) || !text(question.id, 300) || !text(question.text, 380) || !["经历复盘", "技术理解"].includes(String(question.category)) || typeof question.technical !== "boolean" || question.sourceType !== "experience_practice" || !text(question.source, 1000) || !record(question.resumePracticeOrigin)) return false;
    const origin = question.resumePracticeOrigin as Record<string, unknown>;
    const evidence = Array.isArray(origin.evidence) ? origin.evidence : [];
    const coverage = Array.isArray(origin.coverage) ? origin.coverage as ResumeEvidenceKind[] : [];
    const evidenceFields = (id: string) => evidence.filter(item => record(item) && item.experienceId === id).map(item => String(item.field));
    const validEvidence = evidence.every(item => record(item) && text(item.experienceId, 200) && text(item.contentVersion, 200) && fields.includes(item.field as ExperienceField) && text(item.quote, MAX_EVIDENCE_QUOTE_CHARS) && sourceVersions.get(String(item.experienceId)) === item.contentVersion);
    const evidenceKeys = evidence.map(item => record(item) ? `${item.experienceId}:${item.field}` : "");
    const supportedCoverage = coverage.every(kind => evidence.some(item => record(item) && sourceKinds.get(String(item.experienceId))?.includes(kind)));
    const focus = origin.focus === "knowledge" ? "knowledge" : "practice";
    const technicalEvidence = focus === "knowledge" || !coverage.includes("technical_evidence") || evidence.some(item => record(item) && sourceKinds.get(String(item.experienceId))?.includes("technical_evidence") && evidenceFields(String(item.experienceId)).includes("action") && evidenceFields(String(item.experienceId)).includes("tools"));
    return origin.setId === value.id && evidence.length >= 1 && evidence.length <= 4 && validEvidence && new Set(evidenceKeys).size === evidenceKeys.length
      && text(origin.whyAsk, 500) && Array.isArray(origin.capabilities) && origin.capabilities.length >= 1 && origin.capabilities.length <= 3 && origin.capabilities.every(item => text(item, 80))
      && Array.isArray(origin.angles) && origin.angles.length >= 1 && origin.angles.every(item => resumeDeepDiveAngles.includes(item as ResumeDeepDiveAngle))
      && Array.isArray(origin.followUps) && origin.followUps.length >= 1 && origin.followUps.length <= 3 && origin.followUps.every(item => text(item, 220))
      && Array.isArray(origin.missingAspects) && origin.missingAspects.every(item => resumeDeepDiveAngles.includes(item as ResumeDeepDiveAngle))
      && (origin.focus === undefined || origin.focus === "knowledge" || origin.focus === "practice") && (focus === "knowledge" ? question.category === "技术理解" && question.technical === true : question.category === "经历复盘")
      && coverage.length >= 1 && coverage.every(item => kinds.includes(item)) && supportedCoverage && technicalEvidence;
  };
  const validIssues = value.generationIssues === undefined || Array.isArray(value.generationIssues) && value.generationIssues.every(issue => record(issue) && typeof issue.index === "number" && Number.isInteger(issue.index) && issue.index >= 0 && ["structure", "duplicate", "evidence", "safety", "coverage"].includes(String(issue.reason)) && text(issue.message, 300));
  return questions.every(validQuestion) && validIssues && (value.hiddenQuestionIds === undefined || Array.isArray(value.hiddenQuestionIds) && value.hiddenQuestionIds.every(id => typeof id === "string" && questions.some(question => record(question) && question.id === id)));
}

export function loadPendingConfirmedResumePracticeSet(storage: StorageLike = candidateStorage()): ConfirmedResumePracticeSet | null {
  try {
    const raw = storage.getItem(PENDING_CONFIRMED_RESUME_SET_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return validConfirmedResumePracticeSet(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePendingConfirmedResumePracticeSet(set: ConfirmedResumePracticeSet, storage: StorageLike = candidateStorage()): void {
  if (!validConfirmedResumePracticeSet(set)) throw new Error("候选题组结构无效，未保存。");
  storage.setItem(PENDING_CONFIRMED_RESUME_SET_KEY, JSON.stringify(set));
}

export function clearPendingConfirmedResumePracticeSet(storage: StorageLike = candidateStorage()): void {
  storage.removeItem(PENDING_CONFIRMED_RESUME_SET_KEY);
}

/** Candidate sets can be reviewed again after reload, but cannot enter training once their fact snapshot changes. */
export function isPendingConfirmedResumePracticeSetCurrent(profile: UserProfile, set: ConfirmedResumePracticeSet): boolean {
  return isConfirmedResumePracticeSetCurrent(profile, set);
}

/** A saved whole-resume set may intentionally use only part of the confirmed resume. */
export function isConfirmedResumePracticeSetCurrent(profile: UserProfile, set: ConfirmedResumePracticeSet): boolean {
  const ids = new Set(set.sources.map(source => source.experienceId));
  if (!ids.size || ids.size !== set.sources.length) return false;
  const currentSources = confirmedResumeSources(profile).filter(source => ids.has(source.experienceId));
  return currentSources.length === set.sources.length && resumePracticeSetVersion(currentSources) === set.contentVersion;
}
