export type MatchStatus = "matched" | "partial" | "gap";
export interface ResumeProfile { raw: string; summary: string; skills: string[]; evidence: string[]; }
/** 岗位归属为可选字段：旧数据没有，训练记录与复盘只在存在时显示；不参与模型输入。 */
export interface JobProfile { raw: string; title: string; requirements: string[]; projectId?: string; projectName?: string; }
export interface MatrixRow { capability: string; requirement: string; evidence: string; status: MatchStatus; gap: string; }
export interface Question { id: string; category: "技术理解" | "方案与业务" | "协作交付" | "经历复盘" | "AI / LLM 基础" | "RAG / Agent / Prompt / 评测" | "AI 产品与落地" | "AI 售前 / 解决方案" | "转岗动机 / 能力迁移" | "项目表达 / 行为面试"; text: string; source: string; sourceType: "jd" | "resume" | "foundation" | "third_party" | "ai_follow_up" | "analysis_recommendation" | "user_recorded" | "ai_prediction" | "experience_practice" | "material_derived"; technical: boolean; projectDeepDive?: ProjectDeepDive; experienceOrigin?: { experienceId: string; setId: string; contentVersion: string; basisQuote: string }; resumePracticeOrigin?: ResumePracticeOrigin; collectionOrigin?: { materialId: string; analysisId: string; contentVersion: string; kind: string; evidenceQuote: string; origin: "original" | "derived" }; }
export interface Preparation { id: string; createdAt: string; resume: ResumeProfile; job: JobProfile; matrix: MatrixRow[]; questions: Question[]; }
export type ExperienceField = "situation" | "action" | "tools" | "result" | "reflection";
export interface ConfirmedExperienceSource { id: string; title: string; fields: Record<ExperienceField, string>; }
export type ResumeEvidenceKind = "education" | "work" | "project" | "technical_evidence" | "other";
export type ResumeQuestionFocus = "knowledge" | "practice";
export interface ResumeQuestionEvidence { experienceId: string; contentVersion: string; field: ExperienceField; quote: string; }
export interface ResumePracticeOrigin {
  setId: string;
  evidence: ResumeQuestionEvidence[];
  whyAsk: string;
  capabilities: string[];
  angles: string[];
  followUps: string[];
  missingAspects: string[];
  coverage: ResumeEvidenceKind[];
  /** Older saved sets did not record focus; treat them as personal-practice questions. */
  focus?: ResumeQuestionFocus;
}
export interface ProjectDeepDive { experienceId: string; experienceTitle: string; experienceSnapshot: string; requirementQuote: string; evidenceQuote: string; whyAsk: string; angles: string[]; followUps: string[]; }
export interface ReferenceBasis { experienceId: string; title: string; field: ExperienceField; quote: string; }
export interface Observation { id: string; label: string; status: "provided" | "missing" | "contradiction" | "unknown"; quotes: string[]; materialQuotes?: string[]; explanation: string; nextStep: string; }
/** Numeric fields retained for legacy data compatibility; not competence scores. */
export interface Scorecard { overall: number; dimensions: Record<"回应度" | "逻辑结构" | "事实与案例" | "岗位匹配度" | "表达清晰度", number>; technicalAccuracy?: number; technicalNote?: string; improvement: string; referenceAnswer: string; observations?: Observation[]; }
export interface AnswerRevision { answer: string; score: Scorecard; createdAt: string; }
export interface CoachFeedback { strengths: string[]; issues: string[]; factRisks: string[]; suggestions: string[]; answerStructure: string; studyTopics: string[]; optimizedExample: string; referenceBasis?: ReferenceBasis[]; referenceUncertainties?: string[]; generatedAt: string; }
export interface CoachReview { answerVersion: number; answer: string; feedback: CoachFeedback; }
export interface InterviewTurn { questionId: string; question: string; answer: string; score: Scorecard; followedUp: boolean; revisions?: AnswerRevision[]; finalAnswer?: string; finalAnswerUpdatedAt?: string; aiCoach?: CoachFeedback; coachReviews?: CoachReview[]; coachFailure?: { answerVersion: number; message: string }; }
export interface Report { overall: string; strengths: string[]; risks: string[]; gaps: string[]; studyTopics: string[]; nextFocus: string[]; }
export interface InterviewSession {
  id: string; createdAt: string; preparation: Preparation; questions: Question[]; currentQuestionIndex: number; awaitingFollowUp: boolean; status: "active" | "completed"; turns: InterviewTurn[]; report?: Report;
  /** Optional for backward compatibility; an ID is skipped only until the user submits an answer for it. */
  skippedQuestionIds?: string[];
  /** The final answer or skip is done, but the user has not yet explicitly completed the training. */
  readyToComplete?: boolean;
}

export type QuestionStatus = "unanswered" | "answered" | "needs_improvement" | "mastered";
export type ProjectStatus = "ready" | "practicing" | "completed";
export type QuestionDifficulty = "easy" | "medium" | "hard";

export interface FeedbackScores {
  completeness: number;
  structure: number;
  relevance: number;
  specificity: number;
  clarity: number;
}

export interface AnswerFeedback {
  overallFeedback: string;
  strengths: string[];
  improvements: string[];
  suggestions: string[];
  scores: FeedbackScores;
  possibleFollowUps: string[];
}

