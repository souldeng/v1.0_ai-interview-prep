import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, FileText, Play, Sparkles, UsersRound } from "lucide-react";
import type { ExperienceCard, InterviewSession, Question, UserProfile } from "../../lib/domain";
import type { QuestionLibraryState } from "../../lib/questionLibrary";
import { clearPendingExperiencePracticeSet, currentExperienceSet, experienceVersion, isPendingExperiencePracticeSetCurrent, loadPendingExperiencePracticeSet, savePendingExperiencePracticeSet, setExperienceQuestionHidden, visibleExperienceQuestions, type ExperiencePracticeSet } from "../../lib/experiencePractice";
import { clearPendingConfirmedResumePracticeSet, eligibleConfirmedResumeCards, isConfirmedResumePracticeSetCurrent, loadPendingConfirmedResumePracticeSet, savePendingConfirmedResumePracticeSet, setConfirmedResumeQuestionHidden, visibleConfirmedResumeQuestions, type ConfirmedResumePracticeSet } from "../../lib/confirmedResumePractice";
import { loadUserProfile } from "../../lib/profileStorage";
import { trainingTotals } from "../../lib/interview";
import { generateConfirmedResumePracticeSet, generateExperienceQuestions } from "../../services/modelClient";
import { useSafeNavigation, useUnsavedChanges } from "../shared/UnsavedChanges";

type PreparationMode = "resume" | "experience" | "introduction";
type GroupRecord = { kind: "resume"; set: ConfirmedResumePracticeSet } | { kind: "experience"; set: ExperiencePracticeSet };

const secondaryButton = "rounded-md border border-border bg-white px-4 py-2 text-[16px] font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[16px] font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

function formatDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "日期未知" : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function questionsOf(group: GroupRecord) {
  return group.kind === "resume" ? visibleConfirmedResumeQuestions(group.set) : visibleExperienceQuestions(group.set);
}

function sourceLabel(group: GroupRecord, profile: UserProfile) {
  if (group.kind === "experience") return `单段经历 · ${group.set.title}`;
  const titles = group.set.sources.map(source => profile.experiences.find(card => card.id === source.experienceId)?.title ?? source.title).filter(Boolean);
  return `全局简历题组 · ${titles.length} 段经历${titles.length ? `：${titles.join("、")}` : ""}`;
}

function groupIsCurrent(group: GroupRecord, profile: UserProfile) {
  if (group.kind === "resume") return isConfirmedResumePracticeSetCurrent(profile, group.set);
  const card = profile.experiences.find(item => item.id === group.set.experienceId);
  return Boolean(card?.confirmed && experienceVersion(card) === group.set.contentVersion);
}

function questionEvidence(question: Question, profile: UserProfile) {
  if (question.resumePracticeOrigin) {
    const names = [...new Set(question.resumePracticeOrigin.evidence.map(item => profile.experiences.find(card => card.id === item.experienceId)?.title).filter(Boolean))];
    return names.length ? `依据：${names.join("、")}` : "依据：已确认经历";
  }
  return question.experienceOrigin?.basisQuote ? `依据：${question.experienceOrigin.basisQuote}` : "依据：已确认经历";
}

function groupTraining(group: GroupRecord, sessions: InterviewSession[]) {
  const matches = sessions.filter(session => session.preparation.questions.some(question => question.resumePracticeOrigin?.setId === group.set.id || question.experienceOrigin?.setId === group.set.id));
  const latest = [...matches].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!latest) return { label: "待练", detail: "尚未开始训练", sessionId: undefined };
  const totals = trainingTotals(latest);
  if (latest.status === "active") return { label: "进行中", detail: `已答 ${totals.answered} / ${totals.total} · 已跳过 ${totals.skipped}`, sessionId: latest.id };
  return { label: "已完成", detail: `完成 ${totals.answered} / ${totals.total} · 最终回答 ${totals.finalAnswers}`, sessionId: latest.id };
}

