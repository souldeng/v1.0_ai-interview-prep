import { useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, Lightbulb, Save, Sparkles } from "lucide-react";
import type { InterviewSession } from "../../lib/domain";
import { currentCoachReview, evaluateEvidence, isKnowledgeQuestion, latestAnswer, questionForTurn } from "../../lib/coaching";
import { loadDrafts, saveDraft } from "../../lib/drafts";
import { displayQuestionText } from "../../lib/interviewRecordParser";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface AnswerReviewProps {
  session: InterviewSession;
  onRevise: (index: number, answer: string) => string | null;
  onSaveFinal: (index: number, answer: string) => string | null;
  onUnsaved: (value: boolean) => void;
  onRequestCoach?: (index: number) => Promise<string | null>;
  modelAvailable?: boolean;
  coachPending?: boolean;
  turnIndex?: number;
  onContinue?: () => void;
  /** 单题练习结束流程简化：提供时以「完成训练」替代「下一题」，跳过冗余确认页。 */
  onFinish?: () => void;
  onExit?: () => void;
  onReturnToSource?: () => void;
}

const button = "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-[16px] font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const secondary = `${button} border border-border bg-white text-muted-foreground hover:bg-muted`;
const primary = `${button} bg-primary text-white hover:bg-primary/90`;

function TrainingHeader({ session, onExit, disabled }: Pick<AnswerReviewProps, "session" | "onExit"> & { disabled: boolean }) {
  return <header className="border-b border-border bg-card">
    <div className="mx-auto flex w-full max-w-[1376px] items-center justify-between gap-4 px-6 py-4 lg:px-8">
      <Button variant="outline" onClick={onExit} disabled={!onExit || disabled}><ArrowLeft size={18}/>退出训练</Button>
      <div className="min-w-0 text-right">
        <p className="truncate text-[14px] text-muted-foreground">第 {session.currentQuestionIndex + 1} / {session.questions.length} 题</p>
        <p className="truncate text-[16px] font-medium text-foreground">{session.preparation.job.title || "模拟训练"}</p>
      </div>
    </div>
  </header>;
}

