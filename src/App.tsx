import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, History, Loader2, Play, Send, Sparkles, Trash2 } from "lucide-react";
import type { InterviewProject, InterviewSession, JobMaterial, Preparation, Question, Report, UserProfile } from "./lib/domain";
import { completeSession, createPreparation, finishSession, goToQuestion, nextTurn, skipCurrentQuestion, startSession, trainingTotals } from "./lib/interview";
import { loadProjects, saveProject, deleteProject } from "./lib/projectStorage";
import { createInterviewProject, editInterviewProject, toProjectQuestion, updateProjectFromSession, validateInterviewProject, type InterviewProjectInput } from "./lib/projects";
import { clearHistory, deleteHistory, loadHistory, saveHistory } from "./lib/storage";
import { coachInterviewAnswer, decideInterviewTurn, generateJobProjectQuestions, selectInterviewQuestionIds, DEFAULT_MODEL_TIMEOUTS } from "./services/modelClient";
import { questionSourceLabel } from "./lib/questionSource";
import { buildInterviewContext } from "./lib/interviewContext";
import { trustedPreparation, trustedQuestionCandidates, selectLocalQuestions } from "./lib/trustedPreparation";
import { foundationQuestions, foundationToPracticeQuestion, type FoundationQuestion } from "./lib/foundationQuestions";
import { CreateInterview } from "./components/interview/CreateInterview";
import { CareerPlan } from "./components/interview/CareerPlan";
import { updateEvidenceNote } from "./lib/careerPlan";
import type { EvidenceNote } from "./lib/domain";
import { AnswerReview } from "./components/interview/AnswerReviewV2";
import { AIRequestStatus } from "./components/interview/AIRequestStatus";
import { VoicePracticeControls } from "./components/interview/VoicePracticeControls";
import { BackupPanel } from "./components/interview/BackupPanel";
import { SettingsCenter } from "./components/settings/SettingsCenter";
import { ExportPanel } from "./components/settings/ExportPanel";
import { attachCoachReview, currentCoachReview, latestAnswer, markCoachFailure, questionForTurn, reviseTurn, saveFinalAnswer as persistFinalAnswer } from "./lib/coaching";
import { loadDrafts, saveDraft } from "./lib/drafts";
import { loadUserProfile, saveUserProfile } from "./lib/profileStorage";
import { AppShell, type NavigationTarget } from "./components/layout/AppShell";
import { PreparationDashboard } from "./components/dashboard/PreparationDashboard";
import { TrainingRecordList } from "./components/history/TrainingRecordList";
import { TrainingSessionReview } from "./components/history/TrainingSessionReview";
import { JobList } from "./components/jobs/JobList";
import { JobWorkbench, type JobWorkbenchModule } from "./components/jobs/JobWorkbench";
import { JobMaterials } from "./components/jobs/JobMaterials";
import { EvidenceAnalysis } from "./components/jobs/EvidenceAnalysis";
import { saveProjectAnalysis } from "./lib/jobAnalysis";
import type { SavedJobAnalysis } from "./lib/domain";
import { analysisPracticeOrigin, analysisPracticeQuestion, type AnalysisQuestionSelection } from "./lib/analysisPractice";
import { ProfileLibrary } from "./components/profile/ProfileLibraryV2";
import { QuestionLibrary } from "./components/library/QuestionLibrary";
import { Toaster } from "./components/ui/sonner";
import { Button } from "./components/ui/button";
import { JobSpecialtyTraining } from "./components/library/JobSpecialtyTraining";
import { FoundationLearning } from "./components/library/FoundationLearning";
import { RecordedQuestionInput } from "./components/library/RecordedQuestionInput";
import { BatchImportQuestions } from "./components/library/BatchImportQuestions";
import { ExperiencePractice } from "./components/library/ExperiencePractice";
import { MaterialCollection } from "./components/library/MaterialCollection";
import { collectionPracticeContext, type MaterialCollection as CollectionState, type CollectedMaterial } from "./lib/materialCollection";
import { currentExperienceSet, experiencePracticeContext, experienceVersion, visibleExperienceQuestions, type ExperiencePracticeSet } from "./lib/experiencePractice";
import { confirmedResumePracticeContext, isConfirmedResumePracticeSetCurrent, isResumePracticeQuestionCurrent, resumeIntroductionQuestion, visibleConfirmedResumeQuestions, type ConfirmedResumePracticeSet } from "./lib/confirmedResumePractice";
import { createImportSource, createJobRecommendedQuestion, createRecordedQuestion, createRecordedQuestions, deleteExperienceSet, deleteJobRecommendedQuestion, deleteRecordedQuestion, deleteResumeSet, recordedPracticeQuestion, type RecordedQuestion } from "./lib/questionLibrary";
import { buildLibraryQuestions, createReuseDraft, loadQuestionLibrary, saveQuestionLibrary, toggleLibraryFavorite, type AnswerReuseDraft, type LibraryQuestion, type QuestionLibraryState } from "./lib/questionLibrary";
import type { BatchImportSavePayload } from "./components/library/BatchImportQuestions";
import { displayQuestionText } from "./lib/interviewRecordParser";
import { buildDocx, buildPdf, buildQuestionDocx, buildQuestionPdf, download } from "./lib/interviewExport";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { UnsavedChangesProvider, useSafeNavigation, useUnsavedChanges } from "./components/shared/UnsavedChanges";
import { buildTrainingRecords, trainingQuestionStates, type TrainingRecord } from "./lib/trainingRecords";
const answerKey = (s: InterviewSession) => `answer:${s.id}:${s.questions[s.currentQuestionIndex]?.id ?? "complete"}`;
const isImportedPracticeSource = (sourceType?: Question["sourceType"]) => sourceType === "user_recorded" || sourceType === "ai_prediction";
/**
 * 岗位归属只从题库题目的 projectId 推导：全部题目属于同一个仍存在的岗位才算归属。
 * 混合岗位或存在未关联题时不强行归属，也不伪造统一 projectId。
 */
function jobOwnership(jobs: InterviewProject[], projectIds: Array<string | undefined>): { projectId: string; name: string } | undefined {
  if (!projectIds.length) return undefined;
  const first = projectIds[0];
  if (!first || projectIds.some(id => !id || id !== first)) return undefined;
  const project = jobs.find(item => item.id === first);
  return project ? { projectId: project.id, name: project.jobTitle || "未命名岗位" } : undefined;
}

type Page = "dashboard" | "jobs" | "profile" | "library" | "job-workbench" | "create" | "matrix" | "questions" | "interview" | "report" | "history" | "training-review" | "settings";

const demoResume = `张晨｜AI 解决方案顾问
3 年 AI 应用与售前经验。2023-2025 在星云科技负责企业知识库与智能客服方案，完成 12 个客户 POC，覆盖金融、零售行业；与算法、交付团队协作，将检索召回率从 72% 优化到 86%，项目平均交付周期缩短 20%。
熟悉 LLM 应用、RAG、Prompt 工程、Python、SQL、需求调研和方案撰写。曾向客户高管汇报方案并参与投标。`;
const demoJd = `AI 解决方案经理
负责大模型应用解决方案设计、客户需求调研、POC 推进和售前技术支持。要求 3 年以上 AI 或 SaaS 解决方案经验，理解 LLM、RAG 和模型评测；能与产品、算法、交付协作；具备客户沟通、方案汇报与项目管理能力。熟悉 Python 或 SQL 优先。`;
const demoProject = {
  company: "星云科技",
  jobTitle: "AI 解决方案经理",
  jobDescription: demoJd,
  candidateBackground: demoResume,
  concerns: "担心被追问项目中的个人贡献、模型评测方法和量化结果。",
};

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return <h2 className="flex items-center gap-2 text-xl font-bold text-slate-950">{icon}{children}</h2>;
}

function statusLabel(status: string) {
  return status === "matched" ? "有文字线索" : status === "partial" ? "部分匹配" : "待补足";
}

export default function App() {
  return <UnsavedChangesProvider><InterviewApp/></UnsavedChangesProvider>;
}

