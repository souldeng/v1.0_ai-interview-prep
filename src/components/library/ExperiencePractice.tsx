import { useEffect, useRef, useState } from "react";
import type { UserProfile } from "../../lib/domain";
import type { QuestionLibraryState } from "../../lib/questionLibrary";
import { currentExperienceSet, experienceVersion, setExperienceQuestionHidden, visibleExperienceQuestions, type ExperiencePracticeSet } from "../../lib/experiencePractice";
import { loadUserProfile } from "../../lib/profileStorage";
import { generateExperienceQuestions } from "../../services/modelClient";
import { useSafeNavigation, useUnsavedChanges } from "../shared/UnsavedChanges";

const button = "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all";
export function ExperiencePractice({ profile, state, experienceId, setId, modelAvailable, onSelect, onSave, onUpdate, onPractice }: {
  profile: UserProfile; state: QuestionLibraryState; experienceId: string | null; setId: string | null; modelAvailable: boolean;
  onSelect: (experienceId: string, setId?: string) => void; onSave: (set: ExperiencePracticeSet) => string | null; onUpdate?: (set: ExperiencePracticeSet) => string | null; onPractice: (setId: string, questionId: string) => void;
}) {
  const navigate = useSafeNavigation();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [pendingResult, setPendingResult] = useState<ExperiencePracticeSet | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { const cancel = () => request.current?.abort(); window.addEventListener("pagehide", cancel); return () => { window.removeEventListener("pagehide", cancel); cancel(); }; }, []);
  useUnsavedChanges("experience-question-generation", busy || Boolean(pendingResult), { label: "专项题生成与保存", save: () => busy ? "请先等待生成完成，或取消生成。" : pendingResult ? persist(pendingResult) : null, discard: () => { request.current?.abort(); setPendingResult(null); } });
  const card = profile.experiences.find(card => card.id === experienceId);
  const set = state.experienceSets?.find(item => item.id === setId) ?? (card ? currentExperienceSet(state, card) : undefined);
  const stale = Boolean(set && (!card?.confirmed || set.experienceId !== card.id || set.contentVersion !== experienceVersion(card)));
  useEffect(() => setDeleted(null), [set?.id]);
  function persist(generated: ExperiencePracticeSet): string | null {
    const latest = loadUserProfile().experiences.find(item => item.id === generated.experienceId);
    if (!latest?.confirmed || experienceVersion(latest) !== generated.contentVersion) return "经历已变化或撤销确认，本次结果未保存。请重新选择。";
    const error = onSave(generated);
    if (error) return `题组保存失败：${error} 当前页面保留生成结果，可重试保存。`;
    setPendingResult(null); onSelect(generated.experienceId, generated.id); return null;
  }
  async function generate(mode: "initial" | "replace" | "append" = "initial") {
    if (request.current || !card?.confirmed) return;
    if (mode === "append" && set && visibleExperienceQuestions(set).length >= 20) { setNotice("当前已有20道题，请先整理题目或重新生成。"); return; }
    if (!pendingResult && mode !== "initial" && !window.confirm(`${mode === "append" ? "继续生成" : "重新生成"}将再次调用模型。已有题目与训练历史会保留，是否继续？`)) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setNotice("");
    try {
      const generated = pendingResult ?? await generateExperienceQuestions(card, { signal: controller.signal, ...(mode === "append" && set ? { appendTo: set } : {}) });
      if (controller.signal.aborted) return;
      setPendingResult(generated);
      const error = persist(generated); if (error) throw new Error(error);
      setNotice(mode === "append" ? `本次新增 ${generated.questions.length - (set?.questions.length ?? 0)} 道题，已保存。` : "题组已保存。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "生成失败，已有题组与回答仍保留，可主动重试。"); }
    finally { if (request.current === controller) request.current = null; setBusy(false); }
  }
  function hide(questionId: string, hidden: boolean) {
    if (!set || !onUpdate) return;
    const error = onUpdate(setExperienceQuestionHidden(set, questionId, hidden));
    setNotice(error ?? (hidden ? "已从练习列表移除，历史回答仍保留。" : "已恢复题目。"));
    if (!error) setDeleted(hidden ? questionId : null);
  }
  return <section className="min-w-0 space-y-4" aria-label="简历专项">
    <h2 className="text-xl font-semibold text-slate-950">{set?.title ?? card?.title ?? "选择一段已确认经历"}</h2>
    {set ? <>
      {stale && <p role="status" className="text-sm text-amber-900">经历已变化或未确认。旧题可复练，旧事实不会进入新的 AI 点评。</p>}
      {card?.confirmed && <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || Boolean(pendingResult) || !modelAvailable} onClick={() => void generate("replace")}>重新生成</button><button className={button} disabled={busy || Boolean(pendingResult) || stale || !modelAvailable} onClick={() => void generate("append")}>继续生成</button></div>}
      {pendingResult && <button className={button} disabled={busy} onClick={() => void generate()}>重试保存题组</button>}
      <div className="space-y-4">{visibleExperienceQuestions(set).map((question,index) => <article key={question.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-2"><span aria-hidden="true" className="leading-7 text-slate-500">{index + 1}.</span><h3 className="break-words font-medium leading-7 text-slate-950">{question.text}</h3></div>
        <button disabled={busy} className={`${button} mt-3`} onClick={() => navigate(() => onPractice(set.id, question.id))}>开始练习</button>
        <button disabled={busy} className={`${button} mt-3 ml-2`} aria-label={`删除题目 ${index + 1}`} onClick={() => hide(question.id, true)}>删除</button>
      </article>)}</div>
      {!visibleExperienceQuestions(set).length && <p className="text-sm text-slate-600">本组题目已移除，可撤销删除或重新生成。</p>}
      {deleted && <button className={button} onClick={() => hide(deleted, false)}>撤销删除</button>}
      <p className="text-xs text-slate-500">AI 根据经历生成，非企业真实面试原题。</p>
    </> : card?.confirmed ? <>
      <p className="text-sm text-slate-600">生成 3–5 道题，可任选一道练习。生成时会将这段经历发送给已配置的模型。</p>
      <button disabled={busy || (!pendingResult && !modelAvailable)} className={button} onClick={() => void generate()}>{busy ? pendingResult ? "正在保存题组…" : "正在生成专项题…" : pendingResult ? "重试保存题组" : "生成专项题"}</button>
      {!modelAvailable && <p className="text-sm text-amber-900">模型未连接，已有题组仍可练习。</p>}
    </> : !profile.experiences.some(item => item.confirmed) && <p className="text-sm text-slate-600">先在“我的经历”确认一段真实经历。</p>}
    {busy && <p role="status" className="text-sm text-slate-700">正在生成并保存专项题，已有题组仍保留。</p>}
    {busy && <button className={button} onClick={() => request.current?.abort()}>取消生成</button>}
    {notice && <p role="alert" className="text-sm text-red-700">{notice}</p>}
    {!busy && <div className="flex flex-wrap gap-3">{profile.experiences.filter(item => item.confirmed && item.id !== (set?.experienceId ?? card?.id)).map(item => <button className={button} key={item.id} onClick={() => navigate(() => { setNotice(""); onSelect(item.id); })}>{item.title}</button>)}</div>}
    {!!state.experienceSets?.length && <details className="text-sm text-slate-600"><summary className="cursor-pointer py-2">历史题组</summary><div className="mt-2 flex flex-wrap gap-3">{state.experienceSets.map((item,index) => <button className={button} disabled={busy} key={item.id} onClick={() => navigate(() => { setNotice(""); onSelect(item.experienceId, item.id); })}>{item.title} · 第{index+1}组 · {new Date(item.createdAt).toLocaleString("zh-CN")}</button>)}</div></details>}
  </section>;
}