function GroupIssues({ issues }: { issues?: Array<{ index: number; message: string }> }) {
  const relevant = issues?.filter(issue => issue.index > 0) ?? [];
  if (!relevant.length) return null;
  return <details className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
    <summary className="cursor-pointer text-[16px] font-medium text-muted-foreground transition-colors hover:text-foreground">本次有 {relevant.length} 道候选未采用</summary>
    <ul className="mt-3 space-y-2 text-[14px] leading-6 text-muted-foreground">{relevant.map((issue, index) => <li key={`${issue.index}-${index}`}>第 {issue.index} 项：{issue.message}</li>)}</ul>
  </details>;
}

function SourceSelector({ cards, selectedIds, disabled, onToggle, onToggleAll }: { cards: ExperienceCard[]; selectedIds: string[]; disabled: boolean; onToggle: (id: string) => void; onToggleAll: () => void }) {
  const selected = new Set(selectedIds);
  const allSelected = cards.length > 0 && cards.every(card => selected.has(card.id));
  return <section className="rounded-[14px] border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div><h3 className="text-[18px] font-semibold text-foreground">本次使用的经历</h3><p className="mt-1 text-[14px] text-muted-foreground">只使用已确认经历；待确认候选不会参与出题。</p></div>
      <label className="flex items-center gap-2 text-[16px] text-muted-foreground"><input type="checkbox" checked={allSelected} disabled={disabled || !cards.length} onChange={onToggleAll} className="size-4 accent-[#C4622D] disabled:cursor-not-allowed"/>使用全部已确认经历</label>
    </div>
    <div className="divide-y divide-[#F0E7DC] bg-white">{cards.map(card => <label key={card.id} className="flex cursor-pointer items-center gap-3 px-5 py-4 transition-colors hover:bg-muted">
      <input type="checkbox" checked={selected.has(card.id)} disabled={disabled} onChange={() => onToggle(card.id)} className="size-4 accent-[#C4622D] disabled:cursor-not-allowed"/>
      <span className="min-w-0 flex-1"><span className="block break-words text-[16px] font-medium text-foreground">{card.title}</span><span className="mt-1 block text-[14px] text-muted-foreground">{card.type || "已确认经历"}</span></span>
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[13px] text-emerald-700">已确认</span>
    </label>)}</div>
  </section>;
}