export interface InterviewQuestion {
  id: string;
  category: string;
  question: string;
  whyAsk: string;
  answerGuide: string[];
  difficulty: QuestionDifficulty;
  status: QuestionStatus;
  userAnswer: string;
  feedback: AnswerFeedback | null;
  followUpQuestions: string[];
  score: number | null;
}

export interface JobAnalysis {
  coreCapabilities: string[];
  keywords: string[];
  strengths: string[];
  risks: string[];
  preparationPlan: Array<{ category: string; questionCount: number }>;
}

export interface JobAnalysisItem { requirement: string; status: "direct" | "transferable" | "no_evidence" | "unknown"; evidenceQuote: string; reason: string; studyTopic: string; practiceQuestion: string; }
export interface AnalysisSource { id: string; kind: "jd" | "experience" | "reference" | "third_party" | "previous_answer"; label: string; }
export interface JobAnalysisBasis { version: 1; projectId: string; fingerprint: string; sources: AnalysisSource[]; }
export interface SavedJobAnalysis { id: string; generatedAt: string; rows: JobAnalysisItem[]; basis?: JobAnalysisBasis; }

export interface InterviewProject {
  id: string;
  company: string;
  jobTitle: string;
  jobDescription: string;
  candidateBackground: string;
  concerns: string;
  analysis: JobAnalysis | null;
  questions: InterviewQuestion[];
  status: ProjectStatus;
  completedQuestions: number;
  totalQuestions: number;
  createdAt: string;
  updatedAt: string;
  lastPracticedAt: string | null;
  preparation?: Preparation;
  session?: InterviewSession;
  prepMinutes?: 30 | 60 | 120;
  evidenceNotes?: Record<string, EvidenceNote>;
  cases?: Record<string, EvidenceNote & { title: string }>;
  caseLinks?: Record<string, string>;
  materials?: JobMaterial[];
  /** Successful analyses are append-only; absent on legacy projects. */
  aiAnalyses?: SavedJobAnalysis[];
}

/** Self-reported preparation material, never third-party verification. */
export interface EvidenceNote {
  action: string;
  result: string;
  reflection: string;
  confirmed: boolean;
  updatedAt: string;
}

export interface ResumeMaterial {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  extractedText: string;
  parser: "plain-text" | "manual" | "docx" | "pdf" | "ocr";
  /** Immutable first extraction; old records only have extractedText. */
  initialExtractedText?: string;
  fileId?: string;
  originalSaved?: boolean;
  reviewedAt?: string;
  createdAt: string;
}

/** A user-owned card. Only confirmed cards may later be used as personal facts. */
export interface ExperienceCard {
  id: string;
  title: string;
  situation: string;
  action: string;
  result: string;
  reflection: string;
  confirmed: boolean;
  sourceResumeId?: string;
  type?: string;
  tools?: string;
  notes?: string;
  sourceQuotes?: Array<{ materialId: string; quote: string }>;
  /** Only present while an AI-derived, unconfirmed card still needs its source text rechecked. */
  candidateSourceVersions?: ExperienceCandidateSourceVersion[];
  origin?: "manual" | "ai";
  createdAt: string;
  updatedAt: string;
}

/** A stable snapshot of reviewed resume text used by an AI candidate. It is not a personal fact. */
export interface ExperienceCandidateSourceVersion {
  materialId: string;
  contentVersion: string;
}

/** AI output awaiting the user's choice to turn it into an editable, unconfirmed experience draft. */
export interface ExperienceCandidate {
  id: string;
  title: string;
  situation: string;
  action: string;
  result: string;
  reflection: string;
  type?: string;
  tools?: string;
  notes?: string;
  sourceQuotes: Array<{ materialId: string; quote: string }>;
  sourceVersions: ExperienceCandidateSourceVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  version: 1;
  supplementaryInfo: string;
  resumes: ResumeMaterial[];
  experiences: ExperienceCard[];
  /** Persisted AI proposals. They are intentionally excluded from confirmedUserFacts. */
  experienceCandidates?: ExperienceCandidate[];
  aiExperienceExtractionConsent?: boolean;
  updatedAt: string;
}

export type JobMaterialKind = "job_description" | "interview_experience" | "reference";
export type InterviewExperienceCategory = "company" | "role" | "technical" | "culture" | "other";

export interface JobMaterialPart {
  id: string;
  fileId?: string;
  fileName: string;
  mimeType: string;
  size: number;
  initialText: string;
  reviewedText: string;
  originalSaved: boolean;
}

/** Job requirements and third-party notes are sources, never personal facts. */
export interface JobMaterial {
  id: string;
  collectionSourceId?: string;
  projectId?: string;
  kind: JobMaterialKind;
  title: string;
  content: string;
  category?: InterviewExperienceCategory;
  source: "manual_text" | "screenshot" | "file";
  sourceFileName?: string;
  sourceMimeType?: string;
  sourceDataUrl?: string;
  fileId?: string;
  originalSaved?: boolean;
  initialContent?: string;
  reviewedAt?: string;
  parts?: JobMaterialPart[];
  createdAt: string;
  updatedAt: string;
}
