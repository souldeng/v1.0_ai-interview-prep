import { ArrowRight, BriefcaseBusiness } from "lucide-react";

export interface JobQuestionStat { id: string; name: string; total: number; answered: number; unanswered: number }

/**
 * 岗位专项训练入口：只展示现有岗位与其关联题数量，点击后复用题库岗位筛选。
 * 不做推荐、不生成题目、不调用模型；没有关联题时显示空状态而不是伪造题目。
 */
export function JobSpecialtyTraining({ jobs, activeJobId, disabled, onOpen, onCreateJob }: {
  jobs: JobQuestionStat[];
  activeJobId: string;
  disabled: boolean;
  onOpen: (projectId: string) => void;
  onCreateJob: () => void;
}) {
  if (!jobs.length) {
    return <section aria-label="岗位专项训练" className="rounded-[16px] border border-border bg-white p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-accent text-primary"><BriefcaseBusiness size={18}/></span>
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold text-foreground">还没有岗位</h2>
          <p className="mt-1 text-[14px] leading-6 text-muted-foreground">先创建目标岗位，再在题库录入或批量导入时把题目关联到该岗位。</p>
          <button onClick={onCreateJob} disabled={disabled} className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-[14px] font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">创建岗位</button>
        </div>
      </div>
    </section>;
  }
  const total = jobs.reduce((sum, job) => sum + job.total, 0);
  return <section aria-label="岗位专项训练" className="rounded-[16px] border border-border bg-white p-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-[20px] font-semibold text-foreground">岗位专项训练</h2>
        <p className="mt-1 text-[13px] leading-6 text-muted-foreground">选择岗位后只显示该岗位关联的题目；共 {total} 道。</p>
      </div>
      <button onClick={onCreateJob} disabled={disabled} className="rounded-md border border-border bg-white px-3 py-2 text-[13px] text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">新建岗位</button>
    </div>
    <ul className="mt-4 space-y-2">
      {jobs.map(job => {
        const active = activeJobId === job.id;
        return <li key={job.id}>
          <button aria-pressed={active} onClick={() => onOpen(job.id)} disabled={disabled} className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-[12px] border px-4 py-3 text-left transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-ring bg-amber-50" : "border-border bg-white hover:bg-muted"}`}>
            <span className="min-w-0">
              <span className="block truncate text-[16px] font-medium text-foreground">{job.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{job.total ? `关联题 ${job.total} 道 · 已答 ${job.answered} · 未答 ${job.unanswered}` : "暂无关联题"}</span>
            </span>
            <span className={`inline-flex shrink-0 items-center gap-1 text-[13px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}>{active ? "当前筛选" : "查看题目"}<ArrowRight size={14}/></span>
          </button>
        </li>;
      })}
    </ul>
    {total === 0 && <p className="mt-3 rounded-[10px] bg-card p-3 text-[13px] leading-6 text-muted-foreground">这些岗位还没有关联题。到「手动题目与预测题」录入或批量导入时，为题目选择岗位即可在这里看到。</p>}
  </section>;
}
