import { evaluateEvidence, hasNegativeClaim, reviewTurn } from "./coaching";
import type { InterviewSession, JobProfile, MatrixRow, Preparation, Question, Report, ResumeProfile, Scorecard } from "./domain";

export type TurnDecision = { action: "follow_up" | "next"; followUpQuestion?: string };

const capabilities = [
  { name: "大模型应用与技术理解", hints: ["llm", "大模型", "rag", "prompt", "模型", "评测", "agent", "知识库"] },
  { name: "客户需求与方案设计", hints: ["客户", "需求", "方案", "售前", "调研", "投标", "汇报", "解决方案"] },
  { name: "POC 与项目交付", hints: ["poc", "交付", "项目", "上线", "实施", "推进", "周期"] },
  { name: "跨团队协作", hints: ["协作", "产品", "算法", "研发", "交付", "团队"] },
  { name: "数据与工程工具", hints: ["python", "sql", "api", "数据", "分析"] },
];
const split = (text: string) => text.split(/[。；;\n]/).map(s => s.trim()).filter(Boolean);
const has = (text: string, hints: string[]) => hints.some(h => text.toLowerCase().includes(h));
const extractTitle = (jd: string) => split(jd).find(line => /经理|顾问|工程师|产品|售前|解决方案|职位|岗位/.test(line))?.slice(0, 40) ?? "";
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function jobQuestion(row: MatrixRow): string {
  switch (row.capability) {
    case "大模型应用与技术理解": return /多模态|剪辑/.test(row.requirement)
      ? "如果要为内容生成或智能剪辑业务选择大模型，你会如何比较候选方案并验证效果？"
      : "你会如何选择合适的大模型，并验证它是否适合一个具体业务场景？";
    case "客户需求与方案设计": return "假设接到一个还不清楚的客户需求，你会怎样澄清目标、约束和验收标准？";
    case "POC 与项目交付": return "假设要验证一个 AI 应用方案是否值得落地，你会怎样设计小范围试验并判断是否继续？";
    case "跨团队协作": return "如果业务和研发对 AI 方案的可行性意见不同，你会怎样澄清分歧并推进决策？";
    default: return "如果 AI 应用的效果不稳定，你会收集哪些数据、使用什么工具来定位问题？";
  }
}

