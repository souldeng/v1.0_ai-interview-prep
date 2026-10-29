import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Search, Star } from "lucide-react";
import type { InterviewProject } from "../../lib/domain";
import type { AnswerReuseDraft, LibraryAnswerStatus, LibraryQuestion, QuestionLibraryState } from "../../lib/questionLibrary";
import { questionSourceLabel } from "../../lib/questionSource";
import { useSafeNavigation, useUnsavedChanges } from "../shared/UnsavedChanges";

type ExportFormat = "docx" | "pdf";
const statusLabel: Record<LibraryAnswerStatus, string> = { unanswered: "未作答", answered: "已有原回答", final: "已有最终答案" };

interface QuestionLibraryProps {
  entries: LibraryQuestion[];
  visibleEntries?: LibraryQuestion[];
  projects: InterviewProject[];
  state: QuestionLibraryState;
  onToggleFavorite: (key: string) => void;
  onSaveFinal: (entry: LibraryQuestion, answer: string) => string | null;
  onOpenPractice: (projectId: string) => void;
  onRecordedPractice?: (questionId: string) => void;
  onCreateReuse: (source: LibraryQuestion, target: LibraryQuestion) => string | null;
  onSaveReuse: (id: string, answer: string) => string | null;
  onConfirmReuse: (draft: AnswerReuseDraft, target: LibraryQuestion) => string | null;
  onExport: (entry: LibraryQuestion, format: ExportFormat) => void;
}

