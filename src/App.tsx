import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClipboardList, History, Loader2, Play, Send, Sparkles, Trash2 } from "lucide-react";
import type { InterviewProject, InterviewSession, JobMaterial, Preparation, Question, Report, UserProfile } from "./lib/domain";
import { createPreparation, finishSession, nextTurn, startSession } from "./lib/interview";
import { loadProjects, saveProject, deleteProject } from "./lib/projectStorage";
import { createInterviewProject, editInterviewProject, toProjectQuestion, updateProjectFromSession, validateInterviewProject, type InterviewProjectInput } from "./lib/projects";
import { clearHistory, deleteHistory, loadHistory, saveHistory } from "./lib/storage";
import { coachInterviewAnswer, decideInterviewTurn, selectInterviewQuestionIds, DEFAULT_MODEL_TIMEOUTS } from "./services/modelClient";
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
import { attachCoachReview, currentCoachReview, latestAnswer, markCoachFailure, questionForTurn, reviseTurn, saveFinalAnswer as persistFinalAnswer } from "./lib/coaching";
import { loadDrafts, saveDraft } from "./lib/drafts";
import { loadUserProfile, saveUserProfile } from "./lib/profileStorage";
import { AppShell, type PrimaryPage } from "./components/layout/AppShell";
import { JobList } from "./components/jobs/JobList";
import { JobWorkbench, type JobWorkbenchModule } from "./components/jobs/JobWorkbench";
import { JobMaterials } from "./components/jobs/JobMaterials";
import { EvidenceAnalysis } from "./components/jobs/EvidenceAnalysis";
import { saveProjectAnalysis } from "./lib/jobAnalysis";
import type { SavedJobAnalysis } from "./lib/domain";
import { analysisPracticeOrigin, analysisPracticeQuestion, type AnalysisQuestionSelection } from "./lib/analysisPractice";
import { ProfileLibrary } from "./components/profile/ProfileLibraryV2";
import { QuestionLibrary } from "./components/library/QuestionLibrary";
import { FoundationLearning } from "./components/library/FoundationLearning";
import { RecordedQuestionInput } from "./components/library/RecordedQuestionInput";
import { ExperiencePractice } from "./components/library/ExperiencePractice";
import { MaterialCollection } from "./components/library/MaterialCollection";
import { collectionPracticeContext, type MaterialCollection as CollectionState, type CollectedMaterial } from "./lib/materialCollection";
import { currentExperienceSet, experiencePracticeContext, experienceVersion, type ExperiencePracticeSet } from "./lib/experiencePractice";
import { createRecordedQuestion, recordedPracticeQuestion } from "./lib/questionLibrary";
import { buildLibraryQuestions, createReuseDraft, loadQuestionLibrary, saveQuestionLibrary, toggleLibraryFavorite, type AnswerReuseDraft, type LibraryQuestion, type QuestionLibraryState } from "./lib/questionLibrary";
import { buildQuestionDocx, buildQuestionPdf, download } from "./lib/interviewExport";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { UnsavedChangesProvider, useSafeNavigation } from "./components/shared/UnsavedChanges";
const answerKey = (s: InterviewSession) => `answer:${s.id}:${s.questions[s.currentQuestionIndex]?.id ?? "complete"}`;

