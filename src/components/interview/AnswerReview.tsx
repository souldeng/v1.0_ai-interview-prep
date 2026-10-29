import { useState } from "react";
import type { CoachFeedback, InterviewSession, Scorecard } from "../../lib/domain";
import { compareFeedback, evaluateEvidence, observationLabels, questionForTurn, isKnowledgeQuestion, currentCoachReview } from "../../lib/coaching";
import { loadDrafts, saveDraft } from "../../lib/drafts";

export function EvidenceFeedback({ score }: { score: Scorecard }) {
  return <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4"><h3 className="font-bold text-blue-950">回答依据核对 · 本地规则</h3><p className="text-xs text-slate-600">已提供只表示出现文字线索，不代表真实、正确或已掌握；缺失也可能是规则漏判。</p>
    {(score.observations ?? []).map(o => <div key={o.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700"><p className="font-semibold text-slate-950">{o.label} · {observationLabels[o.status]}</p>{o.quotes.map((quote, i) => <blockquote key={i} className="mt-2 whitespace-pre-wrap break-words border-l-2 border-blue-300 pl-3">回答原句：「{quote}」</blockquote>)}{o.materialQuotes?.map((q, i) => <p key={i} className="mt-2 text-blue-800">材料原句：「{q}」</p>)}<p className="mt-2 text-slate-600">{o.explanation}</p><p className="mt-2">建议：{o.nextStep}</p></div>)}
    <p className="text-sm text-slate-600">{score.referenceAnswer}</p></section>;
}

export interface AnswerReviewProps {
  session: InterviewSession;
  onRevise: (index: number, answer: string) => string | null;
  onSaveFinal: (index: number, answer: string) => string | null;
  onUnsaved: (value: boolean) => void;
  onRequestCoach?: (index: number) => Promise<string | null>;
  modelAvailable?: boolean;
  coachPending?: boolean;
}

function CoachDetails({ coach, additionalOnly = false }: { coach: CoachFeedback; additionalOnly?: boolean }) {
  const groups = additionalOnly
    ? [["更多优点", coach.strengths.slice(2)], ["其他改进点", coach.issues.slice(2)], ["补充建议", coach.suggestions.slice(1)], ["需要学习", coach.studyTopics]] as const
    : [["已经做得好的地方", coach.strengths], ["需要改进的地方", coach.issues], ["事实风险", coach.factRisks], ["补充建议", coach.suggestions], ["需要学习", coach.studyTopics]] as const;
  return <div className="space-y-3 text-sm leading-6 text-slate-700">{groups.map(([label, items]) => items.length ? <div key={label}><p className="font-medium">{label}</p><ul className="list-disc pl-5">{items.map((item, i) => <li key={i} className="whitespace-pre-wrap break-words">{item}</li>)}</ul></div> : null)}{!additionalOnly && <p className="whitespace-pre-wrap break-words">回答思路：{coach.answerStructure}</p>}{coach.optimizedExample && <p className="whitespace-pre-wrap break-words">示例优化回答（需本人核对）：{coach.optimizedExample}</p>}</div>;
}

export function AnswerReview({ session, onRevise, onSaveFinal, onUnsaved, onRequestCoach, modelAvailable = false, coachPending = false }: AnswerReviewProps) {
  const [index, setIndex] = useState(session.turns.length - 1);
  const turn = session.turns[index];
  const draftKey = `retry:${session.id}:${index}`;
  const [draft, setDraft] = useState(() => loadDrafts()[draftKey] ?? "");
  const finalDraftKey = `final:${session.id}:${index}`;
  const [finalDraft, setFinalDraft] = useState(() => loadDrafts()[finalDraftKey] ?? turn?.finalAnswer ?? "");
  const [notice, setNotice] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);
  if (!turn) return null;
  const question = questionForTurn(session, turn);
  const versions = [{ answer: turn.answer, createdAt: session.createdAt }, ...(turn.revisions ?? [])];
  const coach = currentCoachReview(turn)?.feedback;
  const legacyCoach = turn.aiCoach && !(turn.coachReviews ?? []).some(review => JSON.stringify(review.feedback) === JSON.stringify(turn.aiCoach)) ? turn.aiCoach : undefined;
  const failure = turn.coachFailure?.answerVersion === versions.length ? turn.coachFailure.message : null;
  const feedback = evaluateEvidence(versions.at(-1)!.answer, question, session.preparation);
  const comparison = versions.length > 1 ? compareFeedback(evaluateEvidence(versions.at(-2)!.answer, question, session.preparation), feedback) : null;
  function update(value: string) {
    setDraft(value);
    try { saveDraft(draftKey, value); setSaveFailed(false); onUnsaved(false); setNotice("重答草稿已保存到本机。"); }
    catch (e) { setSaveFailed(true); onUnsaved(true); setNotice(e instanceof Error ? e.message : "保存失败，请保留当前页面并重试。"); }
  }
  function submit() {
    const error = onRevise(index, draft);
    if (error) { setNotice(error); return; }
    update(""); setNotice("重答已保存，原回答保留；对比仅说明材料表述变化。");
  }
  function saveFinal(value: string) {
    setFinalDraft(value);
    try { saveDraft(finalDraftKey, value); setSaveFailed(false); onUnsaved(false); }
    catch (error) { setSaveFailed(true); onUnsaved(true); setNotice(error instanceof Error ? error.message : "最终答案草稿未保存，请保留当前页面并重试。"); }
  }
  return <section className="mx-auto mt-6 max-w-5xl space-y-4 border-t border-slate-200 pt-5">
    <h2 className="text-xl font-bold text-slate-950">点评 → 重答 → 对比</h2>
    <label className="block text-sm font-medium text-slate-700">选择已回答的问题<select disabled={saveFailed || coachPending} aria-label="选择已回答的问题" className="form-control mt-2" value={index} onChange={e => { const next = Number(e.target.value); setIndex(next); setDraft(loadDrafts()[`retry:${session.id}:${next}`] ?? ""); setFinalDraft(loadDrafts()[`final:${session.id}:${next}`] ?? session.turns[next]?.finalAnswer ?? ""); setNotice(""); }}>{session.turns.map((t, i) => <option key={i} value={i}>第 {i + 1} 轮：{t.question.slice(0, 60)}</option>)}</select></label>
    <p className="whitespace-pre-wrap break-words text-sm text-slate-700">原问题：{turn.question}</p>
    <section aria-label="当前回答反馈" className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm leading-6 text-slate-700">
      <h3 className="font-semibold text-slate-950">{coach ? "AI 教练反馈" : "本地辅助提示"}</h3>
      {!coach && failure && <><p role="alert" className="mt-2 font-medium text-amber-900">AI 点评未完成，目前显示的是本地辅助提示</p><p className="text-xs text-slate-600">{failure}</p></>}
      {!coach && !failure && <p className="mt-1 text-xs text-slate-600">{modelAvailable ? "当前回答尚未获得 AI 点评。" : "未配置 AI 服务；目前只提供本地表达辅助，不能判断专业知识正确性。"}</p>}
      <p className="mt-1 text-xs text-slate-600">针对版本 {versions.length}；{coach ? "AI 建议需本人核对，不代表事实已核验或已经独立掌握。" : "文字线索不是事实核验，也不能判断专业知识是否正确或已经掌握。"}</p>
      <h4 className="mt-3 font-medium text-slate-950">已经做得好的地方</h4>
      <p className="whitespace-pre-wrap break-words">{coach ? (coach.strengths.slice(0, 2).join("；") || "本轮未指出有依据的优点。") : isKnowledgeQuestion(question) ? `已提供可讨论的回答：「${versions.at(-1)!.answer.slice(0, 100)}」。这不表示概念已答对。` : (feedback.observations?.filter(o => o.status === "provided").map(o => `写出了${o.label}相关表述`).join("；") || "已经提交回答；尚未识别到清楚的行动与结果表述，可核对原文。")}</p>
      <h4 className="mt-3 font-medium text-slate-950">需要改进的地方</h4>
      <p className="whitespace-pre-wrap break-words">{coach ? (coach.issues.slice(0, 2).join("；") || "本轮未指出主要问题，不代表没有遗漏。") : isKnowledgeQuestion(question) ? `围绕「${question.text}」核对概念、逻辑与遗漏要点；不懂的部分可以如实说明，需要专业资料或 AI 点评进一步检查。` : feedback.improvement}</p>
      {coach?.suggestions[0] && <p className="mt-3 whitespace-pre-wrap break-words">{coach.suggestions[0]}</p>}
      <h4 className="mt-3 font-medium text-slate-950">建议回答思路</h4><p className="whitespace-pre-wrap break-words">{coach?.answerStructure ?? feedback.referenceAnswer}</p>
      {!coach && onRequestCoach && <button disabled={!modelAvailable || coachPending || saveFailed} onClick={async () => { const message = await onRequestCoach(index); if (message) setNotice(message); }} className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">{coachPending ? "AI 点评中…" : failure ? "重试 AI 点评" : "请求 AI 点评"}</button>}
    </section>
    {coach?.factRisks.length ? <section role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><h3 className="font-semibold">事实风险 · 请核对</h3><ul className="list-disc pl-5">{coach.factRisks.map((risk, i) => <li key={i} className="whitespace-pre-wrap break-words">{risk}</li>)}</ul></section> : null}
    {coach && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">AI 补充建议与示例（需本人核对）</summary><div className="mt-3"><CoachDetails coach={coach} additionalOnly/>{coach.optimizedExample && <button onClick={() => saveFinal(coach.optimizedExample)} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm">复制到待确认答案草稿</button>}</div></details>}
    {feedback.observations?.filter(o => o.status === "contradiction").map(o => <p key={o.id} role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">事实风险：{o.quotes.join(" / ")}。{o.explanation}</p>)}
    <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">历史回答与点评</summary><div className="mt-3 space-y-2">{versions.map((v, i) => <details key={i} open={i === versions.length - 1} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700"><summary className="cursor-pointer font-medium">版本 {i + 1}{i === 0 ? " · 原回答" : " · 重答"}</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm">{v.answer}</p></details>)}</div>
    {(turn.coachReviews ?? []).filter(review => review.answerVersion !== versions.length).map(review => <details key={review.answerVersion} className="mt-2 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm text-slate-700">历史 AI 点评 · 回答版本 {review.answerVersion}</summary><p className="my-3 whitespace-pre-wrap break-words text-sm text-slate-600">对应回答：{review.answer}</p><CoachDetails coach={review.feedback}/></details>)}
    </details>
    <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">事实依据与规则检测详情</summary><div className="mt-3"><EvidenceFeedback score={feedback}/></div></details>
    {legacyCoach?.factRisks.length ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">旧版点评的事实风险（未记录关联版本，请对照历史回答核对）：{legacyCoach.factRisks.join("；")}</p> : null}
    {legacyCoach && <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm text-slate-700">旧版 AI 点评 · 未记录关联版本，不能视为当前点评</summary><div className="mt-3"><CoachDetails coach={legacyCoach}/></div></details>}
    {comparison && <details className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-sm text-slate-700"><summary className="cursor-pointer font-medium text-slate-950">与上一版相比</summary><p className="mt-2">新增表述线索：{comparison.added.join("、") || "未识别到新增项"}</p><p>仍需补充或核对：{comparison.unresolved.join("、") || "未识别到缺失项，仍须人工核对"}</p><p>不再识别到的线索：{comparison.lost.join("、") || "无"}</p><p>仍无法判断：{comparison.unknown.join("、") || "无"}</p><p className="mt-2 text-slate-600">这不是能力提升证明，也不是事实认证。</p></details>}
    <label className="block text-sm font-medium text-slate-700">围绕同一问题重新回答<p className="mt-1 text-xs font-normal text-slate-600">上方点评仅对应已保存的版本；编辑中的草稿尚未获得点评。</p><textarea aria-label="同题重答" maxLength={12000} className="form-control mt-2 min-h-36" value={draft} onChange={e => update(e.target.value)}/></label>
    <div className="flex flex-wrap gap-3"><button onClick={submit} disabled={!draft.trim() || coachPending} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40">保存重答并对比</button><button onClick={() => update(draft)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">重试保存草稿</button></div>
    <details className="rounded-xl border border-blue-200 bg-blue-50/70 p-4"><summary className="cursor-pointer font-semibold text-slate-950">保存我的回答思路</summary><p className="mt-1 text-sm leading-6 text-slate-600">保存你认可的思路；原回答和重答仍保留。</p><textarea aria-label="最终确认答案" value={finalDraft} maxLength={12000} onChange={event => saveFinal(event.target.value)} className="mt-3 min-h-32 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900 outline-none focus:border-blue-700" placeholder="基于真实材料整理最终回答…"/><button onClick={() => { const error = onSaveFinal(index, finalDraft); if (error) { setNotice(error); return; } saveFinal(""); setFinalDraft(finalDraft.trim()); setNotice("最终确认答案已保存；原回答和重答未被覆盖。"); }} disabled={!finalDraft.trim()} className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40">保存最终答案</button></details>
    {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
  </section>;
}