export function QuestionLibrary({ entries, visibleEntries = entries, projects, state, onToggleFavorite, onSaveFinal, onOpenPractice, onRecordedPractice, onCreateReuse, onSaveReuse, onConfirmReuse, onExport }: QuestionLibraryProps) {
  const navigate = useSafeNavigation();
  const [search, setSearch] = useState(""); const [jobId, setJobId] = useState("all"); const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | LibraryAnswerStatus>("all"); const [favoritesOnly, setFavoritesOnly] = useState(false); const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [finalDraft, setFinalDraft] = useState(""); const [reuseTargetKey, setReuseTargetKey] = useState(""); const [reuseEdits, setReuseEdits] = useState<Record<string, string>>({}); const [notice, setNotice] = useState("");
  const categories = useMemo(() => [...new Set(visibleEntries.map(item => item.category))].sort(), [visibleEntries]);
  const filtered = useMemo(() => visibleEntries.filter(item => {
    const keywords = `${item.question}\n${item.projectName}\n${item.originalAnswer}\n${item.finalAnswer}`.toLocaleLowerCase();
    return (jobId === "all" || (item.associatedProjectId ?? item.projectId) === jobId) && (category === "all" || item.category === category) && (status === "all" || item.answerStatus === status)
      && (!favoritesOnly || item.favorite) && (!search.trim() || keywords.includes(search.trim().toLocaleLowerCase()));
  }), [visibleEntries, jobId, category, status, favoritesOnly, search]);
  const selected = filtered.find(item => item.key === selectedKey) ?? filtered[0] ?? null;
  useEffect(() => {
    if (selected && selected.key !== selectedKey) {
      setSelectedKey(selected.key);
      setFinalDraft(selected.finalAnswer);
    }
  }, [selected?.key, selected?.finalAnswer, selectedKey]);
  const targetOptions = selected?.projectId ? entries.filter(item => item.projectId && item.projectId !== selected.projectId) : [];
  const reuseDrafts = selected ? state.reuseDrafts.filter(draft => draft.targetKey === selected.key) : [];
  const choose = (entry: LibraryQuestion) => navigate(() => { setSelectedKey(entry.key); setFinalDraft(entry.finalAnswer); setReuseTargetKey(""); setNotice(""); });
  const saveFinal = () => { if (!selected) return "请先选择题目。"; const message = onSaveFinal(selected, finalDraft); setNotice(message ?? "最终确认答案已保存到对应训练记录。"); if (!message) setFinalDraft(finalDraft.trim()); return message; };
  const changedReuse = state.reuseDrafts.some(draft => reuseEdits[draft.id] !== undefined && reuseEdits[draft.id] !== draft.answer);
  useUnsavedChanges("library-answers", Boolean(selected && finalDraft !== selected.finalAnswer) || changedReuse, {
    label: "题库答案", save: () => changedReuse ? "请先逐份保存引用草稿，再离开；修改仍保留。" : saveFinal(),
    discard: () => { setFinalDraft(selected?.finalAnswer ?? ""); setReuseEdits({}); },
  });
  const createReuse = () => {
    if (!selected || !reuseTargetKey) return;
    const target = entries.find(item => item.key === reuseTargetKey); if (!target) return;
    const message = onCreateReuse(selected, target); setNotice(message ?? "已建立目标岗位的独立答案草稿；来源答案不会被修改。"); if (!message) setReuseTargetKey("");
  };
  const saveReuse = (draft: AnswerReuseDraft) => { const message = onSaveReuse(draft.id, reuseEdits[draft.id] ?? draft.answer); setNotice(message ?? "目标岗位答案草稿已保存。"); };
  const confirmReuse = (draft: AnswerReuseDraft) => {
    if (!selected) return; const message = onConfirmReuse({ ...draft, answer: reuseEdits[draft.id] ?? draft.answer }, selected); setNotice(message ?? "已由你确认并保存为目标岗位的最终答案。");
    if (!message) setFinalDraft((reuseEdits[draft.id] ?? draft.answer).trim());
  };

  if (!visibleEntries.length) return <p className="py-4 text-sm text-slate-600">这里还没有已保存的题目或回答。</p>;
  return <div className="space-y-5">
    {selected?.recordedQuestionId && <button onClick={() => navigate(() => onRecordedPractice?.(selected.recordedQuestionId!))} className="rounded-lg bg-blue-700 px-4 py-2.5 text-sm text-white">再次练习这道题</button>}
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><label className="relative block xl:col-span-2"><Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={17}/><input value={search} onChange={event => { const value = event.target.value; navigate(() => setSearch(value)); }} placeholder="搜索题目、岗位或已有回答" className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-700"/></label><select aria-label="按岗位筛选" value={jobId} onChange={event => { const value = event.target.value; navigate(() => setJobId(value)); }} className="rounded-lg border border-slate-300 px-3 text-sm"><option value="all">全部岗位与记录</option>{projects.map(project => <option key={project.id} value={project.id}>{project.jobTitle || "未命名岗位"}</option>)}</select><select aria-label="按题型筛选" value={category} onChange={event => { const value = event.target.value; navigate(() => setCategory(value)); }} className="rounded-lg border border-slate-300 px-3 text-sm"><option value="all">全部题型</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select><select aria-label="按答案状态筛选" value={status} onChange={event => { const value = event.target.value as "all" | LibraryAnswerStatus; navigate(() => setStatus(value)); }} className="rounded-lg border border-slate-300 px-3 text-sm"><option value="all">全部答案状态</option><option value="unanswered">未作答</option><option value="answered">已有原回答</option><option value="final">已有最终答案</option></select></div><label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={favoritesOnly} onChange={event => { const value = event.target.checked; navigate(() => setFavoritesOnly(value)); }}/>仅看收藏</label></section>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]"><section className="space-y-3">{filtered.length ? filtered.map(entry => <article key={entry.key} className={`rounded-xl border bg-white p-4 shadow-sm ${selected?.key === entry.key ? "border-blue-300 ring-1 ring-blue-100" : "border-slate-200"}`}><div className="flex items-start justify-between gap-3"><button onClick={() => choose(entry)} className="min-w-0 flex-1 text-left"><div className="flex flex-wrap gap-2 text-xs"><span className="rounded bg-blue-50 px-2 py-1 text-blue-700">{entry.projectName}</span><span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{entry.category}</span><span className="rounded bg-slate-100 px-2 py-1 text-slate-600">{questionSourceLabel(entry)}</span><span className={`rounded px-2 py-1 ${entry.answerStatus === "final" ? "bg-emerald-50 text-emerald-700" : entry.answerStatus === "answered" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{statusLabel[entry.answerStatus]}</span></div><h2 className="mt-3 font-medium leading-6 text-slate-950">{entry.question}</h2><p className="mt-2 line-clamp-2 text-sm text-slate-500">来源：{questionSourceLabel(entry)} · {entry.source}</p></button><button aria-label={entry.favorite ? "取消收藏" : "收藏题目"} onClick={() => { if (favoritesOnly && selected?.key === entry.key) navigate(() => onToggleFavorite(entry.key)); else onToggleFavorite(entry.key); }} className={`rounded-lg p-2 ${entry.favorite ? "text-amber-500" : "text-slate-400 hover:bg-slate-50"}`}><Star size={18} fill={entry.favorite ? "currentColor" : "none"}/></button></div></article>) : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">没有符合当前筛选条件的既有题目。</p>}</section>
      {selected && <aside className="min-w-0 h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-24"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-slate-500">{selected.projectName} · {selected.company}</p><h2 className="mt-2 font-semibold leading-6 text-slate-950">{selected.question}</h2></div>{selected.projectId && <button onClick={() => navigate(() => onOpenPractice(selected.projectId!))} className="shrink-0 rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50" title="进入对应岗位训练"><ExternalLink size={17}/></button>}</div><p className="mt-3 text-sm leading-6 text-slate-600">来源：{questionSourceLabel(selected)} · {selected.source}</p><Detail label="原回答" value={selected.originalAnswer || "（未填写）"}/>{selected.suggestion && <Detail label="既有改进建议" value={selected.suggestion}/>}<label className="mt-4 block text-sm font-medium text-slate-700">最终确认答案<textarea value={finalDraft} onChange={event => setFinalDraft(event.target.value)} maxLength={12000} placeholder="只有手动保存的内容才会成为最终确认答案。" className="mt-2 min-h-32 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-blue-700"/></label><button onClick={saveFinal} disabled={!selected.sessionId || selected.turnIndex === undefined} className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">保存最终答案</button>{!selected.sessionId && <p className="mt-2 text-xs leading-5 text-amber-700">{selected.recordedQuestionId ? "本题尚无已提交回答；先练习作答，再保存本人认可的思路。" : "该题只有岗位题目、尚无对应训练轮次；请先进入岗位作答后再保存最终答案。"}</p>}<div className="mt-5 flex flex-wrap gap-2"><button onClick={() => onExport(selected, "docx")} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Download size={16}/>导出 DOCX</button><button onClick={() => onExport(selected, "pdf")} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Download size={16}/>导出 PDF</button></div>{selected.finalAnswer.trim() && targetOptions.length > 0 && <section className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-medium text-slate-950">引用到另一个岗位</h3><p className="mt-1 text-sm leading-6 text-slate-600">复制为目标岗位的独立草稿，不会改动来源答案，也不会自动标记为最终答案。</p><div className="mt-3 flex gap-2"><select aria-label="选择引用目标题目" value={reuseTargetKey} onChange={event => setReuseTargetKey(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">选择目标岗位题目</option>{targetOptions.map(item => <option key={item.key} value={item.key}>{item.projectName}｜{item.question.slice(0, 28)}</option>)}</select><button onClick={createReuse} disabled={!reuseTargetKey} className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 disabled:opacity-50">创建草稿</button></div></section>}{reuseDrafts.length > 0 && <section className="mt-6 border-t border-slate-200 pt-5"><h3 className="font-medium text-slate-950">来自其他岗位的答案草稿</h3>{reuseDrafts.map(draft => <div key={draft.id} className="mt-3 rounded-lg bg-slate-50 p-3"><textarea aria-label="跨岗位答案草稿" value={reuseEdits[draft.id] ?? draft.answer} onChange={event => setReuseEdits(current => ({ ...current, [draft.id]: event.target.value }))} className="min-h-24 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm leading-6"/><div className="mt-2 flex flex-wrap gap-2"><button onClick={() => saveReuse(draft)} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700">保存草稿</button><button onClick={() => confirmReuse(draft)} disabled={!selected.sessionId || selected.turnIndex === undefined} className="rounded border border-emerald-200 px-3 py-1.5 text-xs text-emerald-700 disabled:opacity-50">本人确认并保存最终答案</button></div>{draft.confirmedAt && <p className="mt-2 text-xs text-emerald-700">已于 {new Date(draft.confirmedAt).toLocaleDateString("zh-CN")} 保存为目标岗位最终答案。</p>}</div>)}</section>}{notice && <p role="status" className="mt-4 text-sm text-blue-700">{notice}</p>}</aside>}</div>
  </div>;
}

function Detail({ label, value }: { label: string; value: string }) { return <section className="mt-4"><h3 className="text-sm font-medium text-slate-700">{label}</h3><p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">{value}</p></section>; }
