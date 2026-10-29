import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronUp, ClipboardPaste, ImageUp, MoreHorizontal, Pencil, Plus, Sparkles, Upload } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import type { ExperienceCard, ResumeMaterial, UserProfile } from "../../lib/domain";
import { extractResumeText, pdfExtractionNotice } from "../../lib/documentParser";
import { deleteMaterialFile, getMaterialFile, materialFileLimit, storeMaterialFile } from "../../lib/materialFileStorage";
import { inspectOcrImage, MAX_OCR_IMAGE_BYTES } from "../../lib/localOcr";
import { materialFileIsShared, materialLinkedExperiences, MAX_RESUME_TEXT_BYTES, withoutExperienceCard, withoutResumeMaterial } from "../../lib/profileStorage";
import { loadProjects } from "../../lib/projectStorage";
import { validProject } from "../../lib/validation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { extractExperienceCandidates, type ExperienceCandidate } from "../../services/modelClient";
import { useSafeNavigation, useUnsavedChanges } from "../shared/UnsavedChanges";

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const blankCard = (): ExperienceCard => ({ id: id("experience"), title: "", situation: "", action: "", result: "", reflection: "", confirmed: false, origin: "manual", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
const readable = (file: File) => /\.(pdf|docx|txt|md|markdown|png|jpe?g)$/i.test(file.name) || ["application/pdf", "text/plain", "text/markdown", "image/png", "image/jpeg"].includes(file.type);
const shortPdfNotice = "PDF 文字可能不完整，请核对后使用";
const isPdf = (material: ResumeMaterial) => material.parser === "pdf" || material.mimeType === "application/pdf" || /\.pdf$/i.test(material.fileName);

function OriginalPreview({ material }: { material: ResumeMaterial }) {
  const [url, setUrl] = useState<string | null>(null); const [missing, setMissing] = useState(false);
  const [previewError,setPreviewError]=useState("");
  useEffect(() => {
    let objectUrl = ""; let active = true;
    setUrl(null); setMissing(false);setPreviewError("");
    if (material.fileId && material.originalSaved) void getMaterialFile(material.fileId).then(async value => {
      if (!active) return;
      if (!value) setMissing(true);
      else { let warning="";if(material.mimeType.startsWith("image/"))try{await inspectOcrImage(new File([value.blob],value.name,{type:value.type||material.mimeType}));}catch(e){warning=e instanceof Error?e.message:"无法安全预览图片";}if(!active)return;setPreviewError(warning);objectUrl = URL.createObjectURL(value.blob); setUrl(objectUrl); }
    }).catch(() => { if (active) setMissing(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [material.fileId, material.originalSaved]);
  if (!material.fileId || !material.originalSaved || missing) return <p className="mt-2 text-xs text-amber-700">原文件未保存，请重新上传。</p>;
  if (!url) return <p className="mt-2 text-xs text-slate-500">正在读取本地原文件…</p>;
  if(previewError)return <div className="mt-3 space-y-2"><p className="text-sm text-amber-900">未自动打开预览：{previewError}</p><a href={url} download={material.fileName} className="text-sm text-blue-700 underline hover:text-blue-900 active:text-blue-950 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-all">下载原文件</a></div>;
  if (material.mimeType.startsWith("image/")) return <img src={url} alt={`${material.fileName} 原图`} className="mt-3 max-h-72 max-w-full rounded-lg border object-contain"/>;
  return <div className="mt-3 space-y-3">
    {isPdf(material) && <>
      {navigator.pdfViewerEnabled !== false && <iframe title={`${material.fileName} PDF 预览`} src={url} className="h-[min(65dvh,36rem)] min-h-64 w-full rounded-lg border border-slate-200"/>}
      <p className="text-xs text-slate-600">{navigator.pdfViewerEnabled === false ? "当前浏览器不支持内嵌 PDF 预览，请打开或下载原文件。" : "若预览空白或无法显示，请打开或下载原文件。"}</p>
    </>}
    <div className="flex flex-wrap gap-3 text-sm"><a className="text-blue-700 underline" href={url} download={material.fileName}>下载原文件</a>{isPdf(material) && <a className="text-blue-700 underline" href={url} target="_blank" rel="noreferrer">打开 PDF 预览</a>}</div>
  </div>;
}

function SourceEditor({ material, onSave, onDelete }: { material: ResumeMaterial; onSave: (next: ResumeMaterial) => string | null; onDelete: () => void }) {
  const navigate = useSafeNavigation();
  const [view, setView] = useState<"collapsed" | "edit" | "original">("collapsed");
  const [text, setText] = useState(material.extractedText); const [notice, setNotice] = useState("");
  const save = () => {
    const error = onSave({ ...material, extractedText: text.trim(), reviewedAt: new Date().toISOString() });
    setNotice(error || "已保存并标记为已核对。");
    if (!error) { setText(text.trim()); setView("collapsed"); }
    return error;
  };
  useUnsavedChanges(`profile-text:${material.id}`, text !== material.extractedText, { label: material.fileName, save, discard: () => setText(material.extractedText) });
  const show = (next: typeof view) => navigate(() => setView(next));
  const format = material.parser === "manual" ? "文本" : material.fileName.split(".").pop()?.toUpperCase() || "文件";
  return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><h3 className="break-all font-medium text-slate-950">{material.fileName}</h3>
        <p className="mt-1 text-xs text-slate-500">{format} · {Math.ceil(material.size / 1024)}KB · {material.reviewedAt ? "已核对" : "待核对"}{view === "edit" ? " · 编辑中" : ""}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        {view !== "collapsed" && <button aria-label="收起" title="收起" aria-expanded={true} onClick={() => show("collapsed")} className="inline-flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700"><ChevronUp size={18}/></button>}
        <Menu.Root><Menu.Trigger aria-label="更多操作" title="更多操作" className="inline-flex size-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-700"><MoreHorizontal size={20}/></Menu.Trigger>
          <Menu.Portal><Menu.Positioner align="end" sideOffset={4} className="z-50"><Menu.Popup className="min-w-32 rounded-lg border border-slate-200 bg-white p-1 shadow-lg outline-none"><Menu.Item onClick={onDelete} className="cursor-pointer rounded-md px-3 py-2.5 text-sm text-red-700 outline-none data-highlighted:bg-red-50">删除资料</Menu.Item></Menu.Popup></Menu.Positioner></Menu.Portal>
        </Menu.Root>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button onClick={() => { if (view !== "original") show("original"); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">{isPdf(material) ? "预览 PDF" : "查看原件"}</button>
      <button onClick={() => { if (view !== "edit") show("edit"); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">核对文字</button>
    </div>
    {view !== "collapsed" && isPdf(material) && <div className="mt-3 text-sm text-amber-900"><p>{shortPdfNotice}</p><details className="mt-1 text-xs"><summary className="cursor-pointer py-1">提取说明与扫描件处理</summary><p className="mt-1 leading-5">{pdfExtractionNotice}</p></details></div>}
    {view === "original" && <OriginalPreview material={material}/>}
    {view === "edit" && <div className="mt-4 space-y-3">
      <label className="block text-sm font-medium text-slate-700">当前可编辑文字<textarea value={text} onChange={e => setText(e.target.value)} maxLength={MAX_RESUME_TEXT_BYTES} className="mt-2 min-h-64 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6 text-slate-900"/></label>
      <div className="flex flex-wrap gap-2"><button className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white" onClick={save}>保存核对文字</button><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700" onClick={() => { setText(material.initialExtractedText ?? material.extractedText); setNotice("已恢复到初始提取文字，尚未保存。"); }}>恢复初始文字</button></div>
      <details className="text-xs text-slate-600"><summary className="cursor-pointer py-2">初始提取文字</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 leading-5">{material.initialExtractedText ?? material.extractedText}</pre></details>
    </div>}
    {notice && <p role="status" className="mt-2 text-sm text-slate-600">{notice}</p>}
  </article>;
}
function CardEditor({ initial, onSave, onCancel }: { initial?: ExperienceCard; onSave: (card: ExperienceCard) => string | null; onCancel: () => void }) {
  const [card, setCard] = useState<ExperienceCard>(initial ?? blankCard()); const [notice, setNotice] = useState("");
  const navigate = useSafeNavigation();
  const original = useRef(card);
  const save = () => { if (!card.title.trim()) { setNotice("请填写经历标题。"); return "请填写经历标题。"; } const error = onSave({ ...card, title: card.title.trim() }); setNotice(error || "经历卡已保存。"); return error; };
  useUnsavedChanges(`profile-card:${card.id}`, JSON.stringify(card) !== JSON.stringify(original.current), { label: "经历卡文字", save, discard: () => setCard(original.current) });
  const patch = (key: keyof ExperienceCard, value: string | boolean) => setCard(current => ({ ...current, [key]: value, confirmed: key === "confirmed" ? Boolean(value) : false, updatedAt: new Date().toISOString() }));
  const fields: Array<[keyof ExperienceCard, string, string]> = [["title", "经历标题", "例如：企业知识库 POC 推进"], ["type", "经历类型", "项目 / 工作 / 学习"], ["situation", "背景与目标", "项目背景、目标与边界"], ["action", "本人行动", "只写自己实际做过的动作"], ["tools", "工具/方法", "使用的工具、方法或协作方式"], ["result", "结果或证据", "数字、产物或待核对边界"], ["reflection", "复盘", "学到什么、下次如何改进"], ["notes", "备注", "待补充或需核验的信息"]];
  return <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5"><div className="flex justify-between gap-3"><h3 className="font-semibold text-slate-950">{initial ? "编辑经历卡" : "新建经历卡"}</h3><button onClick={() => navigate(onCancel)} className="text-sm text-slate-600">取消</button></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{fields.map(([key,label,placeholder]) => <label key={key} className={`text-sm font-medium text-slate-700 ${key === "title" ? "sm:col-span-2" : ""}`}>{label}{key === "title" || key === "type" ? <input value={String(card[key] ?? "")} maxLength={key === "title" ? 120 : 80} onChange={e => patch(key, e.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-slate-900"/> : <textarea value={String(card[key] ?? "")} maxLength={3000} onChange={e => patch(key, e.target.value)} placeholder={placeholder} className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-slate-900"/>}</label>)}</div>{card.sourceQuotes?.length ? <p className="mt-3 text-xs text-slate-600">来源证据：{card.sourceQuotes.map(q => q.quote).join("；")}</p> : null}<label className="mt-4 flex gap-2 text-sm leading-6 text-slate-700"><input type="checkbox" checked={card.confirmed} onChange={e => patch("confirmed", e.target.checked)} className="mt-1 size-4"/>我确认这张卡中的个人贡献、结果和边界真实可用。</label><button onClick={save} className="mt-4 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white">保存经历卡</button>{notice && <p role="status" className="mt-3 text-sm text-slate-600">{notice}</p>}</section>;
}

function ExperienceSummary({ card, materials, onEdit, onDelete, onPractice }: { card: ExperienceCard; materials: ResumeMaterial[]; onEdit: () => void; onDelete: () => void; onPractice?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const overview = [card.situation, card.action, card.result].filter(Boolean).join("；");
  const sources = [...new Set([card.sourceResumeId, ...(card.sourceQuotes ?? []).map(source => source.materialId)].filter(Boolean))];
  const fields = [["经历类型", card.type], ["背景与目标", card.situation], ["本人行动", card.action], ["工具/方法", card.tools], ["结果或证据", card.result], ["复盘", card.reflection], ["备注", card.notes]];
  return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-medium text-slate-950">{card.title}</h3>
        {card.confirmed ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700"><CheckCircle2 size={13}/>已确认</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">待核对</span>}
      </div><p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-slate-600">{overview ? overview.slice(0, 160) + (overview.length > 160 ? "…" : "") : "尚未填写具体内容"}</p>
    </div><div className="flex flex-wrap gap-2">
      <button aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">{expanded ? "收起详情" : "查看详情"}</button>
      <button onClick={onEdit} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"><Pencil size={15}/>编辑</button>
      <button onClick={onDelete} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">删除经历</button>
      {card.confirmed && onPractice && <button onClick={onPractice} className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800 hover:bg-blue-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all">练习这段经历</button>}
    </div></div>
    {expanded && <div className="mt-4 border-t border-slate-200 pt-4"><dl className="space-y-3">{fields.map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{value || "未填写"}</dd></div>)}</dl>
      <div className="mt-4 text-sm text-slate-600"><p className="font-medium">资料来源</p>{sources.length ? sources.map(sourceId => <p key={sourceId} className="mt-1 break-words">{materials.find(item => item.id === sourceId)?.fileName ?? "原资料已缺失（旧记录），请人工核对来源。"}</p>) : <p className="mt-1">手工填写，未关联资料。</p>}
        {card.sourceQuotes?.map((source, index) => <blockquote key={index} className="mt-2 whitespace-pre-wrap break-words border-l-2 border-slate-300 pl-3">{source.quote}</blockquote>)}
      </div>
    </div>}
  </article>;
}

export function ProfileLibrary({ profile, onSave, onPractice }: { profile: UserProfile; onSave: (profile: UserProfile) => string | null; onPractice?: (id: string) => void }) {
  const navigate = useSafeNavigation();
  const latestProfile = useRef(profile); latestProfile.current = profile;
  const [tab, setTab] = useState<"materials" | "experiences">("materials"), [notice, setNotice] = useState(""), [editing, setEditing] = useState<string | "new" | null>(null), [dragging,setDragging] = useState(false), [candidates, setCandidates] = useState<ExperienceCandidate[]>([]), [extracting,setExtracting] = useState(false); const inputRef = useRef<HTMLInputElement>(null);
  const save = (next: UserProfile) => onSave({ ...next, updatedAt: new Date().toISOString() });
  const [pendingMaterial, setPendingMaterial] = useState<ResumeMaterial | null>(null);
  const [pendingCard, setPendingCard] = useState<ExperienceCard | null>(null);
  const [importing, setImporting] = useState(false); const importBusy = useRef(false);
  const [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState("");
  const linkedCards = pendingMaterial ? materialLinkedExperiences(profile, pendingMaterial.id) : [];
  useUnsavedChanges("profile-operation", deleting || importing || extracting, { label: "资料处理", save: () => "正在处理资料，请稍后再离开。", discard: () => { throw new Error("正在处理资料，请稍后再离开。"); } });
  const requestMaterialDelete = (material: ResumeMaterial) => navigate(() => { setDeleteError(""); setPendingMaterial(material); });
  const deleteMaterial = async () => {
    if (!pendingMaterial || deleting) return;
    setDeleting(true); setDeleteError("");
    const previous = profile;
    try {
      const next = withoutResumeMaterial(previous, pendingMaterial.id);
      let cleanFile = false;
      if (pendingMaterial.fileId) {
        const raw = JSON.parse(localStorage.getItem("ai-interview-projects-v1") || "[]");
        if (!Array.isArray(raw) || !raw.every(validProject)) throw new Error("岗位数据无法安全读取，不能确认原件引用关系；未执行删除。");
        cleanFile = !materialFileIsShared(previous, pendingMaterial, loadProjects());
      }
      const error = save(next);
      if (error) throw new Error(error);
      if (cleanFile && pendingMaterial.fileId) {
        try { await deleteMaterialFile(pendingMaterial.fileId); }
        catch (cause) {
          const rollback = save(previous);
          throw new Error(`原件删除失败：${cause instanceof Error ? cause.message : "本地存储错误"}。${rollback ? "资料恢复也失败：" + rollback + "；请保留当前页面并备份，不要继续删除。" : "资料记录已恢复，未完成删除，可重试。"}`);
        }
      }
      setCandidates(items => items.filter(item => !item.sourceQuotes?.some(source => source.materialId === pendingMaterial.id)));
      setNotice(cleanFile ? "资料及其独立原件已删除。" : "资料已删除；被其他资料引用的原件继续保留（如有）。");
      setPendingMaterial(null);
    } catch (error) { setDeleteError(error instanceof Error ? error.message : "删除失败，未完成操作。"); }
    finally { setDeleting(false); }
  };
  const requestCardDelete = (card: ExperienceCard) => navigate(() => { setDeleteError(""); setPendingCard(card); });
  const deleteCard = () => {
    if (!pendingCard || deleting) return;
    setDeleteError("");
    try {
      const error = save(withoutExperienceCard(profile, pendingCard.id));
      if (error) throw new Error(error);
      setPendingCard(null); setNotice("经历卡已删除；来源资料与原件保留，不再进入新的已确认个人事实上下文。");
    } catch (error) { setDeleteError(error instanceof Error ? error.message : "经历删除失败，未完成操作。"); }
  };
  const importFiles = async (files: File[]) => { if (importBusy.current || deleting || extracting) { setNotice("正在处理资料，请稍后重试。"); return; } importBusy.current = true; setImporting(true); let working = profile; try { for (const file of files) { if (!readable(file)) { setNotice(`${file.name} 不受支持；可手工粘贴文字。`); continue; } const materialId = id("resume"); try { const extracted = await extractResumeText(file, progress => setNotice(`${file.name}：${progress.status}`)); if (!extracted.text.trim()) throw new Error("未提取到文字，请手工录入。"); const item: ResumeMaterial = { id: materialId, fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, extractedText: extracted.text.trim(), initialExtractedText: extracted.text.trim(), parser: extracted.parser, createdAt: new Date().toISOString() }; try { await storeMaterialFile(materialId, file); item.fileId = materialId; item.originalSaved = true; } catch (error) { item.originalSaved = false; setNotice(`${file.name} 原件未保存：${error instanceof Error ? error.message : "存储失败"}；文字仍可核对保存。`); } const next = { ...working, resumes: [item, ...working.resumes], updatedAt: new Date().toISOString() }; const error = save(next); if (error) setNotice(error); else { working = next; setNotice(`${file.name} 已导入，请核对文字后再提取经历。${extracted.warning === pdfExtractionNotice ? shortPdfNotice : extracted.warning ?? ""}`); } } catch (error) { setNotice(`${file.name}：${error instanceof Error ? error.message : "读取失败"}`); } } } finally { importBusy.current = false; setImporting(false); } };
  const addPasted = () => { const value = window.prompt("粘贴本人允许保存的资料文本：") || ""; if (!value.trim()) return; const now = new Date().toISOString(); const error = save({ ...profile, resumes: [{ id: id("resume"), fileName: "手工粘贴资料", mimeType: "text/plain", size: new Blob([value]).size, extractedText: value.trim(), initialExtractedText: value.trim(), parser: "manual", originalSaved: false, reviewedAt: now, createdAt: now }, ...profile.resumes] }); setNotice(error || "手工文字已保存并标记为已核对。"); };
  const generate = async () => { const inputProfile = latestProfile.current; const sources = inputProfile.resumes.filter(item => item.reviewedAt && item.extractedText.trim()); if (!sources.length) return setNotice("请先保存至少一份已核对的资料文字。"); if (!inputProfile.aiExperienceExtractionConsent && !window.confirm("将把已核对的资料文字发送至已配置的模型服务生成候选经历卡。不会自动保存为个人事实。是否同意？")) return; setTab("experiences"); setExtracting(true); try { const result = await extractExperienceCandidates(sources); setCandidates(result); const current = latestProfile.current; const error = save(current.aiExperienceExtractionConsent ? current : { ...current, aiExperienceExtractionConsent: true }); setNotice(error || (result.length ? "候选卡已生成，请选择、编辑并逐张确认。" : "未找到有可靠文字依据的候选经历；可手工新建。")); } catch (error) { setNotice(error instanceof Error ? error.message : "生成失败；可继续手工新建。"); } finally { setExtracting(false); } };
  const selectCandidate = (candidate: ExperienceCandidate) => { const now = new Date().toISOString(); const card: ExperienceCard = { ...blankCard(), ...candidate, id: id("experience"), origin: "ai", confirmed: false, createdAt: now, updatedAt: now }; const error = save({ ...profile, experiences: [card, ...profile.experiences] }); if (error) setNotice(error); else { setCandidates(items => items.filter(item => item !== candidate)); setEditing(card.id); } };
  return <div className="max-w-6xl space-y-6"><fieldset disabled={deleting || importing || extracting} className="min-w-0"><div className="rounded-2xl border border-slate-200 bg-white p-4"><div role="tablist" aria-label="个人资料库选项" className="flex gap-2 border-b border-slate-200"><button role="tab" aria-selected={tab === "materials"} onClick={() => navigate(() => setTab("materials"))} className={`px-4 py-2.5 text-sm font-medium ${tab === "materials" ? "border-b-2 border-blue-700 text-blue-800" : "text-slate-600"}`}>我的资料</button><button role="tab" aria-selected={tab === "experiences"} onClick={() => navigate(() => setTab("experiences"))} className={`px-4 py-2.5 text-sm font-medium ${tab === "experiences" ? "border-b-2 border-blue-700 text-blue-800" : "text-slate-600"}`}>我的经历</button></div>{tab === "materials" ? <div className="pt-5"><section className="rounded-xl border border-blue-100 bg-blue-50/50 p-5"><h2 className="font-semibold text-slate-950">上传或粘贴资料</h2><p className="mt-1 text-sm leading-6 text-slate-600">上传简历后核对文字，再提取并确认经历。支持文档和图片。</p><div tabIndex={0} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void importFiles(Array.from(e.dataTransfer.files)); }} onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void importFiles(files); } }} className={`mt-4 rounded-xl border-2 border-dashed p-6 text-center ${dragging ? "border-blue-600 bg-blue-100" : "border-blue-200 bg-white"}`}><ImageUp className="mx-auto text-blue-700"/><p className="mt-2 text-sm text-slate-700">拖入多个文件，聚焦后粘贴图片，或选择文件</p><div className="mt-3 flex justify-center gap-2"><button className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white" onClick={() => inputRef.current?.click()}><Upload size={16}/>选择文件</button><button className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700" onClick={addPasted}><ClipboardPaste size={16}/>粘贴文字</button></div><input ref={inputRef} aria-label="上传个人资料文件" type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,image/png,image/jpeg" className="sr-only" onChange={e => { void importFiles(Array.from(e.target.files || [])); e.target.value = ""; }}/></div><p className="mt-2 text-xs text-slate-500">图片原件最大 {Math.round(MAX_OCR_IMAGE_BYTES / 1024 / 1024)}MB，其他文件最大 {Math.round(materialFileLimit / 1024 / 1024)}MB；图片 OCR 首次需下载资源。</p></section><section className="mt-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-slate-950">已保存资料</h2><button disabled={extracting || !profile.resumes.some(item => item.reviewedAt && item.extractedText.trim())} onClick={() => navigate(() => void generate())} className="rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-800 disabled:opacity-50">从已核对简历提取经历</button></div>{importing && <p role="status" className="text-sm text-slate-600">正在导入资料，请稍候再编辑或删除。</p>}{profile.resumes.length ? profile.resumes.map(item => <SourceEditor key={item.id} material={item} onSave={next => save({ ...profile, resumes: profile.resumes.map(item => item.id === next.id ? next : item) })} onDelete={() => requestMaterialDelete(item)}/>) : <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">暂无资料。上传后需先核对文本，才能用于 AI 候选经历提取。</p>}</section></div> : <div className="pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">我的经历</h2><p className="mt-1 text-sm text-slate-600">确认后用于岗位准备。也可手工补充简历未写的真实项目。</p></div><div className="flex gap-2"><button disabled={extracting} onClick={() => void generate()} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 disabled:opacity-50"><Sparkles size={16}/>{extracting ? "正在提取…" : "AI 提取经历"}</button><button onClick={() => navigate(() => setEditing("new"))} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white"><Plus size={16}/>手工新建</button></div></div>{candidates.length > 0 && <section className="mt-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4"><h3 className="font-medium text-slate-950">候选经历（尚未保存为事实）</h3><div className="mt-3 space-y-3">{candidates.map((candidate,index) => <article key={`${candidate.title}-${index}`} className="rounded-lg border border-violet-100 bg-white p-3"><p className="font-medium text-slate-950">{candidate.title}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{[candidate.situation,candidate.action,candidate.result].filter(Boolean).join("\n") || "模型未提供完整字段，请编辑补充。"}</p><button onClick={() => navigate(() => selectCandidate(candidate))} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">选择并编辑</button></article>)}</div></section>}{editing === "new" && <div className="mt-5"><CardEditor onSave={card => { const error = save({ ...profile, experiences: [card, ...profile.experiences] }); if (!error) setEditing(null); return error; }} onCancel={() => setEditing(null)}/></div>}<div className="mt-5 space-y-3">{profile.experiences.map(card => editing === card.id ? <CardEditor key={card.id} initial={card} onSave={next => { const error = save({ ...profile, experiences: profile.experiences.map(item => item.id === next.id ? next : item) }); if (!error) setEditing(null); return error; }} onCancel={() => setEditing(null)}/> : <ExperienceSummary key={card.id} card={card} materials={profile.resumes} onEdit={() => navigate(() => setEditing(card.id))} onDelete={() => requestCardDelete(card)} onPractice={onPractice ? () => navigate(() => onPractice(card.id)) : undefined}/>)}{!profile.experiences.length && editing !== "new" && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">暂无经历卡。可以手工新建，或在核对资料后请求候选卡。</p>}</div></div>}{notice && <p role="status" className="mt-5 text-sm text-slate-700">{notice}</p>}</div></fieldset>
    <Dialog open={Boolean(pendingMaterial)} onOpenChange={open => { if (!open && !deleting) setPendingMaterial(null); }}>
      <DialogContent showCloseButton={!deleting}><DialogHeader><DialogTitle>删除个人资料</DialogTitle><DialogDescription>将删除“{pendingMaterial?.fileName}”的资料文字与未被其他资料引用的原件，不删除经历卡、岗位资料或训练记录。此操作不可撤销。</DialogDescription></DialogHeader>
        {linkedCards.length > 0 && <p role="alert" className="break-words text-sm text-amber-900">无法删除：仍被经历卡引用（{linkedCards.map(card => card.title).join("、")}）。请先处理关联经历；不会自动删卡或移除来源。</p>}
        {deleteError && <p role="alert" className="text-sm text-red-700">{deleteError}</p>}
        <DialogFooter><button disabled={deleting} onClick={() => setPendingMaterial(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">取消</button><button disabled={deleting || linkedCards.length > 0} onClick={() => void deleteMaterial()} className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50">{deleting ? "正在删除…" : "确认删除"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(pendingCard)} onOpenChange={open => { if (!open) setPendingCard(null); }}>
      <DialogContent><DialogHeader><DialogTitle>删除经历卡</DialogTitle><DialogDescription>删除“{pendingCard?.title}”后，它不再进入新的已确认个人事实上下文。来源资料、原件、岗位和历史训练记录不会删除；此操作不可撤销。</DialogDescription></DialogHeader>
        {deleteError && <p role="alert" className="text-sm text-red-700">{deleteError}</p>}
        <DialogFooter><button onClick={() => setPendingCard(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">取消</button><button onClick={deleteCard} className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white">确认删除</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
