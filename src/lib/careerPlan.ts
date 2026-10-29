import { hasNegativeClaim } from "./coaching";
import type { EvidenceNote, InterviewProject, Preparation, Question } from "./domain";

export interface EvidenceTask {
  id: string;
  title: string;
  requirement: string;
  background: string;
  reason: string;
  kind: "job" | "concern";
  priority: number;
}

export function getEvidenceNotes(project: InterviewProject): Record<string, EvidenceNote> {
  const notes = { ...project.evidenceNotes };
  for (const [taskId, caseId] of Object.entries(project.caseLinks ?? {})) {
    if (project.cases?.[caseId]) notes[taskId] = project.cases[caseId];
  }
  return notes;
}

export function updateEvidenceNote(project: InterviewProject, taskId: string, note: EvidenceNote): InterviewProject {
  const caseId = project.caseLinks?.[taskId];
  return caseId && project.cases?.[caseId]
    ? { ...project, cases: { ...project.cases, [caseId]: { ...project.cases[caseId], ...note } }, updatedAt: new Date().toISOString() }
    : { ...project, evidenceNotes: { ...project.evidenceNotes, [taskId]: note }, updatedAt: new Date().toISOString() };
}

const themes = [
  { id: "discovery", title: "需求洞察与产品判断", words: ["需求", "用户", "调研", "产品规划", "优先级"] },
  { id: "ai", title: "AI 方案与技术取舍", words: ["大模型", "llm", "rag", "prompt", "agent", "知识库", "智能体"] },
  { id: "evaluation", title: "效果评测与指标", words: ["评测", "指标", "召回", "准确率", "数据分析", "实验"] },
  { id: "delivery", title: "从验证到交付", words: ["poc", "交付", "上线", "落地", "项目管理", "实施"] },
  { id: "business", title: "业务价值与客户沟通", words: ["客户", "售前", "商业", "成本", "方案汇报", "解决方案"] },
  { id: "collaboration", title: "跨团队协作", words: ["协作", "跨团队", "协调", "研发", "算法团队"] },
];
const clauses = (text: string) => text.split(/[。；;\n]/).map(value => value.trim()).filter(Boolean);
const hits = (text: string, words: string[]) => words.some(word => text.toLowerCase().includes(word));
const stableId = (text: string) => { let hash = 2166136261; for (const c of text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619); return (hash >>> 0).toString(36); };

export function buildEvidenceTasks(project: Pick<InterviewProject, "jobDescription" | "candidateBackground" | "concerns">): EvidenceTask[] {
  const jd = clauses(project.jobDescription);
  const background = clauses(project.candidateBackground);
  const tasks: EvidenceTask[] = themes.flatMap(theme => {
    const requirements = [...new Set(jd.filter(line => hits(line, theme.words)))];
    if (!requirements.length) return [];
    const linked = requirements.map(requirement => ({ requirement, evidence: background.find(line => !hasNegativeClaim(line) && hits(line, theme.words.filter(word => requirement.toLowerCase().includes(word)))) ?? "" }));
    return linked.map(({ requirement, evidence }, index) => ({ id: index === 0 ? theme.id : `${theme.id}-${stableId(requirement)}`, title: `${theme.title}${index ? ` · 要求 ${index + 1}` : ""}`, requirement, background: evidence, kind: "job" as const,
      priority: evidence ? 2 : 1,
      reason: evidence ? "有相关文字线索，请补清个人贡献、结果依据与参与边界。" : "JD 提到了这项要求，但经历中暂未找到对应文字线索，建议优先核对。" }));
  });
  if (tasks.length === 0) tasks.push({ id: "general", title: "岗位要求人工核对", requirement: project.jobDescription.trim(), background: "", kind: "job", priority: 1, reason: "暂未识别到预设能力主题，请根据原文选一个真实案例，或说明尚缺的经历。" });
  if (project.concerns.trim()) tasks.unshift({ id: "concerns", title: "你希望重点准备的问题", requirement: project.concerns.trim(), background: "", kind: "concern", priority: 0, reason: "这是你主动提出的顾虑，不代表已确认存在的能力缺陷。先准备事实说明，再准备补足计划。" });
  return tasks.sort((a, b) => a.priority - b.priority);
}