function InterviewApp() {
  const navigate = useSafeNavigation();
  const [page, setPage] = useState<Page>("dashboard");
  const [settingsSection, setSettingsSection] = useState<"home" | "backup" | "export">("home");
  const [settingsReturnPage, setSettingsReturnPage] = useState<Page>("dashboard");
  const [libraryArea, setLibraryArea] = useState<"foundation" | "job" | "recorded" | "resume" | "collection" | null>(null);
  // 题库「导入已有题目」入口跳转时让批量导入页直接打开；其余进入方式重置为单题录入。
  const [recordedInputMode, setRecordedInputMode] = useState<"single" | "batch">("single");
  /** 题库岗位筛选由 App 持有，岗位工作台与题库快捷筛选共用同一份状态，不新建第二套筛选。 */
  const [libraryJobFilter, setLibraryJobFilter] = useState("all");
  const [selectedExperience, setSelectedExperience] = useState<string | null>(null);
  const [selectedExperienceSet, setSelectedExperienceSet] = useState<string | null>(null);
  const [selectedCollectionAnalysis, setSelectedCollectionAnalysis] = useState<string | null>(null);
  const [pendingExperience, setPendingExperience] = useState<{ kind: "question"; setId: string; questionId: string } | { kind: "set"; setId: string } | null>(null);
  const [pendingIntroduction, setPendingIntroduction] = useState<1 | 3 | null>(null);
  const [activeJobModule, setActiveJobModule] = useState<JobWorkbenchModule>("materials");
  const [projects, setProjects] = useState<InterviewProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [reviewingTurnIndex, setReviewingTurnIndex] = useState<number | null>(null);
  const [answer, setAnswer] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<InterviewSession[]>([]);
  const [selectedTrainingRecordId, setSelectedTrainingRecordId] = useState<string | null>(null);
  const [questionLibrary, setQuestionLibrary] = useState<QuestionLibraryState>(() => loadQuestionLibrary());
  const [userProfile, setUserProfile] = useState<UserProfile>(() => loadUserProfile());
  const [error, setError] = useState("");
  const [modelAvailable, setModelAvailable] = useState(false);
  const [answerSubmitting, setAnswerSubmitting] = useState(false);
  const [trainingStarting, setTrainingStarting] = useState(false);
  const [coachPending, setCoachPending] = useState(false);
  const [waitingAnswer, setWaitingAnswer] = useState<{ question: string; answer: string } | null>(null);
  const [modelTimeouts, setModelTimeouts] = useState<{ coach: number; interviewer: number }>({ ...DEFAULT_MODEL_TIMEOUTS });
  const [cancellingAI, setCancellingAI] = useState(false);
  const activeAIRequest = useRef<AbortController | null>(null);
  const coachRequestActive = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [editing, setEditing] = useState<InterviewProject | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InterviewProject | null>(null);
  const [historyReturnPage, setHistoryReturnPage] = useState<Page>("library");
  function manageHistory() { navigate(() => { setHistoryReturnPage(page); setPage("history"); setError(""); }); }
  function openSettings() { navigate(() => { setSettingsReturnPage(page); setSettingsSection("home"); setPage("settings"); setError(""); }); }
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const blocked = Object.values(unsaved).some(Boolean);
  const markUnsaved = (key: string, value: boolean) => setUnsaved(current => ({ ...current, [key]: value }));
  // 训练草稿写入失败时接入统一未保存对话框：退出不再静默失效（P1-1）。
  useUnsavedChanges("training-answer-draft", Boolean(unsaved.answer && session), {
    label: "本轮回答草稿",
    save: () => {
      try {
        if (session) saveDraft(answerKey(session), answer);
        markUnsaved("answer", false);
        return null;
      } catch (e) { return e instanceof Error ? e.message : "草稿保存失败，请重试。"; }
    },
    discard: () => markUnsaved("answer", false),
  });
  useUnsavedChanges("review-drafts", Boolean(unsaved.retry), {
    label: "重答与最终回答草稿",
    save: () => "当前本地存储不可用，重答草稿暂无法保存；可选择「放弃修改」离开（文字不保留），或留在当前页重试。",
    discard: () => markUnsaved("retry", false),
  });
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (blocked) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [blocked]);
  const [pendingNewTraining, setPendingNewTraining] = useState(false);
  const [pendingRecommendation, setPendingRecommendation] = useState<AnalysisQuestionSelection | null>(null);
  const [pendingRecordedQuestion, setPendingRecordedQuestion] = useState<string | null>(null);
  const [pendingRecordedIds, setPendingRecordedIds] = useState<string[]>([]);
  const [splittingRecordedId, setSplittingRecordedId] = useState<string | null>(null);
  const [pendingFoundation, setPendingFoundation] = useState<FoundationQuestion | null>(null);
  const [returnAnalysisId, setReturnAnalysisId] = useState<string | null>(null);

  useEffect(() => {
    const cancel = () => activeAIRequest.current?.abort("page-exit");
    window.addEventListener("pagehide", cancel);
    return () => { window.removeEventListener("pagehide", cancel); cancel(); };
  }, []);

  useEffect(() => {
    setProjects(loadProjects());
    setHistory(loadHistory());
    setQuestionLibrary(loadQuestionLibrary());
    setUserProfile(loadUserProfile());
    fetch("/api/health").then(r => r.json()).then(data => {
      setModelAvailable(Boolean(data.modelConfigured));
      const bounded = (value: unknown, fallback: number) => Number.isInteger(value) && Number(value) >= 1000 && Number(value) <= 300_000 ? Number(value) : fallback;
      setModelTimeouts({ coach: bounded(data.timeouts?.coach, DEFAULT_MODEL_TIMEOUTS.coach), interviewer: bounded(data.timeouts?.interviewer, DEFAULT_MODEL_TIMEOUTS.interviewer) });
    }).catch(() => { setModelAvailable(false); });
  }, []);
  const activeProject = useMemo(() => projects.find(project => project.id === activeProjectId) ?? null, [activeProjectId, projects]);
  const trainingRecords = useMemo(() => buildTrainingRecords(projects, history), [projects, history]);
  const selectedTrainingRecord = useMemo(() => trainingRecords.find(record => record.id === selectedTrainingRecordId) ?? null, [trainingRecords, selectedTrainingRecordId]);
  const libraryEntries = useMemo(() => buildLibraryQuestions(projects, history, questionLibrary), [projects, history, questionLibrary]);
  /** 岗位关联题统计：只读聚合题库条目（手动题/AI 预测题 + 岗位推荐题），不写任何数据。 */
  const jobQuestionStats = useMemo(() => projects.map(project => {
    const keys = [
      ...(questionLibrary.recordedQuestions ?? []).filter(item => item.projectId === project.id).map(item => `recorded:${item.id}`),
      ...(questionLibrary.jobRecommendedQuestions ?? []).filter(item => item.projectId === project.id).map(item => `jobrec:${item.id}`),
    ];
    const byKey = new Map(libraryEntries.map(entry => [entry.key, entry]));
    const answered = keys.filter(key => { const entry = byKey.get(key); return Boolean(entry && entry.answerStatus !== "unanswered"); }).length;
    return { id: project.id, name: project.jobTitle || "未命名岗位", total: keys.length, answered, unanswered: keys.length - answered };
  }), [projects, questionLibrary, libraryEntries]);
  const activeJobStats = jobQuestionStats.find(item => item.id === activeProjectId) ?? null;
  function openJobQuestions(projectId: string) {
    navigate(() => { setLibraryArea("job"); setLibraryJobFilter(projectId); setPage("library"); setError(""); });
  }
  const selectedCard = userProfile.experiences.find(card => card.id === selectedExperience);
  const viewedExperienceSet = questionLibrary.experienceSets?.find(set => set.id === selectedExperienceSet) ?? (selectedCard ? currentExperienceSet(questionLibrary, selectedCard) : undefined);
  const viewedResumeSet = questionLibrary.resumeSets?.find(set => set.id === selectedExperienceSet);
  const visibleLibraryEntries = libraryEntries.filter(item => libraryArea === "collection" ? item.questionId.startsWith("collected-question-") : libraryArea === "resume" ? Boolean(viewedExperienceSet?.questions.some(question => question.id === item.questionId.replace(/(?:-followup)+$/, "")) || viewedResumeSet?.questions.some(question => question.id === item.questionId.replace(/(?:-followup)+$/, ""))) : libraryArea === "foundation" ? !item.projectId && item.questionId.startsWith("foundation-") : libraryArea === "recorded" ? Boolean(item.recordedQuestionId) || item.questionId.startsWith("recorded-") : libraryArea === "job" ? !item.questionId.startsWith("collected-question-") && !item.questionId.startsWith("experience-set-") && !item.questionId.startsWith("resume-set-") && (Boolean(item.projectId) || Boolean(item.associatedProjectId) || (!item.recordedQuestionId && !item.questionId.startsWith("recorded-") && !item.questionId.startsWith("foundation-"))) : !item.questionId.startsWith("collected-question-") && !item.questionId.startsWith("experience-set-") && !item.questionId.startsWith("resume-set-") && !item.recordedQuestionId && !item.questionId.startsWith("recorded-") && (Boolean(item.projectId) || !item.questionId.startsWith("foundation-")));
  const question = session?.questions[session.currentQuestionIndex];
  const totals = session ? trainingTotals(session) : null;
  const reviewingTurn = session && reviewingTurnIndex !== null ? session.turns[reviewingTurnIndex] : null;
  const canContinueTraining = Boolean(session?.status === "active" && (question || session.readyToComplete));
  const recordedTarget = projects.find(project => project.id === questionLibrary.recordedQuestions?.find(item => item.id === pendingRecordedQuestion)?.projectId);
  const recordedContinuation = session?.status === "active" ? session : recordedTarget?.session?.status === "active" ? recordedTarget.session : history.find(item => item.status === "active" && isImportedPracticeSource(item.preparation.questions[0]?.sourceType) && item.preparation.questions[0].id === pendingRecordedQuestion);
  const foundationContinuation = session?.status === "active" ? session : history.find(item => item.status === "active" && item.preparation.questions[0]?.sourceType === "foundation" && item.preparation.questions[0].id === pendingFoundation?.id);
  const experienceContinuation = session?.status === "active" ? session : history.find(item => item.status === "active");
  const activeNavigationTarget: NavigationTarget = page === "settings" ? "settings"
    : page === "dashboard" ? "dashboard"
    : page === "profile" ? "profile"
      : page === "library" ? "library"
        : page === "history" || page === "training-review" || (!activeProjectId && (page === "interview" || page === "report")) ? "history"
          : page === "job-workbench" && activeJobModule === "materials" ? "materials"
            : "prepare";
  const pageDetails: Record<Page, { title: string; description: string; breadcrumbs: string[] }> = {
    dashboard: { title: "工作台", description: "从当前进度继续准备。", breadcrumbs: [] },
    jobs: { title: "准备", description: "管理目标岗位、JD、资料与岗位训练。", breadcrumbs: [] },
    profile: { title: "我的经历", description: "", breadcrumbs: ["资料"] },
    library: { title: "", description: "", breadcrumbs: [] },
    "job-workbench": { title: activeProject?.jobTitle || "岗位准备", description: "", breadcrumbs: ["准备", activeProject?.jobTitle || "未选择岗位"] },
    create: { title: editing ? "编辑岗位" : "创建岗位", description: "", breadcrumbs: ["准备", editing ? "编辑岗位" : "创建岗位"] },
    matrix: { title: "岗位分析", description: "查看当前岗位的原始 JD、材料线索和准备路线。", breadcrumbs: ["准备", activeProject?.jobTitle || "当前岗位", "分析"] },
    questions: { title: "问题练习", description: "浏览当前岗位的针对性题目，并进入文字模拟训练。", breadcrumbs: ["准备", activeProject?.jobTitle || "当前岗位", "训练"] },
    interview: { title: "模拟训练", description: "", breadcrumbs: ["准备", activeProject?.jobTitle || "当前岗位", "训练"] },
    report: { title: "训练复盘", description: "依据当前会话的最新回答整理可追溯的材料线索与待补项。", breadcrumbs: ["训练记录", activeProject?.jobTitle || "当前岗位", "面试训练"] },
    history: { title: "训练记录", description: "查看岗位训练和独立练习的真实进度、回答与最终答案。", breadcrumbs: [] },
    "training-review": { title: "历史单轮复盘", description: "只展示该轮实际保存的题目、回答、点评和最终答案。", breadcrumbs: ["训练记录"] },
    settings: { title: "设置与数据", description: "管理本地备份与导出。数据仅保存在当前浏览器，不会自动上传。", breadcrumbs: [] },
  };

  async function createProject(input: InterviewProjectInput, materials: JobMaterial[] = []): Promise<string | null> {
    setError("");
    if (Object.keys(validateInterviewProject(input)).length > 0) return "请检查必填项后再提交。";
    try {
      const generated = editing ? null : createPreparation(input.candidateBackground, input.jobDescription);
      const nextPreparation = generated ? { ...generated, job: { ...generated.job, title: input.jobTitle.trim() } } : null;
      const project = editing ? editInterviewProject(editing, input) : createInterviewProject(input, nextPreparation!);
      if (materials.length) project.materials = [...(project.materials ?? []), ...materials.map(material => ({ ...material, projectId: project.id }))];
      setProjects(saveProject(project));
      setActiveProjectId(project.id);
      setPreparation(project.session?.preparation ?? project.preparation ?? null);
      setSession(project.session ?? null); setReviewingTurnIndex(null);
      setReport(null);
      setAnswer(project.session ? loadDrafts()[answerKey(project.session)] ?? "" : "");
      setActiveJobModule("analysis");
      setPage("job-workbench"); setEditing(null); markUnsaved("form", false);
      return null;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "创建面试项目失败，请稍后重试。";
      setError(message);
      return message;
    }
  }

  function requestNewTraining() {
    if (!activeProject || answerSubmitting || coachPending || blocked) return;
    navigate(() => {
      setPendingRecommendation(null);
      setPendingRecordedQuestion(null); setPendingRecordedIds([]);
      if (activeProject.session || answer.trim()) setPendingNewTraining(true);
      else void startTrustedInterview();
    });
  }

  function requestAnalysisPractice(selection: AnalysisQuestionSelection) {
    if (!activeProject || selection.projectId !== activeProject.id || answerSubmitting || coachPending || blocked) return;
    navigate(() => {
      setPendingRecommendation(selection);
      setPendingRecordedQuestion(null); setPendingRecordedIds([]);
      if (activeProject.session || answer.trim()) setPendingNewTraining(true);
      else void startTrustedInterview(selection);
    });
  }

  /** 从题库练习已加入岗位专项题库的推荐题：按存储的 analysisId+rowIndex 重建选择，保持来源可追溯（C3）。 */
  function requestRecommendedPractice(recommendedId: string) {
    if (answerSubmitting || coachPending || blocked) return;
    navigate(() => {
      const item = loadQuestionLibrary().jobRecommendedQuestions?.find(entry => entry.id === recommendedId);
      if (!item) { setError("题库推荐题无法读取，未开始训练。"); return; }
      setPendingRecordedQuestion(null); setPendingRecordedIds([]);
      const selection: AnalysisQuestionSelection = { projectId: item.projectId, analysisId: item.analysisId, rowIndex: item.rowIndex };
      setPendingRecommendation(selection);
      const target = loadProjects().find(project => project.id === item.projectId);
      if (session || target?.session || answer.trim()) setPendingNewTraining(true);
      else void startTrustedInterview(selection);
    });
  }

  /** 把当前分析的推荐题加入岗位专项题库：按 analysisId+rowIndex 去重，不复制出互不关联的题目副本（C3）。 */
  function addRecommendationToLibrary(analysisId: string, rowIndex: number, question: string): string | null {
    try {
      if (!activeProject) return "请先打开岗位分析，再加入题库。";
      const analysis = activeProject.aiAnalyses?.find(item => item.id === analysisId);
      const row = Number.isInteger(rowIndex) && rowIndex >= 0 ? analysis?.rows[rowIndex] : undefined;
      if (!analysis || !row?.practiceQuestion.trim()) return "原分析或推荐题已不存在，未加入题库。";
      const current = loadQuestionLibrary();
      if ((current.jobRecommendedQuestions ?? []).some(item => item.projectId === activeProject.id && item.analysisId === analysisId && item.rowIndex === rowIndex)) return "这道推荐题已在岗位专项题库中。";
      const item = createJobRecommendedQuestion(activeProject.id, analysisId, rowIndex, row.practiceQuestion);
      setQuestionLibrary(saveQuestionLibrary({ ...current, jobRecommendedQuestions: [...(current.jobRecommendedQuestions ?? []), item] }));
      setError("");
      return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "加入题库失败，请重试。"; }
  }

  function requestRecordedPractice(id: string) {
    if (answerSubmitting || coachPending || blocked) return;
    navigate(() => {
      const item = loadQuestionLibrary().recordedQuestions?.find(item => item.id === id);
      if (!item) { setError("已保存题目无法读取，未开始训练。"); return; }
      setPendingRecommendation(null); setPendingRecordedQuestion(id); setPendingRecordedIds([]);
      const target = loadProjects().find(project => project.id === item.projectId);
      const ongoing = loadHistory().some(session => session.status === "active" && isImportedPracticeSource(session.preparation.questions[0]?.sourceType) && session.preparation.questions[0].id === id);
      if (session || target?.session || ongoing || answer.trim()) setPendingNewTraining(true);
      else void startTrustedInterview(undefined, id);
    });
  }

  /** 多题训练：选中几道就训练几道，顺序与选择一致；独立训练记录，不自动补题、不写入岗位会话。 */
  function requestRecordedSetPractice(ids: string[]) {
    if (answerSubmitting || coachPending || blocked || !ids.length) return;
    navigate(() => {
      const stored = loadQuestionLibrary().recordedQuestions ?? [];
      if (ids.some(id => !stored.some(item => item.id === id))) { setError("部分已选题目无法读取，未开始训练。"); return; }
      setPendingRecommendation(null); setPendingRecordedQuestion(null); setPendingRecordedIds(ids);
      const ongoing = loadHistory().some(item => item.status === "active" && isImportedPracticeSource(item.preparation.questions[0]?.sourceType) && ids.includes(item.preparation.questions[0].id));
      if (session || ongoing || answer.trim()) setPendingNewTraining(true);
      else void startTrustedInterview(undefined, undefined, ids);
    });
  }

  function saveRecordedQuestion(text: string, projectId?: string): string | null {
    try {
      if (projectId && !loadProjects().some(project => project.id === projectId)) throw new Error("关联岗位已不可用，请重新选择；输入仍保留。");
      const item = createRecordedQuestion(text, projectId), current = loadQuestionLibrary();
      setQuestionLibrary(saveQuestionLibrary({ ...current, recordedQuestions: [...(current.recordedQuestions ?? []), item] }));
      requestRecordedPractice(item.id); return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "题目保存失败，输入仍保留。"; }
  }

  /** 批量导入/拆分保存：原始记录保留用于追溯；任一题目非法则整批失败，预览保留以便重试。 */
  function saveImportedQuestions(payload: BatchImportSavePayload, splitFromId?: string): string | null {
    try {
      const current = loadQuestionLibrary();
      const parent = splitFromId ? current.recordedQuestions?.find(item => item.id === splitFromId) : null;
      if (splitFromId && !parent) throw new Error("原题目已不存在，未保存；请刷新题库后重试。");
      let importSources = current.importSources ?? [];
      let importSourceId = parent?.importSourceId;
      if (!splitFromId) {
        const source = createImportSource(payload.source.title, payload.source.content, payload.source.feedback, payload.source.sourceType);
        importSources = [...importSources, source];
        importSourceId = source.id;
      }
      const sourceType = parent?.sourceType ?? payload.source.sourceType;
      const items = createRecordedQuestions(payload.drafts.map(draft => splitFromId ? { ...draft, splitFromId } : draft), importSourceId, sourceType);
      setQuestionLibrary(saveQuestionLibrary({
        ...current,
        importSources: importSources.length ? importSources : undefined,
        recordedQuestions: [...(current.recordedQuestions ?? []), ...items],
      }));
      setError("");
      return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "批量保存失败，预览内容已保留。"; }
  }

  async function startTrustedInterview(selection?: AnalysisQuestionSelection, recordedId?: string, recordedIds?: string[]) {
    if ((!activeProject && !recordedId && !recordedIds?.length) || answerSubmitting || coachPending || blocked) return;
    setPendingNewTraining(false);
    const controller = new AbortController();
    activeAIRequest.current = controller; setCancellingAI(false); setWaitingAnswer(null);
    setTrainingStarting(true); setAnswerSubmitting(true);
    try {
      const recorded = recordedId ? loadQuestionLibrary().recordedQuestions?.find(item => item.id === recordedId) : null;
      if (recordedId && !recorded) throw new Error("已保存题目无法读取，未开始训练。");
      // 多题训练：按用户确认的顺序取题；不补题、不调用模型、不写入岗位会话。
      const recordedSet: RecordedQuestion[] = recordedIds?.length
        ? recordedIds.map(id => loadQuestionLibrary().recordedQuestions?.find(item => item.id === id)).filter((item): item is RecordedQuestion => Boolean(item))
        : [];
      if (recordedIds?.length && recordedSet.length !== recordedIds.length) throw new Error("部分已选题目无法读取，未开始训练。");
      const jobs = loadProjects();
      // 单题与多题练习一律独立保存：只保留结构化岗位归属，岗位当前会话、题目列表与进度保持原样。
      const ownership = recordedSet.length ? jobOwnership(jobs, recordedSet.map(item => item.projectId)) : recorded ? jobOwnership(jobs, [recorded.projectId]) : undefined;
      const target = recorded || recordedSet.length ? undefined : jobs.find(item => item.id === activeProject?.id);
      if (!target && !recorded && !recordedSet.length) throw new Error("岗位无法安全读取，未开始训练。");
      // 上下文仍可读取关联岗位（单题沿用既有岗位上下文），但不写回该岗位的任何会话。
      const contextProject = target ?? (ownership ? jobs.find(item => item.id === ownership.projectId) ?? null : null);
      if (contextProject && !contextProject.preparation && !contextProject.session && contextProject.questions.length > 0) throw new Error("该旧岗位缺少训练准备快照，旧分析与题目仍可查看。为避免覆盖历史内容，未开始新训练；请先备份并人工核对旧记录。");
      const recommendation = recorded ? recordedPracticeQuestion(recorded, jobs) : selection ? analysisPracticeQuestion(target!, selection) : null;
      const context = buildInterviewContext({ project: contextProject, profile: loadUserProfile() });
      const candidates = recommendation ? [recommendation] : trustedQuestionCandidates(context);
      if (!candidates.length && !recordedSet.length) throw new Error("当前没有可练习题目；请补充 JD 或前往 AI 面试题库选择内置题。");
      let selected = recommendation ? [recommendation] : selectLocalQuestions(candidates);
      let modelNotice = "";
      if (recordedSet.length) selected = recordedSet.map(item => recordedPracticeQuestion(item, jobs));
      else if (!recommendation && modelAvailable) {
        try {
          if (context.targetJob.jd.trim() && context.confirmedExperienceSources?.length) {
            selected = await generateJobProjectQuestions(context, { signal: controller.signal, timeoutMs: modelTimeouts.interviewer });
          } else {
            const ids = await selectInterviewQuestionIds(context, candidates.map(item => ({ id: item.id, question: item.text, source: item.source })), { signal: controller.signal, timeoutMs: modelTimeouts.interviewer });
            if (ids.length) selected = ids.map(id => candidates.find(item => item.id === id)!).filter(Boolean); else modelNotice = "模型未选出有效题目，已使用本地选题。";
          }
        }
        catch { if (controller.signal.aborted) throw new Error("已取消准备训练，原训练和资料保留。"); modelNotice = "AI 岗位题准备失败或依据不足，已使用本地题；本轮未获得有效的项目深挖题。"; }
      }
      if (controller.signal.aborted || activeAIRequest.current !== controller) throw new Error("已取消准备训练，未写入迟到结果。");
      if (!recommendation && !recordedSet.length && JSON.stringify(context) !== JSON.stringify(buildInterviewContext({ project: loadProjects().find(p => p.id === contextProject?.id), profile: loadUserProfile() }))) throw new Error("岗位或经历在准备期间已变化，请重新开始；原训练保留。");
      // 选中几道就训练几道：多题训练不套用默认 6 题上限。
      const prepared = trustedPreparation(context, selected, recordedSet.length ? selected.length : undefined);
      // 手动导入题不冒充岗位训练：记录标题与保存时的来源一致；岗位归属用结构化字段保留。
      if (recorded || recordedSet.length) {
        const imported = [recorded, ...recordedSet].filter((item): item is RecordedQuestion => Boolean(item));
        prepared.job.title = imported.length && imported.every(item => item.sourceType === "ai_prediction") ? "AI 预测题练习" : "手动导入题目练习";
        if (ownership) prepared.job = { ...prepared.job, projectId: ownership.projectId, projectName: ownership.name };
      }
      const next = startSession(prepared, recordedSet.length ? prepared.questions.length : undefined);
      if (target) {
        // 岗位训练保持原行为：旧会话归档到 history，新会话写回岗位。
        const previous = target.session ? [target.session] : [];
        for (const item of previous) saveHistory(item);
        if (previous.length) setHistory(loadHistory());
        const updated = { ...target, preparation: target.preparation ?? target.session?.preparation ?? prepared, questions: prepared.questions.map(toProjectQuestion), totalQuestions: prepared.questions.length };
        setProjects(saveProject(updateProjectFromSession(updated, next)));
        setActiveProjectId(target.id);
      } else {
        // 独立练习：只写独立历史；岗位会话、题目列表与进度完全不动。
        saveHistory(next); setHistory(loadHistory());
        if (recorded || recordedSet.length) setActiveProjectId(null);
      }
      sessionRef.current = next; setPreparation(prepared); setSession(next); setReviewingTurnIndex(null); setReport(null); setAnswer(""); setActiveJobModule("training"); setError(modelNotice);
      // 岗位内新训练留在岗位工作台（可切回分析/资料）；只有独立练习才切到全屏训练页。
      if (recorded || recordedSet.length) setPage("interview");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建训练失败，现有项目和回答未覆盖。"); }
    finally { if (activeAIRequest.current === controller) activeAIRequest.current = null; setAnswerSubmitting(false); setTrainingStarting(false); setCancellingAI(false); }
  }

  function startFoundationPractice(item: FoundationQuestion, confirmed = false) {
    if (blocked || answerSubmitting || coachPending) return;
    try {
      const stored = loadHistory();
      if (!confirmed && (session || stored.some(saved => saved.status === "active" && saved.preparation.questions[0]?.sourceType === "foundation" && saved.preparation.questions[0].id === item.id))) {
        setError(""); setPendingRecommendation(null); setPendingRecordedQuestion(null); setPendingFoundation(item); setPendingNewTraining(true); return;
      }
      const context = buildInterviewContext({ profile: userProfile, foundationKnowledge: item.knowledgePoints });
      const prepared = trustedPreparation(context, [foundationToPracticeQuestion(item)]);
      prepared.job.title = "基础知识练习";
      const next = startSession(prepared);
      // Persist even a zero-answer session so its existing per-session draft remains reachable after refresh.
      if (session) saveHistory(loadProjects().find(project => project.id === activeProjectId)?.session ?? stored.find(saved => saved.id === session.id) ?? session);
      saveHistory(next); setHistory(loadHistory());
      setPendingNewTraining(false); setPendingFoundation(null);
      setActiveProjectId(null); setPreparation(prepared); setSession(next); setReviewingTurnIndex(null); setAnswer(""); setReport(null); setError(""); setPage("interview");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始基础题练习。"); }
  }

  function selectExperience(id: string, setId?: string) {
    setSelectedExperience(id); setSelectedExperienceSet(setId ?? null); setLibraryArea("resume"); setPage("library");
  }
  function selectConfirmedResumeSet(setId?: string) {
    setSelectedExperience(null); setSelectedExperienceSet(setId ?? null); setLibraryArea("resume"); setPage("library");
  }
  function saveExperienceSet(set: ExperiencePracticeSet): string | null {
    try {
      const card = loadUserProfile().experiences.find(card => card.id === set.experienceId);
      if (!card?.confirmed || experienceVersion(card) !== set.contentVersion) throw new Error("经历已变化或撤销确认，未保存本次题组。");
      const current = loadQuestionLibrary();
      const exists = current.experienceSets?.some(item => item.id === set.id);
      setQuestionLibrary(saveQuestionLibrary({ ...current, experienceSets: exists ? current.experienceSets!.map(item => item.id === set.id ? set : item) : [...(current.experienceSets ?? []), set] })); return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "题组保存失败，已有题组和回答仍保留。"; }
  }
  function saveConfirmedResumeSet(set: ConfirmedResumePracticeSet): string | null {
    try {
      if (!isConfirmedResumePracticeSetCurrent(loadUserProfile(), set)) throw new Error("题组依据的已确认经历在生成期间变化，未保存本次题组。请重新生成。 ");
      const current = loadQuestionLibrary();
      const exists = current.resumeSets?.some(item => item.id === set.id);
      setQuestionLibrary(saveQuestionLibrary({ ...current, resumeSets: exists ? current.resumeSets!.map(item => item.id === set.id ? set : item) : [...(current.resumeSets ?? []), set] })); return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "整份简历题组保存失败，已有题组和回答仍保留。"; }
  }
  function startExperiencePractice(setId: string, questionId: string, confirmed = false) {
    if (blocked || answerSubmitting || coachPending) return;
    try {
      const stored = loadHistory(), library = loadQuestionLibrary(), currentSet = library.experienceSets?.find(item => item.id === setId);
      const resumeSet = library.resumeSets?.find(item => item.id === setId);
      const collectionSet = library.collection?.analyses.find(item => item.id === setId);
      const selected = (currentSet ?? resumeSet ?? collectionSet)?.questions.find(item => item.id === questionId);
      if (!selected || (currentSet ?? resumeSet ?? collectionSet)?.hiddenQuestionIds?.includes(questionId)) throw new Error("题组无法读取或题目已移除，未开始训练。");
      if (!confirmed && (session || stored.some(saved => saved.status === "active"))) {
        setPendingFoundation(null); setPendingRecordedQuestion(null); setPendingRecommendation(null);
        setPendingExperience({ kind: "question", setId, questionId }); setPendingNewTraining(true); setError(""); return;
      }
      const profile = loadUserProfile();
      const context = selected.resumePracticeOrigin ? confirmedResumePracticeContext(profile, selected) : selected.experienceOrigin ? experiencePracticeContext(profile, selected) : collectionPracticeContext(profile, selected);
      if (selected.resumePracticeOrigin && !isResumePracticeQuestionCurrent(profile, selected)) throw new Error("本题依据的经历已变化、删除或撤销确认，未使用旧事实开始训练。请重新生成题组。");
      const prepared = trustedPreparation(context, [selected]);
      prepared.job.title = resumeSet ? resumeSet.title : currentSet ? `经历专项：${currentSet.title}` : "面试资料单题练习";
      const next = startSession(prepared);
      if (session) saveHistory(loadProjects().find(project => project.id === activeProjectId)?.session ?? stored.find(saved => saved.id === session.id) ?? session);
      saveHistory(next);
      setHistory(loadHistory()); setActiveProjectId(null); setPreparation(prepared); sessionRef.current = next; setSession(next); setReviewingTurnIndex(null); setAnswer(""); setReport(null);
      setPendingNewTraining(false); setPendingExperience(null); setError(""); setPage("interview");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始专项练习，原训练保留。"); }
  }
  function startExperienceSetPractice(setId: string, confirmed = false) {
    if (blocked || answerSubmitting || coachPending) return;
    try {
      const stored = loadHistory(), library = loadQuestionLibrary();
      const experienceSet = library.experienceSets?.find(item => item.id === setId);
      const resumeSet = library.resumeSets?.find(item => item.id === setId);
      const selectedSet = experienceSet ?? resumeSet;
      if (!selectedSet) throw new Error("题组无法读取，未开始训练。");
      const questions = (experienceSet ? visibleExperienceQuestions(experienceSet) : visibleConfirmedResumeQuestions(resumeSet!));
      if (!questions.length) throw new Error("题组没有可练习题目。");
      const profile = loadUserProfile();
      if (experienceSet) {
        const card = profile.experiences.find(item => item.id === experienceSet.experienceId);
        if (!card?.confirmed || experienceVersion(card) !== experienceSet.contentVersion) throw new Error("经历已变化、删除或撤销确认，未使用旧事实开始训练。请重新生成题组。");
      } else if (questions.some(question => !isResumePracticeQuestionCurrent(profile, question))) throw new Error("题组依据的经历已变化、删除或撤销确认，未使用旧事实开始训练。请重新生成题组。");
      if (!confirmed && (session || stored.some(saved => saved.status === "active"))) {
        setPendingFoundation(null); setPendingRecordedQuestion(null); setPendingRecommendation(null);
        setPendingExperience({ kind: "set", setId }); setPendingNewTraining(true); setError(""); return;
      }
      const sourceIds = new Set(experienceSet ? [experienceSet.experienceId] : resumeSet!.sources.map(source => source.experienceId));
      const context = buildInterviewContext({ profile: { ...profile, experiences: profile.experiences.filter(card => sourceIds.has(card.id)), supplementaryInfo: "" } });
      const prepared = trustedPreparation(context, questions, questions.length);
      prepared.job.title = resumeSet ? resumeSet.title : `经历专项：${experienceSet!.title}`;
      const next = startSession(prepared, questions.length);
      if (session) saveHistory(loadProjects().find(project => project.id === activeProjectId)?.session ?? stored.find(saved => saved.id === session.id) ?? session);
      saveHistory(next);
      setHistory(loadHistory()); setActiveProjectId(null); setPreparation(prepared); sessionRef.current = next; setSession(next); setReviewingTurnIndex(null); setAnswer(""); setReport(null);
      setPendingNewTraining(false); setPendingExperience(null); setError(""); setPage("interview");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始题组训练，原训练保留。"); }
  }
  function startResumeIntroductionPractice(minutes: 1 | 3, confirmed = false) {
    if (blocked || answerSubmitting || coachPending) return;
    try {
      const profile = loadUserProfile();
      if (!profile.experiences.some(card => card.confirmed)) throw new Error("请先确认至少一段经历。");
      if (!confirmed && (session || loadHistory().some(saved => saved.status === "active"))) {
        setPendingExperience(null); setPendingFoundation(null); setPendingRecordedQuestion(null); setPendingRecommendation(null); setPendingIntroduction(minutes); setPendingNewTraining(true); setError(""); return;
      }
      const selected = resumeIntroductionQuestion(minutes);
      const context = buildInterviewContext({ profile, question: selected, currentQuestion: selected.text });
      const prepared = trustedPreparation(context, [selected]);
      prepared.job.title = `${minutes} 分钟自我介绍练习`;
      const stored = loadHistory(), next = startSession(prepared);
      if (session) saveHistory(loadProjects().find(project => project.id === activeProjectId)?.session ?? stored.find(saved => saved.id === session.id) ?? session);
      saveHistory(next);
      setHistory(loadHistory()); setActiveProjectId(null); setPreparation(prepared); sessionRef.current = next; setSession(next); setReviewingTurnIndex(null); setAnswer(""); setReport(null);
      setPendingNewTraining(false); setPendingIntroduction(null); setError(""); setPage("interview");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始自我介绍练习，原训练保留。"); }
  }

  function saveEvidence(id: string, note: EvidenceNote): string | null {
    if (!activeProject) return "请先打开一个面试项目。";
    try {
      setProjects(saveProject(updateEvidenceNote(activeProject, id, note)));
      return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "保存失败，输入已保留，请重试。"; }
  }

  function changeMinutes(minutes: 30 | 60 | 120) {
    if (!activeProject) return;
    try { setProjects(saveProject({ ...activeProject, prepMinutes: minutes, updatedAt: new Date().toISOString() })); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "准备时间保存失败。"); }
  }

  async function submitAnswer() {
    if (!session || !question || !answer.trim()) {
      setError("请先输入回答；不理解时可以如实写“我不知道”或“不会”。"); return;
    }
    if (answerSubmitting || coachRequestActive.current || activeAIRequest.current) return;
    const controller = new AbortController();
    activeAIRequest.current = controller; setCancellingAI(false);
    setWaitingAnswer({ question: question.text, answer });
    setAnswerSubmitting(true);
    setError("");
    try {
      const context = question.resumePracticeOrigin ? confirmedResumePracticeContext(loadUserProfile(), question, answer) : question.experienceOrigin ? experiencePracticeContext(loadUserProfile(), question, answer) : question.collectionOrigin ? collectionPracticeContext(loadUserProfile(), question, answer) : buildInterviewContext({ project: activeProject, profile: loadUserProfile(), question, currentQuestion: question.text, userAnswer: answer,
        foundationKnowledge: foundationQuestions.find(item => item.id === question.id)?.knowledgePoints });
      let coachFailure: string | null = null;
      let [decision, coach] = modelAvailable ? await Promise.all([
        decideInterviewTurn(question, answer, session.preparation, context, { signal: controller.signal, timeoutMs: modelTimeouts.interviewer }),
        coachInterviewAnswer(context, question, { signal: controller.signal, timeoutMs: modelTimeouts.coach }).catch(cause => { coachFailure = cause instanceof Error ? cause.message : "AI 服务异常，请稍后重试。"; return null; }),
      ]) : [null, null];
      if (activeAIRequest.current !== controller || controller.signal.reason === "page-exit") return;
      const current = sessionRef.current;
      if (!current || current.id !== session.id || current.currentQuestionIndex !== session.currentQuestionIndex || current.turns.length !== session.turns.length || current.questions[current.currentQuestionIndex]?.id !== question.id)
        throw new Error("训练已变化，未写入旧结果；本次回答草稿仍保留。");
      if (controller.signal.aborted) { coach = null; decision = null; coachFailure = "AI 请求已取消，原回答保留，可主动重试。"; }
      if ((question.projectDeepDive && !buildInterviewContext({ profile: loadUserProfile(), question }).confirmedExperienceSources?.length) || (question.resumePracticeOrigin && !isResumePracticeQuestionCurrent(loadUserProfile(), question))) { coach = null; decision = null; coachFailure = "经历在请求期间变化或撤销确认，未保存旧依据的建议；原回答保留。"; }
      const stored = activeProject ? loadProjects().find(item => item.id === activeProject.id) : null;
      if (activeProject && (!stored || stored.session?.id !== session.id || stored.session.turns.length !== session.turns.length || stored.session.currentQuestionIndex !== session.currentQuestionIndex || stored.session.questions[session.currentQuestionIndex]?.id !== question.id))
        throw new Error("对应岗位或训练已变化，未写入旧结果；回答草稿仍保留。");
      let advanced = nextTurn(stored?.session ?? current, answer, decision);
      const turnIndex = advanced.turns.length - 1;
      if (coach) advanced = attachCoachReview(advanced, turnIndex, 1, answer, coach);
      else if (coachFailure) advanced = markCoachFailure(advanced, turnIndex, 1, coachFailure);
      const persistedSession = advanced;
      if (activeProject) {
        setProjects(saveProject(updateProjectFromSession(stored!, persistedSession)));
      }
      else saveHistory(persistedSession);
      try { saveDraft(answerKey(session), ""); markUnsaved("answer", false); } catch { setError("回答已保存，但旧草稿清理失败，请保留文字与训练备份。"); }
      sessionRef.current = persistedSession; setSession(persistedSession); setAnswer(loadDrafts()[answerKey(persistedSession)] ?? "");
      setReviewingTurnIndex(turnIndex);
      setReport(null);
      setHistory(loadHistory());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回答提交失败，请重试。");
    } finally {
      if (activeAIRequest.current === controller) { activeAIRequest.current = null; setAnswerSubmitting(false); setCancellingAI(false); }
    }
  }

  function saveSessionNavigation(next: InterviewSession): boolean {
    try {
      if (activeProject) setProjects(saveProject(updateProjectFromSession(activeProject, next)));
      else saveHistory(next);
      sessionRef.current = next; setSession(next); setHistory(loadHistory());
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "训练状态保存失败，未切换题目。"); return false; }
  }

  function turnForQuestion(current: InterviewSession, questionIndex: number) {
    const currentQuestion = current.questions[questionIndex];
    if (!currentQuestion) return -1;
    const root = currentQuestion.id.replace(/(?:-followup)+$/, "");
    for (let index = current.turns.length - 1; index >= 0; index -= 1) if (current.turns[index].questionId.replace(/(?:-followup)+$/, "") === root) return index;
    return -1;
  }

  function moveToQuestion(index: number) {
    if (!session || answerSubmitting || coachPending || blocked) return;
    try {
      const next = goToQuestion(session, index);
      if (!saveSessionNavigation(next)) return;
      setAnswer(loadDrafts()[answerKey(next)] ?? "");
      const turnIndex = turnForQuestion(next, index);
      setReviewingTurnIndex(turnIndex >= 0 ? turnIndex : null);
      setReport(null); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法切换题目。"); }
  }

  function skipQuestion() {
    if (!session || answerSubmitting || coachPending || blocked) return;
    try {
      // updateAnswer persists every keystroke; keeping its draft is intentional when a user skips this question.
      const next = skipCurrentQuestion(session);
      if (!saveSessionNavigation(next)) return;
      setReviewingTurnIndex(null); setAnswer(loadDrafts()[answerKey(next)] ?? "");
      setError(next.readyToComplete ? "最后一题已跳过。可完成训练，草稿已保留。" : "已跳过本题；如有草稿已保留，稍后可返回继续回答。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "跳过失败，当前草稿仍保留。"); }
  }

  function continueAfterReview() {
    if (!session || reviewingTurnIndex === null || answerSubmitting || coachPending || blocked) return;
    const turn = session.turns[reviewingTurnIndex];
    const currentQuestion = session.questions[session.currentQuestionIndex];
    if (turn && currentQuestion && !session.awaitingFollowUp && currentQuestion.id.replace(/(?:-followup)+$/, "") === turn.questionId.replace(/(?:-followup)+$/, "")) {
      const nextIndex = session.currentQuestionIndex + 1;
      if (nextIndex < session.questions.length) { moveToQuestion(nextIndex); return; }
    }
    setReviewingTurnIndex(null); setAnswer(loadDrafts()[answerKey(session)] ?? "");
  }

  function finishTraining() {
    if (!session || answerSubmitting || coachPending || blocked) return;
    try {
      const completed = completeSession(session); const nextReport = finishSession(completed); const persisted = { ...completed, report: nextReport };
      if (!saveSessionNavigation(persisted)) return;
      setReviewingTurnIndex(null); setReport(nextReport);
      if (activeProject) {
        try { saveHistory(persisted); } catch { setError("训练已保存在项目中；历史副本保存失败，可从当前岗位继续查看。"); }
      }
      setHistory(loadHistory());
      setPage("report");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法完成训练，原记录保留。"); }
  }

  function openTraining() {
    if (page === "job-workbench") setActiveJobModule("training");
    else setPage("interview");
  }

  function exitTraining() {
    if (answerSubmitting || coachPending) return;
    navigate(() => {
      setError("");
      if (activeProject) { setActiveJobModule("training"); setPage("job-workbench"); }
      else { setHistoryReturnPage(page); setPage("history"); }
    });
  }

  function returnToCollectionSource() {
    if (!session || answerSubmitting || coachPending || blocked) return;
    const analysisId = session.questions.find(item => item.collectionOrigin)?.collectionOrigin?.analysisId ?? selectedCollectionAnalysis;
    navigate(() => {
      setSelectedCollectionAnalysis(analysisId ?? null);
      setLibraryArea("collection");
      setReviewingTurnIndex(null);
      setError("");
      setPage("library");
    });
  }

  function openProject(project: InterviewProject) {
    setReturnAnalysisId(null);
    setActiveProjectId(project.id);
    setPreparation(project.session?.preparation ?? project.preparation ?? null);
    setSession(project.session ?? null); setReviewingTurnIndex(null);
    setAnswer(project.session ? loadDrafts()[answerKey(project.session)] ?? "" : "");
    setError("");
    setReport(project.session?.status === "completed" ? finishSession(project.session) : null);
    setActiveJobModule("materials");
    setPage("job-workbench");
  }

  function openHistory(item: InterviewSession) {
    setActiveProjectId(null); setPreparation(item.preparation); setSession(item); setReviewingTurnIndex(null); setAnswer(loadDrafts()[answerKey(item)] ?? ""); setReport(item.status === "completed" ? finishSession(item) : null); setPage(item.status === "completed" ? "report" : "interview");
  }

  function openTrainingRecord(record: TrainingRecord) {
    openTrainingRecordById(record.id);
  }

  function openTrainingRecordById(sessionId: string) {
    setSelectedTrainingRecordId(sessionId);
    setError("");
    setPage("training-review");
  }

  function continueTrainingRecord(record: TrainingRecord) {
    if (record.session.status !== "active") return;
    navigate(() => {
      if (record.project) continueProjectTraining(record.project);
      else openHistory(record.session);
    });
  }

  function exportTrainingRecord(record: TrainingRecord, format: "docx" | "pdf") {
    const safeTitle = record.title.replace(/[\\/:*?"<>|]/g, "-").slice(0, 60) || "训练记录";
    const data = { project: record.project, session: record.session, report: record.session.report ?? null };
    download(format === "docx" ? buildDocx(data) : buildPdf(data), `AI面试通-${safeTitle}-准备记录.${format}`);
  }

  function patchProject(project: InterviewProject): string | null {
    try { setProjects(saveProject(project)); return null; } catch(e) { return e instanceof Error ? e.message : "保存失败，当前输入保留。"; }
  }
  function saveAnalysis(projectId: string, result: SavedJobAnalysis): string | null {
    try { setProjects(saveProjectAnalysis(projectId, result)); return null; }
    catch (cause) { return cause instanceof Error ? cause.message : "分析保存失败，此前资料与分析仍保留。"; }
  }
  function saveProfile(profile: UserProfile): string | null {
    try { setUserProfile(saveUserProfile(profile)); return null; }
    catch (cause) { return cause instanceof Error ? cause.message : "个人资料保存失败，当前输入仍保留在页面。"; }
  }
  function updateAnswer(value: string) {
    setAnswer(value);
    if (!session) return;
    try { saveDraft(answerKey(session), value); markUnsaved("answer", false); setError(""); }
    catch(e) { markUnsaved("answer", true); setError(e instanceof Error ? e.message : "回答草稿未保存，请保留当前页面并重试。"); }
  }
  function saveRevision(index: number, value: string): string | null {
    if (coachRequestActive.current) return "AI 点评进行中，请等待完成后保存重答。";
    if (!session) return "请先打开训练记录。";
    try {
      const revised = reviseTurn(session, index, value);
      const next = revised.status === "completed" ? { ...revised, report: finishSession(revised) } : revised;
      if (activeProject) setProjects(saveProject(updateProjectFromSession(activeProject, next)));
      else saveHistory(next);
      sessionRef.current = next; setSession(next); if (next.status === "completed") setReport(next.report ?? null);
      if (activeProject && next.status === "completed") { try { saveHistory(next); } catch { setError("重答已保存在项目，历史副本更新失败。"); } }
      setHistory(loadHistory()); return null;
    } catch(e) { return e instanceof Error ? e.message : "重答保存失败，输入保留。"; }
  }
  function saveFinalAnswer(index: number, value: string): string | null {
    if (!session) return "请先打开训练记录。";
    try {
      const next = persistFinalAnswer(session, index, value);
      if (activeProject) setProjects(saveProject(updateProjectFromSession(activeProject, next)));
      else saveHistory(next);
      sessionRef.current = next; setSession(next); setHistory(loadHistory()); return null;
    } catch (error) { return error instanceof Error ? error.message : "最终答案保存失败，输入已保留。"; }
  }
  async function requestCoach(index: number): Promise<string | null> {
    const initial = sessionRef.current;
    const turn = initial?.turns[index];
    if (!initial || !turn) return "未找到回答，请重新打开训练记录。";
    if (!modelAvailable) return "未配置 AI 服务；当前为本地辅助提示。";
    if (coachRequestActive.current || answerSubmitting || activeAIRequest.current) return "已有 AI 请求正在进行，请稍候。";
    if (currentCoachReview(turn)) return "当前回答版本已有点评，未覆盖历史建议。";
    const answerVersion = (turn.revisions?.length ?? 0) + 1;
    const submittedAnswer = latestAnswer(turn);
    const targetProjectId = activeProjectId;
    const requestedQuestion = questionForTurn(initial, turn);
    const context = requestedQuestion.resumePracticeOrigin ? confirmedResumePracticeContext(loadUserProfile(), requestedQuestion, submittedAnswer) : requestedQuestion.experienceOrigin ? experiencePracticeContext(loadUserProfile(), requestedQuestion, submittedAnswer) : requestedQuestion.collectionOrigin ? collectionPracticeContext(loadUserProfile(), requestedQuestion, submittedAnswer) : buildInterviewContext({ project: activeProject, profile: loadUserProfile(), question: requestedQuestion, currentQuestion: requestedQuestion.text, userAnswer: submittedAnswer,
      foundationKnowledge: foundationQuestions.find(item => item.id === requestedQuestion.id)?.knowledgePoints });
    const controller = new AbortController();
    activeAIRequest.current = controller; setCancellingAI(false);
    setWaitingAnswer({ question: requestedQuestion.text, answer: submittedAnswer });
    coachRequestActive.current = true; setCoachPending(true);
    try {
      let feedback;
      let failure: string | null = null;
      try { feedback = await coachInterviewAnswer(context, requestedQuestion, { signal: controller.signal, timeoutMs: modelTimeouts.coach }); }
      catch (cause) { failure = cause instanceof Error ? cause.message : "AI 服务异常，请稍后重试。"; }
      if (activeAIRequest.current !== controller || controller.signal.reason === "page-exit") return "请求已结束，未写入迟到点评。";
      if (controller.signal.aborted) { feedback = null; failure = "AI 请求已取消，原回答保留，可主动重试。"; }
      const current = sessionRef.current;
      if (!current || current.id !== initial.id || current.turns[index]?.questionId !== turn.questionId
        || (current.turns[index].revisions?.length ?? 0) + 1 !== answerVersion || latestAnswer(current.turns[index]) !== submittedAnswer)
        return "回答版本已变化，未写入旧点评。请为当前回答重新请求点评。";
      // Merge into the latest session, including final answers saved while the request was pending.
      const stored = targetProjectId ? loadProjects().find(item => item.id === targetProjectId) : null;
      if (targetProjectId && (!stored || stored.session?.id !== initial.id || stored.session.turns[index]?.questionId !== turn.questionId
        || (stored.session.turns[index].revisions?.length ?? 0) + 1 !== answerVersion || latestAnswer(stored.session.turns[index]) !== submittedAnswer))
        return "对应岗位或回答版本已变化，未写入旧点评。请重新打开训练。";
      if ((requestedQuestion.projectDeepDive && !buildInterviewContext({ profile: loadUserProfile(), question: requestedQuestion }).confirmedExperienceSources?.length) || (requestedQuestion.resumePracticeOrigin && !isResumePracticeQuestionCurrent(loadUserProfile(), requestedQuestion))) return "经历在请求期间变化或撤销确认，未保存旧依据的建议。原回答与最终答案保留。";
      const base = stored?.session ?? current;
      const next = feedback ? attachCoachReview(base, index, answerVersion, submittedAnswer, feedback) : markCoachFailure(base, index, answerVersion, failure!);
      if (targetProjectId) {
        setProjects(saveProject({ ...stored!, session: next }));
        if (next.status === "completed") { try { saveHistory(next); } catch { setError("点评已保存在项目，但独立历史副本未能同步。"); } }
      } else saveHistory(next);
      sessionRef.current = next; setSession(next); setHistory(loadHistory());
      return null;
    } catch (cause) {
      return cause instanceof Error ? `点评未保存：${cause.message}。原回答与最终答案未被覆盖，请重试。` : "点评未保存，请重试；原回答保留。";
    } finally {
      if (activeAIRequest.current === controller) { activeAIRequest.current = null; coachRequestActive.current = false; setCoachPending(false); setCancellingAI(false); }
    }
  }

  function saveQuestionLibraryState(next: QuestionLibraryState): string | null {
    try { setQuestionLibrary(saveQuestionLibrary(next)); return null; }
    catch (error) { return error instanceof Error ? error.message : "题库索引保存失败，当前操作未完成。"; }
  }
  function saveCollection(value: CollectionState): string | null {
    try { setQuestionLibrary(saveQuestionLibrary({ ...loadQuestionLibrary(), collection: value })); return null; }
    catch (cause) { return cause instanceof Error ? cause.message : "资料保存失败。"; }
  }
  function linkCollectedMaterial(material: CollectedMaterial, projectId: string): string | null {
    try {
      if (!material.reviewedAt) throw new Error("请先核对并保存文字，再关联岗位。");
      const project = loadProjects().find(p => p.id === projectId); if (!project) throw new Error("岗位不存在。");
      // A separate reviewed reference; never assign to project.jobDescription.
      const linked = { ...material, id: `collection-link-${material.id}-${projectId}`, collectionSourceId: material.id, projectId };
      setProjects(saveProject({ ...project, materials: [...(project.materials ?? []).filter(m => m.id !== linked.id && m.collectionSourceId !== material.id), linked], updatedAt: new Date().toISOString() })); return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "关联保存失败。"; }
  }
  function updateExperienceSet(set: ExperiencePracticeSet): string | null {
    try {
      const current = loadQuestionLibrary(), original = current.experienceSets?.find(s => s.id === set.id);
      if (!original) throw new Error("题组无法读取。");
      setQuestionLibrary(saveQuestionLibrary({ ...current, experienceSets: current.experienceSets!.map(s => s.id === set.id ? { ...s, hiddenQuestionIds: set.hiddenQuestionIds } : s) })); return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "题目保存失败，原记录仍保留。"; }
  }
  function updateConfirmedResumeSet(set: ConfirmedResumePracticeSet): string | null {
    try {
      const current = loadQuestionLibrary(), original = current.resumeSets?.find(item => item.id === set.id);
      if (!original) throw new Error("整份简历题组无法读取。 ");
      setQuestionLibrary(saveQuestionLibrary({ ...current, resumeSets: current.resumeSets!.map(item => item.id === set.id ? { ...item, hiddenQuestionIds: set.hiddenQuestionIds } : item) })); return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "题目保存失败，原记录仍保留。"; }
  }
  function saveLibraryFinalAnswer(entry: LibraryQuestion, value: string): string | null {
    if (entry.turnIndex === undefined || !entry.sessionId) return "该题尚无可保存的训练回答。";
    try {
      if (entry.projectId) {
        const project = projects.find(item => item.id === entry.projectId);
        if (!project?.session || project.session.id !== entry.sessionId) return "未找到对应岗位训练记录；未写入任何答案。";
        if (project.session.turns[entry.turnIndex]?.questionId !== entry.questionId) return "题目与回答轮次不一致；未写入任何答案，请重新打开题库。";
        const next = persistFinalAnswer(project.session, entry.turnIndex, value);
        setProjects(saveProject(updateProjectFromSession(project, next)));
      } else {
        const saved = history.find(item => item.id === entry.sessionId);
        if (!saved) return "未找到对应独立训练记录；未写入任何答案。";
        if (saved.turns[entry.turnIndex]?.questionId !== entry.questionId) return "题目与回答轮次不一致；未写入任何答案，请重新打开题库。";
        saveHistory(persistFinalAnswer(saved, entry.turnIndex, value)); setHistory(loadHistory());
      }
      return null;
    } catch (error) { return error instanceof Error ? error.message : "最终答案保存失败，输入未覆盖原记录。"; }
  }
  /** 复盘页更新当前确认答案：写入同一 finalAnswer 数据源，历史原答/重答快照不变（C5）。 */
  function saveTrainingReviewFinal(record: TrainingRecord, questionId: string, value: string): string | null {
    if (!value.trim()) return "请填写本人认可的回答思路。";
    try {
      const root = questionId.replace(/(?:-followup)+$/, "");
      const session = record.session;
      let turnIndex = -1;
      for (let i = session.turns.length - 1; i >= 0; i -= 1) if (session.turns[i].questionId.replace(/(?:-followup)+$/, "") === root) { turnIndex = i; break; }
      if (turnIndex < 0) return "未找到要更新的回答；未写入任何答案。";
      const expectedQuestionId = session.turns[turnIndex].questionId;
      let next: InterviewSession;
      if (record.storage === "project" && record.project) {
        const stored = loadProjects().find(item => item.id === record.project!.id);
        if (!stored?.session || stored.session.id !== session.id) return "对应岗位训练已变化；请重新打开复盘后再保存。";
        if (stored.session.turns[turnIndex]?.questionId !== expectedQuestionId) return "题目与回答轮次不一致；未写入任何答案，请重新打开复盘。";
        next = persistFinalAnswer(stored.session, turnIndex, value);
        setProjects(saveProject(updateProjectFromSession(stored, next)));
      } else {
        const saved = loadHistory().find(item => item.id === session.id);
        if (!saved) return "未找到对应独立训练记录；未写入任何答案。";
        if (saved.turns[turnIndex]?.questionId !== expectedQuestionId) return "题目与回答轮次不一致；未写入任何答案，请重新打开复盘。";
        next = persistFinalAnswer(saved, turnIndex, value);
        saveHistory(next);
        setHistory(loadHistory());
      }
      if (sessionRef.current?.id === next.id) sessionRef.current = next;
      if (session?.id === next.id) setSession(next);
      return null;
    } catch (error) { return error instanceof Error ? error.message : "最终答案保存失败，历史快照未改变。"; }
  }
  /** 题库删除题目（本人记录题/岗位推荐题）：确认后仅移除题库条目，训练历史与最终答案受保护（C4/E-03）。题库 UI 已用 AlertDialog 确认时跳过原生 confirm。 */
  function deleteLibraryQuestion(entry: LibraryQuestion, options?: { skipConfirm?: boolean }): string | null {
    try {
      const id = entry.recordedQuestionId ?? entry.recommendedQuestionId;
      if (!id) return "该题目不支持删除。";
      const impact = "删除后本题不再出现在题库与训练入口；已有训练记录、原答、点评与最终答案全部保留，可从训练记录查看。未备份的题目本身无法恢复。";
      if (!options?.skipConfirm && !window.confirm(`删除这道题？「${entry.question.slice(0, 40)}」\n\n${impact}`)) return null;
      const current = loadQuestionLibrary();
      setQuestionLibrary(saveQuestionLibrary(entry.recordedQuestionId ? deleteRecordedQuestion(current, id) : deleteJobRecommendedQuestion(current, id)));
      setError("");
      return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "删除失败，未更改任何数据。"; }
  }
  /** 题组删除（经历专项/整份简历）：确认后仅移除题组索引，训练历史与最终答案受保护（C4/F-05）。 */
  function deleteSetById(kind: "resume" | "experience", setId: string): string | null {
    try {
      const current = loadQuestionLibrary();
      const label = kind === "resume" ? current.resumeSets?.find(item => item.id === setId)?.title : current.experienceSets?.find(item => item.id === setId)?.title;
      if (!label) return "题组不存在或已删除。";
      if (!window.confirm(`删除题组「${label}」？\n\n题组将从题组管理移除；已有训练记录、原答、最终答案与历史会话全部保留，可从训练记录查看。未备份的题组本身无法恢复。`)) return null;
      setQuestionLibrary(saveQuestionLibrary(kind === "resume" ? deleteResumeSet(current, setId) : deleteExperienceSet(current, setId)));
      if (selectedExperienceSet === setId) { setSelectedExperience(null); setSelectedExperienceSet(null); }
      return null;
    } catch (cause) { return cause instanceof Error ? cause.message : "删除失败，未更改任何数据。"; }
  }
  function createLibraryReuse(source: LibraryQuestion, target: LibraryQuestion): string | null {
    try { return saveQuestionLibraryState({ ...questionLibrary, reuseDrafts: [...questionLibrary.reuseDrafts, createReuseDraft(source, target)] }); }
    catch (error) { return error instanceof Error ? error.message : "创建跨岗位答案草稿失败。"; }
  }
  function saveLibraryReuse(id: string, answer: string): string | null {
    if (!answer.trim()) return "请填写跨岗位答案草稿，不能只输入空白。";
    const draft = questionLibrary.reuseDrafts.find(item => item.id === id); if (!draft) return "未找到要保存的跨岗位答案草稿。";
    return saveQuestionLibraryState({ ...questionLibrary, reuseDrafts: questionLibrary.reuseDrafts.map(item => item.id === id ? { ...item, answer: answer.trim(), updatedAt: new Date().toISOString() } : item) });
  }
  function confirmLibraryReuse(draft: AnswerReuseDraft, target: LibraryQuestion): string | null {
    const saved = saveLibraryFinalAnswer(target, draft.answer); if (saved) return saved;
    return saveQuestionLibraryState({ ...questionLibrary, reuseDrafts: questionLibrary.reuseDrafts.map(item => item.id === draft.id ? { ...item, answer: draft.answer.trim(), updatedAt: new Date().toISOString(), confirmedAt: new Date().toISOString() } : item) });
  }
  function exportLibraryQuestion(entry: LibraryQuestion, format: "docx" | "pdf") {
    const data = { projectName: entry.projectName, company: entry.company, question: entry.question, source: entry.source, originalAnswer: entry.originalAnswer, suggestion: entry.suggestion, finalAnswer: entry.finalAnswer };
    download(format === "docx" ? buildQuestionDocx(data) : buildQuestionPdf(data), `AI面试通-${entry.projectName}-题目准备记录.${format}`);
  }
  function removeProject() {
    if (!pendingDelete) return;
    try {
      setProjects(deleteProject(pendingDelete.id));
      if (editing?.id === pendingDelete.id) setEditing(null);
      if (activeProjectId === pendingDelete.id) { setActiveProjectId(null); setPreparation(null); setSession(null); setReviewingTurnIndex(null); setReport(null); setAnswer(""); }
      setPendingDelete(null); setError("已删除选定项目；独立训练记录未删除。可从此前导出的文字与训练备份恢复。");
    } catch(e) { setError(e instanceof Error ? e.message : "删除失败"); }
  }
  const details = page === "settings" && settingsSection !== "home"
    ? { ...pageDetails.settings, title: settingsSection === "backup" ? "备份与恢复" : "导出准备资料", breadcrumbs: ["设置与数据"] }
    : pageDetails[page];
  const isLegacyPage = ["create", "matrix", "questions", "interview", "report"].includes(page);
  const displayedQuestions: Question[] = preparation?.questions ?? (activeProject?.questions ?? []).map(item => ({
    id: item.id, text: item.question, category: item.category as Question["category"], technical: false,
    source: item.whyAsk, sourceType: undefined,
  }));
  const compatibilityPreparation = activeProject?.preparation ?? preparation;
  const compatibilityQuestions = compatibilityPreparation?.questions ?? displayedQuestions;
  const recommendationOrigin = analysisPracticeOrigin(session?.preparation.questions[0]);
  function returnToAnalysis() {
    navigate(() => {
      if (!activeProject || recommendationOrigin?.projectId !== activeProject.id || !activeProject.aiAnalyses?.some(item => item.id === recommendationOrigin.analysisId)) {
        setError("原岗位分析无法定位；现有训练与回答仍保留，请从岗位分析模块查看可用记录。"); return;
      }
      setReturnAnalysisId(recommendationOrigin.analysisId); setActiveJobModule("analysis");
    });
  }
  const analysisContent: ReactNode = <div className="space-y-5">
    {activeProject && <EvidenceAnalysis key={activeProject.id} project={activeProject} profile={userProfile} modelAvailable={modelAvailable} onSaveAnalysis={saveAnalysis} onFailure={setError} onPractice={requestAnalysisPractice} practiceDisabled={answerSubmitting || coachPending || blocked} initialSelectedId={returnAnalysisId} onAddToLibrary={addRecommendationToLibrary} addedRecommendedRows={new Set((questionLibrary.jobRecommendedQuestions ?? []).map(item => `${item.analysisId}:${item.rowIndex}`))} onRequestMaterials={() => setActiveJobModule("materials")}/>}
    {(activeProject?.aiAnalyses?.length ?? 0) > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><p className="text-sm text-muted-foreground">准备好后，可进入本岗位训练。</p><button onClick={() => navigate(openTraining)} disabled={answerSubmitting || coachPending || blocked} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">进入面试训练</button></div>}
    {(compatibilityPreparation || activeProject?.analysis || compatibilityQuestions.length > 0) && <details className="rounded-xl border border-border bg-white p-4">
      <summary onClick={event => { if (blocked) event.preventDefault(); }} className="cursor-pointer font-medium text-slate-700">历史分析与旧材料（兼容查看）</summary>
      <div className="mt-5 space-y-6">
        <section><h2 className="font-semibold text-slate-950">原有岗位分析（兼容材料）</h2><p className="mt-1 text-sm leading-6 text-slate-600">这里保留旧项目的个人背景与材料线索，不代表资料库中的已确认经历。</p><p className="mt-2 text-sm text-amber-900">旧分析未记录可校验的生成依据，不能判断是否对应当前资料。</p></section>
        {activeProject?.analysis && <section aria-label="已保存的旧岗位分析" className="space-y-3 text-sm text-slate-700">{([
          ["原有能力主题", activeProject.analysis.coreCapabilities], ["原有关键词", activeProject.analysis.keywords],
          ["原有材料线索", activeProject.analysis.strengths], ["原有待核对项", activeProject.analysis.risks],
        ] as const).map(([label, items]) => <div key={label}><h3 className="font-medium">{label}</h3><ul className="mt-1 list-disc pl-5">{(Array.isArray(items) ? items.filter(item => typeof item === "string") : []).map((item, index) => <li key={index}>{item}</li>)}</ul></div>)}</section>}
        {activeProject?.analysis && <section className="text-sm text-slate-700"><h3 className="font-medium">原有准备建议</h3><ul className="mt-1 list-disc pl-5">{(Array.isArray(activeProject.analysis.preparationPlan) ? activeProject.analysis.preparationPlan : []).filter(item => typeof item?.category === "string" && Number.isFinite(item.questionCount)).map((item, index) => <li key={index}>{item.category}：{item.questionCount} 题（历史建议）</li>)}</ul></section>}
        {activeProject && <CareerPlan trainingEntryLabel="进入面试训练" key={activeProject.id} project={activeProject} onSave={saveEvidence} onMinutes={changeMinutes} onPractice={() => navigate(openTraining)} onPatch={patchProject} onUnsaved={value => markUnsaved("evidence", value)}/>}
        <details className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer font-medium text-slate-700">{compatibilityPreparation ? "查看基础能力矩阵与历史题目" : "查看历史题目"}</summary><div className="mt-5 space-y-6">{compatibilityPreparation && <Matrix preparation={compatibilityPreparation}/>}<Questions questions={compatibilityQuestions}/></div></details>
      </div>
    </details>}
  </div>;
  const materialsContent: ReactNode = activeProject && <JobMaterials project={activeProject} onPatch={patchProject}/>;
  const trainingContent: ReactNode = (preparation || activeProject) && <div className="space-y-6">
    {activeJobStats && <section aria-label="岗位关联题" className="rounded-[14px] border border-border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-foreground">关联题 {activeJobStats.total} 道<span className="font-normal text-muted-foreground"> · 已答 {activeJobStats.answered} · 未答 {activeJobStats.unanswered}</span></p>
          <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{activeJobStats.total ? "来自题库中关联到本岗位的题目；单题或整组练习都不会覆盖本岗位当前训练。" : "还没有关联到本岗位的题目；在题库录入或批量导入时选择本岗位即可。"}</p>
        </div>
        <button onClick={() => openJobQuestions(activeJobStats.id)} disabled={answerSubmitting || coachPending || blocked} className="inline-flex shrink-0 items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-[14px] font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">查看关联题</button>
      </div>
    </section>}
    <section aria-label="岗位训练操作" className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <div className="mt-3 flex flex-wrap gap-3">
        {recommendationOrigin?.projectId === activeProjectId && <button onClick={returnToAnalysis} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 disabled:opacity-50">返回原岗位分析</button>}
        <button onClick={() => canContinueTraining ? navigate(openTraining) : requestNewTraining()} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{canContinueTraining ? "继续当前训练" : session ? "开始新一轮训练" : "开始新训练"}</button>
        {canContinueTraining && <button onClick={requestNewTraining} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 disabled:opacity-50">开始新一轮训练</button>}
      </div>
    </section>
    {session && reviewingTurn && reviewingTurnIndex !== null && <fieldset disabled={answerSubmitting || trainingStarting} className="min-w-0"><AnswerReview key={`${session.id}-${reviewingTurnIndex}-${session.turns.length}`} session={session} turnIndex={reviewingTurnIndex} onContinue={continueAfterReview} onFinish={session.questions.length === 1 && session.readyToComplete ? finishTraining : undefined} onRequestCoach={requestCoach} modelAvailable={modelAvailable} coachPending={coachPending || answerSubmitting} onRevise={saveRevision} onSaveFinal={saveFinalAnswer} onUnsaved={value => markUnsaved("retry", value)} /></fieldset>}
    {!reviewingTurn && canContinueTraining && session && question ? <Interview session={session} question={question} answer={answer} setAnswer={updateAnswer} submitting={answerSubmitting || coachPending} onSubmit={() => { if (!unsaved.retry) submitAnswer(); }} onPrevious={session.currentQuestionIndex > 0 ? () => moveToQuestion(session.currentQuestionIndex - 1) : undefined} onNext={session.currentQuestionIndex < session.questions.length - 1 ? () => moveToQuestion(session.currentQuestionIndex + 1) : undefined} onSkip={skipQuestion} onExit={exitTraining} /> : session?.readyToComplete && totals ? <TrainingCompletion session={session} totals={totals} onFinish={finishTraining} onResume={() => moveToQuestion(session.currentQuestionIndex)} onExit={exitTraining} /> : !reviewingTurn && <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-medium text-slate-700">查看历史题目</summary><div className="mt-4"><Questions questions={displayedQuestions}/></div></details>}
    {report && <TrainingSummary session={session} report={report} onOpenReview={() => { if (session) openTrainingRecordById(session.id); }}/>}
  </div>;
  function continueProjectTraining(project: InterviewProject) {
    openProject(project);
    setActiveJobModule("training");
    setPage("interview");
  }
  function navigateGlobal(target: NavigationTarget) {
    navigate(() => {
      setError("");
      if (target === "dashboard") { setPage("dashboard"); return; }
      if (target === "prepare") { setPage("jobs"); return; }
      if (target === "library") { setLibraryArea(null); setLibraryJobFilter("all"); setRecordedInputMode("single"); setPage("library"); return; }
      if (target === "history") { setHistoryReturnPage(page); setPage("history"); return; }
      if (target === "profile") { setPage("profile"); return; }
      if (target === "settings") { setSettingsReturnPage(page); setSettingsSection("home"); setPage("settings"); return; }
      if (activeProject) { setActiveJobModule("materials"); setPage("job-workbench"); }
      else setPage("jobs");
    });
  }
  const immersiveTraining = page === "interview" || page === "report";
  return <><Toaster theme="light" position="top-center" /><AppShell activeTarget={activeNavigationTarget} title={details.title} description={details.description} breadcrumbs={details.breadcrumbs} hidePageHeader={page === "dashboard" || page === "job-workbench" || page === "profile"} navigationDisabled={answerSubmitting || coachPending || blocked} activeJobLabel={activeProject?.jobTitle ?? null} immersive={immersiveTraining} onNavigate={navigateGlobal} onOpenBackup={openSettings}>
      {(answerSubmitting || coachPending) && <AIRequestStatus key={trainingStarting ? "starting" : "coaching"} starting={trainingStarting} cancelling={cancellingAI} onCancel={() => { setCancellingAI(true); activeAIRequest.current?.abort(); }}/>}
      {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {page !== "library" && error && /20 条上限|历史记录超过/.test(error) && <button onClick={manageHistory} className="mb-4 rounded-lg border border-slate-300 px-3 py-2 text-sm">整理训练记录</button>}
      {isLegacyPage && <div className="mb-6"><button onClick={() => setPage(page === "history" ? historyReturnPage : !activeProject ? "library" : "job-workbench")} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{page === "history" && ["interview","report","job-workbench"].includes(historyReturnPage) ? "返回继续训练" : `返回${page === "history" || !activeProject ? "AI 面试题库" : "岗位工作台"}`}</button></div>}
      {page === "dashboard" && <PreparationDashboard projects={projects} profile={userProfile} questionLibrary={questionLibrary} history={history} onCreateJob={() => { setEditing(null); setError(""); setPage("create"); }} onOpenPrepare={() => { setError(""); if (projects.length === 1) openProject(projects[0]); else setPage("jobs"); }} onOpenProfile={() => setPage("profile")} onOpenResumePractice={() => { setSelectedExperience(null); setSelectedExperienceSet(null); setLibraryArea("resume"); setPage("library"); }} onOpenLibrary={() => { setLibraryArea(null); setPage("library"); }} onOpenHistory={manageHistory} onContinueProjectTraining={continueProjectTraining} onContinueIndependentTraining={openHistory}/>}
      {page === "jobs" && <div className="space-y-6"><JobList projects={projects} activeProjectId={activeProjectId} onCreate={() => { setEditing(null); setError(""); setPage("create"); }} onOpen={openProject} onEdit={project => { setEditing(project); setPage("create"); }} onDelete={setPendingDelete}/></div>}
      {page === "job-workbench" && <JobWorkbench project={activeProject} activeModule={activeJobModule} hasPreparation={Boolean(preparation)} hasActiveSession={canContinueTraining} hasReport={Boolean(report)} navigationDisabled={answerSubmitting || coachPending || blocked} onSelectModule={module => navigate(() => setActiveJobModule(module))} onBackToJobs={() => navigate(() => setPage("jobs"))} onEditMaterials={() => navigate(() => { setEditing(activeProject); setPage("create"); })} onOpenLegacy={legacyPage => navigate(() => setPage(legacyPage))} materialsContent={materialsContent} analysisContent={analysisContent} trainingContent={trainingContent}/>} 
      {page === "profile" && <ProfileLibrary profile={userProfile} onSave={saveProfile} onPractice={id => selectExperience(id)} onPrepareResume={() => { setSelectedExperience(null); setSelectedExperienceSet(null); setLibraryArea("resume"); setPage("library"); }}/>}
      {page === "settings" && settingsSection === "home" && <SettingsCenter onBack={() => navigate(() => setPage(settingsReturnPage))} onOpen={area => setSettingsSection(area)}/>}
      {page === "settings" && settingsSection === "backup" && <div className="space-y-4"><button type="button" onClick={() => setSettingsSection("home")} className="rounded-md px-4 py-2 text-sm text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22]">返回设置中心</button><BackupPanel onRestored={() => { setProjects(loadProjects()); setHistory(loadHistory()); setUserProfile(loadUserProfile()); setQuestionLibrary(loadQuestionLibrary()); }}/></div>}
      {page === "settings" && settingsSection === "export" && <div className="space-y-4"><button type="button" onClick={() => setSettingsSection("home")} className="rounded-md px-4 py-2 text-sm text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22]">返回设置中心</button><ExportPanel entries={libraryEntries} records={trainingRecords}/></div>}
      {page === "library" && <div className="space-y-5">
        {libraryArea === null ? <div className="grid gap-4 md:grid-cols-2">{([
          ["foundation", "AI 基础学习", "学习概念，练习独立表达。"],
          ["job", "岗位专项训练", "围绕目标岗位练习与复习。"],
          ["resume", "简历专项", "整份已确认简历或单段经历，选择问题练习。"],
          ["collection", "面试资料收集", "批量整理JD、面经与知识笔记，选择题目练习。"],
          ["recorded", "手动题目与预测题", "记录真实题，或导入已整理的 AI 预测题后练习。"],
        ] as const).map(([area, title, hint]) => <button key={area} aria-label={title} onClick={() => navigate(() => { setRecordedInputMode("single"); setLibraryArea(area); })} className="rounded-xl border border-slate-200 bg-white p-6 text-left hover:border-blue-300 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"><span className="block font-semibold text-slate-950">{title}</span><span className="mt-2 block text-sm text-slate-600">{hint}</span></button>)}</div> : <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => navigate(() => { setLibraryArea(null); setLibraryJobFilter("all"); setRecordedInputMode("single"); })} className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-[15px] font-medium text-foreground transition-all hover:bg-muted hover:border-[#94A3B8] active:scale-[0.98]">返回题库分类</button>
            <button onClick={manageHistory} className="text-base text-slate-600 underline">整理训练记录</button>
          </div>
          {libraryArea === "foundation" && <FoundationLearning state={questionLibrary} onReview={(id,status) => { const message = saveQuestionLibraryState({ ...questionLibrary, foundationReview: { ...(questionLibrary.foundationReview ?? {}), [id]: status } }); if (message) setError(message); }} onPractice={item => navigate(() => startFoundationPractice(item))}/>}
          {libraryArea === "job" && <JobSpecialtyTraining jobs={jobQuestionStats} activeJobId={libraryJobFilter} disabled={answerSubmitting || coachPending || blocked} onOpen={openJobQuestions} onCreateJob={() => navigate(() => { setEditing(null); setError(""); setPage("create"); })}/>}
          {libraryArea === "recorded" && (splittingRecordedId ? (() => {
            const parent = questionLibrary.recordedQuestions?.find(item => item.id === splittingRecordedId);
            if (!parent) { setSplittingRecordedId(null); return null; }
            const splitCount = (questionLibrary.recordedQuestions ?? []).filter(item => item.splitFromId === splittingRecordedId).length;
            return <div className="space-y-4">
              <button onClick={() => navigate(() => setSplittingRecordedId(null))} className="rounded-md border border-border bg-white px-3 py-2 text-[14px] text-muted-foreground transition-all hover:bg-muted">返回录入方式</button>
              <BatchImportQuestions projects={projects} splitFromId={splittingRecordedId} initialText={parent.question} initialTitle={`拆分自历史题目：${parent.question.slice(0, 40)}`} existingSplitCount={splitCount} disabled={answerSubmitting || coachPending || blocked} onSave={(payload, splitFrom) => saveImportedQuestions(payload, splitFrom ?? splittingRecordedId ?? undefined)} />
            </div>;
          })() : <RecordedQuestionInput projects={projects} onSave={saveRecordedQuestion} onBatchSave={payload => saveImportedQuestions(payload)} disabled={answerSubmitting || coachPending || blocked} initialMode={recordedInputMode}/>)}
          {libraryArea === "resume" && <ExperiencePractice profile={userProfile} state={questionLibrary} experienceId={selectedExperience} setId={selectedExperienceSet} modelAvailable={modelAvailable} onSelect={selectExperience} onSave={saveExperienceSet} onUpdate={updateExperienceSet} onPractice={startExperiencePractice} onPracticeSet={startExperienceSetPractice} onContinueTraining={sessionId => { const project = projects.find(item => item.session?.id === sessionId); if (project) { continueProjectTraining(project); return; } const saved = loadHistory().find(item => item.id === sessionId); if (saved) openHistory(saved); }} sessions={session ? [...history.filter(item => item.id !== session.id), session] : history} onIntroductionPractice={startResumeIntroductionPractice} onSaveResumeSet={saveConfirmedResumeSet} onUpdateResumeSet={updateConfirmedResumeSet} onSelectResumeSet={selectConfirmedResumeSet} onDeleteSet={group => { const message = deleteSetById(group.kind, group.set.id); if (message) setError(message); }}/>}
          {libraryArea === "collection" && <MaterialCollection value={questionLibrary.collection} projects={projects} modelAvailable={modelAvailable} onSave={saveCollection} onLink={linkCollectedMaterial} initialAnalysisId={selectedCollectionAnalysis} onPractice={(id,q) => { setSelectedCollectionAnalysis(id); startExperiencePractice(id,q); }} onOpenBatchImport={() => navigate(() => { setRecordedInputMode("batch"); setLibraryArea("recorded"); setPage("library"); })}/>} 
          {(libraryArea === "foundation" || libraryArea === "resume" || libraryArea === "collection") ? <details><summary className="cursor-pointer py-2 text-sm text-slate-700">{libraryArea === "collection" ? "我的资料题回答与复习" : libraryArea === "resume" ? "我的专项回答与复习" : "我的基础题回答与复习"}</summary><div className="mt-3"><QuestionLibrary visibleEntries={visibleLibraryEntries} entries={libraryEntries} projects={projects} state={questionLibrary} jobFilter={libraryJobFilter} onJobFilterChange={setLibraryJobFilter} onToggleFavorite={key => { const message = saveQuestionLibraryState(toggleLibraryFavorite(questionLibrary, key)); if (message) setError(message); }} onSaveFinal={saveLibraryFinalAnswer} onRecordedPractice={requestRecordedPractice} onRecommendedPractice={requestRecommendedPractice} onDeleteQuestion={deleteLibraryQuestion} onStartMultiPractice={requestRecordedSetPractice} onBatchSplit={entry => { if (!entry.recordedQuestionId) return; navigate(() => { setSplittingRecordedId(entry.recordedQuestionId!); setLibraryArea("recorded"); }); }} onOpenPractice={id => { const project = projects.find(item => item.id === id); if (project) continueProjectTraining(project); }} onCreateReuse={createLibraryReuse} onSaveReuse={saveLibraryReuse} onConfirmReuse={confirmLibraryReuse} onExport={exportLibraryQuestion}/></div></details> : <QuestionLibrary visibleEntries={visibleLibraryEntries} entries={libraryEntries} projects={projects} state={questionLibrary} jobFilter={libraryJobFilter} onJobFilterChange={setLibraryJobFilter} onToggleFavorite={key => { const message = saveQuestionLibraryState(toggleLibraryFavorite(questionLibrary, key)); if (message) setError(message); }} onSaveFinal={saveLibraryFinalAnswer} onRecordedPractice={requestRecordedPractice} onRecommendedPractice={requestRecommendedPractice} onDeleteQuestion={deleteLibraryQuestion} onStartMultiPractice={requestRecordedSetPractice} onBatchSplit={entry => { if (!entry.recordedQuestionId) return; navigate(() => { setSplittingRecordedId(entry.recordedQuestionId!); setLibraryArea("recorded"); }); }} onOpenPractice={id => { const project = projects.find(item => item.id === id); if (project) continueProjectTraining(project); }} onCreateReuse={createLibraryReuse} onSaveReuse={saveLibraryReuse} onConfirmReuse={confirmLibraryReuse} onExport={exportLibraryQuestion}/>}
        </>}
      </div>}
      {page === "create" && <CreateInterview confirmedExperienceCount={userProfile.experiences.filter(card => card.confirmed).length} key={editing?.id ?? "create"} demoInput={demoProject} initialInput={editing ?? undefined} draftId={editing ? `edit:${editing.id}` : "create"} onUnsaved={v => markUnsaved("form", v)} onBack={() => { if (!blocked) { setError(""); setPage("jobs"); } }} onCreate={createProject} />}
      {blocked && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">有未能保存的输入，导航暂时锁定；请保留本页，重试保存或提交。</p>}
      {pendingDelete && <Dialog open onOpenChange={open => { if (!open) setPendingDelete(null); }}><DialogContent aria-label="删除项目确认"><DialogHeader><DialogTitle className="pr-8 text-xl font-semibold text-slate-950">删除“{pendingDelete.jobTitle}”？</DialogTitle><DialogDescription>将删除该项目及其中材料、案例和当前训练。独立训练记录不会删除。请先导出文字与训练备份；未备份的项目无法恢复。</DialogDescription></DialogHeader><DialogFooter><button onClick={removeProject} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-800">确认删除该项目</button><button onClick={() => setPendingDelete(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100">取消</button></DialogFooter></DialogContent></Dialog>}
      {pendingNewTraining && <Dialog open onOpenChange={open => { if (!open) { setPendingNewTraining(false); setPendingRecommendation(null); setPendingRecordedQuestion(null); setPendingRecordedIds([]); setPendingFoundation(null); setPendingExperience(null); setPendingIntroduction(null); } }}><DialogContent aria-label="开始新一轮训练">
        <DialogHeader><DialogTitle>开始新一轮训练？</DialogTitle><DialogDescription>{pendingIntroduction ? `将练习 ${pendingIntroduction} 分钟自我介绍。` : pendingExperience?.kind === "set" ? "将按当前题组顺序开始训练。" : pendingExperience ? "将练习你选择的这道题。" : pendingFoundation ? "将练习你选定的内置基础题。" : pendingRecordedIds.length ? `将按你确认的顺序训练这 ${pendingRecordedIds.length} 道题；不会自动补入其他题目，也不会覆盖岗位当前训练。` : pendingRecordedQuestion ? (recordedTarget?.session ? "将开始独立练习；该岗位当前训练与草稿保持原样，可随时回去继续。" : "将练习你记录的问题。") : pendingRecommendation ? "将练习这道推荐题。" : "将依据当前资料重新选题。"}</DialogDescription></DialogHeader>
        {pendingRecordedIds.length > 0 && <ul aria-label="本轮训练题目" className="max-h-48 space-y-2 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">{pendingRecordedIds.map((id, index) => { const item = loadQuestionLibrary().recordedQuestions?.find(entry => entry.id === id); return <li key={id} className="break-words">{index + 1}. {item?.question ?? "（题目无法读取）"}</li>; })}</ul>}
        {(pendingFoundation || pendingExperience || pendingIntroduction) && error && <p role="alert" className="text-base text-red-700">{error}</p>}
        <DialogFooter>
          {pendingExperience && experienceContinuation && <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all" onClick={() => {
            const project = loadProjects().find(item => item.session?.id === experienceContinuation.id);
            if (project) continueProjectTraining(project);
            else openHistory(loadHistory().find(item => item.id === experienceContinuation.id) ?? experienceContinuation);
            setPendingNewTraining(false); setPendingExperience(null);
          }}>继续当前训练</button>}
          <button disabled={answerSubmitting || coachPending || blocked} onClick={() => pendingIntroduction ? startResumeIntroductionPractice(pendingIntroduction, true) : pendingExperience?.kind === "set" ? startExperienceSetPractice(pendingExperience.setId, true) : pendingExperience ? startExperiencePractice(pendingExperience.setId, pendingExperience.questionId, true) : pendingFoundation ? startFoundationPractice(pendingFoundation, true) : pendingRecordedIds.length ? void startTrustedInterview(undefined, undefined, pendingRecordedIds) : void startTrustedInterview(pendingRecommendation ?? undefined, pendingRecordedQuestion ?? undefined)} className="rounded-lg bg-blue-700 px-4 py-2 text-base text-white disabled:opacity-50">暂存并开始新练习</button>
          {pendingRecommendation && canContinueTraining && <button onClick={() => { setPendingNewTraining(false); setPendingRecommendation(null); openTraining(); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">继续当前训练</button>}
          {pendingFoundation && foundationContinuation && <button onClick={() => {
            const project = loadProjects().find(item => item.session?.id === foundationContinuation.id);
            if (project) continueProjectTraining(project);
            else openHistory(loadHistory().find(item => item.id === foundationContinuation.id) ?? foundationContinuation);
            setPendingNewTraining(false); setPendingFoundation(null);
          }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">继续当前训练</button>}
          {pendingRecordedQuestion && recordedContinuation && <button onClick={() => {
            const project = loadProjects().find(item => item.session?.id === recordedContinuation.id);
            if (project) continueProjectTraining(project);
            else openHistory(loadHistory().find(item => item.id === recordedContinuation.id) ?? recordedContinuation);
            setPendingNewTraining(false); setPendingRecordedQuestion(null);
          }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">继续当前训练</button>}
          <button onClick={() => { setPendingNewTraining(false); setPendingRecommendation(null); setPendingRecordedQuestion(null); setPendingFoundation(null); setPendingExperience(null); setPendingIntroduction(null); }} className="rounded-lg border border-slate-300 px-4 py-2 text-base text-slate-700">保留当前训练</button>
        </DialogFooter>
      </DialogContent></Dialog>}

      {page === "matrix" && preparation && <div className="space-y-6">{activeProject && <CareerPlan trainingEntryLabel="进入面试训练" key={activeProject.id} project={activeProject} onSave={saveEvidence} onMinutes={changeMinutes} onPractice={() => navigate(openTraining)} onPatch={patchProject} onUnsaved={v => markUnsaved("evidence", v)}/>}<details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" open={!activeProject}><summary className="mb-4 cursor-pointer font-medium text-slate-700">查看基础能力矩阵与历史题目</summary><Matrix preparation={preparation} onStart={() => navigate(openTraining)}/></details></div>}
      {page === "questions" && preparation && <Questions questions={preparation.questions} onStart={() => navigate(openTraining)} />}
      {page === "interview" && session && reviewingTurn && reviewingTurnIndex !== null && <fieldset disabled={answerSubmitting} className="min-w-0"><AnswerReview key={`${session.id}-${reviewingTurnIndex}-${session.turns.length}`} session={session} turnIndex={reviewingTurnIndex} onContinue={continueAfterReview} onFinish={session.questions.length === 1 && session.readyToComplete ? finishTraining : undefined} onRequestCoach={requestCoach} modelAvailable={modelAvailable} coachPending={coachPending || answerSubmitting} onRevise={saveRevision} onSaveFinal={saveFinalAnswer} onUnsaved={v => markUnsaved("retry", v)} onExit={exitTraining} onReturnToSource={session.questions.some(item => item.collectionOrigin) ? returnToCollectionSource : undefined}/></fieldset>}
      {page === "interview" && !reviewingTurn && session?.readyToComplete && totals && <TrainingCompletion session={session} totals={totals} onFinish={finishTraining} onResume={() => moveToQuestion(session.currentQuestionIndex)} onExit={exitTraining}/>}
      {page === "interview" && !reviewingTurn && session && question && <Interview session={session} question={question} answer={answer} setAnswer={updateAnswer} submitting={answerSubmitting || coachPending} onSubmit={() => { if (!unsaved.retry) submitAnswer(); }} onPrevious={session.currentQuestionIndex > 0 ? () => moveToQuestion(session.currentQuestionIndex - 1) : undefined} onNext={session.currentQuestionIndex < session.questions.length - 1 ? () => moveToQuestion(session.currentQuestionIndex + 1) : undefined} onSkip={skipQuestion} onExit={exitTraining} onReturnToSource={session.questions.some(item => item.collectionOrigin) ? returnToCollectionSource : undefined}/>}
      {page === "report" && report && <TrainingSummary session={session} report={report} onOpenReview={() => { if (session) openTrainingRecordById(session.id); }} onExit={exitTraining} exitLabel={activeProject ? "返回岗位准备" : "返回训练记录"}/>}
      {page === "history" && <div className="space-y-5">
        <TrainingRecordList records={trainingRecords} onOpen={openTrainingRecord} onContinue={continueTrainingRecord}/>
        <details className="rounded-xl border border-border bg-white p-4">
          <summary className="cursor-pointer text-[16px] font-semibold text-foreground">管理独立训练记录</summary>
          <div className="mt-4"><HistoryView history={history} onOpen={openHistory} onDelete={(id) => { if (!window.confirm("删除这条独立训练记录？项目中的会话不受影响。未备份的记录无法恢复。")) return; try { deleteHistory(id); setHistory(loadHistory()); setError("已删除选定训练记录，其他资料不受影响。"); } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败，未更改记录。"); } }} onClear={() => { if (!window.confirm("清空独立训练记录？项目中的当前会话不受影响。未备份的独立记录无法恢复。")) return; clearHistory(); setHistory([]); }}/></div>
        </details>
      </div>}
      {page === "training-review" && (selectedTrainingRecord ? <TrainingSessionReview key={selectedTrainingRecord.id} record={selectedTrainingRecord} onBack={() => setPage("history")} onContinue={() => continueTrainingRecord(selectedTrainingRecord)} onExport={format => exportTrainingRecord(selectedTrainingRecord, format)} onSaveFinal={(questionId, value) => saveTrainingReviewFinal(selectedTrainingRecord, questionId, value)}/> : <section className="rounded-xl border border-border bg-white p-5"><p className="text-[16px] font-medium text-foreground">未找到这条训练记录</p><button onClick={() => setPage("history")} className="mt-4 rounded-md border border-border bg-white px-4 py-2 text-[16px] text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]">返回训练记录</button></section>)}
  </AppShell></>;
}

function Matrix({ preparation, onStart }: { preparation: Preparation; onStart?: () => void }) { return <div className="space-y-6"><div><SectionTitle icon={<Sparkles className="text-blue-700" />}>能力矩阵</SectionTitle><p className="mt-2 text-slate-600">目标岗位：{preparation.job.title || "未识别职位名称"}。以下为旧准备材料中的背景线索，不等于已确认个人经历。</p></div><div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th>岗位核心能力</th><th>JD 要求</th><th>简历对应证据</th><th>匹配状态</th><th>能力缺口</th></tr></thead><tbody>{preparation.matrix.map(row => <tr key={row.capability} className="border-t border-slate-200 align-top text-slate-700"><td className="font-medium text-slate-950">{row.capability}</td><td>{row.requirement}</td><td>{row.evidence || "—"}</td><td><span className={`rounded-full px-2 py-1 text-xs ${row.status === "matched" ? "bg-emerald-50 text-emerald-700" : row.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{statusLabel(row.status)}</span></td><td>{row.gap}</td></tr>)}</tbody></table></div>{onStart && <button onClick={onStart} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-medium text-white hover:bg-blue-800"><Play size={17}/>进入面试训练</button>}</div> }

function Questions({ questions, onStart }: { questions: Question[]; onStart?: () => void }) { return <div><SectionTitle icon={<ClipboardList className="text-blue-700" />}>针对性题库</SectionTitle><p className="mt-2 text-slate-600">按已有记录显示题目来源；来源标签不代表事实已核验。</p><div className="mt-5 grid gap-4 md:grid-cols-2">{questions.map((q, index) => <article key={q.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-blue-700">{index + 1}. {q.category}</span><span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{questionSourceLabel(q)}</span></div><h3 className="font-semibold leading-6 text-slate-950">{q.text}</h3><p className="mt-3 text-sm text-slate-500">依据：{q.source}</p></article>)}</div>{onStart && <button onClick={onStart} className="mt-6 rounded-xl bg-blue-700 px-5 py-3 font-medium text-white hover:bg-blue-800">进入面试训练</button>}</div> }

function Interview({ session, question, answer, setAnswer, submitting, onSubmit, onPrevious, onNext, onSkip, onExit, onReturnToSource }: { session: InterviewSession; question: Question; answer: string; setAnswer: (v: string) => void; submitting: boolean; onSubmit: () => void; onPrevious?: () => void; onNext?: () => void; onSkip: () => void; onExit?: () => void; onReturnToSource?: () => void }) {
  const isFollowUp = session.awaitingFollowUp;
  const button = "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[16px] font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
  const secondary = `${button} border border-border bg-white text-muted-foreground hover:bg-muted`;
  return <div className="min-h-screen bg-background">
    <header className="border-b border-border bg-card"><div className="mx-auto flex w-full max-w-[1376px] items-center justify-between gap-4 px-6 py-4 lg:px-8">
      <div className="flex flex-wrap items-center gap-2"><Button variant="outline" onClick={onExit} disabled={!onExit || submitting}><ArrowLeft size={18}/>退出训练</Button>{onReturnToSource && <Button variant="outline" onClick={onReturnToSource} disabled={submitting}>返回资料题组</Button>}</div>
      <div className="min-w-0 text-right"><p className="truncate text-[14px] text-muted-foreground">{session.preparation.job.title || "模拟训练"}</p><p className="text-[16px] font-medium text-foreground">第 {session.currentQuestionIndex + 1} / {session.questions.length} 题</p></div>
    </div></header>
    <main className="mx-auto w-full max-w-[880px] p-6 lg:p-8">
      <div className="flex items-center justify-between gap-3"><p className="text-[14px] font-medium text-primary">{isFollowUp ? "针对上一回答的追问" : question.category}<span className="ml-2 rounded bg-muted px-2 py-0.5 text-[13px] font-normal text-muted-foreground">{questionSourceLabel(question)}</span></p><span className="rounded-full bg-muted px-3 py-1 text-[13px] text-muted-foreground">进度 {session.currentQuestionIndex + 1}/{session.questions.length}</span></div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`训练进度 ${session.currentQuestionIndex + 1}/${session.questions.length}`}><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(8, ((session.currentQuestionIndex + 1) / session.questions.length) * 100)}%` }}/></div>
      <section className="mt-4 rounded-[14px] border border-border bg-white p-5"><h1 className="whitespace-pre-wrap text-[22px] font-semibold leading-9 text-foreground">{displayQuestionText(question.text)}</h1>{question.source && <p className="mt-3 text-[14px] leading-6 text-muted-foreground">参考资料：{question.source}</p>}</section>
      <div className="mt-4"><VoicePracticeControls questionId={question.id} questionText={question.text} answer={answer} onAnswer={setAnswer} disabled={submitting}/></div>
      <section className="mt-4 overflow-hidden rounded-[14px] border border-border bg-white"><div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"><label htmlFor="training-answer" className="text-[16px] font-semibold text-foreground">你的回答</label><span className="text-[13px] text-muted-foreground">草稿自动保存</span></div><textarea id="training-answer" value={answer} onChange={event => setAnswer(event.target.value)} disabled={submitting} maxLength={12000} aria-label="本轮回答" placeholder="输入你的回答；不知道也可以如实说明。" className="min-h-[280px] w-full resize-y p-5 text-[18px] leading-8 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"/></section>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={onPrevious} disabled={!onPrevious || submitting}><ChevronLeft size={17}/>上一题</Button><Button variant="outline" onClick={onNext} disabled={!onNext || submitting}>下一题<ChevronRight size={17}/></Button><Button variant="ghost" onClick={onSkip} disabled={submitting} className="text-muted-foreground">跳过本题</Button></div><Button data-cta="primary" onClick={onSubmit} disabled={submitting || !answer.trim()} className="px-6">{submitting ? <Loader2 className="animate-spin" size={17}/> : <Send size={17}/>} {submitting ? "正在获取建议…" : "提交回答"}</Button></div>
      <p className="mt-3 text-[13px] leading-6 text-muted-foreground">跳过不会请求 AI；已输入的草稿会保留，之后可返回继续回答。</p>
    </main>
  </div>;
}

function TrainingCompletion({ session, totals, onFinish, onResume, onExit }: { session: InterviewSession; totals: ReturnType<typeof trainingTotals>; onFinish: () => void; onResume: () => void; onExit?: () => void }) {
  const button = "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[16px] font-medium transition-all active:scale-[0.98]";
  return <div className="min-h-screen bg-background"><header className="border-b border-border bg-card"><div className="mx-auto flex w-full max-w-[940px] items-center justify-between gap-4 px-6 py-4 lg:px-8"><Button variant="outline" onClick={onExit} disabled={!onExit}><ArrowLeft size={18}/>退出训练</Button><p className="text-[14px] text-muted-foreground">{session.preparation.job.title || "模拟训练"}</p></div></header><main className="mx-auto w-full max-w-[880px] p-6 lg:p-8"><section className="rounded-[14px] border border-border bg-white p-6"><p className="text-[14px] font-medium text-primary">本轮题目已处理</p><h1 className="mt-2 text-[28px] font-semibold tracking-tight text-foreground">完成这轮训练前，再确认一次</h1><p className="mt-3 text-[16px] leading-7 text-muted-foreground">总题数 {totals.total} = 已回答 {totals.answered} + 已跳过 {totals.skipped} + 未开始 {totals.unfinished}。已保存 {totals.finalAnswers} 份最终回答。</p><div className="mt-6 flex flex-wrap gap-3"><Button variant="outline" onClick={onResume}>返回本题继续作答</Button><Button data-cta="primary" onClick={onFinish}><CheckCircle2 size={17}/>完成训练</Button></div></section></main></div>;
}

function TrainingSummary({ session, report, onOpenReview, onExit, exitLabel = "返回训练记录" }: { session: InterviewSession | null; report: Report; onOpenReview?: () => void; onExit?: () => void; exitLabel?: string }) {
  if (!session) return <ReportView report={report}/>;
  const totals = trainingTotals(session);
  const states = trainingQuestionStates(session);
  const needsPractice = states.filter(item => item.status === "skipped" || (item.status === "answered" && !item.finalAnswer));
  const statusLabel = (status: typeof states[number]["status"]) => status === "answered" ? "已回答" : status === "skipped" ? "已跳过" : "未开始";
  const statusStyle = (status: typeof states[number]["status"]) => status === "answered" ? "bg-emerald-50 text-emerald-700" : status === "skipped" ? "bg-amber-50 text-amber-800" : "bg-muted text-muted-foreground";
  const button = "inline-flex items-center gap-2 rounded-md px-4 py-2 text-[16px] font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
  return <div className="min-h-screen bg-background"><main className="mx-auto w-full max-w-[1376px] p-6 lg:p-8"><header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[14px] font-medium text-primary">训练总结</p><h1 className="mt-1 text-[28px] font-semibold tracking-tight text-foreground">本轮训练结束</h1><p className="mt-2 text-[16px] text-muted-foreground">{session.preparation.job.title || "模拟训练"} · 由你主动结束</p></div><span className="rounded-full bg-muted px-3 py-1.5 text-[13px] text-muted-foreground">最终回答 {totals.finalAnswers} 份</span></header><section aria-label="本轮训练统计" className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[[totals.total, "总题数", "按本轮顺序"], [totals.answered, "已回答", "不含跳过"], [totals.skipped, "已跳过", "可在后续继续练习"], [totals.unfinished, "未开始", "不计入已回答"]].map(([value, label, hint]) => <article key={label as string} className="rounded-[14px] border border-border bg-white p-4"><p className="text-[28px] font-semibold text-foreground">{value}</p><p className="mt-1 text-[14px] font-medium text-muted-foreground">{label}</p><p className="mt-1 text-[12px] text-muted-foreground">{hint}</p></article>)}</section><div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]"><section className="overflow-hidden rounded-[14px] border border-border bg-white"><div className="border-b border-border px-5 py-3"><p className="text-[15px] font-semibold text-foreground">本轮题目</p><p className="mt-1 text-[13px] text-muted-foreground">{totals.total} 题 = 已回答 {totals.answered} + 已跳过 {totals.skipped} + 未开始 {totals.unfinished}</p></div>{states.map(item => <div key={item.question.id} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-b-0"><span className="grid size-7 shrink-0 place-items-center rounded-md bg-card text-[13px] font-semibold text-primary">{item.index + 1}</span><p className="min-w-0 flex-1 truncate text-[14px] text-foreground">{item.question.text}</p><span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${statusStyle(item.status)}`}>{statusLabel(item.status)}</span></div>)}</section><aside className="space-y-3"><section className="rounded-[14px] border border-border bg-white p-5"><h2 className="text-[17px] font-semibold text-foreground">下一步</h2><p className="mt-2 text-[14px] leading-6 text-muted-foreground">{needsPractice.length ? `本轮有 ${needsPractice.length} 道题尚未形成最终回答或已跳过，可在复盘中查看后继续安排练习。` : "本轮每道已回答题都已保存最终回答。"}</p><div className="mt-4 space-y-2">{onOpenReview && <Button data-cta="primary" onClick={onOpenReview} className="w-full"><ClipboardList size={17}/>查看本轮复盘</Button>}<Button variant="outline" onClick={onExit} disabled={!onExit} className="w-full">{exitLabel}</Button></div></section><section className="rounded-[14px] border border-border bg-card p-5"><h2 className="text-[15px] font-semibold text-foreground">导出准备记录</h2><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" onClick={() => download(buildDocx({ project: null, session, report }), "AI面试通-准备记录.docx")}>导出 DOCX</Button><Button variant="outline" onClick={() => download(buildPdf({ project: null, session, report }), "AI面试通-准备记录.pdf")}>导出 PDF</Button></div></section></aside></div><details className="mt-5 rounded-[14px] border border-border bg-white p-5"><summary className="cursor-pointer text-[16px] font-semibold text-foreground">查看本轮分析</summary><div className="mt-5"><ReportView report={report}/></div></details></main></div>;
}



function ReportView({ report }: { report: Report }) { return <div className="mx-auto max-w-4xl space-y-5"><SectionTitle icon={<Sparkles className="text-blue-700" />}>面试报告</SectionTitle><div className="rounded-2xl border border-blue-100 bg-blue-50 p-6"><p className="text-sm text-blue-700">整体评价</p><h3 className="mt-2 text-2xl font-semibold text-slate-950">{report.overall}</h3></div><div className="grid gap-4 md:grid-cols-2">{([['已提供的回答线索', report.strengths], ['风险问题', report.risks], ['待补充的回答材料', report.gaps], ['仍需人工核对', report.studyTopics], ['下一轮训练重点', report.nextFocus]] as const).map(([title, items]) => <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-semibold text-slate-950">{title}</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">{items.map(item => <li key={item}>{item}</li>)}</ul></section>)}</div></div> }

function HistoryView({ history, onOpen, onDelete, onClear }: { history: InterviewSession[]; onOpen: (s: InterviewSession) => void; onDelete: (id: string) => void; onClear: () => void }) { return <div><div className="flex items-center justify-between"><SectionTitle icon={<History className="text-blue-700" />}>历史记录</SectionTitle>{history.length > 0 && <button onClick={onClear} className="text-sm font-medium text-red-700 hover:text-red-800">清空历史</button>}</div><p className="mt-2 text-sm text-slate-600">保存岗位、题目、回答、评价和报告；最多 20 份，本地浏览器存储。</p><div className="mt-5 space-y-3">{history.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">暂无本地记录。完成模拟面试或归档旧轮次后会保存。</div> : history.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h3 className="font-medium text-slate-950">{item.preparation.job.title || "AI 岗位模拟面试"}</h3><p className="mt-1 text-sm text-slate-600">{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.turns.length} 轮回答 · {item.status === "completed" ? "已生成报告" : "未完成"}</p></div><div className="flex gap-2"><button onClick={() => onOpen(item)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">查看</button><button onClick={() => onDelete(item.id)} aria-label="删除记录" className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash2 size={18}/></button></div></article>)}</div></div> }
