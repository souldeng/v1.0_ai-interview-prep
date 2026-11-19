import { ArrowLeft, BookOpenCheck, BriefcaseBusiness, ChartNoAxesCombined, FileText, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { InterviewProject } from "../../lib/domain";
import { Badge } from "@/components/ui/badge";

export type JobWorkbenchModule = "materials" | "analysis" | "training";

export const jobWorkbenchModules: Array<{ id: JobWorkbenchModule; label: string; icon: LucideIcon }> = [
  { id: "materials", label: "岗位资料", icon: FileText },
  { id: "analysis", label: "岗位分析", icon: ChartNoAxesCombined },
  { id: "training", label: "面试训练", icon: BriefcaseBusiness },
];

export function isJobWorkbenchModule(value: string): value is JobWorkbenchModule {
  return jobWorkbenchModules.some(module => module.id === value);
}

export function canOpenWorkbenchModule(module: JobWorkbenchModule, hasPreparation: boolean, hasActiveSession: boolean, hasReport: boolean) {
  if (module === "analysis" || module === "training") return hasPreparation;
  return true;
}

interface JobWorkbenchProps {
  project: InterviewProject | null;
  activeModule: JobWorkbenchModule;
  hasPreparation: boolean;
  hasActiveSession: boolean;
  hasReport: boolean;
  navigationDisabled: boolean;
  onSelectModule: (module: JobWorkbenchModule) => void;
  onBackToJobs: () => void;
  onEditMaterials: () => void;
  onOpenLegacy: (page: "matrix" | "questions" | "interview" | "report" | "history") => void;
  materialsContent?: ReactNode;
  analysisContent?: ReactNode;
  trainingContent?: ReactNode;
  reviewContent?: ReactNode;
}

function EmptyWorkbench() {
  return <section className="max-w-xl rounded-2xl border border-border bg-white p-6"><span className="inline-flex rounded-xl bg-accent p-3 text-primary"><BookOpenCheck size={22}/></span><h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">先选择一个岗位</h1><p className="mt-3 text-[16px] leading-7 text-muted-foreground">岗位资料、分析和训练会保留在各自岗位中。请从准备页打开岗位，或先创建一个目标岗位。</p></section>;
}

export function JobWorkbench({ project, activeModule, hasPreparation, hasActiveSession, hasReport, navigationDisabled, onSelectModule, onBackToJobs, onEditMaterials, onOpenLegacy, materialsContent, analysisContent, trainingContent }: JobWorkbenchProps) {
  if (!project) return <EmptyWorkbench/>;
  const status = hasActiveSession ? "训练进行中" : hasReport ? "已有训练复盘" : hasPreparation ? "待开始训练" : "资料待补充";
  const statusClass = hasActiveSession ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground";
  return <div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><button onClick={onBackToJobs} disabled={navigationDisabled} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"><ArrowLeft size={15}/>岗位</button><span className="text-border">/</span><h1 className="truncate text-[26px] font-semibold tracking-[-0.03em] text-foreground">{project.jobTitle || "未命名岗位"}</h1><Badge className={`border-0 px-2.5 py-1 text-xs font-medium ${statusClass}`}>{status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{project.company || "未填写公司"}</p></div><button onClick={onEditMaterials} disabled={navigationDisabled} className="rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-muted-foreground transition-all hover:border-[#94A3B8] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">编辑岗位</button>
    </header>
    <nav aria-label="岗位准备模块" className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">{jobWorkbenchModules.map(module => { const Icon = module.icon; const active = activeModule === module.id; return <button key={module.id} role="tab" aria-selected={active} disabled={navigationDisabled} onClick={() => onSelectModule(module.id)} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-ring text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon size={17}/>{module.label}</button>; })}</nav>
    {activeModule === "training" && hasActiveSession && <div className="flex justify-end"><button onClick={() => onOpenLegacy("interview")} disabled={navigationDisabled} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">继续训练</button></div>}
    <div>
      {activeModule === "materials" && (materialsContent ?? <section className="rounded-xl border border-border bg-white p-6"><h2 className="text-xl font-semibold text-foreground">岗位资料</h2><p className="mt-3 text-[16px] leading-7 text-muted-foreground">补充岗位资料后，可以直接回到这里查看分析和训练。</p><button onClick={onEditMaterials} disabled={navigationDisabled} className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">编辑岗位资料</button></section>)}
      {activeModule === "analysis" && (analysisContent ?? <section className="rounded-xl border border-border bg-white p-6"><h2 className="text-xl font-semibold text-foreground">岗位分析</h2><p className="mt-3 text-[16px] leading-7 text-muted-foreground">当前岗位尚未生成准备材料，因此不能展示能力分析。</p><button onClick={() => onSelectModule("materials")} disabled={navigationDisabled} className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">补充岗位资料</button></section>)}
      {activeModule === "training" && (trainingContent ?? <section className="rounded-xl border border-border bg-white p-6"><h2 className="text-xl font-semibold text-foreground">面试训练</h2><p className="mt-3 text-[16px] leading-7 text-muted-foreground">当前岗位尚未生成可练习题目。补充资料并完成岗位分析后即可开始。</p><button onClick={() => onSelectModule("materials")} disabled={navigationDisabled} className="mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">补充岗位资料</button></section>)}
    </div>
  </div>;
}