export function isEvidenceReady(note?: EvidenceNote): boolean {
  return Boolean(note?.confirmed && typeof note.action === "string" && note.action.trim() && typeof note.result === "string" && note.result.trim() && typeof note.reflection === "string" && note.reflection.trim());
}

export function getSprintTasks(tasks: EvidenceTask[], notes: Record<string, EvidenceNote>, minutes: 30 | 60 | 120): EvidenceTask[] {
  return tasks.filter(task => !isEvidenceReady(notes[task.id])).slice(0, minutes / 15);
}

export function evidenceQuestions(task: EvidenceTask): Question[] {
  const prompts = task.kind === "concern" ? [
    `关于“${task.requirement}”，请如实说明背景，并解释你为何申请这个目标岗位。`,
    "哪些真实行动或可展示的作品，能够支持你的转岗准备？哪些还只是学习计划？",
    "如果面试官认为证据还不充分，你会怎样说明能力边界和接下来的补足计划？",
  ] : [
    `针对“${task.title}”，请选一个真实经历，说明它如何迁移到目标岗位，以及你本人具体做了什么。没有相关经历时请直接说明。`,
    `你用什么结果或产物验证“${task.title}”相关工作的效果？请解释指标口径、验证方式或目前缺少的证据。`,
    `在“${task.title}”相关工作中，你做过什么取舍？哪些不属于你的职责，重做一次会怎样调整？`,
  ];
  return prompts.map((text, index) => ({ id: `evidence-${task.id}-${index}`, category: task.kind === "concern" ? "经历复盘" : /^(ai|evaluation)(-|$)/.test(task.id) ? "技术理解" : "方案与业务", technical: /^(ai|evaluation)(-|$)/.test(task.id), sourceType: task.kind === "concern" ? "resume" : "jd", source: `${task.kind === "concern" ? "用户顾虑" : "JD 原文"}：${task.requirement}`, text }));
}

export function createEvidencePreparation(project: InterviewProject, tasks: EvidenceTask[]): Preparation {
  if (!project.preparation || !tasks.length) throw new Error("请先选择至少一项准备内容。");
  const supplemental = tasks.flatMap(task => {
    const note = getEvidenceNotes(project)[task.id];
    return note ? [`【用户补充，未经外部核验】个人贡献：${note.action}；结果依据：${note.result}；边界与反思：${note.reflection}`] : [];
  });
  return { ...project.preparation, resume: { ...project.preparation.resume, evidence: [...project.preparation.resume.evidence, ...supplemental] }, questions: tasks.flatMap(evidenceQuestions) };
}

export function renderPreparationBrief(project: InterviewProject, tasks: EvidenceTask[]): string {
  const lines = [`# ${project.jobTitle}｜面试准备摘要`, "", `公司：${project.company || "未填写"}`, "", "以下内容来自岗位文本与本人补充；关联线索不等于能力核验。含求职材料，请自行决定分享范围。", ""];
  for (const task of tasks) {
    const note = getEvidenceNotes(project)[task.id];
    lines.push(`## ${task.title}`, "", `${task.kind === "concern" ? "本人顾虑" : "JD 原文"}：${task.requirement}`, "", `经历线索：${task.background || "待补充"}`, "", `个人贡献：${note?.action || "待补充"}`, "", `结果依据：${note?.result || "待补充"}`, "", `边界与反思：${note?.reflection || "待补充"}`, "", `状态：${isEvidenceReady(note) ? "本人确认可用于练习，非第三方核验" : "待补充或确认"}`, "", "建议练习：", ...evidenceQuestions(task).map(q => `- ${q.text}`), "");
  }
  return lines.join("\n");
}
