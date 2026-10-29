import type { EvidenceNote, InterviewProject, InterviewSession, JobMaterial, Preparation } from "./domain";
const record = (x: unknown): x is Record<string, any> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const strings = (x: any, keys: string[]) => record(x) && keys.every(k => typeof x[k] === "string");
const list = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === "string");
const date = (x: unknown) => typeof x === "string" && Number.isFinite(Date.parse(x));
const optionalMap = (x: unknown, valid: (v: any) => boolean) => x === undefined || record(x) && Object.entries(x).every(([k, v]) => !["__proto__", "prototype", "constructor"].includes(k) && valid(v));
export function validNote(x: unknown): x is EvidenceNote { return strings(x, ["action", "result", "reflection", "updatedAt"]) && typeof (x as any).confirmed === "boolean"; }
function validQuestion(x: any) { return strings(x, ["id", "text", "source", "category"]) && typeof x.technical === "boolean"; }
function validCoach(x: any) { return strings(x, ["answerStructure", "optimizedExample", "generatedAt"]) && date(x.generatedAt) && ["strengths", "issues", "factRisks", "suggestions", "studyTopics"].every(key => list(x[key])); }
export function validPreparation(x: unknown): x is Preparation {
  return record(x) && strings(x, ["id", "createdAt"]) && strings(x.resume, ["raw", "summary"]) && list(x.resume.evidence) && list(x.resume.skills)
    && strings(x.job, ["raw", "title"]) && list(x.job.requirements) && Array.isArray(x.questions) && x.questions.every(validQuestion)
    && Array.isArray(x.matrix) && x.matrix.every((r: any) => strings(r, ["capability", "requirement", "evidence", "gap"]) && ["matched", "partial", "gap"].includes(r.status));
}
export function validSession(x: unknown): x is InterviewSession {
  return record(x) && strings(x, ["id", "createdAt"]) && date(x.createdAt) && validPreparation(x.preparation)
    && ["active", "completed"].includes(x.status) && typeof x.awaitingFollowUp === "boolean"
    && Array.isArray(x.questions) && x.questions.length > 0 && x.questions.every(validQuestion)
    && Number.isInteger(x.currentQuestionIndex) && x.currentQuestionIndex >= 0 && x.currentQuestionIndex <= x.questions.length
    && (x.status !== "active" || x.currentQuestionIndex < x.questions.length)
    && Array.isArray(x.turns) && x.turns.every((t: any) => strings(t, ["questionId", "question", "answer"]) && record(t.score) && typeof t.followedUp === "boolean"
      && (t.revisions === undefined || Array.isArray(t.revisions) && t.revisions.every((r: any) => strings(r, ["answer", "createdAt"]) && date(r.createdAt) && record(r.score)))
      && (t.aiCoach === undefined || strings(t.aiCoach, ["answerStructure", "optimizedExample", "generatedAt"]) && date(t.aiCoach.generatedAt)
        && ["strengths", "issues", "factRisks", "suggestions", "studyTopics"].every(key => list(t.aiCoach[key])))
      && (t.coachReviews === undefined || Array.isArray(t.coachReviews) && t.coachReviews.length <= 21
        && new Set(t.coachReviews.map((r: any) => r.answerVersion)).size === t.coachReviews.length
        && t.coachReviews.every((r: any) => record(r) && typeof r.answer === "string" && Number.isInteger(r.answerVersion) && r.answerVersion >= 1 && r.answerVersion <= (t.revisions?.length ?? 0) + 1
          && r.answer === [t.answer, ...(t.revisions ?? []).map((v: any) => v.answer)][r.answerVersion - 1] && validCoach(r.feedback)))
      && (t.coachFailure === undefined || strings(t.coachFailure, ["message"]) && Number.isInteger(t.coachFailure.answerVersion)
        && t.coachFailure.answerVersion >= 1 && t.coachFailure.answerVersion <= (t.revisions?.length ?? 0) + 1)
      && (t.finalAnswer === undefined || typeof t.finalAnswer === "string") && (t.finalAnswerUpdatedAt === undefined || date(t.finalAnswerUpdatedAt)));
}
export function validProject(x: unknown): x is InterviewProject {
  return record(x) && strings(x, ["id", "company", "jobTitle", "jobDescription", "candidateBackground", "concerns", "createdAt", "updatedAt"])
    && date(x.createdAt) && date(x.updatedAt) && (x.lastPracticedAt == null || date(x.lastPracticedAt))
    && ["ready", "practicing", "completed"].includes(x.status) && Number.isInteger(x.completedQuestions) && Number.isInteger(x.totalQuestions)
    && x.completedQuestions >= 0 && x.totalQuestions >= x.completedQuestions
    && Array.isArray(x.questions) && x.questions.every((q: any) => strings(q, ["id", "category", "question", "whyAsk", "userAnswer", "status"]) && list(q.answerGuide) && list(q.followUpQuestions))
    && (x.preparation === undefined || validPreparation(x.preparation)) && (x.session === undefined || validSession(x.session))
    && (x.prepMinutes === undefined || [30, 60, 120].includes(x.prepMinutes))
    && optionalMap(x.evidenceNotes, validNote) && optionalMap(x.cases, v => strings(v, ["title"]) && validNote(v))
    && optionalMap(x.caseLinks, v => typeof v === "string" && Boolean(x.cases?.[v]))
    && (x.materials === undefined || Array.isArray(x.materials) && x.materials.every(validJobMaterial))
    && (x.aiAnalyses === undefined || Array.isArray(x.aiAnalyses) && x.aiAnalyses.every(validSavedJobAnalysis)
      && new Set(x.aiAnalyses.map((a: any) => a.id)).size === x.aiAnalyses.length);
}

