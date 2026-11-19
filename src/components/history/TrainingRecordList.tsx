import { Check, Clock3, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import type { TrainingRecord } from "../../lib/trainingRecords";

function formatTrainingDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) : "日期未记录";
}

function StatusPill({ completed }: { completed: boolean }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[12px] font-medium ${completed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{completed ? "已完成" : "未完成"}</span>;
}

function Progress({ record }: { record: TrainingRecord }) {
  const completed = record.totals.answered + record.totals.skipped;
  const width = record.totals.total ? Math.max(4, (completed / record.totals.total) * 100) : 0;
  return <div className="min-w-[112px] flex-1 md:min-w-0 md:flex-none">
    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`已处理 ${completed} / ${record.totals.total} 题`}><span className="rounded-full bg-primary" style={{ width: `${width}%` }}/></div>
    <p className="mt-1.5 text-[12px] text-muted-foreground">已处理 {completed} / {record.totals.total}</p>
  </div>;
}

function Count({ label, value }: { label: string; value: number }) {
  return <div><p className="text-[15px] font-semibold text-foreground">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>;
}

export function TrainingRecordList({ records, onOpen, onContinue }: { records: TrainingRecord[]; onOpen: (record: TrainingRecord) => void; onContinue: (record: TrainingRecord) => void }) {
  const completed = records.filter(record => record.session.status === "completed");
  const active = records.filter(record => record.session.status === "active");
  const finalAnswers = records.reduce((count, record) => count + record.totals.finalAnswers, 0);
  const continuation = active[0];
  const [showAllRecords, setShowAllRecords] = useState(false);
  const visibleRecords = showAllRecords ? records : records.slice(0, 5);

  return <div className="space-y-5">
    <section aria-label="训练记录统计" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-xl border border-border bg-white p-4"><p className="text-[22px] font-semibold text-foreground">{records.length} 次</p><p className="mt-1 text-[14px] font-medium text-muted-foreground">训练次数</p><p className="mt-1 text-[12px] text-muted-foreground">岗位与独立练习合计</p></article>
      <article className="rounded-xl border border-border bg-white p-4"><p className="text-[22px] font-semibold text-foreground">{completed.length} 次</p><p className="mt-1 text-[14px] font-medium text-muted-foreground">已完成</p><p className="mt-1 text-[12px] text-muted-foreground">题目已全部处理</p></article>
      <article className="rounded-xl border border-border bg-white p-4"><p className="text-[22px] font-semibold text-foreground">{active.length} 次</p><p className="mt-1 text-[14px] font-medium text-muted-foreground">未完成</p><p className="mt-1 text-[12px] text-muted-foreground">可回到实际进度继续</p></article>
      <article className="rounded-xl border border-border bg-white p-4"><p className="text-[22px] font-semibold text-foreground">{finalAnswers} 份</p><p className="mt-1 text-[14px] font-medium text-muted-foreground">已保存最终回答</p><p className="mt-1 text-[12px] text-muted-foreground">只计用户主动保存版本</p></article>
    </section>

    <section aria-label="训练会话列表" className="overflow-hidden rounded-[14px] border border-border bg-white">
      <div className="hidden grid-cols-[minmax(0,1fr)_74px_128px_168px_80px] gap-3 border-b border-border px-4 py-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground md:grid">
        <span>题组与来源</span><span>日期</span><span>作答进度</span><span>已回答 / 跳过 / 未开始</span><span>操作</span>
      </div>
      {records.length === 0 ? <div className="px-5 py-12 text-center"><p className="text-[16px] font-medium text-foreground">还没有训练记录</p><p className="mt-2 text-[14px] text-muted-foreground">开始一次题库或岗位训练后，会在这里保留真实进度和回答。</p></div> : visibleRecords.map(record => {
        const isCompleted = record.session.status === "completed";
        return <article key={record.id} className="border-b border-border px-4 py-3 last:border-b-0 md:grid md:grid-cols-[minmax(0,1fr)_74px_128px_168px_80px] md:items-center md:gap-3">
          <div className="min-w-0"><p className="truncate text-[15px] font-semibold text-foreground" title={record.title}>{record.title}</p><p className="mt-1 text-[12px] text-muted-foreground md:truncate">{record.project?.jobTitle && record.kind !== "岗位训练" ? `${record.project.jobTitle} · ` : ""}来源：{record.sourceLabel}</p></div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 md:mt-0 md:contents">
            <p className="text-[12px] font-medium text-muted-foreground">{formatTrainingDate(record.activityAt)}</p>
            <Progress record={record}/>
            <div className="flex gap-3"><Count label="已答" value={record.totals.answered}/><Count label="跳过" value={record.totals.skipped}/><Count label="未开始" value={record.totals.unfinished}/></div>
            <div className="flex items-center gap-2 md:flex-col md:items-start"><StatusPill completed={isCompleted}/><button onClick={() => onOpen(record)} className="text-[13px] font-medium text-primary transition-all hover:text-primary/80 active:scale-[0.98]">查看复盘</button></div>
          </div>
        </article>;
      })}
      {records.length > 5 && <div className="border-t border-border px-4 py-3"><Button variant="outline" onClick={() => setShowAllRecords(current => !current)} className="text-[14px] font-medium">{showAllRecords ? "收起，只看最近 5 条" : `查看全部 ${records.length} 条记录`}</Button>{!showAllRecords && <span className="ml-3 text-[13px] text-muted-foreground">当前显示最近 5 条；统计与复盘入口按全部记录计算。</span>}</div>}
      <div className="bg-card px-4 py-3 text-[12px] leading-5 text-muted-foreground">统计口径与训练总结一致：总题数 = 已回答 + 已跳过 + 未开始；最终回答是已回答的子集。岗位会话与其历史副本按会话 ID 合并显示，不重复计数。</div>
    </section>

    {continuation && <section aria-label="继续进行中的训练" className="flex flex-wrap items-center gap-4 rounded-[14px] border border-border bg-white p-4">
      <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-accent text-primary"><Play size={18}/></span>
      <div className="min-w-0 flex-1"><h2 className="text-[16px] font-semibold text-foreground">继续进行中的训练</h2><p className="mt-1 text-[14px] text-muted-foreground"><span className="font-medium">{continuation.title}</span> · 已答 {continuation.totals.answered} / {continuation.totals.total}，跳过 {continuation.totals.skipped}，未开始 {continuation.totals.unfinished}</p></div>
      <Button data-cta="primary" onClick={() => onContinue(continuation)}><Play size={16}/>继续训练</Button>
    </section>}
  </div>;
}