export function AnswerReview({ session, onRevise, onSaveFinal, onUnsaved, onRequestCoach, modelAvailable = false, coachPending = false, turnIndex, onContinue, onFinish, onExit, onReturnToSource }: AnswerReviewProps) {
  const index = turnIndex ?? session.turns.length - 1;
  const turn = session.turns[index];
  const retryKey = `retry:${session.id}:${index}`;
  const finalKey = `final:${session.id}:${index}`;
  const [retry, setRetry] = useState(() => loadDrafts()[retryKey] ?? "");
  const [finalAnswer, setFinalAnswer] = useState(() => loadDrafts()[finalKey] ?? turn?.finalAnswer ?? "");
  const [mode, setMode] = useState<"feedback" | "retry">("feedback");
  const [notice, setNotice] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  if (!turn) return null;

  const question = questionForTurn(session, turn);
  const coach = currentCoachReview(turn)?.feedback;
  const fallback = evaluateEvidence(latestAnswer(turn), question, session.preparation);
  const suggestions = coach?.issues?.slice(0, 3) ?? fallback.improvement.split(/。\s*/).filter(Boolean).slice(0, 3);
  const referenceAnswer = coach?.optimizedExample || coach?.answerStructure || fallback.referenceAnswer;
  const versions = [{ answer: turn.answer, createdAt: session.createdAt }, ...(turn.revisions ?? [])];
  const failure = turn.coachFailure?.answerVersion === versions.length ? turn.coachFailure.message : null;

  function persist(key: string, value: string, setter: (value: string) => void) {
    setter(value);
    try { saveDraft(key, value); setSaveFailed(false); onUnsaved(false); }
    catch (error) { setSaveFailed(true); onUnsaved(true); setNotice(error instanceof Error ? error.message : "草稿未保存，请保留当前页面后重试。"); }
  }
  function saveRetry() {
    const error = onRevise(index, retry);
    if (error) { setNotice(error); return; }
    persist(retryKey, "", setRetry);
    setNotice("本次重答已保存，原回答仍可查看。");
    setMode("feedback");
  }
  function saveFinal() {
    const error = onSaveFinal(index, finalAnswer);
    if (error) { setNotice(error); return; }
    setNotice("最终确认答案已保存；原回答和重答未被覆盖。");
  }
  async function requestAdvice() {
    if (!onRequestCoach) return;
    const message = await onRequestCoach(index);
    if (message) setNotice(message);
  }

  if (mode === "retry") return <div className="min-h-screen bg-background">
    <TrainingHeader session={session} onExit={onExit} disabled={coachPending || saveFailed}/>
    <main className="mx-auto w-full max-w-[1376px] p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><h1 className="text-[24px] font-semibold tracking-tight text-foreground">再答一次</h1><span className="rounded-full bg-amber-50 px-3 py-1 text-[13px] font-medium text-primary">第 {versions.length + 1} 版</span></div>
        <p className="text-[14px] text-muted-foreground">只保留你认可的一版作为最终回答，原回答始终保留</p>
      </div>
      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="overflow-hidden rounded-[14px] border border-border bg-white">
          <div className="border-b border-border px-5 py-4"><p className="text-[14px] font-medium text-muted-foreground">当前问题</p><h2 className="mt-1 whitespace-pre-wrap text-[18px] font-semibold leading-7 text-foreground">{displayQuestionText(turn.question)}</h2></div>
          <div className="p-5"><label htmlFor="retry-answer" className="text-[16px] font-semibold text-foreground">重新组织你的回答</label><Textarea id="retry-answer" aria-label="同题重答" maxLength={12000} value={retry} onChange={event => persist(retryKey, event.target.value, setRetry)} placeholder="根据建议重新组织回答…" className="mt-3 min-h-[360px] w-full resize-y bg-white" disabled={coachPending}/><p className="mt-2 text-[13px] text-muted-foreground">草稿会随输入保存；保存本次重答不会覆盖原回答。</p></div>
        </section>
        <aside className="space-y-3"><section className="rounded-[14px] border border-border bg-white p-4"><div className="flex items-center gap-2 text-primary"><Lightbulb size={17}/><h2 className="text-[15px] font-semibold">AI 回答建议</h2></div><ul className="mt-3 space-y-2 text-[14px] leading-6 text-muted-foreground">{suggestions.map((item, itemIndex) => <li key={itemIndex} className="flex gap-2"><span className="text-primary">•</span><span>{item}</span></li>)}</ul></section><details className="rounded-lg border border-border bg-card p-3"><summary className="cursor-pointer text-[14px] font-medium text-muted-foreground">查看原回答</summary><p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground">{turn.answer}</p></details><details className="rounded-lg border border-border bg-amber-50 p-3"><summary className="cursor-pointer text-[14px] font-medium text-muted-foreground">查看 AI 参考表达</summary><p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground">{referenceAnswer}</p></details><section className="rounded-lg border border-border bg-white p-3"><p className="text-[13px] font-medium text-muted-foreground">已保存版本</p><p className="mt-1 text-[15px] text-foreground">原回答{turn.revisions?.length ? ` + ${turn.revisions.length} 次重答` : ""}{turn.finalAnswer ? " · 已保存最终回答" : ""}</p></section></aside>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setMode("feedback")} disabled={coachPending || saveFailed}><ChevronLeft size={17}/>返回建议</Button><Button variant="outline" onClick={() => persist(retryKey, retry, setRetry)} disabled={coachPending || saveFailed}><Save size={17}/>保存草稿</Button></div><Button data-cta="primary" onClick={saveRetry} disabled={!retry.trim() || coachPending || saveFailed}><CheckCircle2 size={17}/>保存这次回答</Button></div>
      {notice && <p role="status" className="mt-4 text-[15px] text-muted-foreground">{notice}</p>}
    </main>
  </div>;

  return <div className="min-h-screen bg-background">
    <TrainingHeader session={session} onExit={onExit} disabled={coachPending || saveFailed}/>
    <main className="mx-auto w-full max-w-[940px] p-6 lg:p-8">
      <section><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[14px] font-medium text-primary">AI 回答建议</h2><span className="rounded-full bg-muted px-3 py-1 text-[13px] text-muted-foreground">第 {session.currentQuestionIndex + 1} / {session.questions.length} 题</span></div><h1 className="mt-2 whitespace-pre-wrap text-[20px] font-semibold leading-8 text-foreground">{displayQuestionText(turn.question)}</h1></section>
      <section className="mt-4 flex items-start justify-between gap-4 rounded-lg bg-card px-4 py-3"><div className="min-w-0"><p className="text-[13px] font-medium text-muted-foreground">我的回答</p><p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground">{latestAnswer(turn)}</p></div><span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-medium text-emerald-700">已保存</span></section>
      <section aria-label="当前回答建议" className="mt-4 overflow-hidden rounded-[14px] border border-border bg-white"><div className="p-5"><div className="flex items-center gap-2 text-primary"><Sparkles size={18}/><h3 className="text-[18px] font-semibold text-foreground">这次回答可以这样更清楚</h3></div>{failure && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-[15px] leading-6 text-amber-800">AI 建议未完成：{failure}</p>}<div className="mt-4 grid gap-4 md:grid-cols-2"><section className="rounded-lg bg-card p-4"><h3 className="text-[15px] font-semibold text-foreground">优先改进</h3><ul className="mt-2 space-y-2 text-[15px] leading-6 text-muted-foreground">{suggestions.map((item, itemIndex) => <li key={itemIndex} className="flex gap-2"><span className="text-primary">•</span><span>{item}</span></li>)}</ul></section><section className="rounded-lg bg-amber-50 p-4"><h3 className="text-[15px] font-semibold text-foreground">表达顺序</h3><p className="mt-2 text-[15px] leading-6 text-muted-foreground">{coach?.answerStructure || (isKnowledgeQuestion(question) ? "先解释概念，再说明原理、应用与局限。" : "先交代背景与目标，再说本人行动、结果或产物，最后说明边界和反思。")}</p></section></div>{coach?.factRisks.length ? <section role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"><h3 className="text-[15px] font-semibold text-amber-800">需要核对</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-6 text-muted-foreground">{coach.factRisks.map((risk, riskIndex) => <li key={riskIndex}>{risk}</li>)}</ul></section> : null}<details className="mt-4 rounded-lg border border-border p-4"><summary className="cursor-pointer text-[15px] font-medium text-muted-foreground">查看 AI 参考表达</summary><p className="mt-3 whitespace-pre-wrap break-words text-[16px] leading-7 text-foreground">{referenceAnswer}</p></details>{!coach && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card p-4"><p className="text-[14px] leading-6 text-muted-foreground">{modelAvailable ? "可以为当前回答重试获取 AI 建议。" : "当前使用本地表达提示；未虚构 AI 点评。"}</p>{onRequestCoach && <Button variant="outline" disabled={!modelAvailable || coachPending || saveFailed} onClick={() => void requestAdvice()}>{coachPending ? "正在生成建议…" : failure ? "重试获取建议" : "获取 AI 建议"}</Button>}</div>}</div><details className="border-t border-border bg-card p-5"><summary className="cursor-pointer text-[16px] font-semibold text-foreground">保存我的回答思路</summary><label htmlFor="final-answer" className="mt-3 block text-[16px] font-semibold text-foreground">保存我认可的最终回答</label><Textarea id="final-answer" aria-label="最终确认答案" value={finalAnswer} maxLength={12000} onChange={event => persist(finalKey, event.target.value, setFinalAnswer)} className="mt-3 min-h-36 w-full bg-white" placeholder="整理后保存你认可的回答…"/><div className="mt-3 flex flex-wrap gap-2"><Button data-cta="primary" onClick={saveFinal} disabled={!finalAnswer.trim() || saveFailed}><CheckCircle2 size={17}/>保存最终答案</Button></div></details></section>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-muted-foreground">原回答与每次重答均保留，不会被建议覆盖。</p><div className="flex flex-wrap gap-2">{onReturnToSource && <Button variant="outline" onClick={onReturnToSource} disabled={coachPending || saveFailed}>返回资料题组</Button>}<Button variant="outline" onClick={() => setMode("retry")} disabled={coachPending || saveFailed}>再答一次</Button>{onFinish ? <Button data-cta="primary" onClick={onFinish} disabled={coachPending || saveFailed}><CheckCircle2 size={17}/>完成训练</Button> : <Button data-cta="primary" onClick={onContinue} disabled={!onContinue || coachPending || saveFailed}>下一题</Button>}</div></div>
      <details className="mt-4 rounded-lg border border-border bg-white p-4"><summary className="cursor-pointer text-[15px] font-medium text-muted-foreground">查看回答版本</summary><div className="mt-3 space-y-3">{versions.map((version, versionIndex) => <section key={versionIndex} className="rounded-lg bg-card p-3"><p className="text-[13px] font-medium text-muted-foreground">{versionIndex === 0 ? "原回答" : `第 ${versionIndex + 1} 次回答`}</p><p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-6 text-foreground">{version.answer}</p></section>)}</div></details>
      {notice && <p role="status" className="mt-4 text-[15px] text-muted-foreground">{notice}</p>}
    </main>
  </div>;
}
