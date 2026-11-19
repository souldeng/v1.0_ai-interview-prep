import { useEffect, useRef, useState } from "react";
import { FileDown, MoreHorizontal, TriangleAlert } from "lucide-react";
import type { InterviewProject } from "../../lib/domain";
import { activeCollectionMaterials, analysisSources, collectionKindLabels, collectionVersion, createCollectedMaterial, currentCollectionAnalysis, emptyCollection, groupContinuousScreenshots, nextCollectionBatch, removeFromCollectionBatch, saveCollectionAttempt, normalizeCollectedQuestion, type CollectedMaterial, type CollectionAnalysis, type MaterialCollection as Collection } from "../../lib/materialCollection";
import { extractResumeText } from "../../lib/documentParser";
import { getMaterialFile, storeMaterialFile } from "../../lib/materialFileStorage";
import { organizeCollectionMaterials } from "../../services/modelClient";
import { Original } from "../jobs/JobMaterials";
import { useSafeNavigation, useUnsavedChanges } from "../shared/UnsavedChanges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";

const button = "rounded-md border border-border bg-white px-4 py-2 text-[16px] text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const accept = ".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg";
type NoticeTone = "info" | "success" | "error";
export function MaterialCollection({ value, projects, modelAvailable, onSave, onLink, onPractice, initialAnalysisId, onOpenBatchImport }: {
  value?: Collection; projects: InterviewProject[]; modelAvailable: boolean; onSave: (value: Collection) => string | null;
  onLink: (material: CollectedMaterial, projectId: string) => string | null; onPractice: (analysisId: string, questionId: string) => void;
  initialAnalysisId?: string | null;
  /** 跳转到题库「批量导入题目」：已有整理好的题库不走 AI 提取链路。 */
  onOpenBatchImport?: () => void;
}) {
  const collection = value ?? emptyCollection();
  const working = useRef(collection); working.current = collection;
  const [selected, setSelected] = useState<string[] | null>(null), [opened, setOpened] = useState<string | null>(null), [text, setText] = useState("");
  const [area,setArea] = useState<"new"|"archive"|"questions">(initialAnalysisId ? "questions" : "new");
  const [showSources,setShowSources] = useState(false);
  const [busy, setBusy] = useState(false), [parsing, setParsing] = useState(false), [notice, setNoticeValue] = useState(""), [noticeTone, setNoticeTone] = useState<NoticeTone>("info"), [progress, setProgress] = useState("");
  const [pending, setPending] = useState<CollectionAnalysis | null>(null), [pendingSaveFailed, setPendingSaveFailed] = useState(false), [viewId, setViewId] = useState<string | null>(initialAnalysisId ?? null), [deleted, setDeleted] = useState<string | null>(null);
  const batchCache = useRef<NonNullable<Collection["extractions"]>>([]);
  const [elapsed, setElapsed] = useState(0);
  const operation = useRef(false), controller = useRef<AbortController | null>(null), input = useRef<HTMLInputElement>(null), files = useRef(new Map<string, File>());
  const navigate = useSafeNavigation();
  const setNotice = (message: string, tone: NoticeTone = "info") => { setNoticeValue(message); setNoticeTone(tone); };
  useEffect(() => { if (!busy) return; const start = Date.now(), timer = setInterval(() => setElapsed(Math.floor((Date.now()-start)/1000)), 1000); return () => clearInterval(timer); }, [busy]);
  useEffect(() => { const cancel = () => controller.current?.abort(); window.addEventListener("pagehide", cancel); return () => { cancel(); window.removeEventListener("pagehide", cancel); }; }, []);
  const commit = (next: Collection) => { const error = onSave(next); if (error) throw new Error(error); working.current = next; };
  const patch = (id: string, update: Partial<CollectedMaterial>) => commit({ ...working.current, materials: working.current.materials.map(m => m.id === id ? { ...m, ...update, updatedAt: new Date().toISOString() } : m) });
  useUnsavedChanges("collection-operation", busy || parsing || Boolean(pending) || Boolean(text.trim()), {
    label: "收集资料与整理结果", save: () => {
      if (busy || parsing) return "正在处理资料，请先等待完成或取消AI整理。";
      try { if (pending) persist(pending); if (text.trim()) addText(); return null; } catch (e) { return String(e instanceof Error ? e.message : e); }
    }, discard: () => { if (parsing) throw new Error("正在识别并自动保存资料，请稍候。"); controller.current?.abort(); setPending(null); setText(""); },
  });
  async function recognize(item: CollectedMaterial, file?: File) {
    const original = file ?? files.current.get(item.id) ?? await getMaterialFile(item.fileId ?? item.id).then(f => f ? new File([f.blob], f.name, { type: f.type }) : undefined);
    if (!original) throw new Error("原文件未保存，请重新选择文件；已有文字仍可编辑。");
    patch(item.id, { processing: "processing", error: undefined });
    if (!item.originalSaved) { setProgress(`${item.title}：正在保存原图…`); await storeMaterialFile(item.id, original); patch(item.id, { fileId: item.id, originalSaved: true }); }
    const result = await extractResumeText(original, p => setProgress(`${item.title}：${p.status} ${p.progress}%`));
    if (!result.text.trim()) throw new Error("未识别到文字，可打开详情手工录入。");
    const latest = working.current.materials.find(m => m.id === item.id)!;
    patch(item.id, { processing: "recognized", initialContent: latest.initialContent || result.text, content: latest.reviewedAt ? latest.content : result.text, error: result.warning });
  }
  async function upload(incoming: File[]) {
    if (operation.current || !incoming.length) return;
    operation.current = true; setParsing(true); setNotice("");
    try {
      if (incoming.length > 20) throw new Error("一次最多添加20份资料，请分批上传。");
      if (working.current.materials.length + incoming.length > 80) throw new Error("已达到80份资料的本地安全上限，本次尚未添加；已有资料仍可查看、练习和备份。");
      const addedIds: string[] = [];
      for (const [index,file] of incoming.entries()) {
        setProgress(`正在处理 ${index + 1}/${incoming.length}：${file.name}`);
        const image = file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name);
        const mimeType = file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : image ? /\.png$/i.test(file.name) ? "image/png" : "image/jpeg" : "application/octet-stream");
        const item = { ...createCollectedMaterial(file.name), source: image ? "screenshot" as const : "file" as const, sourceFileName: file.name, sourceMimeType: mimeType };
        files.current.set(item.id,file);
        commit({ ...working.current, materials: [...working.current.materials, item], activeMaterialIds:[...activeCollectionMaterials(working.current).map(m=>m.id),item.id] });
        addedIds.push(item.id); setSelected(null);
        try { await recognize(item,file); } catch (error) {
          const message = error instanceof Error ? error.message : "识别失败";
          patch(item.id, { processing: "failed", error: message });
        }
      }
      const grouped = groupContinuousScreenshots(working.current);
      const newlyGrouped = grouped.materials.filter((material, index) => !working.current.materials[index].groupId && material.groupId).length;
      if (grouped !== working.current) commit(grouped);
      const completed=working.current.materials.filter(m=>addedIds.includes(m.id));
      setNotice(`上传完成：已识别 ${completed.filter(m=>m.processing==="recognized").length} 份，失败 ${completed.filter(m=>m.processing==="failed").length} 份。${newlyGrouped ? `已按明确重叠文字标记 ${newlyGrouped} 张连续截图。` : ""} 原件与文字已保留，失败项可单独重试。`, "success");
    } catch (error) { setNotice(`保存或识别失败：${error instanceof Error ? error.message : "请重试"}。当前文件仍保留，可重试。`, "error"); }
    finally { operation.current = false; setParsing(false); setProgress(""); }
  }
  async function retry(item: CollectedMaterial) {
    if (operation.current) return; operation.current = true; setParsing(true);
    try { await recognize(item); setNotice("识别结果已保存。", "success"); }
    catch (error) { const message = error instanceof Error ? error.message : "识别失败"; try { patch(item.id, { processing: "failed", error: message }); } catch { /* Existing data stays unchanged on storage failure. */ } setNotice(message, "error"); }
    finally { operation.current = false; setParsing(false); setProgress(""); }
  }
  function addText() {
    if (!text.trim()) return;
    const m = createCollectedMaterial(`粘贴资料 ${working.current.materials.length + 1}`, text.trim());
    commit({ ...working.current, materials: [...working.current.materials,m], activeMaterialIds:[...activeCollectionMaterials(working.current).map(item=>item.id),m.id] }); setText(""); setSelected(null); setNotice("文字已保存，等待AI整理。");
  }
  const active = activeCollectionMaterials(collection);
  const chosen = active.filter(m => selected === null || selected.includes(m.id));
  const current = currentCollectionAnalysis(collection, chosen);
  const analysis = collection.analyses.find(a => a.id === viewId) ?? current ?? collection.analyses.at(-1);
  useEffect(() => setDeleted(null), [analysis?.id]);
  function persist(result: CollectionAnalysis) {
    const next = saveCollectionAttempt(working.current,result);
    commit(next); setPending(null); setPendingSaveFailed(false); setViewId(currentCollectionAnalysis(next,analysisSources(result).map(s=>next.materials.find(m=>m.id===s.materialId)!))?.id ?? result.id);
  }
  function savePending() {
    if (!pending) return;
    try { persist(pending); setNotice("整理结果已确认保存。", "success"); }
    catch (error) { setPendingSaveFailed(true); setNotice(`保存失败，整理结果仍保留：${error instanceof Error ? error.message : "请重试"}`, "error"); }
  }
  async function organize(sources = chosen, retryId?:string) {
    if (operation.current) return;
    sources = sources.map(m=>working.current.materials.find(now=>now.id===m.id) ?? m);
    if (pending) { savePending(); return; }
    const previous = currentCollectionAnalysis(working.current,sources);
    if (previous && !previous.failures?.length && !previous.summaryError) { setViewId(previous.id); setNotice("已打开此前保存的结果，本次没有调用模型。"); return; }
    if (!previous && working.current.analyses.length >= 80) { setNotice("已达到80批整理结果的本地安全上限，本次未调用模型；已有结果仍可查看、练习和备份。"); return; }
    operation.current = true; const abort = new AbortController(); controller.current = abort; setBusy(true); setElapsed(0); setNotice("");
    try {
      const generated = await organizeCollectionMaterials(sources, { signal: abort.signal, retryIds: retryId ? [retryId] : undefined, previousFailures: previous?.failures, cached: [...batchCache.current, ...(working.current.extractions ?? []),...(previous?.items ?? [])], onProgress: setProgress, onBatch: batch => {
        batchCache.current = [...batchCache.current.filter(i => !batch.some(n => n.materialId === i.materialId)), ...batch];
        commit({ ...working.current, extractions: [...(working.current.extractions ?? []).filter(i => !batch.some(n => n.materialId === i.materialId)), ...batch] });
      } });
      if (abort.signal.aborted) return;
      if (!sources.every(m => working.current.materials.some(now => now.id === m.id && collectionVersion(now) === collectionVersion(m)))) throw new Error("资料已变化，请重新整理；已有结果仍保留。");
      setPending(generated); setPendingSaveFailed(false); setNotice(`智能整理完成：已生成 ${generated.questions.length} 道可练习题候选。请核对集中结果后确认保存。${generated.failures?.length || generated.summaryError ? "本批部分完成，请查看失败或待补充项。" : ""}`, "success");
    } catch (error) { setNotice(abort.signal.aborted ? "已取消整理，已有资料与结果仍保留；已提交请求的费用无法撤销。" : `${error instanceof Error ? error.message : "整理失败"} 已有资料与结果仍保留。`, abort.signal.aborted ? "info" : "error"); }
    finally { controller.current = null; operation.current = false; setBusy(false); setProgress(""); }
  }
  function remove(id:string) {
    navigate(()=>{try { commit(removeFromCollectionBatch(working.current,id));setSelected(ids=>ids?.filter(i=>i!==id)??null);if(opened===id)setOpened(null);setNotice("已从当前批次移除；原件及既有来源、训练历史未删除。可在已整理资料中找回。"); }catch(e){setNotice(`移除失败：${String(e)}`);} });
  }
  function nextBatch() {
    const saved = current ?? collection.analyses.find(a=>a.id===viewId);
    if (!saved || pending || operation.current) return;
    navigate(()=>{try { commit(nextCollectionBatch(working.current,saved));setSelected(null);setOpened(null);setText("");setViewId(null);setDeleted(null);setShowSources(false);batchCache.current=[];files.current.clear();setNotice("已开始下一批，归档资料、题目和训练历史仍保留；未整理的资料可在已整理资料的暂存区找回。"); }catch(e){setNotice(`开始下一批失败：${String(e)}`);} });
  }
  const retrySources = (a:CollectionAnalysis) => analysisSources(a).flatMap(s=>collection.materials.find(m=>m.id===s.materialId) ?? []);
  const result = area === "new" ? pending ?? current ?? collection.analyses.find(a=>a.id===viewId && analysisSources(a).some(s=>active.some(m=>m.id===s.materialId))) : analysis;
  const locked = busy || parsing || Boolean(pending);
  const sourceRows = area === "new" ? active : area === "archive" && showSources && analysis ? retrySources(analysis) : [];
  function resultOverview(a:CollectionAnalysis, saved:boolean) {
    const failures=a.failures ?? [], checks=a.items.filter(i=>i.warnings?.length || i.type==="mixed").length;
    // 只有真正异常时才提示；正常完成态不出现 amber 文案，多条异常合并为一个折叠入口。
    const anomalies:string[] = [];
    if (area==="new" && saved && a.id!==current?.id) anomalies.push("工作区或选择已有调整，以下仍为此前保存的结果。");
    if (a.summaryError) anomalies.push(`综合摘要未完成：${a.summaryError}`);
    if (a.summaryMaterialIds) anomalies.push(`仍保留上次成功摘要，仅覆盖此前 ${a.summaryMaterialIds.length} 份资料；尚未新增汇总。`);
    if (checks>0) anomalies.push(`${checks} 份资料需要对照原件检查，逐份原因见下方。`);
    return <section aria-label="本批整理结果" className="space-y-3 rounded-[16px] border border-border bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="flex flex-wrap items-center gap-2 text-[20px] font-semibold text-foreground">{failures.length || a.summaryError ? "部分完成" : "整理完成"}<Badge variant={saved ? "secondary" : "outline"} className={saved ? "bg-emerald-50 text-emerald-700" : "border-border text-muted-foreground"}>{saved ? "已保存" : "尚未保存"}</Badge></h3>
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground"><span>资料 {analysisSources(a).length}</span><span aria-hidden className="text-border">·</span><span>成功 {a.items.length}</span><span aria-hidden className="text-border">·</span><span>失败 {failures.length}</span><span aria-hidden className="text-border">·</span><span>待检查 {checks}</span><span aria-hidden className="text-border">·</span><span className="font-semibold text-primary">题目 {a.questions.filter(q=>!a.hiddenQuestionIds?.includes(q.id)).length}</span></p>
      </div>
      {anomalies.length > 0 && <details className="rounded-[10px] border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">
        <summary className="flex cursor-pointer items-center gap-1.5 font-medium"><TriangleAlert size={14} aria-hidden />本批异常（{anomalies.length}）</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">{anomalies.map(item => <li key={item} className="break-words">{item}</li>)}</ul>
        {checks>0 && <ul className="mt-2 space-y-1 border-t border-amber-200 pt-2">{a.items.flatMap(i=>(i.warnings??(i.type==="mixed"?["内容混合或类型不确定，请对照原件检查。"]:[])).map(w=><li key={`${i.materialId}-${w}`} className="break-words">{collection.materials.find(m=>m.id===i.materialId)?.title}：{w}</li>))}</ul>}
      </details>}
      <details className="text-[14px] text-muted-foreground"><summary className="cursor-pointer">整理摘要</summary><p className="mt-2 text-[15px] leading-7">{a.topics[0]?.text ?? a.priorities[0]?.text ?? (a.items.length ? `已整理${a.items.length}份资料，提取结果与问题保留原文来源。` : "尚无有效整理结果。")}</p></details>
      {!!a.items.filter(i=>i.type==="job_description").length && <details className="rounded-[10px] bg-card p-3 text-[14px] text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">JD 主要能力要求</summary><ul className="mt-2 list-inside list-disc space-y-1">{[...new Set(a.items.filter(i=>i.type==="job_description").flatMap(i=>i.requirements))].slice(0,5).map(t=><li key={t} className="break-words">{t}</li>)}</ul><p className="mt-2 text-[12px] text-muted-foreground">各资料分别保留，不代表同一家企业或同一个岗位。</p></details>}
      {!saved && a.questions.length > 0 && <section className="rounded-[12px] border border-border bg-card p-4"><div><h4 className="text-[17px] font-semibold text-foreground">候选练习题</h4><p className="mt-1 text-[14px] leading-6 text-muted-foreground">确认保存前，可修改 AI 衍生题的表述，或不采纳任意候选。第三方原题只允许保留或不采纳，避免改写原始来源。</p></div><div className="mt-3 space-y-3">{a.questions.map(question => { const hidden = Boolean(a.hiddenQuestionIds?.includes(question.id)); const editable = question.sourceType === "material_derived"; return <article key={question.id} className={`rounded-[10px] border p-3 ${hidden ? "border-border bg-white opacity-70" : "border-border bg-white"}`}><div className="flex flex-wrap items-start justify-between gap-3"><p className="text-[13px] font-medium text-primary">{question.sourceType === "third_party" ? "第三方资料原题" : "AI 衍生练习题"}</p><button className={button} onClick={() => setPendingQuestionHidden(question.id, !hidden)}>{hidden ? "恢复采纳" : "不采纳"}</button></div>{editable ? <Textarea aria-label={`编辑候选题目：${question.text}`} value={question.text} maxLength={300} disabled={hidden} onChange={event => editPendingQuestion(question.id, event.target.value)} className="mt-2 min-h-20 bg-white"/> : <p className="mt-2 text-[16px] leading-7 text-foreground">{question.text}</p>}<details className="mt-2 text-[14px] text-muted-foreground"><summary className="cursor-pointer">查看来源</summary><p className="mt-2 whitespace-pre-wrap break-words">{question.collectionOrigin?.evidenceQuote || "来源依据保留在整理结果中。"}</p></details></article>; })}</div></section>}
      {failures.map(f=><div key={f.materialId} className="space-y-2 rounded-md bg-amber-50 p-3"><p className="break-words text-sm text-amber-950">{f.message}</p><div className="flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={()=>navigate(()=>{setViewId(a.id);setOpened(f.materialId);setShowSources(true);setArea("archive");})}>查看并核对资料</button>{f.stage==="recognition" ? <button className={button} disabled={locked} onClick={()=>navigate(()=>void retry(working.current.materials.find(m=>m.id===f.materialId)!))}>重新识别此项</button> : <button className={button} disabled={locked || !modelAvailable} onClick={()=>navigate(()=>void organize(retrySources(a),f.materialId))}>重试此项整理</button>}</div></div>)}
      <div className="flex flex-wrap gap-2">{!saved && <Button data-cta="primary" disabled={busy || parsing} onClick={savePending}>{pendingSaveFailed ? "重试保存整理结果" : "确认保存整理结果"}</Button>}<button className={button} disabled={!saved || busy || parsing} onClick={()=>navigate(()=>{setViewId(a.id);setArea("questions");setOpened(null);})}>查看面试题</button>{saved && <button className={button} disabled={locked} onClick={()=>navigate(()=>{setViewId(a.id);setArea("archive");setShowSources(true);})}>查看原始资料</button>}{saved && area==="new" && <button className={button} disabled={locked} onClick={nextBatch}>开始下一批</button>}{saved && (failures.length>0 || a.summaryError) && <button className={button} disabled={locked || !modelAvailable} onClick={()=>navigate(()=>void organize(retrySources(a)))}>重试未完成项</button>}</div>
    </section>;
  }
  function move(id: string, delta: number) { try { const active = activeCollectionMaterials(working.current), index = active.findIndex(m => m.id === id), to = index + delta; if (to < 0 || to >= active.length) return; [active[index],active[to]] = [active[to],active[index]]; let cursor=0; const ids=new Set(active.map(m=>m.id)), list=working.current.materials.map(m=>ids.has(m.id)?active[cursor++]:m); commit({ ...working.current, materials:list.map((m,index)=>m.groupId && ids.has(m.id) ? {...m,groupOrder:list.slice(0,index).filter(other=>other.groupId===m.groupId && ids.has(other.id)).length}:m) }); } catch (e) { setNotice(String(e)); } }
  function group() { try { if (chosen.length < 2 || chosen.some(m => m.source !== "screenshot")) throw new Error("请选择至少两张属于同一来源的连续截图。"); const groupId = `source-${crypto.randomUUID()}`; commit({ ...working.current, materials: working.current.materials.map(m => chosen.some(c => c.id === m.id) ? { ...m, groupId, groupOrder: chosen.findIndex(c => c.id === m.id) } : m) }); setNotice("已按当前顺序标记为同一来源，原件与逐份文字分别保留。"); } catch (e) { setNotice(String(e instanceof Error ? e.message : e)); } }
  function hide(id: string, hidden = true) {
    if (!analysis) return;
    try { commit({ ...working.current, analyses: working.current.analyses.map(a => a.id === analysis.id ? { ...a,hiddenQuestionIds: hidden ? [...new Set([...(a.hiddenQuestionIds ?? []),id])] : (a.hiddenQuestionIds ?? []).filter(q => q !== id) } : a) }); setDeleted(hidden ? id : null); setNotice(hidden ? "已移除练习入口，训练历史仍保留。" : "题目已恢复。"); } catch (error) { setNotice(`保存失败：${error instanceof Error ? error.message : "请重试"}`); }
  }
  function setPendingQuestionHidden(id: string, hidden: boolean) {
    setPending(current => current ? { ...current, hiddenQuestionIds: hidden ? [...new Set([...(current.hiddenQuestionIds ?? []), id])] : (current.hiddenQuestionIds ?? []).filter(questionId => questionId !== id) } : current);
  }
  function editPendingQuestion(id: string, text: string) {
    const nextText = text.trimStart().slice(0, 300);
    const normalized = normalizeCollectedQuestion(nextText);
    if (!normalized || pending?.questions.some(question => question.id !== id && normalizeCollectedQuestion(question.text) === normalized)) {
      setNotice("题目不能为空，也不能与其他候选题重复。", "error");
      return;
    }
    setPending(current => {
      if (!current) return current;
      const target = current.questions.find(question => question.id === id);
      if (!target || target.sourceType !== "material_derived") return current;
      const origin = target.collectionOrigin;
      return { ...current,
        questions: current.questions.map(question => question.id === id ? { ...question, text: nextText } : question),
        items: current.items.map(item => item.materialId === origin?.materialId ? { ...item, questions: item.questions.map(question => question.text === target.text && question.evidenceQuote === origin?.evidenceQuote ? { ...question, text: nextText } : question) } : item),
      };
    });
  }
  return <section aria-label="面试资料收集" className="min-w-0 space-y-5">
    <header><p className="text-[14px] font-medium text-primary">JD 与面经</p><h2 className="mt-1 text-[26px] font-semibold tracking-tight text-foreground">收集资料，整理练习题</h2><p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">先核对资料文字，再整理成可练习的题目；第三方面经不会作为个人经历使用。</p></header>
    <nav aria-label="资料收集区域" className="flex flex-wrap gap-2 rounded-[12px] border border-border bg-white p-1">{([['new','新建收集'],['archive','已整理资料'],['questions','面试题集']] as const).map(([id,label])=><button key={id} className={`rounded-[9px] px-4 py-2 text-[16px] font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${area===id?'bg-accent text-primary':'text-muted-foreground hover:bg-muted'}`} aria-pressed={area===id} disabled={busy || parsing} onClick={()=>navigate(()=>{setArea(id);setOpened(null);})}>{label}</button>)}</nav>
    {notice && <p role={noticeTone === "error" ? "alert" : "status"} aria-live="polite" className={`whitespace-pre-wrap break-words text-[15px] ${noticeTone === "error" ? "text-red-700" : noticeTone === "success" ? "text-emerald-800" : "text-muted-foreground"}`}>{notice}</p>}
    {area === "new" && <section className="space-y-4 rounded-[16px] border border-border bg-white p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-[20px] font-semibold text-foreground">添加资料</h3><p className="mt-1 text-[15px] text-muted-foreground">支持截图、PDF、文档与粘贴文字；会按上传顺序保留来源。</p></div>{active.length > 0 && <span className="rounded-full bg-accent px-3 py-1 text-[14px] font-medium text-primary">本批 {active.length} 份</span>}</div>
      <div tabIndex={0} className="rounded-[12px] border-2 border-dashed border-border bg-card p-6 text-center transition-colors focus:border-ring" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(Array.from(e.dataTransfer.files)); }} onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); void upload(Array.from(e.clipboardData.files)); } }}>
        <p className="mb-3 text-[16px] text-muted-foreground">一次添加多张截图或文档，系统会依次识别并保留原件</p>
        <Button data-cta="primary" disabled={locked} onClick={() => input.current?.click()} className="px-4">{parsing ? "正在识别并保存…" : "批量添加文件"}</Button><input ref={input} aria-label="上传面试收集资料" type="file" accept={accept} multiple className="sr-only" disabled={locked} onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = ""; }}/>
      </div>
      <Textarea aria-label="粘贴面试资料" disabled={locked} value={text} onChange={e => setText(e.target.value)} className="min-h-24 bg-white" placeholder="粘贴JD、面经或知识笔记…"/>
      <Button variant="outline" disabled={locked || !text.trim()} onClick={() => { try { addText(); } catch (e) { setNotice(`保存失败，文字仍保留：${String(e)}`); } }}>添加文字</Button>
      {onOpenBatchImport && <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-dashed border-border bg-card p-4">
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-foreground">已经有整理好的题目？</p>
          <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">Markdown 题库、ChatGPT 预测题、真实面试题列表走「导入已有题目」：本机解析后整批入库，不调用 AI，也不适用整理的 8 题控制。</p>
        </div>
        <Button variant="outline" disabled={locked} onClick={() => navigate(() => onOpenBatchImport())}>导入已有题目</Button>
      </div>}
      <details className="text-[13px] leading-6 text-muted-foreground"><summary className="cursor-pointer">查看处理说明</summary><div className="mt-2 space-y-1.5"><p>整理只发送本批已识别的文字和资料序号，不会发送原图、个人资料或未确认经历。</p><p>连续截图只在有明确重叠文字时自动标记；原件不包含在 JSON 备份中，请另存。</p><p>这里的「智能整理」用于 JD、第三方面经与零散文字的重点提取：产出可练习题与重点，不承诺保留全部原文题目。</p><p>已整理好的 Markdown 题库请用上方「导入已有题目」，不需要再次整理。</p></div></details>
    </section>}
    {result && area!=="questions" && resultOverview(result,!pending)}
    {area !== "new" && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-6"><h3 className="font-semibold">{area==="archive" ? "已归档批次" : "选择面试题集"}（{collection.analyses.length}）</h3><div className="flex flex-wrap gap-2">{collection.analyses.map((a,index)=><button key={a.id} className={button} aria-pressed={analysis?.id===a.id} disabled={locked} onClick={()=>navigate(()=>{setViewId(a.id);setOpened(null);setShowSources(false);})}>第{index+1}批 · {analysisSources(a).length}份 · {new Date(a.createdAt).toLocaleString("zh-CN")}</button>)}</div>{!analysis && <p className="text-sm text-slate-600">尚无整理结果，请先在新建收集中添加资料并整理。</p>}
      {area==="archive" && collection.materials.some(m=>!active.some(n=>n.id===m.id) && !collection.analyses.some(a=>analysisSources(a).some(s=>s.materialId===m.id))) && <details className="text-sm"><summary className="cursor-pointer">暂存资料（未归档、未永久删除）</summary>{collection.materials.filter(m=>!active.some(n=>n.id===m.id)&&!collection.analyses.some(a=>analysisSources(a).some(s=>s.materialId===m.id))).map(m=><div key={m.id} className="mt-2 flex flex-wrap items-center gap-2"><span className="break-words">{m.title}</span><button className={button} disabled={locked} onClick={()=>navigate(()=>{try{commit({...working.current,activeMaterialIds:[...activeCollectionMaterials(working.current).map(s=>s.id),m.id]});setArea("new");setSelected(null);}catch(e){setNotice(`恢复失败：${String(e)}`)}})}>放回新建收集</button></div>)}</details>}
    </section>}
    {(area === "new" || sourceRows.length>0) && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{area==="new" ? `原始资料（${active.length}）` : "本批原始资料"}</h3>{area==="new" && <div className="flex flex-wrap gap-2"><button className={button} disabled={locked || !active.length} onClick={() => navigate(()=>setSelected(chosen.length === active.length ? [] : active.map(m => m.id)))}>{chosen.length === active.length ? "取消全选" : "全选资料"}</button><button className={button} disabled={locked || chosen.length < 2} onClick={()=>navigate(group)}>将所选标为连续资料</button></div>}</div>
      {area==="new" && active.length>0 && <p className="text-xs text-slate-600">已选 {chosen.length} 份，仅整理所选资料。</p>}
      {sourceRows.map((m,index) => { const extracted = collection.extractions?.find(i => i.materialId === m.id && i.contentVersion === collectionVersion(m)); return <article key={m.id} className="min-w-0 rounded-lg border border-slate-200 p-4">
        <div className="flex items-start gap-3">{area==="new" && <input aria-label={`选择资料 ${m.title}`} type="checkbox" disabled={locked} checked={selected === null || selected.includes(m.id)} onChange={e => navigate(()=>setSelected(e.target.checked ? [...(selected ?? active.map(i => i.id)), m.id] : (selected ?? active.map(i => i.id)).filter(id => id !== m.id)))}/>}<div className="min-w-0 flex-1"><h4 className="break-words font-medium">{index+1}. {m.title}</h4><p className="mt-1 text-xs text-slate-600">{extracted ? collectionKindLabels[extracted.type] : "待AI分类"} · {m.processing === "processing" ? "处理中 / 若已刷新可重试" : m.processing === "failed" ? "识别失败" : m.reviewedAt ? "已核对" : "已识别 · 待检查"}{m.groupId ? " · 连续截图" : ""}</p></div></div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className={button} disabled={locked} onClick={() => navigate(() => setOpened(opened === m.id ? null : m.id))}>{opened === m.id ? "收起详情" : "查看 / 核对"}</button>
          {m.processing === "failed" && m.source !== "manual_text" && <button className={button} disabled={locked} onClick={() => navigate(()=>void retry(m))}>重新识别</button>}
          {area==="new" && <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-1 text-[13px] text-muted-foreground hover:text-foreground" aria-label="更多" disabled={locked}><MoreHorizontal size={15} />更多</Button>} />
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem disabled={locked || index === 0} onClick={() => navigate(()=>move(m.id,-1))}>上移</DropdownMenuItem>
              <DropdownMenuItem disabled={locked || index === active.length-1} onClick={() => navigate(()=>move(m.id,1))}>下移</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={locked} onClick={()=>remove(m.id)}>移除本批文件</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
        </div>
        {m.processing === "failed" && <p role="alert" className="mt-2 text-sm text-red-700">{m.error}</p>}
        {opened === m.id && <CollectionMaterialDetail key={m.id} material={m} projects={projects} disabled={locked} onSave={update => { try { patch(m.id,update); return null; } catch (e) { return String(e instanceof Error ? e.message : e); } }} onLink={projectId => onLink({ ...m, kind: extracted?.type === "job_description" ? "job_description" : extracted?.type === "interview_experience" ? "interview_experience" : "reference" },projectId)}/>}
      </article>; })}
      {area==="new" && !active.length && <p className="text-sm text-slate-500">添加资料后会自动保存，可一次整理多份。</p>}
    </section>}
    {area==="new" && !pending && <div className="space-y-2"><Button data-cta="primary" disabled={busy || parsing || !chosen.length || !modelAvailable} onClick={() => navigate(()=>void organize())}>{busy ? `正在智能整理 · ${elapsed}秒` : "开始智能整理"}</Button>{!modelAvailable && active.length > 0 && <p role="status" className="text-sm text-amber-900">暂未配置 AI 整理，已识别文字与原件仍可核对和保存。</p>}</div>}
    {(busy || parsing) && <p role="status" aria-live="polite" className="text-sm text-slate-700">{progress}{busy ? ` · 已等待${elapsed}秒` : ""}</p>}{busy && <button className={button} onClick={() => controller.current?.abort()}>取消整理</button>}
    {analysis && area!=="new" && <section className="space-y-4" aria-label="资料整理结果"><h3 className="text-lg font-semibold">{area==="questions" ? "本批面试题" : "整理摘要与准备重点"}</h3>{analysis.items.some(i=>!collection.materials.some(m=>m.id===i.materialId && collectionVersion(m)===i.contentVersion)) && <p className="text-sm text-amber-900">原资料已有变化，当前仍展示生成时保存的结果及依据。</p>}
      {area==="archive" && <>
      <details className="rounded-xl border border-slate-200 bg-white p-5 text-sm"><summary className="cursor-pointer font-medium">逐份资料的分类与提取内容</summary>{analysis.items.map(i=><section key={i.materialId} className="mt-4 space-y-2 border-t border-slate-100 pt-3"><h4 className="break-words font-medium">{collection.materials.find(m=>m.id===i.materialId)?.title} · {collectionKindLabels[i.type]}</h4>{i.jobTitle && <p>原文岗位名：{i.jobTitle}</p>}{([['duties','职责'],['requirements','要求'],['skills','技能'],['knowledgePoints','知识点']] as const).map(([key,label])=>i[key].length>0 && <div key={key}><p>{label}</p><ul className="list-inside list-disc">{i[key].map((v,index)=><li key={index} className="break-words">{v}</li>)}</ul></div>)}<details><summary className="cursor-pointer">生成时的原文快照</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.parse(i.contentVersion)[0]}</p></details></section>)}</details>
      {([['commonRequirements','岗位共同能力要求'],['topics','主要面试考点'],['priorities','建议优先准备']] as const).map(([key,label]) => analysis[key].length > 0 && <section key={key} className="rounded-xl border border-slate-200 bg-white p-5"><h4 className="font-medium">{label}</h4>{analysis[key].map((row,index) => <div key={index} className="mt-3"><p className="text-sm leading-6">{row.text}</p><details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer">查看依据</summary>{row.evidence.map((e,i) => <p key={i} className="mt-2 break-words">{collection.materials.find(m => m.id === e.materialId)?.title}：{e.quote}</p>)}</details></div>)}</section>)}
      </>}
      {area==="questions" && !analysis.questions.some(q=>!analysis.hiddenQuestionIds?.includes(q.id)) && <p className="text-sm text-slate-600">本批暂无可练习题。已删除题目的训练历史仍可从回答与复习入口查看。</p>}
      {area==="questions" && analysis.questions.filter(q => !analysis.hiddenQuestionIds?.includes(q.id)).map(q => <article key={q.id} className="rounded-xl border border-slate-200 bg-white p-5"><h4 className="break-words font-medium leading-7">{q.text}</h4><p className="mt-1 text-xs text-slate-600">{q.sourceType === "third_party" ? "第三方资料提及 · 未经企业认证" : "AI 衍生练习题"}</p><div className="mt-3 flex flex-wrap gap-2"><button className={button} disabled={locked} onClick={() => navigate(() => onPractice(analysis.id,q.id))}>开始练习</button><button className={button} disabled={locked} onClick={() => hide(q.id)}>删除题目</button></div><details className="mt-2 text-sm text-slate-600"><summary className="cursor-pointer">查看来源</summary>{analysis.items.flatMap(item => item.questions.filter(source => normalizeCollectedQuestion(source.text) === normalizeCollectedQuestion(q.text)).map((source,index) => <p key={`${item.materialId}-${index}`} className="mt-2 break-words">{collection.materials.find(m => m.id === item.materialId)?.title}（{source.origin === "original" ? "第三方原文提及" : "AI 衍生依据"}）：{source.evidenceQuote}</p>))}</details></article>)}
      {deleted && <button className={button} onClick={() => hide(deleted,false)}>撤销删除</button>}
    </section>}
  </section>;
}

function CollectionMaterialDetail({ material, projects, disabled, onSave, onLink }: { material: CollectedMaterial; projects: InterviewProject[]; disabled: boolean; onSave: (m: Partial<CollectedMaterial>) => string | null; onLink: (id: string) => string | null }) {
  const [draft,setDraft] = useState(material.content), [notice,setNotice] = useState("");
  const lastContent=useRef(material.content);
  useEffect(()=>{const previous=lastContent.current;lastContent.current=material.content;setDraft(current=>current===previous?material.content:current);},[material.content]);
  const save = () => { if (!draft.trim()) return "请输入可用文字。"; const error = onSave({ content: draft, reviewedAt: new Date().toISOString(), processing: "recognized" }); setNotice(error ?? "核对文字已保存。"); return error; };
  useUnsavedChanges(`collection-edit:${material.id}`, draft !== material.content, { label: "收集资料文字", save, discard: () => setDraft(material.content) });
  return <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
    {material.source !== "manual_text" ? <Original part={{ id:material.id, fileId:material.fileId, originalSaved:Boolean(material.originalSaved), fileName:material.title, mimeType:material.sourceMimeType ?? "text/plain", size:0, initialText:material.initialContent ?? "", reviewedText:material.content }}/> : <p className="text-xs text-slate-600">粘贴文字，无原文件。</p>}
    <details className="text-sm text-slate-600"><summary className="cursor-pointer">原始识别文字</summary><p className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{material.initialContent || "尚无识别文字"}</p></details>
    {material.error && <p className="text-sm text-amber-900">{material.error}</p>}
    <Textarea aria-label={`核对文字 ${material.title}`} className="min-h-48 bg-white" value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)}/>
    <button className={button} disabled={disabled || !draft.trim()} onClick={save}>保存并确认文字</button>
    {projects.length > 0 && <label className="block text-sm">关联已有岗位<select aria-label={`关联岗位 ${material.title}`} className="ml-2 max-w-full rounded-md border border-border bg-white p-2" value="" disabled={disabled || !material.reviewedAt || draft !== material.content} onChange={e => { if (e.target.value) setNotice(onLink(e.target.value) ?? "资料已关联到岗位，原始JD未改变。"); }}><option value="">选择岗位</option>{projects.map(p => <option key={p.id} value={p.id}>{p.jobTitle}</option>)}</select></label>}
    {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
  </div>;
}
