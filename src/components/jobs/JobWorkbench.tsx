import { BookOpenCheck, BriefcaseBusiness, ChartNoAxesCombined, FileText, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { InterviewProject } from "../../lib/domain";
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
  return <section className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><span className="inline-flex rounded-xl bg-blue-50 p-3 text-blue-700"><BookOpenCheck size={22}/></span><h2 className="mt-5 text-xl font-semibold text-slate-950">先选择一个岗位</h2><p className="mt-3 leading-7 text-slate-600">岗位准备只展示已存在的项目，不会在这里重复创建岗位。请从“我的岗位”打开一个项目，或先创建新岗位。</p></section>;
}

export function JobWorkbench({ project, activeModule, hasPreparation, hasActiveSession, hasReport, navigationDisabled, onSelectModule, onBackToJobs, onEditMaterials, onOpenLegacy, materialsContent, analysisContent, trainingContent, reviewContent }: JobWorkbenchProps) {
  if (!project) return <EmptyWorkbench/>;
  
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-slate-500">当前岗位</p><h2 className="text-lg font-semibold text-slate-950">{project.jobTitle}</h2></div><button onClick={onBackToJobs} disabled={navigationDisabled} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">返回岗位列表</button></div>
    {activeModule === "materials" && <section className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="text-sm leading-6 text-blue-950">{hasActiveSession ? "已有进行中的训练，可以继续；也可先查看岗位分析。" : "整理资料后，先查看岗位分析，再开始训练。"}</p><div className="mt-3 flex flex-wrap gap-3"><button onClick={() => onSelectModule(hasActiveSession ? "training" : "analysis")} disabled={navigationDisabled} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{hasActiveSession ? "继续当前训练" : "查看岗位分析"}</button>{hasActiveSession && <button onClick={() => onSelectModule("analysis")} disabled={navigationDisabled} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700 disabled:opacity-50">查看岗位分析</button>}</div></section>}
    <nav aria-label="岗位准备模块" className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{jobWorkbenchModules.map(module => { const Icon = module.icon; const active = activeModule === module.id; return <button key={module.id} disabled={navigationDisabled} onClick={() => onSelectModule(module.id)} className={`flex min-w-24 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}><Icon size={16}/>{module.label}</button>; })}</nav>
    {activeModule === "materials" && (materialsContent ?? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">岗位资料</h2><p className="mt-3 leading-7 text-slate-600">当前项目资料仍保存在原字段中。可以继续使用旧版编辑入口。</p><button onClick={onEditMaterials} disabled={navigationDisabled} className="mt-5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">编辑岗位材料</button></section>)}
    {activeModule === "analysis" && (analysisContent ?? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">岗位分析</h2><p className="mt-3 leading-7 text-slate-600">当前项目尚未生成准备材料，因此无法展示能力矩阵。</p><button onClick={() => onSelectModule("analysis")} disabled={!hasPreparation || navigationDisabled} className="mt-5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">查看岗位分析</button></section>)}
    {activeModule === "training" && (trainingContent ?? <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">面试训练</h2><p className="mt-3 leading-7 text-slate-600">当前项目尚未生成题目，因此暂时无法训练。</p><div className="mt-5 flex flex-wrap gap-3"><button onClick={() => onSelectModule("materials")} disabled={!hasPreparation || navigationDisabled} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">补充岗位资料</button><button onClick={() => onSelectModule("training")} disabled={!hasActiveSession || navigationDisabled} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">继续当前训练</button></div></section>)}
  </div>;
}