function ModeTabs({ mode, onChange }: { mode: PreparationMode; onChange: (mode: PreparationMode) => void }) {
  const items: Array<[PreparationMode, string]> = [["resume", "整份简历题"], ["experience", "单段经历专项"], ["introduction", "自我介绍"]];
  return <div aria-label="准备方向" className="inline-flex rounded-[10px] bg-muted p-1">{items.map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onChange(value)} className={`rounded-[8px] px-3 py-2 text-[14px] transition-all active:scale-[0.98] ${mode === value ? "bg-white font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>;
}

export function ExperiencePractice({ profile, state, experienceId, setId, modelAvailable, onSelect, onSave, onUpdate, onPractice, onPracticeSet, onContinueTraining, sessions = [], onIntroductionPractice, onSaveResumeSet, onUpdateResumeSet, onSelectResumeSet, onDeleteSet }: {
  profile: UserProfile; state: QuestionLibraryState; experienceId: string | null; setId: string | null; modelAvailable: boolean;
  onSelect: (experienceId: string, setId?: string) => void; onSave: (set: ExperiencePracticeSet) => string | null; onUpdate?: (set: ExperiencePracticeSet) => string | null; onPractice: (setId: string, questionId: string) => void;
  onPracticeSet?: (setId: string) => void; onContinueTraining?: (sessionId: string) => void; sessions?: InterviewSession[];
  onIntroductionPractice: (minutes: 1 | 3) => void;
  onSaveResumeSet?: (set: ConfirmedResumePracticeSet) => string | null; onUpdateResumeSet?: (set: ConfirmedResumePracticeSet) => string | null; onSelectResumeSet?: (setId?: string) => void;
  onDeleteSet?: (group: GroupRecord) => void;
}) {
  const navigate = useSafeNavigation();
  const confirmedCards = useMemo(() => eligibleConfirmedResumeCards(profile), [profile]);
  const groupList = useMemo<GroupRecord[]>(() => [
    ...(state.resumeSets ?? []).map(set => ({ kind: "resume" as const, set })),
    ...(state.experienceSets ?? []).map(set => ({ kind: "experience" as const, set })),
  ].sort((left, right) => right.set.createdAt.localeCompare(left.set.createdAt)), [state.experienceSets, state.resumeSets]);
  const initialGroup = groupList.find(group => group.set.id === setId);
  const [view, setView] = useState<"prepare" | "manage">(initialGroup ? "manage" : "prepare");
  const [mode, setMode] = useState<PreparationMode>(initialGroup?.kind ?? "resume");
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() => confirmedCards.map(card => card.id));
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [selectedExperienceId, setSelectedExperienceId] = useState<string | null>(() => experienceId ?? confirmedCards[0]?.id ?? null);
  const [introductionMinutes, setIntroductionMinutes] = useState<1 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingResume, setPendingResume] = useState<ConfirmedResumePracticeSet | null>(() => loadPendingConfirmedResumePracticeSet());
  const [pendingExperience, setPendingExperience] = useState<ExperiencePracticeSet | null>(() => loadPendingExperiencePracticeSet());
  const [lastHidden, setLastHidden] = useState<{ group: GroupRecord; questionId: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const currentGroup = groupList.find(group => group.set.id === setId) ?? (view === "manage" ? groupList[0] : undefined);
  const selectedCard = confirmedCards.find(card => card.id === selectedExperienceId) ?? confirmedCards[0];
  const pendingResumeStale = Boolean(pendingResume && !isConfirmedResumePracticeSetCurrent(profile, pendingResume));
  const pendingExperienceStale = Boolean(pendingExperience && !isPendingExperiencePracticeSetCurrent(profile, pendingExperience));
  const selectedSourceCards = confirmedCards.filter(card => selectedSourceIds.includes(card.id));
  const busyOrCandidate = busy || Boolean(pendingResume) || Boolean(pendingExperience);

  useEffect(() => { const cancel = () => request.current?.abort(); window.addEventListener("pagehide", cancel); return () => { window.removeEventListener("pagehide", cancel); cancel(); }; }, []);
  useEffect(() => {
    const ids = confirmedCards.map(card => card.id);
    setSelectedSourceIds(current => selectionTouched ? current.filter(id => ids.includes(id)) : ids);
    if (!selectedExperienceId || !ids.includes(selectedExperienceId)) setSelectedExperienceId(ids[0] ?? null);
  }, [confirmedCards, selectedExperienceId, selectionTouched]);
  useEffect(() => { if (initialGroup) { setView("manage"); setMode(initialGroup.kind); } }, [initialGroup?.set.id]);
  useEffect(() => { if (pendingExperience) { setMode("experience"); setSelectedExperienceId(pendingExperience.experienceId); } }, [pendingExperience?.id]);
  useEffect(() => setLastHidden(null), [currentGroup?.set.id]);
  useUnsavedChanges("resume-question-generation", busy || Boolean(pendingResume) || Boolean(pendingExperience), {
    label: "简历题生成与保存",
    save: () => busy ? "请先等待生成完成，或取消生成。" : pendingResume ? persistResume(pendingResume) : pendingExperience ? persistExperience(pendingExperience) : null,
    discard: () => { request.current?.abort(); discardPendingResume(); discardPendingExperience(); },
  });

  function openPreparation(next: PreparationMode = mode) {
    setNotice(""); setLastHidden(null); setView("prepare"); setMode(next);
    if (next === "resume") onSelectResumeSet?.();
    if (next === "experience" && selectedCard) onSelect(selectedCard.id);
  }
  function openGroup(group: GroupRecord) {
    setNotice(""); setLastHidden(null); setView("manage"); setMode(group.kind);
    if (group.kind === "resume") onSelectResumeSet?.(group.set.id);
    else onSelect(group.set.experienceId, group.set.id);
  }
  function selectMode(next: PreparationMode) { setNotice(""); setLastHidden(null); setMode(next); setView("prepare"); }
  function persistResume(generated: ConfirmedResumePracticeSet): string | null {
    if (!isConfirmedResumePracticeSetCurrent(loadUserProfile(), generated)) return "已确认经历在生成期间变化，本次候选不能保存。请重新生成。";
    try { savePendingConfirmedResumePracticeSet(generated); } catch (error) { return `候选题组本地保存失败：${error instanceof Error ? error.message : "本地存储错误"}。当前内容仍在本页。`; }
    if (!onSaveResumeSet) return "当前页面未接入整份简历题组保存。";
    const error = onSaveResumeSet(generated);
    if (error) return `题组保存失败：${error} 当前候选已保留，可重试保存。`;
    try { clearPendingConfirmedResumePracticeSet(); } catch (error) { setPendingResume(null); onSelectResumeSet?.(generated.id); setView("manage"); return `题组已保存，但候选副本清理失败：${error instanceof Error ? error.message : "本地存储错误"}。请刷新后核对。`; }
    setPendingResume(null); onSelectResumeSet?.(generated.id); setView("manage"); return null;
  }
  function persistExperience(generated: ExperiencePracticeSet): string | null {
    const latest = loadUserProfile().experiences.find(card => card.id === generated.experienceId);
    if (!latest?.confirmed || experienceVersion(latest) !== generated.contentVersion) return "经历已变化或撤销确认，本次候选不能保存。请重新生成。";
    try { savePendingExperiencePracticeSet(generated); } catch (error) { return `候选题组本地保存失败：${error instanceof Error ? error.message : "本地存储错误"}。当前内容仍在本页。`; }
    const error = onSave(generated);
    if (error) return `题组保存失败：${error} 当前候选已保留，可重试保存。`;
    try { clearPendingExperiencePracticeSet(); } catch (error) { setPendingExperience(null); onSelect(generated.experienceId, generated.id); setView("manage"); return `题组已保存，但候选副本清理失败：${error instanceof Error ? error.message : "本地存储错误"}。请刷新后核对。`; }
    setPendingExperience(null); onSelect(generated.experienceId, generated.id); setView("manage"); return null;
  }
  function discardPendingResume() {
    if (!pendingResume) return;
    try { clearPendingConfirmedResumePracticeSet(); setPendingResume(null); setNotice("已放弃未保存候选；已保存题组和训练记录保持不变。"); }
    catch (error) { setNotice(`放弃候选失败：${error instanceof Error ? error.message : "本地存储错误"}。当前候选仍保留。`); }
  }
  function discardPendingExperience() {
    if (!pendingExperience) return;
    try { clearPendingExperiencePracticeSet(); setPendingExperience(null); setNotice("已放弃未保存候选；已保存题组和训练记录保持不变。"); }
    catch (error) { setNotice(`放弃候选失败：${error instanceof Error ? error.message : "本地存储错误"}。当前候选仍保留。`); }
  }
  async function generateResume() {
    if (request.current || busy || !selectedSourceCards.length) { if (!selectedSourceCards.length) setNotice("请至少选择一段已确认经历。"); return; }
    if (pendingResume) { const error = persistResume(pendingResume); setNotice(error ?? `候选题组已保存，共 ${pendingResume.questions.length} 道题。`); return; }
    if (currentGroup && !window.confirm("将生成一组新的整份简历题；旧题组、训练记录和最终答案会保留。是否继续？")) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setNotice("");
    try {
      const generated = await generateConfirmedResumePracticeSet({ ...profile, experiences: selectedSourceCards, supplementaryInfo: "" }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPendingResume(generated);
      const error = persistResume(generated);
      if (error) { setNotice(error); return; }
      setNotice(`整份简历题组已保存，共 ${generated.questions.length} 道题。${generated.generationIssues?.some(issue => issue.index > 0) ? ` 有 ${generated.generationIssues.filter(issue => issue.index > 0).length} 道候选未采用。` : ""}`);
    } catch (error) { setNotice(controller.signal.aborted ? "已取消生成，已有题组与候选保持不变。" : error instanceof Error ? error.message : "生成失败，已有题组与回答仍保留，可主动重试。"); }
    finally { if (request.current === controller) request.current = null; setBusy(false); }
  }
  async function generateExperience(mode: "initial" | "replace" | "append" = "initial") {
    if (request.current || busy || !selectedCard) return;
    const active = currentGroup?.kind === "experience" ? currentGroup.set : currentExperienceSet(state, selectedCard);
    if (mode === "append" && active && visibleExperienceQuestions(active).length >= 20) { setNotice("当前已有20道题，请先整理题目或重新生成。"); return; }
    if (pendingExperience) { const error = persistExperience(pendingExperience); setNotice(error ?? `候选题组已保存，共 ${pendingExperience.questions.length} 道题。`); return; }
    if (mode !== "initial" && active && !window.confirm(`${mode === "append" ? "继续生成" : "重新生成"}会再次调用模型；已有题组、训练记录和最终答案会保留。是否继续？`)) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setNotice("");
    try {
      const generated = await generateExperienceQuestions(selectedCard, { signal: controller.signal, ...(mode === "append" && active ? { appendTo: active } : {}) });
      if (controller.signal.aborted) return;
      setPendingExperience(generated);
      const error = persistExperience(generated);
      if (error) { setNotice(error); return; }
      const omitted = generated.generationIssues?.length ? ` 有 ${generated.generationIssues.length} 道候选未采用。` : "";
      setNotice(`${mode === "append" ? "已追加" : "专项题组已保存"}，共 ${generated.questions.length} 道题。${omitted}`);
    } catch (error) { setNotice(controller.signal.aborted ? "已取消生成，已有题组与候选保持不变。" : error instanceof Error ? error.message : "生成失败，已有题组与回答仍保留，可主动重试。"); }
    finally { if (request.current === controller) request.current = null; setBusy(false); }
  }
  function hideQuestion(group: GroupRecord, questionId: string, hidden: boolean) {
    const error = group.kind === "resume" ? onUpdateResumeSet?.(setConfirmedResumeQuestionHidden(group.set, questionId, hidden)) : onUpdate?.(setExperienceQuestionHidden(group.set, questionId, hidden));
    setNotice(error ?? (hidden ? "已从本组移除；历史回答和题库记录仍保留。" : "题目已恢复到本组。"));
    if (!error) setLastHidden(hidden ? { group, questionId } : null);
  }
  function renderCandidate() {
    const pending = pendingResume ?? pendingExperience;
    const stale = pendingResume ? pendingResumeStale : pendingExperienceStale;
    if (!pending) return null;
    return <section aria-label="未保存候选题组" className="rounded-[14px] border border-border bg-card p-5">
      <p role={stale ? "alert" : "status"} className={`text-[16px] leading-7 ${stale ? "text-amber-800" : "text-muted-foreground"}`}>{stale ? "已恢复候选题组，但其已确认经历依据已变化。请重新生成。" : `已恢复上次未保存的候选题组，共 ${pending.questions.length} 道题。`}</p>
      {!stale && <p className="mt-1 text-[14px] text-muted-foreground">题目已生成，尚未正式保存；重试不会再次调用模型。</p>}
      <ol className="mt-4 divide-y divide-[#F0E7DC] rounded-lg border border-border bg-white">{pending.questions.map((question, index) => <li key={question.id} className="px-4 py-3"><p className="text-[16px] leading-7 text-foreground"><span className="mr-2 text-primary">{index + 1}.</span>{question.text}</p><p className="mt-1 text-[14px] leading-6 text-muted-foreground">{questionEvidence(question, profile)}</p></li>)}</ol>
      <GroupIssues issues={pending.generationIssues}/>
      <div className="mt-4 flex flex-wrap gap-3">{!stale && <button className={primaryButton} disabled={busy} onClick={() => { const error = pendingResume ? persistResume(pendingResume) : persistExperience(pendingExperience!); setNotice(error ?? `候选题组已保存，共 ${pending.questions.length} 道题。`); }}>重试保存</button>}<button className={secondaryButton} disabled={busy} onClick={() => pendingResume ? discardPendingResume() : discardPendingExperience()}>放弃候选</button></div>
    </section>;
  }
  function renderPreparation() {
    const noCards = !confirmedCards.length;
    return <div className="space-y-6">
      <section className="rounded-[14px] border border-border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-5"><div><p className="text-[14px] text-muted-foreground">准备方向</p><h2 className="mt-1 text-[22px] font-semibold text-foreground">选择这次要练的内容</h2></div><ModeTabs mode={mode} onChange={selectMode}/></div>
        {mode === "resume" && <div className="space-y-5 p-6"><div><h3 className="text-[18px] font-semibold text-foreground">整份简历面试题</h3><p className="mt-2 text-[16px] leading-7 text-muted-foreground">结合你选择的已确认经历出题，可覆盖项目深挖、能力迁移与技术理解。</p></div><SourceSelector cards={confirmedCards} selectedIds={selectedSourceIds} disabled={busyOrCandidate} onToggle={id => { setSelectionTouched(true); setSelectedSourceIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }} onToggleAll={() => { setSelectionTouched(true); setSelectedSourceIds(selectedSourceIds.length === confirmedCards.length ? [] : confirmedCards.map(card => card.id)); }}/><div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-card px-4 py-3"><p className="text-[14px] text-muted-foreground">已选择 {selectedSourceCards.length} 段经历；题组为全局简历题组，不会自动归属到岗位。</p><button className={primaryButton} disabled={busyOrCandidate || !selectedSourceCards.length || !modelAvailable} onClick={() => void generateResume()}><Sparkles size={18}/>{busy ? "正在生成…" : pendingResume ? "重试保存题组" : "生成题组"}</button></div></div>}
        {mode === "experience" && <div className="space-y-5 p-6"><div><h3 className="text-[18px] font-semibold text-foreground">单段经历专项题</h3><p className="mt-2 text-[16px] leading-7 text-muted-foreground">只选择一段已确认经历，围绕本人行动、判断、过程和边界生成 3–5 道专项题。</p></div><div className="divide-y divide-[#F0E7DC] rounded-[14px] border border-border bg-card">{confirmedCards.map(card => <label key={card.id} className={`flex cursor-pointer items-center gap-3 px-5 py-4 transition-colors hover:bg-white ${selectedCard?.id === card.id ? "bg-amber-50" : "bg-white"}`}><input type="radio" name="experience-practice-card" checked={selectedCard?.id === card.id} disabled={busyOrCandidate} onChange={() => { setSelectedExperienceId(card.id); onSelect(card.id); }} className="size-4 accent-[#C4622D] disabled:cursor-not-allowed"/><span className="min-w-0 flex-1"><span className="block break-words text-[16px] font-medium text-foreground">{card.title}</span><span className="mt-1 block text-[14px] text-muted-foreground">{card.type || "已确认经历"}</span></span></label>)}{!confirmedCards.length && <p className="p-5 text-[16px] leading-7 text-muted-foreground">先到“简历与经历”确认至少一段经历。</p>}</div><div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-card px-4 py-3"><p className="text-[14px] text-muted-foreground">仅围绕 {selectedCard?.title ?? "所选经历"} 出题，不混入其他经历。</p><button className={primaryButton} disabled={busyOrCandidate || !selectedCard || !modelAvailable} onClick={() => void generateExperience()}><Sparkles size={18}/>{busy ? "正在生成…" : pendingExperience ? "重试保存题组" : "生成专项题"}</button></div></div>}
        {mode === "introduction" && <div className="space-y-5 p-6"><div><h3 className="text-[18px] font-semibold text-foreground">自我介绍</h3><p className="mt-2 text-[16px] leading-7 text-muted-foreground">用已确认的教育、工作或项目事实组织开场；不会为你补写经历或成果。</p></div><div className="grid gap-3 min-[860px]:grid-cols-2">{([1, 3] as const).map(minutes => <label key={minutes} className={`flex cursor-pointer items-center gap-3 rounded-[14px] border p-5 transition-colors ${introductionMinutes === minutes ? "border-ring bg-amber-50" : "border-border bg-white hover:bg-muted"}`}><input type="radio" name="introduction-minutes" checked={introductionMinutes === minutes} disabled={busy} onChange={() => setIntroductionMinutes(minutes)} className="size-4 accent-[#C4622D]"/><span><span className="block text-[18px] font-semibold text-foreground">{minutes} 分钟</span><span className="mt-1 block text-[14px] leading-6 text-muted-foreground">{minutes === 1 ? "练开场与一个核心项目" : "练完整经历线与转岗动机"}</span></span></label>)}</div><div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-card px-4 py-3"><p className="text-[14px] text-muted-foreground">会直接进入现有训练流程，不新建第二套训练记录。</p><button className={primaryButton} disabled={busy || noCards} onClick={() => navigate(() => onIntroductionPractice(introductionMinutes))}><Play size={18}/>练习 {introductionMinutes} 分钟自我介绍</button></div></div>}
      </section>
      {!modelAvailable && mode !== "introduction" && <p role="alert" className="rounded-lg bg-amber-50 p-4 text-[16px] text-amber-800">当前无法生成新题，请稍后重试；已有题组仍可查看和练习。</p>}
      {renderCandidate()}
      {busy && <section role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-4 rounded-[14px] border border-border bg-card p-5"><span className="text-[16px] text-muted-foreground">AI 正在生成并检查题目依据…</span><button className={secondaryButton} onClick={() => request.current?.abort()}>取消生成</button></section>}
    </div>;
  }
  function renderGroupDetail(group: GroupRecord) {
    const questions = questionsOf(group), current = groupIsCurrent(group, profile), training = groupTraining(group, sessions);
    return <section className="min-w-0 rounded-[14px] border border-border bg-white"><div className="border-b border-border p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-[20px] font-semibold text-foreground">{group.kind === "resume" ? "整份简历面试题" : "单段经历专项题"}</h2><span className={`rounded-full px-2.5 py-1 text-[13px] ${current ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{current ? training.label : "需重新核对"}</span></div><p className="mt-2 break-words text-[14px] leading-6 text-muted-foreground">{sourceLabel(group, profile)}</p><p className="mt-1 text-[14px] text-muted-foreground">{formatDate(group.set.createdAt)} · {questions.length} 道可练习题</p></div><div className="flex flex-wrap gap-2">{training.sessionId && training.label === "进行中" && onContinueTraining ? <button className={primaryButton} onClick={() => onContinueTraining(training.sessionId)}><Play size={18}/>继续训练</button> : <button className={primaryButton} disabled={!current || !questions.length || busy} onClick={() => onPracticeSet?.(group.set.id)}><Play size={18}/>开始训练</button>}<button className={secondaryButton} disabled={busy} onClick={() => openPreparation(group.kind)}><Sparkles size={17}/>重新生成</button>{onDeleteSet && <button className="rounded-md border border-border bg-white px-3 py-2 text-[14px] font-medium text-destructive transition-all hover:bg-red-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => onDeleteSet(group)}>删除题组</button>}</div></div>{!current && <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-[14px] leading-6 text-amber-800">题组依据的已确认经历已变化、删除或撤销确认。历史题组与训练记录仍保留，但不能继续按旧事实训练。</p>}{training.sessionId && <p className="mt-3 text-[14px] text-muted-foreground">训练状态：{training.detail}</p>}<GroupIssues issues={group.set.generationIssues}/></div><div className="divide-y divide-[#F0E7DC]">{questions.map((question, index) => <article key={question.id} className="p-5"><div className="flex items-start gap-3"><span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] text-muted-foreground">{index + 1}</span><div className="min-w-0 flex-1"><h3 className="break-words text-[18px] font-medium leading-8 text-foreground">{question.text}</h3><p className="mt-2 text-[14px] leading-6 text-muted-foreground">{questionEvidence(question, profile)}</p><details className="mt-3"><summary className="cursor-pointer text-[14px] font-medium text-muted-foreground transition-colors hover:text-foreground">查看提问原因与追问</summary><div className="mt-2 rounded-lg bg-card p-3 text-[14px] leading-6 text-muted-foreground"><p>{question.resumePracticeOrigin?.whyAsk ?? "围绕已确认经历的行动、判断与边界展开。"}</p>{question.resumePracticeOrigin?.followUps?.length ? <p className="mt-2">合理追问：{question.resumePracticeOrigin.followUps.join("；")}</p> : null}</div></details><div className="mt-4 flex flex-wrap gap-2"><button className={secondaryButton} disabled={!current || busy} onClick={() => navigate(() => onPractice(group.set.id, question.id))}>练习这道题</button><button className={secondaryButton} disabled={busy} onClick={() => hideQuestion(group, question.id, true)}>从本组移除</button></div></div></div></article>)}</div>{!questions.length && <p className="p-6 text-[16px] text-muted-foreground">本组没有可练习题目。</p>}{lastHidden?.group.set.id === group.set.id && <div className="border-t border-border bg-card px-5 py-4"><button className={secondaryButton} onClick={() => hideQuestion(group, lastHidden.questionId, false)}>恢复移除的题</button></div>}<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-5 py-4"><p className="text-[14px] text-muted-foreground">重新生成会新建题组；已练记录和历史题组都会保留。</p></div></section>;
  }
  function renderManagement() {
    const group = currentGroup;
    return <div className="space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[14px] text-muted-foreground">题组管理</p><h2 className="mt-1 text-[22px] font-semibold text-foreground">回来继续练，或查看历史题组</h2><p className="mt-2 text-[16px] leading-7 text-muted-foreground">每次生成都会保留一组；全局简历题组不会因岗位切换而消失。</p></div><button className={secondaryButton} onClick={() => openPreparation("resume")}><ChevronLeft size={18}/>新建题组</button></div><div className="grid min-w-0 gap-5 min-[1100px]:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.45fr)]"><aside className="min-w-0"><div className="rounded-[14px] border border-border bg-white"><div className="border-b border-border p-4"><p className="text-[16px] font-semibold text-foreground">已保存题组</p><p className="mt-1 text-[14px] text-muted-foreground">共 {groupList.length} 组</p></div><div className="divide-y divide-[#F0E7DC]">{groupList.map(item => { const active = item.set.id === group?.set.id, training = groupTraining(item, sessions); return <button key={item.set.id} type="button" onClick={() => openGroup(item)} className={`w-full p-4 text-left transition-colors ${active ? "bg-amber-50" : "bg-white hover:bg-muted"}`}><span className="flex items-center justify-between gap-3"><span className="min-w-0 break-words text-[16px] font-medium text-foreground">{item.kind === "resume" ? "整份简历题" : "单段经历专项"}</span><span className={`shrink-0 rounded-full px-2 py-1 text-[12px] ${training.label === "进行中" ? "bg-indigo-50 text-indigo-700" : training.label === "已完成" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{training.label}</span></span><span className="mt-2 block break-words text-[14px] text-muted-foreground">{item.kind === "resume" ? `${item.set.sources.length} 段经历` : item.set.title}</span><span className="mt-2 block text-[13px] text-muted-foreground">{questionsOf(item).length} 题 · {formatDate(item.set.createdAt)}</span></button>; })}</div>{!groupList.length && <p className="p-5 text-[16px] leading-7 text-muted-foreground">还没有已保存题组。先选择准备方向并生成题目。</p>}</div></aside><main className="min-w-0">{group ? renderGroupDetail(group) : <div className="rounded-[14px] border border-dashed border-border bg-card p-8 text-center"><FileText className="mx-auto text-primary" size={28}/><h3 className="mt-3 text-[18px] font-semibold text-foreground">选择一个题组查看详情</h3><p className="mt-2 text-[16px] leading-7 text-muted-foreground">题组生成后会保留在这里，可随时继续训练。</p></div>}</main></div></div>;
  }
  return <div className="min-w-0 space-y-6" aria-label="简历专项">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[14px] text-muted-foreground">准备 / 简历题组</p><h1 className="mt-1 text-[28px] font-semibold tracking-[-0.02em] text-foreground">准备面试题</h1><p className="mt-2 text-[16px] leading-7 text-muted-foreground">只使用已确认经历生成题目；候选经历与第三方资料不会当作个人事实。</p></div><div className="flex flex-wrap gap-2"><button className={view === "prepare" ? primaryButton : secondaryButton} onClick={() => openPreparation(mode)}><Sparkles size={18}/>准备题组</button><button className={view === "manage" ? primaryButton : secondaryButton} onClick={() => setView("manage")}><UsersRound size={18}/>题组管理</button></div></header>
    {notice && <p role={/失败|变化|无法|请先|未保存|取消/.test(notice) ? "alert" : "status"} className={`rounded-lg p-4 text-[16px] leading-7 ${/失败|变化|无法|请先|未保存/.test(notice) ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{notice}</p>}
    {view === "prepare" ? renderPreparation() : renderManagement()}
  </div>;
}