type Page = PrimaryPage | "job-workbench" | "create" | "matrix" | "questions" | "interview" | "report" | "history";

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
  const [page, setPage] = useState<Page>("jobs");
  const [libraryArea, setLibraryArea] = useState<"foundation" | "job" | "recorded" | "resume" | "collection" | null>(null);
  const [selectedExperience, setSelectedExperience] = useState<string | null>(null);
  const [selectedExperienceSet, setSelectedExperienceSet] = useState<string | null>(null);
  const [selectedCollectionAnalysis, setSelectedCollectionAnalysis] = useState<string | null>(null);
  const [pendingExperience, setPendingExperience] = useState<{ setId: string; questionId: string } | null>(null);
  const [activeJobModule, setActiveJobModule] = useState<JobWorkbenchModule>("materials");
  const [projects, setProjects] = useState<InterviewProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [answer, setAnswer] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<InterviewSession[]>([]);
  const [questionLibrary, setQuestionLibrary] = useState<QuestionLibraryState>(() => loadQuestionLibrary());
  const [userProfile, setUserProfile] = useState<UserProfile>(() => loadUserProfile());
  const [error, setError] = useState("");
  const [modelAvailable, setModelAvailable] = useState(false);
  const [modelProvider, setModelProvider] = useState<string | null>(null);
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
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const blocked = Object.values(unsaved).some(Boolean);
  const markUnsaved = (key: string, value: boolean) => setUnsaved(current => ({ ...current, [key]: value }));
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (blocked) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [blocked]);
  const [pendingNewTraining, setPendingNewTraining] = useState(false);
  const [pendingRecommendation, setPendingRecommendation] = useState<AnalysisQuestionSelection | null>(null);
  const [pendingRecordedQuestion, setPendingRecordedQuestion] = useState<string | null>(null);
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
      setModelProvider(typeof data.provider === "string" ? data.provider : null);
      const bounded = (value: unknown, fallback: number) => Number.isInteger(value) && Number(value) >= 1000 && Number(value) <= 300_000 ? Number(value) : fallback;
      setModelTimeouts({ coach: bounded(data.timeouts?.coach, DEFAULT_MODEL_TIMEOUTS.coach), interviewer: bounded(data.timeouts?.interviewer, DEFAULT_MODEL_TIMEOUTS.interviewer) });
    }).catch(() => { setModelAvailable(false); setModelProvider(null); });
  }, []);
  const activeProject = useMemo(() => projects.find(project => project.id === activeProjectId) ?? null, [activeProjectId, projects]);
  const libraryEntries = useMemo(() => buildLibraryQuestions(projects, history, questionLibrary), [projects, history, questionLibrary]);
  const selectedCard = userProfile.experiences.find(card => card.id === selectedExperience);
  const viewedExperienceSet = questionLibrary.experienceSets?.find(set => set.id === selectedExperienceSet) ?? (selectedCard ? currentExperienceSet(questionLibrary, selectedCard) : undefined);
  const visibleLibraryEntries = libraryEntries.filter(item => libraryArea === "collection" ? item.questionId.startsWith("collected-question-") : libraryArea === "resume" ? Boolean(viewedExperienceSet?.questions.some(question => question.id === item.questionId.replace(/(?:-followup)+$/, ""))) : libraryArea === "foundation" ? !item.projectId && item.questionId.startsWith("foundation-") : libraryArea === "recorded" ? Boolean(item.recordedQuestionId) || item.questionId.startsWith("recorded-") : !item.questionId.startsWith("collected-question-") && !item.questionId.startsWith("experience-set-") && !item.recordedQuestionId && !item.questionId.startsWith("recorded-") && (Boolean(item.projectId) || !item.questionId.startsWith("foundation-")));
  const question = session?.questions[session.currentQuestionIndex];
  const canContinueTraining = Boolean(session?.status === "active" && question);
  const recordedTarget = projects.find(project => project.id === questionLibrary.recordedQuestions?.find(item => item.id === pendingRecordedQuestion)?.projectId);
  const recordedContinuation = session?.status === "active" ? session : recordedTarget?.session?.status === "active" ? recordedTarget.session : history.find(item => item.status === "active" && item.preparation.questions[0]?.sourceType === "user_recorded" && item.preparation.questions[0].id === pendingRecordedQuestion);
  const foundationContinuation = session?.status === "active" ? session : history.find(item => item.status === "active" && item.preparation.questions[0]?.sourceType === "foundation" && item.preparation.questions[0].id === pendingFoundation?.id);
  const experienceContinuation = session?.status === "active" ? session : history.find(item => item.status === "active");
  const activePrimaryPage: PrimaryPage = page === "jobs" || page === "profile" || page === "library" ? page : page === "history" || (!activeProjectId && (page === "interview" || page === "report")) ? "library" : "jobs";
  const pageDetails: Record<Page, { title: string; description: string; breadcrumbs: string[] }> = {
    jobs: { title: "我的岗位", description: "", breadcrumbs: [] },
    profile: { title: "个人资料库", description: "", breadcrumbs: [] },
    library: { title: "AI 面试题库", description: "", breadcrumbs: [] },
    "job-workbench": { title: activeProject?.jobTitle || "岗位准备", description: "", breadcrumbs: ["我的岗位", activeProject?.jobTitle || "未选择岗位"] },
    create: { title: "创建岗位", description: "", breadcrumbs: ["我的岗位", "创建岗位"] },
    matrix: { title: "岗位分析", description: "查看当前岗位的原始 JD、材料线索和准备路线。", breadcrumbs: ["我的岗位", activeProject?.jobTitle || "当前岗位", "分析"] },
    questions: { title: "问题练习", description: "浏览当前岗位的针对性题目，并进入文字模拟训练。", breadcrumbs: ["我的岗位", activeProject?.jobTitle || "当前岗位", "训练"] },
    interview: { title: "模拟训练", description: "", breadcrumbs: ["我的岗位", activeProject?.jobTitle || "当前岗位", "训练"] },
    report: { title: "训练复盘", description: "依据当前会话的最新回答整理可追溯的材料线索与待补项。", breadcrumbs: ["我的岗位", activeProject?.jobTitle || "当前岗位", "面试训练"] },
    history: { title: "训练记录", description: "旧版独立训练记录已由 AI 面试题库统一汇总。", breadcrumbs: ["AI 面试题库", "训练记录"] },
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
      setSession(project.session ?? null);
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
      setPendingRecordedQuestion(null);
      if (activeProject.session || answer.trim()) setPendingNewTraining(true);
      else void startTrustedInterview();
    });
  }

  function requestAnalysisPractice(selection: AnalysisQuestionSelection) {
    if (!activeProject || selection.projectId !== activeProject.id || answerSubmitting || coachPending || blocked) return;
    navigate(() => {
      setPendingRecommendation(selection);
      setPendingRecordedQuestion(null);
      if (activeProject.session || answer.trim()) setPendingNewTraining(true);
      else void startTrustedInterview(selection);
    });
  }

  function requestRecordedPractice(id: string) {
    if (answerSubmitting || coachPending || blocked) return;
    navigate(() => {
      const item = loadQuestionLibrary().recordedQuestions?.find(item => item.id === id);
      if (!item) { setError("已保存题目无法读取，未开始训练。"); return; }
      setPendingRecommendation(null); setPendingRecordedQuestion(id);
      const target = loadProjects().find(project => project.id === item.projectId);
      const ongoing = loadHistory().some(session => session.status === "active" && session.preparation.questions[0]?.sourceType === "user_recorded" && session.preparation.questions[0].id === id);
      if (session || target?.session || ongoing || answer.trim()) setPendingNewTraining(true);
      else void startTrustedInterview(undefined, id);
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

  async function startTrustedInterview(selection?: AnalysisQuestionSelection, recordedId?: string) {
    if ((!activeProject && !recordedId) || answerSubmitting || coachPending || blocked) return;
    setPendingNewTraining(false);
    const controller = new AbortController();
    activeAIRequest.current = controller; setCancellingAI(false); setWaitingAnswer(null);
    setTrainingStarting(true); setAnswerSubmitting(true);
    try {
      const recorded = recordedId ? loadQuestionLibrary().recordedQuestions?.find(item => item.id === recordedId) : null;
      if (recordedId && !recorded) throw new Error("已保存题目无法读取，未开始训练。");
      const jobs = loadProjects();
      const target = recorded ? jobs.find(item => item.id === recorded.projectId) : selection ? jobs.find(item => item.id === activeProject?.id) : activeProject;
      if (!target && !recorded) throw new Error("岗位无法安全读取，未开始训练。");
      if (target && !target.preparation && !target.session && target.questions.length > 0) throw new Error("该旧岗位缺少训练准备快照，旧分析与题目仍可查看。为避免覆盖历史内容，未开始新训练；请先备份并人工核对旧记录。");
      const recommendation = recorded ? recordedPracticeQuestion(recorded, jobs) : selection ? analysisPracticeQuestion(target!, selection) : null;
      const context = buildInterviewContext({ project: target, profile: userProfile });
      const candidates = recommendation ? [recommendation] : trustedQuestionCandidates(context);
      if (!candidates.length) throw new Error("当前没有可练习题目；请补充 JD 或前往 AI 面试题库选择内置题。");
      let selected = recommendation ? [recommendation] : selectLocalQuestions(candidates);
      let modelNotice = "";
      if (!recommendation && modelAvailable) {
        try { const ids = await selectInterviewQuestionIds(context, candidates.map(item => ({ id: item.id, question: item.text, source: item.source })), { signal: controller.signal, timeoutMs: modelTimeouts.interviewer }); if (ids.length) selected = ids.map(id => candidates.find(item => item.id === id)!).filter(Boolean); else modelNotice = "模型未选出有效题目，已使用本地选题。"; }
        catch { if (controller.signal.aborted) throw new Error("已取消准备训练，原训练和资料保留。"); modelNotice = "模型选题失败或超时，已使用本地选题。"; }
      }
      if (controller.signal.aborted || activeAIRequest.current !== controller) throw new Error("已取消准备训练，未写入迟到结果。");
      const prepared = trustedPreparation(context, selected);
      const next = startSession(prepared);
      // The library may have edited a saved final answer since this session was rendered.
      const savedCurrent = recorded && session ? [jobs.find(project => project.id === activeProjectId)?.session, ...loadHistory()].find(item => item?.id === session.id) ?? session : null;
      const previous = [target?.session, savedCurrent].filter((item): item is InterviewSession => Boolean(item));
      for (const [index, item] of previous.entries()) if (previous.findIndex(candidate => candidate.id === item.id) === index) saveHistory(item);
      if (previous.length) setHistory(loadHistory());
      if (target) {
        const updated = { ...target, preparation: target.preparation ?? target.session?.preparation ?? prepared, questions: prepared.questions.map(toProjectQuestion), totalQuestions: prepared.questions.length };
        setProjects(saveProject(updateProjectFromSession(updated, next)));
      } else { saveHistory(next); setHistory(loadHistory()); }
      if (recorded) { setActiveProjectId(target?.id ?? null); setPage(target ? "job-workbench" : "interview"); }
      sessionRef.current = next; setPreparation(prepared); setSession(next); setReport(null); setAnswer(""); setActiveJobModule("training"); setError(modelNotice);
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
      const next = startSession(prepared);
      // Persist even a zero-answer session so its existing per-session draft remains reachable after refresh.
      if (session) saveHistory(loadProjects().find(project => project.id === activeProjectId)?.session ?? stored.find(saved => saved.id === session.id) ?? session);
      saveHistory(next); setHistory(loadHistory());
      setPendingNewTraining(false); setPendingFoundation(null);
      setActiveProjectId(null); setPreparation(prepared); setSession(next); setAnswer(""); setReport(null); setError(""); setPage("interview");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始基础题练习。"); }
  }

  function selectExperience(id: string, setId?: string) {
    setSelectedExperience(id); setSelectedExperienceSet(setId ?? null); setLibraryArea("resume"); setPage("library");
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
  function startExperiencePractice(setId: string, questionId: string, confirmed = false) {
    if (blocked || answerSubmitting || coachPending) return;
    try {
      const stored = loadHistory(), library = loadQuestionLibrary(), currentSet = library.experienceSets?.find(item => item.id === setId);
      const collectionSet = library.collection?.analyses.find(item => item.id === setId);
      const selected = (currentSet ?? collectionSet)?.questions.find(item => item.id === questionId);
      if (!selected || (currentSet ?? collectionSet)?.hiddenQuestionIds?.includes(questionId)) throw new Error("题组无法读取或题目已移除，未开始训练。");
      if (!confirmed && (session || stored.some(saved => saved.status === "active"))) {
        setPendingFoundation(null); setPendingRecordedQuestion(null); setPendingRecommendation(null);
        setPendingExperience({ setId, questionId }); setPendingNewTraining(true); setError(""); return;
      }
      const context = selected.experienceOrigin ? experiencePracticeContext(loadUserProfile(), selected) : collectionPracticeContext(loadUserProfile(), selected);
      const prepared = trustedPreparation(context, [selected]);
      prepared.job.title = currentSet ? `经历专项：${currentSet.title}` : "面试资料单题练习";
      const next = startSession(prepared);
      if (session) saveHistory(loadProjects().find(project => project.id === activeProjectId)?.session ?? stored.find(saved => saved.id === session.id) ?? session);
      saveHistory(next);
      setHistory(loadHistory()); setActiveProjectId(null); setPreparation(prepared); sessionRef.current = next; setSession(next); setAnswer(""); setReport(null);
      setPendingNewTraining(false); setPendingExperience(null); setError(""); setPage("interview");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法开始专项练习，原训练保留。"); }
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
      const context = question.experienceOrigin ? experiencePracticeContext(loadUserProfile(), question, answer) : question.collectionOrigin ? collectionPracticeContext(loadUserProfile(), question, answer) : buildInterviewContext({ project: activeProject, profile: userProfile, currentQuestion: question.text, userAnswer: answer,
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
      const stored = activeProject ? loadProjects().find(item => item.id === activeProject.id) : null;
      if (activeProject && (!stored || stored.session?.id !== session.id || stored.session.turns.length !== session.turns.length || stored.session.currentQuestionIndex !== session.currentQuestionIndex || stored.session.questions[session.currentQuestionIndex]?.id !== question.id))
        throw new Error("对应岗位或训练已变化，未写入旧结果；回答草稿仍保留。");
      let advanced = nextTurn(stored?.session ?? current, answer, decision);
      const turnIndex = advanced.turns.length - 1;
      if (coach) advanced = attachCoachReview(advanced, turnIndex, 1, answer, coach);
      else if (coachFailure) advanced = markCoachFailure(advanced, turnIndex, 1, coachFailure);
      const nextReport = advanced.status === "completed" ? finishSession(advanced) : null;
      const persistedSession = nextReport ? { ...advanced, report: nextReport } : advanced;
      if (activeProject) {
        setProjects(saveProject(updateProjectFromSession(stored!, persistedSession)));
      }
      else saveHistory(persistedSession);
      try { saveDraft(answerKey(session), ""); markUnsaved("answer", false); } catch { setError("回答已保存，但旧草稿清理失败，请保留文字与训练备份。"); }
      sessionRef.current = persistedSession; setSession(persistedSession); setAnswer(loadDrafts()[answerKey(persistedSession)] ?? "");
      if (advanced.status === "completed") {
        setReport(nextReport);
        if (page === "job-workbench") setActiveJobModule("training");
        else setPage("report");
        if (activeProject) {
          try { saveHistory(persistedSession); }
          catch { setError("报告已保存在面试项目中；训练记录副本保存失败，可从“我的面试”继续查看。"); }
        }
        setHistory(loadHistory());
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "回答提交失败，请重试。");
    } finally {
      if (activeAIRequest.current === controller) { activeAIRequest.current = null; setAnswerSubmitting(false); setCancellingAI(false); }
    }
  }

  function openTraining() {
    if (page === "job-workbench") setActiveJobModule("training");
    else setPage("interview");
  }

  function openProject(project: InterviewProject) {
    setReturnAnalysisId(null);
    setActiveProjectId(project.id);
    setPreparation(project.session?.preparation ?? project.preparation ?? null);
    setSession(project.session ?? null);
    setAnswer(project.session ? loadDrafts()[answerKey(project.session)] ?? "" : "");
    setError("");
    setReport(project.session?.status === "completed" ? finishSession(project.session) : null);
    setActiveJobModule("materials");
    setPage("job-workbench");
  }

  function openHistory(item: InterviewSession) {
    setActiveProjectId(null); setPreparation(item.preparation); setSession(item); setAnswer(loadDrafts()[answerKey(item)] ?? ""); setReport(item.status === "completed" ? finishSession(item) : null); setPage(item.status === "completed" ? "report" : "interview");
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
    const context = requestedQuestion.experienceOrigin ? experiencePracticeContext(loadUserProfile(), requestedQuestion, submittedAnswer) : requestedQuestion.collectionOrigin ? collectionPracticeContext(loadUserProfile(), requestedQuestion, submittedAnswer) : buildInterviewContext({ project: activeProject, profile: userProfile, currentQuestion: requestedQuestion.text, userAnswer: submittedAnswer,
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
      if (activeProjectId === pendingDelete.id) { setActiveProjectId(null); setPreparation(null); setSession(null); setReport(null); setAnswer(""); }
      setPendingDelete(null); setError("已删除选定项目；独立训练记录未删除。可从此前导出的文字与训练备份恢复。");
    } catch(e) { setError(e instanceof Error ? e.message : "删除失败"); }
  }
  const details = pageDetails[page];
  const isLegacyPage = ["create", "matrix", "questions", "interview", "report", "history"].includes(page);
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
  const analysisContent: ReactNode = <div className="space-y-6">
    {activeProject && <EvidenceAnalysis key={activeProject.id} project={activeProject} profile={userProfile} modelAvailable={modelAvailable} onSaveAnalysis={saveAnalysis} onFailure={setError} onPractice={requestAnalysisPractice} practiceDisabled={answerSubmitting || coachPending || blocked} initialSelectedId={returnAnalysisId}/>}
    <button onClick={() => navigate(openTraining)} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">进入面试训练</button>
    {(compatibilityPreparation || activeProject?.analysis || compatibilityQuestions.length > 0) && <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
    <section aria-label="岗位训练操作" className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <p className="text-sm leading-6 text-blue-950">{canContinueTraining ? "当前训练已保留，继续时不会重新选题或重置进度。" : "先查看岗位分析，再按当前已确认资料开始训练。"}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        {recommendationOrigin?.projectId === activeProjectId && <button onClick={returnToAnalysis} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 disabled:opacity-50">返回原岗位分析</button>}
        <button onClick={() => canContinueTraining ? navigate(openTraining) : requestNewTraining()} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{canContinueTraining ? "继续当前训练" : session ? "开始新一轮训练" : "开始新训练"}</button>
        {canContinueTraining && <button onClick={requestNewTraining} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 disabled:opacity-50">开始新一轮训练</button>}
      </div>
    </section>
    <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">{modelAvailable ? `AI 教练：${modelProvider || "已连接"}` : "当前未配置外部模型，练习使用本地规则反馈。"}</p>
    {session && session.turns.length > 0 && <fieldset disabled={answerSubmitting || trainingStarting} className="min-w-0"><AnswerReview key={`${session.id}-${session.turns.length}`} session={session} onRequestCoach={requestCoach} modelAvailable={modelAvailable} coachPending={coachPending || answerSubmitting} onRevise={saveRevision} onSaveFinal={saveFinalAnswer} onUnsaved={value => markUnsaved("retry", value)} /></fieldset>}
    {canContinueTraining && session && question ? <Interview session={session} question={question} answer={answer} setAnswer={updateAnswer} submitting={answerSubmitting || coachPending} onSubmit={() => { if (!unsaved.retry) submitAnswer(); }} /> : <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer font-medium text-slate-700">查看历史题目</summary><div className="mt-4"><Questions questions={displayedQuestions}/></div></details>}
    {report && <details className="rounded-lg border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm text-slate-700">查看本轮训练汇总</summary><ReportView report={report}/></details>}
  </div>;
  return <AppShell activePage={activePrimaryPage} title={details.title} description={details.description} breadcrumbs={details.breadcrumbs} navigationDisabled={answerSubmitting || coachPending || blocked} onNavigate={nextPage => navigate(() => { setError(""); setPage(nextPage); })} onSettings={() => setError("设置将在后续阶段完善；本轮不会修改模型配置或本地数据。") }>
      {(answerSubmitting || coachPending) && <AIRequestStatus key={trainingStarting ? "starting" : "coaching"} starting={trainingStarting} question={trainingStarting ? undefined : waitingAnswer?.question} answer={trainingStarting ? undefined : waitingAnswer?.answer} cancelling={cancellingAI} onCancel={() => { setCancellingAI(true); activeAIRequest.current?.abort(); }}/>}
      {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {page !== "library" && error && /20 条上限|历史记录超过/.test(error) && <button onClick={manageHistory} className="mb-4 rounded-lg border border-slate-300 px-3 py-2 text-sm">整理训练记录</button>}
      {isLegacyPage && <div className="mb-6"><button onClick={() => setPage(page === "history" ? historyReturnPage : !activeProject ? "library" : "job-workbench")} disabled={answerSubmitting || coachPending || blocked} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{page === "history" && ["interview","report","job-workbench"].includes(historyReturnPage) ? "返回继续训练" : `返回${page === "history" || !activeProject ? "AI 面试题库" : "岗位工作台"}`}</button></div>}
      {page === "jobs" && <div className="space-y-6"><JobList projects={projects} onCreate={() => { setEditing(null); setError(""); setPage("create"); }} onOpen={openProject} onEdit={project => { setEditing(project); setPage("create"); }} onDelete={setPendingDelete}/><BackupPanel onRestored={() => { setProjects(loadProjects()); setHistory(loadHistory()); setQuestionLibrary(loadQuestionLibrary()); setUserProfile(loadUserProfile()); }}/></div>}
      {page === "job-workbench" && <JobWorkbench project={activeProject} activeModule={activeJobModule} hasPreparation={Boolean(preparation)} hasActiveSession={canContinueTraining} hasReport={Boolean(report)} navigationDisabled={answerSubmitting || coachPending || blocked} onSelectModule={module => navigate(() => setActiveJobModule(module))} onBackToJobs={() => navigate(() => setPage("jobs"))} onEditMaterials={() => navigate(() => { setEditing(activeProject); setPage("create"); })} onOpenLegacy={legacyPage => navigate(() => setPage(legacyPage))} materialsContent={materialsContent} analysisContent={analysisContent} trainingContent={trainingContent}/>} 
      {page === "profile" && <ProfileLibrary profile={userProfile} onSave={saveProfile} onPractice={id => selectExperience(id)}/>} 
      {page === "library" && <div className="space-y-5">
        {libraryArea === null ? <div className="grid gap-4 md:grid-cols-2">{([
          ["foundation", "AI 基础学习", "学习概念，练习独立表达。"],
          ["job", "岗位专项训练", "围绕目标岗位练习与复习。"],
          ["resume", "简历专项", "围绕一段已确认经历，选择问题练习。"],
          ["collection", "面试资料收集", "批量整理JD、面经与知识笔记，选择题目练习。"],
          ["recorded", "真实面试题复练", "记下一道遇过的问题，再练一次。"],
        ] as const).map(([area, title, hint]) => <button key={area} aria-label={title} onClick={() => navigate(() => setLibraryArea(area))} className="rounded-xl border border-slate-200 bg-white p-6 text-left hover:border-blue-300 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"><span className="block font-semibold text-slate-950">{title}</span><span className="mt-2 block text-sm text-slate-600">{hint}</span></button>)}</div> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><button onClick={() => navigate(() => setLibraryArea(null))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">返回题库入口</button><button onClick={manageHistory} className="text-sm text-slate-600 underline">整理训练记录</button></div>
          {libraryArea === "foundation" && <FoundationLearning state={questionLibrary} onReview={(id,status) => { const message = saveQuestionLibraryState({ ...questionLibrary, foundationReview: { ...(questionLibrary.foundationReview ?? {}), [id]: status } }); if (message) setError(message); }} onPractice={item => navigate(() => startFoundationPractice(item))}/>}
          {libraryArea === "job" && <button onClick={() => navigate(() => setPage("jobs"))} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm text-white">选择岗位开始训练</button>}
          {libraryArea === "recorded" && <RecordedQuestionInput projects={projects} onSave={saveRecordedQuestion} disabled={answerSubmitting || coachPending || blocked}/>}
          {libraryArea === "resume" && <ExperiencePractice profile={userProfile} state={questionLibrary} experienceId={selectedExperience} setId={selectedExperienceSet} modelAvailable={modelAvailable} onSelect={selectExperience} onSave={saveExperienceSet} onUpdate={updateExperienceSet} onPractice={startExperiencePractice}/>}
          {libraryArea === "collection" && <MaterialCollection value={questionLibrary.collection} projects={projects} modelAvailable={modelAvailable} onSave={saveCollection} onLink={linkCollectedMaterial} initialAnalysisId={selectedCollectionAnalysis} onPractice={(id,q) => { setSelectedCollectionAnalysis(id); startExperiencePractice(id,q); }}/>} 
          {(libraryArea === "foundation" || libraryArea === "resume" || libraryArea === "collection") ? <details><summary className="cursor-pointer py-2 text-sm text-slate-700">{libraryArea === "collection" ? "我的资料题回答与复习" : libraryArea === "resume" ? "我的专项回答与复习" : "我的基础题回答与复习"}</summary><div className="mt-3"><QuestionLibrary visibleEntries={visibleLibraryEntries} entries={libraryEntries} projects={projects} state={questionLibrary} onToggleFavorite={key => { const message = saveQuestionLibraryState(toggleLibraryFavorite(questionLibrary, key)); if (message) setError(message); }} onSaveFinal={saveLibraryFinalAnswer} onRecordedPractice={requestRecordedPractice} onOpenPractice={id => { const project = projects.find(item => item.id === id); if (project) { openProject(project); setActiveJobModule("training"); } }} onCreateReuse={createLibraryReuse} onSaveReuse={saveLibraryReuse} onConfirmReuse={confirmLibraryReuse} onExport={exportLibraryQuestion}/></div></details> : <QuestionLibrary visibleEntries={visibleLibraryEntries} entries={libraryEntries} projects={projects} state={questionLibrary} onToggleFavorite={key => { const message = saveQuestionLibraryState(toggleLibraryFavorite(questionLibrary, key)); if (message) setError(message); }} onSaveFinal={saveLibraryFinalAnswer} onRecordedPractice={requestRecordedPractice} onOpenPractice={id => { const project = projects.find(item => item.id === id); if (project) { openProject(project); setActiveJobModule("training"); } }} onCreateReuse={createLibraryReuse} onSaveReuse={saveLibraryReuse} onConfirmReuse={confirmLibraryReuse} onExport={exportLibraryQuestion}/>}
        </>}
      </div>}
      {page === "create" && <CreateInterview confirmedExperienceCount={userProfile.experiences.filter(card => card.confirmed).length} key={editing?.id ?? "create"} demoInput={demoProject} initialInput={editing ?? undefined} draftId={editing ? `edit:${editing.id}` : "create"} onUnsaved={v => markUnsaved("form", v)} onBack={() => { if (!blocked) { setError(""); setPage("jobs"); } }} onCreate={createProject} />}
      {blocked && <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">有未能保存的输入，导航暂时锁定；请保留本页，重试保存或提交。</p>}
      {pendingDelete && <Dialog open onOpenChange={open => { if (!open) setPendingDelete(null); }}><DialogContent aria-label="删除项目确认"><DialogHeader><DialogTitle className="pr-8 text-xl font-semibold text-slate-950">删除“{pendingDelete.jobTitle}”？</DialogTitle><DialogDescription>将删除该项目及其中材料、案例和当前训练。独立训练记录不会删除。请先导出文字与训练备份；未备份的项目无法恢复。</DialogDescription></DialogHeader><DialogFooter><button onClick={removeProject} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-800">确认删除该项目</button><button onClick={() => setPendingDelete(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100">取消</button></DialogFooter></DialogContent></Dialog>}
      {pendingNewTraining && <Dialog open onOpenChange={open => { if (!open) { setPendingNewTraining(false); setPendingRecommendation(null); setPendingRecordedQuestion(null); setPendingFoundation(null); setPendingExperience(null); } }}><DialogContent aria-label="开始新一轮训练">
        <DialogHeader><DialogTitle>开始新一轮训练？</DialogTitle><DialogDescription>{pendingExperience ? "将只练习你选择的这道题。" : pendingFoundation ? "将练习你选定的内置基础题；可继续原会话，或保存旧轮次后开始新训练。" : pendingRecordedQuestion ? "仅练习你选定的本人记录问题，不重新选题。当前或关联岗位已有训练，确认后才开始新轮次。" : pendingRecommendation ? "将仅练习你选择的 AI 分析推荐题，不重新选题。" : "将依据当前已确认资料重新选题。"}已有回答、重答、最终答案及点评会保留为训练记录；已保存到浏览器的未提交草稿仍归属旧轮次，可从训练记录继续。取消则保留当前训练。</DialogDescription></DialogHeader>
        {(pendingFoundation || pendingExperience) && error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <DialogFooter>
          {pendingExperience && experienceContinuation && <button className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all" onClick={() => {
            const project = loadProjects().find(item => item.session?.id === experienceContinuation.id);
            if (project) { openProject(project); setActiveJobModule("training"); }
            else openHistory(loadHistory().find(item => item.id === experienceContinuation.id) ?? experienceContinuation);
            setPendingNewTraining(false); setPendingExperience(null);
          }}>继续当前训练</button>}
          <button disabled={answerSubmitting || coachPending || blocked} onClick={() => pendingExperience ? startExperiencePractice(pendingExperience.setId, pendingExperience.questionId, true) : pendingFoundation ? startFoundationPractice(pendingFoundation, true) : void startTrustedInterview(pendingRecommendation ?? undefined, pendingRecordedQuestion ?? undefined)} className="rounded-lg bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">保存旧轮次并开始</button>
          {pendingRecommendation && canContinueTraining && <button onClick={() => { setPendingNewTraining(false); setPendingRecommendation(null); openTraining(); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">继续当前训练</button>}
          {pendingFoundation && foundationContinuation && <button onClick={() => {
            const project = loadProjects().find(item => item.session?.id === foundationContinuation.id);
            if (project) { openProject(project); setActiveJobModule("training"); }
            else openHistory(loadHistory().find(item => item.id === foundationContinuation.id) ?? foundationContinuation);
            setPendingNewTraining(false); setPendingFoundation(null);
          }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">继续当前训练</button>}
          {pendingRecordedQuestion && recordedContinuation && <button onClick={() => {
            const project = loadProjects().find(item => item.session?.id === recordedContinuation.id);
            if (project) { openProject(project); setActiveJobModule("training"); }
            else openHistory(loadHistory().find(item => item.id === recordedContinuation.id) ?? recordedContinuation);
            setPendingNewTraining(false); setPendingRecordedQuestion(null);
          }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">继续当前训练</button>}
          <button onClick={() => { setPendingNewTraining(false); setPendingRecommendation(null); setPendingRecordedQuestion(null); setPendingFoundation(null); setPendingExperience(null); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">保留当前训练</button>
        </DialogFooter>
      </DialogContent></Dialog>}

      {page === "matrix" && preparation && <div className="space-y-6">{activeProject && <CareerPlan trainingEntryLabel="进入面试训练" key={activeProject.id} project={activeProject} onSave={saveEvidence} onMinutes={changeMinutes} onPractice={() => navigate(openTraining)} onPatch={patchProject} onUnsaved={v => markUnsaved("evidence", v)}/>}<details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" open={!activeProject}><summary className="mb-4 cursor-pointer font-medium text-slate-700">查看基础能力矩阵与历史题目</summary><Matrix preparation={preparation} onStart={() => navigate(openTraining)}/></details></div>}
      {page === "questions" && preparation && <Questions questions={preparation.questions} onStart={() => navigate(openTraining)} />}
      {page === "interview" && <p className="mb-4 text-xs text-slate-600">{modelAvailable ? `AI 教练：${modelProvider || "已连接"}` : "本地练习，未连接 AI。"}</p>}
      {(page === "interview" || page === "report") && session?.preparation.questions[0]?.experienceOrigin && <button disabled={answerSubmitting || coachPending || blocked} className="mb-4 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all" onClick={() => navigate(() => {
        const origin = session.preparation.questions[0].experienceOrigin!;
        setHistory(loadHistory()); selectExperience(origin.experienceId, origin.setId);
      })}>返回经历题组</button>}
      {(page === "interview" || page === "report") && session?.preparation.questions[0]?.collectionOrigin && <button disabled={answerSubmitting || coachPending || blocked} className="mb-4 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all" onClick={() => navigate(() => { setHistory(loadHistory()); setSelectedCollectionAnalysis(session.preparation.questions[0].collectionOrigin!.analysisId); setLibraryArea("collection"); setPage("library"); })}>返回资料题组</button>}
      {(page === "interview" || page === "report") && session && session.turns.length > 0 && <fieldset disabled={answerSubmitting} className="min-w-0"><AnswerReview key={`${session.id}-${session.turns.length}`} session={session} onRequestCoach={requestCoach} modelAvailable={modelAvailable} coachPending={coachPending || answerSubmitting} onRevise={saveRevision} onSaveFinal={saveFinalAnswer} onUnsaved={v => markUnsaved("retry", v)} /></fieldset>}
      {page === "interview" && session && question && <Interview session={session} question={question} answer={answer} setAnswer={updateAnswer} submitting={answerSubmitting || coachPending} onSubmit={() => { if (!unsaved.retry) submitAnswer(); }} />}
      {page === "report" && report && <details className="mx-auto mt-4 max-w-5xl rounded-lg border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm text-slate-700">查看本轮训练汇总</summary><ReportView report={report}/></details>}
      {page === "history" && <><BackupPanel onRestored={() => { setProjects(loadProjects()); setHistory(loadHistory()); setUserProfile(loadUserProfile()); setQuestionLibrary(loadQuestionLibrary()); }}/><HistoryView history={history} onOpen={openHistory} onDelete={(id) => { if (!window.confirm("删除这条独立训练记录？项目中的会话不受影响。未备份的记录无法恢复。")) return; try { deleteHistory(id); setHistory(loadHistory()); setError("已删除选定训练记录，其他资料不受影响。"); } catch (cause) { setError(cause instanceof Error ? cause.message : "删除失败，未更改记录。"); } }} onClear={() => { if (!window.confirm("清空独立训练记录？项目中的当前会话不受影响。未备份的独立记录无法恢复。")) return; clearHistory(); setHistory([]); }} /></>}
  </AppShell>;
}

function Matrix({ preparation, onStart }: { preparation: Preparation; onStart?: () => void }) { return <div className="space-y-6"><div><SectionTitle icon={<Sparkles className="text-blue-700" />}>能力矩阵</SectionTitle><p className="mt-2 text-slate-600">目标岗位：{preparation.job.title || "未识别职位名称"}。以下为旧准备材料中的背景线索，不等于已确认个人经历。</p></div><div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th>岗位核心能力</th><th>JD 要求</th><th>简历对应证据</th><th>匹配状态</th><th>能力缺口</th></tr></thead><tbody>{preparation.matrix.map(row => <tr key={row.capability} className="border-t border-slate-200 align-top text-slate-700"><td className="font-medium text-slate-950">{row.capability}</td><td>{row.requirement}</td><td>{row.evidence || "—"}</td><td><span className={`rounded-full px-2 py-1 text-xs ${row.status === "matched" ? "bg-emerald-50 text-emerald-700" : row.status === "partial" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{statusLabel(row.status)}</span></td><td>{row.gap}</td></tr>)}</tbody></table></div>{onStart && <button onClick={onStart} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-medium text-white hover:bg-blue-800"><Play size={17}/>进入面试训练</button>}</div> }

function Questions({ questions, onStart }: { questions: Question[]; onStart?: () => void }) { return <div><SectionTitle icon={<ClipboardList className="text-blue-700" />}>针对性题库</SectionTitle><p className="mt-2 text-slate-600">按已有记录显示题目来源；来源标签不代表事实已核验。</p><div className="mt-5 grid gap-4 md:grid-cols-2">{questions.map((q, index) => <article key={q.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-blue-700">{index + 1}. {q.category}</span><span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{questionSourceLabel(q)}</span></div><h3 className="font-semibold leading-6 text-slate-950">{q.text}</h3><p className="mt-3 text-sm text-slate-500">依据：{q.source}</p></article>)}</div>{onStart && <button onClick={onStart} className="mt-6 rounded-xl bg-blue-700 px-5 py-3 font-medium text-white hover:bg-blue-800">进入面试训练</button>}</div> }

function Interview({ session, question, answer, setAnswer, submitting, onSubmit }: { session: InterviewSession; question: Question; answer: string; setAnswer: (v: string) => void; submitting: boolean; onSubmit: () => void }) { const isFollowUp = session.awaitingFollowUp; return <div className="mx-auto w-full max-w-5xl space-y-5"><div className="flex items-center justify-between text-sm text-slate-500"><span>{isFollowUp ? "针对上一回答的追问" : `第 ${session.currentQuestionIndex + 1} / ${session.questions.length} 题`}</span><span>{question.category}</span></div><section className="rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-7"><p className="mb-2 text-xs font-medium text-blue-700">{questionSourceLabel(question)}</p><p className="mb-3 text-sm text-blue-700">问题依据：{question.source}</p><h2 className="text-2xl font-semibold leading-9 text-slate-950">{question.text}</h2></section><VoicePracticeControls questionId={question.id} questionText={question.text} answer={answer} onAnswer={setAnswer} disabled={submitting}/><textarea value={answer} onChange={e => setAnswer(e.target.value)} disabled={submitting} maxLength={12000} aria-label="本轮回答" placeholder="输入你的回答；不知道也可以直接说。" className="min-h-48 w-full rounded-2xl border border-slate-300 bg-white p-5 leading-7 text-slate-900 outline-none focus:border-blue-700 disabled:opacity-60" /><button onClick={onSubmit} disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-medium text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60">{submitting ? <Loader2 className="animate-spin" size={17}/> : <Send size={17}/>} {submitting ? "正在分析回答" : "提交回答"}</button></div> }



function ReportView({ report }: { report: Report }) { return <div className="mx-auto max-w-4xl space-y-5"><SectionTitle icon={<Sparkles className="text-blue-700" />}>面试报告</SectionTitle><div className="rounded-2xl border border-blue-100 bg-blue-50 p-6"><p className="text-sm text-blue-700">整体评价</p><h3 className="mt-2 text-2xl font-semibold text-slate-950">{report.overall}</h3></div><div className="grid gap-4 md:grid-cols-2">{([['已提供的回答线索', report.strengths], ['风险问题', report.risks], ['待补充的回答材料', report.gaps], ['仍需人工核对', report.studyTopics], ['下一轮训练重点', report.nextFocus]] as const).map(([title, items]) => <section key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-semibold text-slate-950">{title}</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">{items.map(item => <li key={item}>{item}</li>)}</ul></section>)}</div></div> }

function HistoryView({ history, onOpen, onDelete, onClear }: { history: InterviewSession[]; onOpen: (s: InterviewSession) => void; onDelete: (id: string) => void; onClear: () => void }) { return <div><div className="flex items-center justify-between"><SectionTitle icon={<History className="text-blue-700" />}>历史记录</SectionTitle>{history.length > 0 && <button onClick={onClear} className="text-sm font-medium text-red-700 hover:text-red-800">清空历史</button>}</div><p className="mt-2 text-sm text-slate-600">保存岗位、题目、回答、评价和报告；最多 20 份，本地浏览器存储。</p><div className="mt-5 space-y-3">{history.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">暂无本地记录。完成模拟面试或归档旧轮次后会保存。</div> : history.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h3 className="font-medium text-slate-950">{item.preparation.job.title || "AI 岗位模拟面试"}</h3><p className="mt-1 text-sm text-slate-600">{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.turns.length} 轮回答 · {item.status === "completed" ? "已生成报告" : "未完成"}</p></div><div className="flex gap-2"><button onClick={() => onOpen(item)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">查看</button><button onClick={() => onDelete(item.id)} aria-label="删除记录" className="rounded-lg p-2 text-red-700 hover:bg-red-50"><Trash2 size={18}/></button></div></article>)}</div></div> }
