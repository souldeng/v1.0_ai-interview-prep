import { CalendarDays, ChevronRight, Clock3, FolderKanban, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { InterviewProject } from "../../lib/domain";

export function Dashboard({ projects, onCreate, onOpen, onEdit, onDelete, activeProjectId }: { projects: InterviewProject[]; onCreate: () => void; onOpen: (project: InterviewProject) => void; onEdit: (project: InterviewProject) => void; onDelete: (project: InterviewProject) => void; activeProjectId?: string | null }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => projects.filter(project => `${project.company}\n${project.jobTitle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [projects, query]);
  return <div className="space-y-6">
    <section className="flex flex-col justify-between gap-5 rounded-[14px] border border-border bg-white p-6 md:flex-row md:items-center">
      <div><p className="mb-2 text-[14px] font-medium text-primary">目标岗位</p><h2 className="text-[22px] font-semibold tracking-tight text-foreground">按岗位管理准备</h2><p className="mt-3 max-w-2xl text-[16px] leading-7 text-muted-foreground">每个岗位保留自己的 JD、资料和训练；简历与已确认经历仍在个人资料专项中共用。</p></div>
      <button onClick={onCreate} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-[16px] font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98]"><Plus size={18}/>创建岗位</button>
    </section>
    {projects.length > 0 && <label className="relative block max-w-md"><Search className="pointer-events-none absolute left-3 top-3 text-muted-foreground" size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索公司或岗位名称" className="w-full rounded-md border border-border bg-white py-2.5 pl-10 pr-3 text-[16px] text-foreground outline-none transition-colors focus:border-ring"/></label>}
    {projects.length === 0 ? <section className="rounded-[14px] border border-dashed border-border bg-white px-6 py-16 text-center"><FolderKanban className="mx-auto text-muted-foreground" size={36}/><h3 className="mt-4 text-[18px] font-semibold text-foreground">还没有岗位资料</h3><p className="mt-2 text-[16px] text-muted-foreground">从一份真实 JD 开始，建立第一套针对性准备方案。</p><button onClick={onCreate} className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[16px] font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98]"><Plus size={18}/>创建第一个岗位</button></section> : filtered.length ? <div className="grid gap-4 lg:grid-cols-2">{filtered.map(project => <ProjectCard key={project.id} project={project} active={project.id === activeProjectId} onOpen={() => onOpen(project)} onEdit={() => onEdit(project)} onDelete={() => onDelete(project)} />)}</div> : <p className="rounded-[14px] border border-dashed border-border bg-white p-6 text-[16px] text-muted-foreground">没有匹配的岗位。</p>}
  </div>;
}

function formatDate(value: string | null) {
  if (!value) return "尚未练习";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function ProjectCard({ project, active, onOpen, onEdit, onDelete }: { project: InterviewProject; active: boolean; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const progress = project.totalQuestions > 0 ? Math.round(project.completedQuestions / project.totalQuestions * 100) : 0;
  return <article className={`rounded-[14px] border bg-white p-6 transition-all hover:bg-muted ${active ? "border-ring shadow-[0_0_0_3px_rgba(79,70,229,0.10)]" : "border-border hover:border-[#94A3B8]"}`}>
    <div className="flex items-start justify-between gap-4"><div><p className="text-[14px] text-primary">{project.company || "未填写公司"}</p><h3 className="mt-1 text-[18px] font-semibold text-foreground">{project.jobTitle}</h3></div><span className="rounded-full bg-background px-3 py-1 text-[13px] text-muted-foreground">{active ? "当前岗位" : project.status === "completed" ? "已完成" : project.status === "practicing" ? "准备中" : "待开始"}</span></div>
    <div className="mt-6 flex items-center justify-between text-[14px]"><span className="text-muted-foreground">训练进度</span><b className="text-foreground">{project.completedQuestions} / {project.totalQuestions}</b></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
    <div className="mt-5 grid gap-2 text-[13px] text-muted-foreground sm:grid-cols-2"><span className="flex items-center gap-2"><CalendarDays size={14}/>创建：{formatDate(project.createdAt)}</span><span className="flex items-center gap-2"><Clock3 size={14}/>最后练习：{formatDate(project.lastPracticedAt)}</span></div>
    <button onClick={onOpen} className="mt-6 inline-flex items-center gap-2 rounded-md bg-background px-4 py-2 text-[16px] font-medium text-foreground transition-all hover:bg-accent active:scale-[0.98]">查看岗位<ChevronRight size={16}/></button><div className="mt-3 flex gap-4 text-[14px]"><button onClick={onEdit} className="text-muted-foreground transition-colors hover:text-foreground">编辑岗位</button><button onClick={onDelete} className="text-destructive transition-colors hover:text-destructive">删除项目</button></div>
  </article>;
}
