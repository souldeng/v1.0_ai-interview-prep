import { currentCoachReview } from "./coaching";
import type { CoachFeedback, InterviewProject, InterviewSession, InterviewTurn, Question } from "./domain";
import { trainingTotals, type TrainingTotals } from "./interview";

export type TrainingRecordStorage = "project" | "history";
export type TrainingRecordKind = "岗位训练" | "整份简历题" | "经历专项" | "自我介绍" | "基础题练习" | "手录面经复练" | "AI 预测题练习" | "资料题练习" | "独立练习";
export type TrainingQuestionStatus = "answered" | "skipped" | "unstarted";

export interface TrainingRecord {
  id: string;
  session: InterviewSession;
  project: InterviewProject | null;
  storage: TrainingRecordStorage;
  kind: TrainingRecordKind;
  title: string;
  sourceLabel: string;
  /** 会话自身携带的结构化岗位归属（多题/单题独立练习），不依赖标题字符串。 */
  job?: TrainingJobOwnership;
  activityAt: string;
  totals: TrainingTotals;
}

export interface TrainingJobOwnership { projectId: string; name: string }

export interface TrainingQuestionState {
  index: number;
  question: Question;
  status: TrainingQuestionStatus;
  turns: InterviewTurn[];
  finalAnswer?: string;
  coachFeedback?: CoachFeedback;
}

const rootQuestionId = (id: string) => id.replace(/(?:-followup)+$/, "");

function latestActualActivity(session: InterviewSession, project: InterviewProject | null) {
  const timestamps = [session.createdAt, project?.updatedAt]
    .concat(session.turns.flatMap(turn => [turn.finalAnswerUpdatedAt, ...(turn.revisions ?? []).map(revision => revision.createdAt), turn.aiCoach?.generatedAt, ...(turn.coachReviews ?? []).map(review => review.feedback.generatedAt)]))
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  return timestamps.sort((left, right) => right.localeCompare(left))[0] ?? session.createdAt;
}

/** 岗位归属只取结构化字段；标题字符串不参与判断，避免伪造岗位关系。 */
export function sessionJobOwnership(session: InterviewSession): TrainingJobOwnership | undefined {
  const job = session.preparation.job;
  if (!job.projectId || !job.projectName?.trim()) return undefined;
  return { projectId: job.projectId, name: job.projectName.trim() };
}

function classifyTraining(session: InterviewSession, project: InterviewProject | null, ownership?: TrainingJobOwnership): Pick<TrainingRecord, "kind" | "title" | "sourceLabel"> {
  if (project) return {
    kind: "岗位训练",
    title: project.jobTitle || session.preparation.job.title || "未命名岗位训练",
    sourceLabel: project.company ? `${project.company} · 岗位专项` : "岗位专项",
  };
  const firstQuestion = session.preparation.questions[0] ?? session.questions[0];
  const preparedTitle = session.preparation.job.title.trim();
  if (firstQuestion?.id.startsWith("resume-introduction-")) return { kind: "自我介绍", title: preparedTitle || "自我介绍练习", sourceLabel: "已确认简历" };
  if (firstQuestion?.resumePracticeOrigin) return { kind: "整份简历题", title: preparedTitle || "整份已确认简历专项", sourceLabel: "整份简历题" };
  if (firstQuestion?.experienceOrigin) return { kind: "经历专项", title: preparedTitle || "单段经历专项", sourceLabel: "已确认经历" };
  if (firstQuestion?.collectionOrigin) return { kind: "资料题练习", title: preparedTitle || "面试资料单题练习", sourceLabel: "已确认资料" };
  if (firstQuestion?.sourceType === "foundation") return { kind: "基础题练习", title: preparedTitle || "基础知识练习", sourceLabel: "基础题库" };
  if (firstQuestion?.sourceType === "user_recorded") return { kind: "手录面经复练", title: preparedTitle || "手录面经练习", sourceLabel: ownership ? `岗位专项 · ${ownership.name}` : "本人记录题目" };
  if (firstQuestion?.sourceType === "ai_prediction") return { kind: "AI 预测题练习", title: preparedTitle || "AI 预测题练习", sourceLabel: ownership ? `岗位专项 · ${ownership.name}` : "AI 预测题" };
  if (session.preparation.job.raw.trim() || firstQuestion?.sourceType === "jd") return { kind: "岗位训练", title: preparedTitle || "历史岗位训练", sourceLabel: "岗位专项（历史会话）" };
  return { kind: "独立练习", title: preparedTitle || "独立面试练习", sourceLabel: "独立训练" };
}

function asTrainingRecord(session: InterviewSession, project: InterviewProject | null, storage: TrainingRecordStorage): TrainingRecord {
  const ownership = project ? { projectId: project.id, name: project.jobTitle || session.preparation.job.title || "未命名岗位" } : sessionJobOwnership(session);
  return {
    id: session.id,
    session,
    project,
    storage,
    ...classifyTraining(session, project, ownership),
    ...(ownership ? { job: ownership } : {}),
    activityAt: latestActualActivity(session, project),
    totals: trainingTotals(session),
  };
}

/**
 * Builds a read-only index over the two existing stores. Project copies win over
 * their archived history copy so each session is displayed exactly once with its
 * current job ownership. This does not mutate either store.
 */
export function buildTrainingRecords(projects: InterviewProject[], history: InterviewSession[]): TrainingRecord[] {
  const bySessionId = new Map<string, TrainingRecord>();
  for (const project of projects) {
    if (!project.session) continue;
    const candidate = asTrainingRecord(project.session, project, "project");
    const current = bySessionId.get(candidate.id);
    if (!current || current.storage === "history" || candidate.activityAt > current.activityAt) bySessionId.set(candidate.id, candidate);
  }
  for (const session of history) {
    if (!bySessionId.has(session.id)) bySessionId.set(session.id, asTrainingRecord(session, null, "history"));
  }
  return [...bySessionId.values()].sort((left, right) => right.activityAt.localeCompare(left.activityAt) || right.session.createdAt.localeCompare(left.session.createdAt));
}

export function trainingQuestionStates(session: InterviewSession): TrainingQuestionState[] {
  const skipped = new Set((session.skippedQuestionIds ?? []).map(rootQuestionId));
  return session.questions.map((question, index) => {
    const rootId = rootQuestionId(question.id);
    const turns = session.turns.filter(turn => rootQuestionId(turn.questionId) === rootId);
    const latestTurn = turns.at(-1);
    const coachFeedback = latestTurn ? currentCoachReview(latestTurn)?.feedback ?? latestTurn.aiCoach : undefined;
    return {
      index,
      question,
      status: turns.length ? "answered" : skipped.has(rootId) ? "skipped" : "unstarted",
      turns,
      finalAnswer: latestTurn?.finalAnswer?.trim() || undefined,
      coachFeedback,
    };
  });
}
