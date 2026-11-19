import { ArrowRight, BookOpenText, CheckCircle2, FileText, Play, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { InterviewProject, InterviewSession, UserProfile } from "../../lib/domain";
import type { QuestionLibraryState } from "../../lib/questionLibrary";

type OngoingProject = { project: InterviewProject; session: InterviewSession };

interface PreparationDashboardProps {
  projects: InterviewProject[];
  profile: UserProfile;
  questionLibrary: QuestionLibraryState;
  history: InterviewSession[];
  onCreateJob: () => void;
  onOpenPrepare: () => void;
  onOpenProfile: () => void;
  onOpenResumePractice: () => void;
  onOpenLibrary: () => void;
  onOpenHistory: () => void;
  onContinueProjectTraining: (project: InterviewProject) => void;
  onContinueIndependentTraining: (session: InterviewSession) => void;
}

function firstOngoingProject(projects: InterviewProject[]): OngoingProject | null {
  for (const project of projects) if (project.session?.status === "active") return { project, session: project.session };
  return null;
}

function formatDate(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) return "尚未开始";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value));
}

function QuietLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]">{children}<ArrowRight size={16}/></button>;
}

function PrimaryAction({ children, onClick, icon }: { children: ReactNode; onClick: () => void; icon?: ReactNode }) {
  return <button onClick={onClick} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white shadow-[0_2px_5px_rgba(110,56,27,0.18)] transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 active:scale-[0.98]">{icon}{children}</button>;
}

function SecondaryAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-muted-foreground transition-all hover:border-[#94A3B8] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98]">{children}</button>;
}

function NextStep({ eyebrow, title, detail, actions, aside }: { eyebrow: string; title: string; detail: string; actions: ReactNode; aside: ReactNode }) {
  return <section className="grid overflow-hidden rounded-xl border-2 border-amber-300 bg-background lg:grid-cols-[minmax(0,1fr)_220px]">
    <div className="p-5 md:p-6"><p className="text-sm font-medium text-primary">{eyebrow}</p><h1 className="mt-1 max-w-2xl text-[26px] font-semibold tracking-[-0.03em] text-foreground">{title}</h1><p className="mt-2 max-w-2xl text-[16px] leading-7 text-muted-foreground">{detail}</p><div className="mt-4 flex flex-wrap gap-3">{actions}</div></div>
    <aside className="border-t border-amber-200 bg-muted p-5 lg:border-l lg:border-t-0">{aside}</aside>
  </section>;
}

function PreparationSummary({ confirmed, resumeSets, completed, onOpenProfile, onOpenHistory }: { confirmed: number; resumeSets: number; completed: number; onOpenProfile: () => void; onOpenHistory: () => void }) {
  return <section className="grid divide-y divide-[#F0E7DC] border-y border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
    <button onClick={onOpenProfile} className="p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"><p className="text-sm text-muted-foreground">已确认经历</p><p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{confirmed}<span className="ml-1 text-sm font-normal text-muted-foreground">条</span></p></button>
    <button onClick={onOpenProfile} className="p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"><p className="text-sm text-muted-foreground">可用题组</p><p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{resumeSets}<span className="ml-1 text-sm font-normal text-muted-foreground">组</span></p></button>
    <button onClick={onOpenHistory} className="p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"><p className="text-sm text-muted-foreground">已完成训练</p><p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{completed}<span className="ml-1 text-sm font-normal text-muted-foreground">次</span></p></button>
  </section>;
}

