import { ArrowLeft, Download, FileText, MessageSquareText, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { currentCoachReview, latestAnswer } from "../../lib/coaching";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { InterviewTurn } from "../../lib/domain";
import { trainingQuestionStates, type TrainingQuestionState, type TrainingRecord } from "../../lib/trainingRecords";

function StatusPill({ status }: { status: TrainingQuestionState["status"] }) {
  const style = status === "answered" ? "bg-emerald-50 text-emerald-700" : status === "skipped" ? "bg-amber-50 text-amber-800" : "bg-card text-muted-foreground";
  const label = status === "answered" ? "已回答" : status === "skipped" ? "已跳过" : "未开始";
  return <span className={`inline-flex rounded-full px-2 py-1 text-[12px] font-medium ${style}`}>{label}</span>;
}

function formatDate(value?: string) {
  if (!value) return "时间未记录";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date) : "时间未记录";
}

function CoachFeedbackView({ turn }: { turn: InterviewTurn }) {
  const feedback = currentCoachReview(turn)?.feedback ?? turn.aiCoach;
  if (!feedback) return <p className="mt-3 text-[13px] leading-6 text-muted-foreground">AI 点评：本题未保存点评。</p>;
  const points = [...feedback.issues, ...feedback.suggestions].filter(Boolean);
  return <section className="mt-4"><h4 className="text-[12px] font-semibold text-muted-foreground">AI 点评</h4>{points.length ? <ul className="mt-2 space-y-2 text-[13px] leading-6 text-muted-foreground">{points.map((point, index) => <li key={`${point}-${index}`} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60"/>{point}</li>)}</ul> : <p className="mt-2 text-[13px] leading-6 text-muted-foreground">本次点评未提供可展示的改进点。</p>}</section>;
}

function TurnReview({ turn, index }: { turn: InterviewTurn; index: number }) {
  const answer = latestAnswer(turn);
  return <article className="border-b border-border pb-5 last:border-b-0 last:pb-0">
    <p className="text-[13px] font-semibold text-foreground">{turn.followedUp ? "追问" : `回答 ${index + 1}`}</p>
    <p className="mt-2 text-[14px] leading-6 text-foreground">{turn.question}</p>
    <h4 className="mt-4 text-[12px] font-semibold text-muted-foreground">原始回答</h4>
    <p className="mt-2 whitespace-pre-wrap text-[14px] leading-7 text-muted-foreground">{turn.answer || "（未填写）"}</p>
    {turn.revisions?.length ? <section className="mt-4"><h4 className="text-[12px] font-semibold text-muted-foreground">重答版本</h4><ol className="mt-2 space-y-3">{turn.revisions.map((revision, revisionIndex) => <li key={`${revision.createdAt}-${revisionIndex}`}><p className="text-[12px] text-muted-foreground">第 {revisionIndex + 1} 次 · {formatDate(revision.createdAt)}</p><p className="mt-1 whitespace-pre-wrap text-[14px] leading-7 text-muted-foreground">{revision.answer}</p></li>)}</ol></section> : null}
    {answer !== turn.answer && <p className="mt-3 text-[12px] text-muted-foreground">当前用于点评的版本为最近一次重答。</p>}
    <CoachFeedbackView turn={turn}/>
    {turn.finalAnswer?.trim() ? <section className="mt-4 rounded-lg bg-card p-3"><h4 className="text-[12px] font-semibold text-muted-foreground">用户保存的最终回答 · {formatDate(turn.finalAnswerUpdatedAt)}</h4><p className="mt-2 whitespace-pre-wrap text-[14px] leading-7 text-muted-foreground">{turn.finalAnswer.trim()}</p></section> : <p className="mt-4 text-[13px] text-muted-foreground">最终回答：未保存。</p>}
  </article>;
}

function Stat({ value, label, hint }: { value: number; label: string; hint: string }) {
  return <article className="rounded-xl border border-border bg-white p-4"><p className="text-[22px] font-semibold text-foreground">{value}</p><p className="mt-1 text-[14px] font-medium text-muted-foreground">{label}</p><p className="mt-1 text-[11px] text-muted-foreground">{hint}</p></article>;
}

export function TrainingSessionReview({ record, onBack, onContinue, onExport, onSaveFinal }: { record: TrainingRecord; onBack: () => void; onContinue: () => void; onExport: (format: "docx" | "pdf") => void; onSaveFinal?: (questionId: string, value: string) => string | null }) {
  const questions = trainingQuestionStates(record.session);
  const initialIndex = questions.findIndex(item => item.turns.length > 0);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex >= 0 ? initialIndex : Math.min(record.session.currentQuestionIndex, Math.max(0, questions.length - 1)));
  const selected = questions[selectedIndex] ?? questions[0];
  const incomplete = record.session.status === "active";
  const currentQuestion = record.session.questions[record.session.currentQuestionIndex];
  const latestTurn = selected?.turns.at(-1);
  const [finalDraft, setFinalDraft] = useState(latestTurn?.finalAnswer ?? "");
  const [finalNotice, setFinalNotice] = useState("");
  useEffect(() => { setFinalDraft(latestTurn?.finalAnswer ?? ""); setFinalNotice(""); }, [selected?.index]);
  function saveFinal() {
    if (!onSaveFinal || !selected) return;
    const message = onSaveFinal(selected.question.id, finalDraft);
    setFinalNotice(message ?? "已保存为本题当前确认答案；历史原答与重答快照保留。");
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><button onClick={onBack} className="inline-flex items-center gap-2 text-[14px] font-medium text-muted-foreground transition-all hover:text-foreground active:scale-[0.98]"><ArrowLeft size={16}/>返回训练记录</button><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => onExport("docx")} className="text-[14px] font-medium"><Download size={16}/>导出 DOCX</Button><Button variant="outline" onClick={() => onExport("pdf")} className="text-[14px] font-medium"><Download size={16}/>导出 PDF</Button>{incomplete && <Button data-cta="primary" onClick={onContinue}><Play size={16}/>继续训练</Button>}</div></div>

    <section className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[16px] font-semibold text-foreground">{record.title}</p><p className="mt-1 text-[14px] text-muted-foreground">{record.project?.jobTitle ? `${record.project.jobTitle} · ` : ""}来源：{record.sourceLabel} · 共 {record.totals.total} 题</p></div><div className="flex flex-wrap items-center gap-2">{record.job && <span className="rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-primary">岗位专项 · {record.job.name}</span>}<span className={`rounded-full px-3 py-1.5 text-[13px] font-medium ${incomplete ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{incomplete ? "本轮未完成 · 草稿保留" : "本轮已完成"}</span></div></section>

    <section aria-label="本轮训练统计" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat value={record.totals.total} label="总题数" hint="按练习顺序编号"/><Stat value={record.totals.answered} label="已回答" hint={`其中 ${record.totals.finalAnswers} 题保存最终回答`}/><Stat value={record.totals.skipped} label="已跳过" hint="草稿仍可返回继续作答"/><Stat value={record.totals.unfinished} label="未开始" hint="不计入已回答"/></section>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-label="本轮题目状态" className="overflow-hidden rounded-[14px] border border-border bg-white"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><p className="text-[13px] font-semibold text-muted-foreground">{record.totals.total} 题 = 已回答 {record.totals.answered} + 已跳过 {record.totals.skipped} + 未开始 {record.totals.unfinished}</p><p className="text-[12px] text-muted-foreground">按练习顺序查看</p></div>{questions.map(item => <button key={item.question.id} onClick={() => setSelectedIndex(item.index)} className={`flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 ${selected?.index === item.index ? "bg-card" : "hover:bg-muted"}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[12px] font-semibold ${selected?.index === item.index ? "bg-accent text-primary" : "bg-card text-muted-foreground"}`}>{item.index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium text-foreground">{item.question.text}</span><span className="mt-1 block text-[11px] text-muted-foreground">{item.status === "answered" ? item.finalAnswer ? "最终回答已保存" : "已提交，未保存最终回答" : item.status === "skipped" ? "已跳过，草稿如有已保留" : "尚未作答"}</span></span><StatusPill status={item.status}/></button>)}</section>

      <aside aria-label="本题回答与点评" className="rounded-[14px] border border-border bg-white p-4"><div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground"><MessageSquareText size={17} className="text-primary"/>第 {(selected?.index ?? 0) + 1} 题 · 回答与点评</h2>{selected && <StatusPill status={selected.status}/>}</div>{selected?.turns.length ? <div className="mt-4 space-y-5">{selected.turns.map((turn, index) => <TurnReview key={`${turn.questionId}-${index}`} turn={turn} index={index}/>)}{onSaveFinal && <details className="rounded-[10px] border border-border bg-card p-3"><summary className="cursor-pointer text-[14px] font-medium text-foreground">更新当前确认答案</summary><p className="mt-2 text-[12px] leading-5 text-muted-foreground">保存后成为本题当前确认答案；历史原答与重答快照保留，不会被覆盖。</p><Textarea aria-label="复盘更新确认答案" value={finalDraft} maxLength={12000} onChange={event => setFinalDraft(event.target.value)} placeholder="整理后保存你认可的回答…" className="mt-2 min-h-28 w-full bg-white"/><Button data-cta="primary" onClick={saveFinal} disabled={!finalDraft.trim()} className="mt-2">保存当前确认答案</Button>{finalNotice && <p role="status" className="mt-2 text-[13px] leading-5 text-emerald-700">{finalNotice}</p>}</details>}</div> : <div className="mt-4 rounded-lg bg-card p-4"><FileText size={18} className="text-muted-foreground"/><p className="mt-2 text-[14px] font-medium text-foreground">{selected?.status === "skipped" ? "本题已跳过" : "本题尚未开始"}</p><p className="mt-1 text-[13px] leading-6 text-muted-foreground">没有已提交的回答或 AI 点评。继续训练会回到会话实际保存的进度。</p></div>}</aside>
    </div>

    {incomplete ? <section className="flex flex-wrap items-center gap-4 rounded-[14px] border border-border bg-white p-4"><span className="grid h-9 w-9 place-items-center rounded-[9px] bg-amber-50 text-amber-800"><Play size={16}/></span><div className="min-w-0 flex-1"><h2 className="text-[15px] font-semibold text-foreground">本轮尚未结束</h2><p className="mt-1 text-[13px] leading-6 text-muted-foreground">{currentQuestion ? `继续训练会从已保存的第 ${record.session.currentQuestionIndex + 1} 题进入。` : "本轮题目已处理，可回到训练完成本轮。"} 已回答、已跳过和未开始保持独立状态。</p></div><Button data-cta="primary" onClick={onContinue}><Play size={16}/>继续训练</Button></section> : <section className="rounded-[14px] border border-border bg-white p-4 text-[13px] leading-6 text-muted-foreground">本轮已完成。导出只使用本轮现有题目、原始回答、重答、最终答案和已保存的本地训练报告；未保存的 AI 点评不会出现在导出中。</section>}
  </div>;
}