export function validSavedJobAnalysis(x: any): boolean {
  return strings(x, ["id", "generatedAt"]) && Boolean(x.id) && date(x.generatedAt)
    && Array.isArray(x.rows) && x.rows.length > 0 && x.rows.length <= 12
    && x.rows.every((row: any) => strings(row, ["requirement", "status", "evidenceQuote", "reason", "studyTopic", "practiceQuestion"])
      && Boolean(row.requirement.trim()) && ["direct", "transferable", "no_evidence", "unknown"].includes(row.status))
    && (x.basis === undefined || record(x.basis) && x.basis.version === 1 && strings(x.basis, ["projectId", "fingerprint"])
      && /^[a-f0-9]{64}$/.test(x.basis.fingerprint) && Array.isArray(x.basis.sources)
      && x.basis.sources.every((source: any) => strings(source, ["id", "kind", "label"])
        && ["jd", "experience", "reference", "third_party", "previous_answer"].includes(source.kind)));
}

export function validJobMaterial(x: unknown): x is JobMaterial {
  return record(x) && strings(x, ["id", "title", "content", "source", "createdAt", "updatedAt"])
    && ["job_description", "interview_experience", "reference"].includes(String(x.kind))
    && ["manual_text", "screenshot", "file"].includes(String(x.source))
    && (x.category === undefined || ["company", "role", "technical", "culture", "other"].includes(String(x.category)))
    && (x.sourceFileName === undefined || typeof x.sourceFileName === "string")
    && (x.sourceMimeType === undefined || typeof x.sourceMimeType === "string")
    && (x.sourceDataUrl === undefined || typeof x.sourceDataUrl === "string" && x.sourceDataUrl.startsWith("data:image/"))
    && (x.fileId === undefined || typeof x.fileId === "string") && (x.originalSaved === undefined || typeof x.originalSaved === "boolean")
    && (x.collectionSourceId === undefined || typeof x.collectionSourceId === "string")
    && (x.initialContent === undefined || typeof x.initialContent === "string") && (x.reviewedAt === undefined || date(x.reviewedAt))
    && (x.projectId === undefined || typeof x.projectId === "string")
    && (x.parts === undefined || Array.isArray(x.parts) && x.parts.every((part: any) => record(part)
      && strings(part, ["id", "fileName", "mimeType", "initialText", "reviewedText"])
      && (part.fileId === undefined || typeof part.fileId === "string")
      && Number.isInteger(part.size) && part.size >= 0 && typeof part.originalSaved === "boolean"))
    && date(x.createdAt) && date(x.updatedAt);
}