export function PreparationDashboard({ projects, profile, questionLibrary, history, onCreateJob, onOpenPrepare, onOpenProfile, onOpenResumePractice, onOpenLibrary, onOpenHistory, onContinueProjectTraining, onContinueIndependentTraining }: PreparationDashboardProps) {
  const confirmedExperiences = profile.experiences.filter(card => card.confirmed);
  const resumeSetCount = questionLibrary.resumeSets?.length ?? 0;
  const ongoingProject = firstOngoingProject(projects);
  const projectSessionIds = new Set(projects.flatMap(project => project.session ? [project.session.id] : []));
  const ongoingIndependent = history.find(session => session.status === "active" && !projectSessionIds.has(session.id));
  const sessions = [...history, ...projects.flatMap(project => project.session ? [project.session] : [])];
  const completedTrainingCount = new Set(sessions.filter(session => session.status === "completed").map(session => session.id)).size;
  const recent = sessions.reduce<InterviewSession | null>((latest, session) => !latest || session.createdAt > latest.createdAt ? session : latest, null);
  const currentProject = projects[0] ?? null;
  const activeSession = ongoingProject?.session ?? ongoingIndependent ?? null;
  const activeTitle = ongoingProject?.project.jobTitle || ongoingIndependent?.preparation.job.title || "当前训练";
  const remaining = activeSession ? Math.max(0, activeSession.questions.length - activeSession.currentQuestionIndex) : 0;

  let nextStep: ReactNode;
  if (activeSession) {
    const progress = `${Math.min(activeSession.currentQuestionIndex + 1, activeSession.questions.length || 1)} / ${activeSession.questions.length}`;
    nextStep = <NextStep eyebrow="继续这一轮" title={`${activeTitle} · 还剩 ${remaining} 题`} detail="从上次停下的位置继续。已有回答、跳过状态和点评都会保留。" actions={<><PrimaryAction icon={<Play size={16}/>} onClick={() => ongoingProject ? onContinueProjectTraining(ongoingProject.project) : onContinueIndependentTraining(ongoingIndependent!)}>继续训练</PrimaryAction><SecondaryAction onClick={onOpenPrepare}>查看岗位准备</SecondaryAction></>} aside={<><p className="text-sm text-muted-foreground">本轮进度</p><p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{progress}</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white"><span className="block h-full rounded-full bg-primary" style={{ width: `${activeSession.questions.length ? Math.min(100, Math.round(((activeSession.currentQuestionIndex + 1) / activeSession.questions.length) * 100)) : 0}%` }}/></div><p className="mt-4 text-sm leading-6 text-muted-foreground">训练在当前浏览器中保存，可随时返回。</p></>}/>;
  } else if (currentProject) {
    nextStep = <NextStep eyebrow="当前准备" title={`继续准备「${currentProject.jobTitle || "未命名岗位"}」`} detail="岗位资料、分析与训练在同一个工作台内衔接。先查看岗位分析，再决定下一轮训练。" actions={<><PrimaryAction onClick={onOpenPrepare}>打开岗位工作台</PrimaryAction>{confirmedExperiences.length > 0 && <SecondaryAction onClick={onOpenResumePractice}>准备简历面试题</SecondaryAction>}</>} aside={<><p className="text-sm text-muted-foreground">当前岗位</p><p className="mt-2 text-lg font-semibold text-foreground">{currentProject.company || "未填写公司"}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{currentProject.jobTitle || "未命名岗位"}</p><span className="mt-4 inline-block"><QuietLink onClick={onCreateJob}>新建另一个岗位</QuietLink></span></>}/>;
  } else if (confirmedExperiences.length > 0 && resumeSetCount === 0) {
    nextStep = <NextStep eyebrow="下一步准备" title={`${confirmedExperiences.length} 条经历已确认，可以开始练习`} detail="根据已确认经历整理一组简历面试题；未确认内容不会作为个人事实使用。" actions={<><PrimaryAction icon={<Sparkles size={16}/>} onClick={onOpenResumePractice}>生成简历面试题</PrimaryAction><SecondaryAction onClick={onCreateJob}>创建目标岗位</SecondaryAction></>} aside={<><span className="inline-flex rounded-lg bg-white p-2 text-emerald-700"><CheckCircle2 size={20}/></span><p className="mt-3 text-sm font-medium text-foreground">资料已就绪</p><p className="mt-1 text-sm leading-6 text-muted-foreground">确认后的经历会用于后续岗位准备。</p></>}/>;
  } else {
    nextStep = <NextStep eyebrow="开始准备" title="从真实经历或目标岗位开始" detail="整理个人资料、保存岗位要求，再进行针对性的模拟训练。每一步都会保留在当前浏览器。" actions={<><PrimaryAction onClick={onCreateJob}>创建目标岗位</PrimaryAction><SecondaryAction onClick={onOpenProfile}>整理个人资料</SecondaryAction></>} aside={<><p className="text-sm font-medium text-foreground">建议顺序</p><ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground"><li>1. 核对经历</li><li>2. 添加岗位资料</li><li>3. 开始训练</li></ol></>}/>;
  }

  return <div className="space-y-5">
    {nextStep}
    <PreparationSummary confirmed={confirmedExperiences.length} resumeSets={resumeSetCount} completed={completedTrainingCount} onOpenProfile={onOpenProfile} onOpenHistory={onOpenHistory}/>
    <section className="grid gap-4 border-t border-border pt-5 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="flex flex-wrap gap-3"><button onClick={onOpenProfile} className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]"><FileText size={17}/>个人资料</button><button onClick={onOpenLibrary} className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]"><BookOpenText size={17}/>浏览题库</button>{projects.length > 0 && <QuietLink onClick={onOpenPrepare}>管理岗位</QuietLink>}</div>
      {recent && <aside className="text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground">最近训练：</span>{recent.preparation.job.title || "独立训练"} · {recent.status === "active" ? "进行中" : "已完成"}</aside>}
    </section>
  </div>;
}
