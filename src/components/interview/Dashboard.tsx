import { CalendarDays, ChevronRight, Clock3, FolderKanban, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { InterviewProject } from "../../lib/domain";

export function Dashboard({ projects, onCreate, onOpen, onEdit, onDelete }: { projects: InterviewProject[]; onCreate: () => void; onOpen: (project: InterviewProject) => void; onEdit: (project: InterviewProject) => void; onDelete: (project: InterviewProject) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => projects.filter(project => `${project.company}\n${project.jobTitle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [projects, query]);
  return <div className="space-y-6">
    <section className="flex flex-col justify-between gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-center">
      <div><p className="mb-2 text-sm font-medium text-blue-700">我的岗位</p><h2 className="text-2xl font-semibold tracking-tight text-slate-950">围绕一个岗位，完成一次准备</h2><p className="mt-3 max-w-2xl text-slate-600">岗位、资料与训练记录保存在当前浏览器，可随时继续。</p></div>
      <button onClick={onCreate} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800"><Plus size={18}/>创建岗位</button>
    </section>
    {projects.length > 0 && <label className="relative block max-w-md"><Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索公司或岗位名称" className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-blue-700"/></label>}
    {projects.length === 0 ? <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><FolderKanban className="mx-auto text-slate-400" size={36}/><h3 className="mt-4 text-lg font-semibold">还没有岗位项目</h3><p className="mt-2 text-sm text-slate-600">从一份真实 JD 开始，建立第一套针对性准备方案。</p><button onClick={onCreate} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800"><Plus size={18}/>创建第一个岗位</button></section> : filtered.length ? <div className="grid gap-4 lg:grid-cols-2">{filtered.map(project => <ProjectCard key={project.id} project={project} onOpen={() => onOpen(project)} onEdit={() => onEdit(project)} onDelete={() => onDelete(project)} />)}</div> : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">没有匹配的岗位。</p>}
  </div>;
}

function formatDate(value: string | null) {
  if (!value) return "尚未练习";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function ProjectCard({ project, onOpen, onEdit, onDelete }: { project: InterviewProject; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const progress = project.totalQuestions > 0 ? Math.round(project.completedQuestions / project.totalQuestions * 100) : 0;
  return <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-md">
    <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-blue-700">{project.company || "未填写公司"}</p><h3 className="mt-1 text-xl font-semibold text-slate-950">{project.jobTitle}</h3></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{project.status === "completed" ? "已完成" : project.status === "practicing" ? "准备中" : "待开始"}</span></div>
    <div className="mt-6 flex items-center justify-between text-sm"><span className="text-slate-600">训练进度</span><b className="text-slate-900">{project.completedQuestions} / {project.totalQuestions}</b></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-700" style={{ width: `${progress}%` }} /></div>
    <div className="mt-5 grid gap-2 text-xs text-slate-600 sm:grid-cols-2"><span className="flex items-center gap-2"><CalendarDays size={14}/>创建：{formatDate(project.createdAt)}</span><span className="flex items-center gap-2"><Clock3 size={14}/>最后练习：{formatDate(project.lastPracticedAt)}</span></div>
    <button onClick={onOpen} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-200">查看岗位<ChevronRight size={16}/></button><div className="mt-3 flex gap-4 text-sm"><button onClick={onEdit} className="text-slate-600 hover:text-slate-950">编辑岗位</button><button onClick={onDelete} className="text-red-600 hover:text-red-700">删除项目</button></div>
  </article>;
}
