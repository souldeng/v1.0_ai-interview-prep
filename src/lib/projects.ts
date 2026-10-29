import type { InterviewProject, InterviewQuestion, InterviewSession, Preparation, Question } from "./domain";
import { latestAnswer, reviewTurn } from "./coaching";

export interface InterviewProjectInput {
  company: string;
  jobTitle: string;
  jobDescription: string;
  candidateBackground: string;
  concerns: string;
}

export type InterviewProjectField = "jobTitle" | "jobDescription";
export type InterviewProjectErrors = Partial<Record<InterviewProjectField, string>>;

const uid = () => `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function validateInterviewProject(input: InterviewProjectInput): InterviewProjectErrors {
  const errors: InterviewProjectErrors = {};
  if (!input.jobTitle.trim()) errors.jobTitle = "请填写目标岗位名称。";
  if (!input.jobDescription.trim()) errors.jobDescription = "请粘贴目标岗位 JD。";
  return errors;
}

export function toProjectQuestion(question: Question): InterviewQuestion {
  return {
    id: question.id,
    category: question.category,
    question: question.text,
    whyAsk: question.source,
    answerGuide: ["说明背景与目标", "突出你的具体行动", "用可验证的结果和复盘收束"],
    difficulty: "medium",
    status: "unanswered",
    userAnswer: "",
    feedback: null,
    followUpQuestions: [],
    score: null,
  };
}

export function createInterviewProject(
  input: InterviewProjectInput,
  preparation: Preparation,
  now = new Date(),
): InterviewProject {
  const timestamp = now.toISOString();
  const questions = preparation.questions.slice(0, 6).map(toProjectQuestion);
  return {
    id: uid(),
    company: input.company.trim(),
    jobTitle: input.jobTitle.trim(),
    jobDescription: input.jobDescription.trim(),
    candidateBackground: input.candidateBackground.trim(),
    concerns: input.concerns.trim(),
    analysis: null,
    questions,
    status: "ready",
    completedQuestions: 0,
    totalQuestions: questions.length,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastPracticedAt: null,
    preparation,
  };
}

/** Editing job metadata must never allocate a new project ID or discard its materials and training. */
export function editInterviewProject(project: InterviewProject, input: InterviewProjectInput, now = new Date()): InterviewProject {
  return {
    ...project,
    company: input.company.trim(),
    jobTitle: input.jobTitle.trim(),
    jobDescription: input.jobDescription.trim(),
    candidateBackground: input.candidateBackground.trim(),
    concerns: input.concerns.trim(),
    updatedAt: now.toISOString(),
  };
}

export function updateProjectFromSession(
  project: InterviewProject,
  session: InterviewSession,
  now = new Date(),
): InterviewProject {
  const latestTurns = new Map<string, InterviewSession["turns"][number]>();
  session.turns.forEach(turn => latestTurns.set(turn.questionId, turn));
  const questions = project.questions.map(question => {
    const turn = latestTurns.get(question.id);
    if (!turn) return question;
    const feedback = reviewTurn(session, turn);
    const status: InterviewQuestion["status"] = feedback.observations?.some(o => o.status === "missing" || o.status === "contradiction") ? "needs_improvement" : "answered";
    return { ...question, status, userAnswer: latestAnswer(turn), score: null };
  });
  const completedQuestions = questions.filter(question => question.status !== "unanswered").length;
  const timestamp = now.toISOString();
  return {
    ...project,
    status: session.status === "completed" ? "completed" : "practicing",
    questions,
    completedQuestions,
    updatedAt: timestamp,
    lastPracticedAt: session.turns.length > 0 ? timestamp : project.lastPracticedAt,
    session,
  };
}