export function parseResume(raw: string): ResumeProfile { const clauses = split(raw); return { raw, summary: clauses.slice(0, 2).join("；"), skills: capabilities.filter(c => has(raw, c.hints)).map(c => c.name), evidence: clauses.filter(c => /\d|负责|完成|主导|优化|参与|熟悉|曾/.test(c)).slice(0, 12) }; }
export function parseJob(raw: string): JobProfile { const requirements = split(raw).filter(c => /负责|要求|熟悉|具备|理解|能力|优先|经验/.test(c)); return { raw, title: extractTitle(raw), requirements: requirements.length ? requirements.slice(0, 12) : split(raw).slice(0, 8) }; }
export function buildMatrix(resume: ResumeProfile, job: JobProfile): MatrixRow[] { return capabilities.map(cap => { const requirement = job.requirements.find(r => has(r, cap.hints)) ?? `JD 未明确展开「${cap.name}」`; const evidence = resume.evidence.filter(e => has(e, cap.hints) && !hasNegativeClaim(e)).join("；"); const status = evidence ? "matched" : resume.skills.includes(cap.name) && !hasNegativeClaim(resume.raw) ? "partial" : "gap"; return { capability: cap.name, requirement, evidence, status, gap: status === "matched" ? "有文字线索，仍需核对事实和个人贡献" : status === "partial" ? "简历有相关技能，但缺少可验证项目证据" : "简历未发现相关经历，请如实补充学习或项目计划" }; }); }
export function buildQuestions(resume: ResumeProfile, job: JobProfile, matrix: MatrixRow[]): Question[] { const questions: Question[] = []; matrix.forEach((row, index) => { const technical = row.capability.includes("技术") || row.capability.includes("工具"); const category: Question["category"] = technical ? "技术理解" : row.capability.includes("协作") ? "协作交付" : "方案与业务"; const source = row.requirement.startsWith("JD 未") ? row.evidence || row.capability : row.requirement; questions.push({ id: `jd-${index}`, category, technical, source, sourceType: "jd", text: jobQuestion(row) }); }); resume.evidence.slice(0, 3).forEach((e, index) => questions.push({ id: `resume-${index}`, category: "经历复盘", technical: /llm|rag|python|sql|模型/i.test(e), source: e, sourceType: "resume", text: `你记录了“${e}”。请说明其中你亲自承担的工作，以及有哪些结果可以确认。` })); return questions.slice(0, 8); }
export function createPreparation(resumeRaw: string, jdRaw: string): Preparation { const resume = parseResume(resumeRaw); const job = parseJob(jdRaw); const matrix = buildMatrix(resume, job); return { id: uid(), createdAt: new Date().toISOString(), resume, job, matrix, questions: buildQuestions(resume, job, matrix) }; }
export const evaluateAnswer = evaluateEvidence;
export function startSession(preparation: Preparation): InterviewSession { return { id: uid(), createdAt: new Date().toISOString(), preparation, questions: preparation.questions.slice(0, 6), currentQuestionIndex: 0, awaitingFollowUp: false, status: "active", turns: [] }; }
export function nextTurn(session: InterviewSession, answer: string, modelDecision?: TurnDecision | null): InterviewSession { const question = session.questions[session.currentQuestionIndex]; const score = evaluateAnswer(answer, question, session.preparation); const ruleFollowUp = score.observations!.some(o => o.status === "contradiction" || ((o.id === "action" || o.id === "result") && o.status === "missing")); const needsFollowUp = !session.awaitingFollowUp && (modelDecision ? modelDecision.action === "follow_up" : ruleFollowUp); const turn = { questionId: question.id, question: question.text, answer, score, followedUp: needsFollowUp }; if (needsFollowUp) { const followUp: Question = { ...question, id: `${question.id}-followup`, text: modelDecision?.followUpQuestion || "请补充一个你亲自负责的具体动作、结果或复盘；若没有该经历，请直接说明并给出学习计划。", source: modelDecision?.followUpQuestion ? "AI 基于本轮回答的追问" : "本地规则基于上一回答的追问", sourceType: modelDecision?.followUpQuestion ? "ai_follow_up" : "resume" }; const questions = [...session.questions]; questions[session.currentQuestionIndex] = followUp; return { ...session, questions, awaitingFollowUp: true, turns: [...session.turns, turn] }; } const nextIndex = session.currentQuestionIndex + 1; return { ...session, turns: [...session.turns, turn], currentQuestionIndex: nextIndex, awaitingFollowUp: false, status: nextIndex >= session.questions.length ? "completed" : "active" }; }
export function finishSession(session: InterviewSession): Report {
  const observations = session.turns.flatMap((turn, i) => (reviewTurn(session, turn).observations ?? []).map(o => ({ ...o, round: i + 1 })));
  const provided = observations.filter(o => o.status === "provided");
  const missing = observations.filter(o => o.status === "missing");
  const conflicts = observations.filter(o => o.status === "contradiction");
  const unique = (values: string[]) => [...new Set(values)];
  const focus = unique([...conflicts, ...missing].map(o => o.nextStep));
  return {
    overall: `完成 ${session.turns.length} 轮回答，保留 ${session.turns.reduce((n, t) => n + (t.revisions?.length ?? 0), 0)} 次重答。以下依据各轮最新版本整理，不提供能力分数或录用预测。`,
    strengths: provided.map(o => `第 ${o.round} 轮 · ${o.label}：「${o.quotes[0]}」（自述，未经核验）`).slice(0, 8),
    risks: conflicts.length ? conflicts.map(o => `第 ${o.round} 轮：${o.explanation}`) : ["规则未检出直接矛盾，不等于材料真实或技术正确。"],
    gaps: missing.map(o => `第 ${o.round} 轮 · ${o.label}：${o.nextStep}`),
    studyTopics: unique(observations.filter(o => o.status === "unknown").map(o => `${o.label}：${o.nextStep}`)),
    nextFocus: focus.length ? focus : ["材料线索已出现，仍需人工核对事实、技术和岗位相关性。"],
  };
}
