import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ClipboardPaste, FileText, ImageUp, MoreHorizontal, Pencil, Plus, Sparkles, Upload } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import type { ExperienceCandidate, ExperienceCard, ResumeMaterial, UserProfile } from "../../lib/domain";
import { extractResumeText, pdfExtractionNotice } from "../../lib/documentParser";
import { deleteMaterialFile, getMaterialFile, materialFileLimit, storeMaterialFile } from "../../lib/materialFileStorage";
import { inspectOcrImage, MAX_OCR_IMAGE_BYTES } from "../../lib/localOcr";
import { addExperienceCandidates, isCandidateDraftCurrent, isExperienceCandidateCurrent, loadUserProfile, materialFileIsShared, materialLinkedExperienceCandidates, materialLinkedExperiences, MAX_RESUME_TEXT_BYTES, resumeMaterialVersion, withoutExperienceCandidate, withoutExperienceCard, withoutResumeMaterial } from "../../lib/profileStorage";
import { loadProjects } from "../../lib/projectStorage";
import { validProject } from "../../lib/validation";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { extractExperienceCandidates, type ExperienceCandidateInput } from "../../services/modelClient";
import { useSafeNavigation, useUnsavedChanges } from "../shared/UnsavedChanges";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
  if (!url) return <p className="mt-2 text-xs text-muted-foreground">正在读取本地原文件…</p>;
  if(previewError)return <div className="mt-3 space-y-2"><p className="text-sm text-amber-900">未自动打开预览：{previewError}</p><a href={url} download={material.fileName} className="text-sm text-primary underline hover:text-primary/80 active:text-primary/80 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-all">下载原文件</a></div>;
  if (material.mimeType.startsWith("image/")) return <img src={url} alt={`${material.fileName} 原图`} className="mt-3 max-h-72 max-w-full rounded-lg border border-border object-contain"/>;
  return <div className="mt-3 space-y-3">
    {isPdf(material) && <>
      {navigator.pdfViewerEnabled !== false && <iframe title={`${material.fileName} PDF 预览`} src={url} className="h-[min(65dvh,36rem)] min-h-64 w-full rounded-lg border border-border"/>}
      <p className="text-xs text-muted-foreground">{navigator.pdfViewerEnabled === false ? "当前浏览器不支持内嵌 PDF 预览，请打开或下载原文件。" : "若预览空白或无法显示，请打开或下载原文件。"}</p>
    </>}
    <div className="flex flex-wrap gap-3 text-sm"><a className="text-primary underline hover:text-primary/80" href={url} download={material.fileName}>下载原文件</a>{isPdf(material) && <a className="text-primary underline hover:text-primary/80" href={url} target="_blank" rel="noreferrer">打开 PDF 预览</a>}</div>
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
  return <article className="min-w-0 rounded-xl border border-border bg-card p-4 transition-colors hover:border-[#94A3B8]">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><h3 className="break-all font-medium text-card-foreground">{material.fileName}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{format} · {Math.ceil(material.size / 1024)}KB · {material.reviewedAt ? "已核对" : "待核对"}{view === "edit" ? " · 编辑中" : ""}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        {view !== "collapsed" && <button aria-label="收起" title="收起" aria-expanded={true} onClick={() => show("collapsed")} className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22]"><ChevronUp size={18}/></button>}
        <Menu.Root><Menu.Trigger aria-label="更多操作" title="更多操作" className="inline-flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22]"><MoreHorizontal size={20}/></Menu.Trigger>
          <Menu.Portal><Menu.Positioner align="end" sideOffset={4} className="z-50"><Menu.Popup className="min-w-32 rounded-lg border border-border bg-white p-1 shadow-lg outline-none"><Menu.Item onClick={onDelete} className="cursor-pointer rounded-md px-3 py-2.5 text-sm text-destructive outline-none data-highlighted:bg-destructive/10">删除资料</Menu.Item></Menu.Popup></Menu.Positioner></Menu.Portal>
        </Menu.Root>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => { if (view !== "original") show("original"); }} className="text-sm">{isPdf(material) ? "预览 PDF" : "查看原件"}</Button>
      <Button variant="outline" onClick={() => { if (view !== "edit") show("edit"); }} className="text-sm">核对文字</Button>
    </div>
    {view !== "collapsed" && isPdf(material) && <div className="mt-3 text-sm text-amber-900"><p>{shortPdfNotice}</p><details className="mt-1 text-xs"><summary className="cursor-pointer py-1">提取说明与扫描件处理</summary><p className="mt-1 leading-5">{pdfExtractionNotice}</p></details></div>}
    {view === "original" && <OriginalPreview material={material}/>}
    {view === "edit" && <div className="mt-4 space-y-3">
      <label className="block text-sm font-medium text-foreground">当前可编辑文字<Textarea value={text} onChange={e => setText(e.target.value)} maxLength={MAX_RESUME_TEXT_BYTES} className="mt-2 min-h-64 w-full bg-white"/></label>
      <div className="flex flex-wrap gap-2"><Button data-cta="primary" onClick={save} className="text-sm">保存核对文字</Button><Button variant="outline" onClick={() => { setText(material.initialExtractedText ?? material.extractedText); setNotice("已恢复到初始提取文字，尚未保存。"); }} className="text-sm">恢复初始文字</Button></div>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">初始提取文字</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-card p-3 leading-5">{material.initialExtractedText ?? material.extractedText}</pre></details>
    </div>}
    {notice && <p role="status" className="mt-2 text-sm text-muted-foreground">{notice}</p>}
  </article>;
}
function CardEditor({ initial, candidateSourceCurrent = true, onSave, onCancel }: { initial?: ExperienceCard; candidateSourceCurrent?: boolean; onSave: (card: ExperienceCard) => string | null; onCancel: () => void }) {
  const [card, setCard] = useState<ExperienceCard>(initial ?? blankCard()); const [notice, setNotice] = useState("");
  const navigate = useSafeNavigation();
  const original = useRef(card);
  const save = () => {
    if (!card.title.trim()) { setNotice("请填写经历标题。"); return "请填写经历标题。"; }
    if (card.confirmed && !initial?.confirmed && !candidateSourceCurrent) { const message = "候选依据已变化，请重新核对来源或手工新建后再确认。"; setNotice(message); return message; }
    const next = card.confirmed ? { ...card, candidateSourceVersions: undefined } : card;
    const error = onSave({ ...next, title: next.title.trim() }); setNotice(error || "经历卡已保存。"); return error;
  };
  useUnsavedChanges(`profile-card:${card.id}`, JSON.stringify(card) !== JSON.stringify(original.current), { label: "经历卡文字", save, discard: () => setCard(original.current) });
  const patch = (key: keyof ExperienceCard, value: string | boolean) => setCard(current => ({ ...current, [key]: value, confirmed: key === "confirmed" ? Boolean(value) : false, updatedAt: new Date().toISOString() }));
  const fields: Array<[keyof ExperienceCard, string, string]> = [["title", "经历标题", "例如：企业知识库 POC 推进"], ["type", "经历类型", "项目 / 工作 / 学习"], ["situation", "背景与目标", "项目背景、目标与边界"], ["action", "本人行动", "只写自己实际做过的动作"], ["tools", "工具/方法", "使用的工具、方法或协作方式"], ["result", "结果或证据", "数字、产物或待核对边界"], ["reflection", "复盘", "学到什么、下次如何改进"], ["notes", "备注", "待补充或需核验的信息"]];
  return <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5"><div className="flex justify-between gap-3"><h3 className="font-semibold text-slate-950">{initial ? "编辑经历卡" : "新建经历卡"}</h3><button onClick={() => navigate(onCancel)} className="text-sm text-slate-600">取消</button></div><div className="mt-4 grid gap-4 sm:grid-cols-2">{fields.map(([key,label,placeholder]) => <label key={key} className={`text-sm font-medium text-slate-700 ${key === "title" ? "sm:col-span-2" : ""}`}>{label}{key === "title" || key === "type" ? <input value={String(card[key] ?? "")} maxLength={key === "title" ? 120 : 80} onChange={e => patch(key, e.target.value)} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-slate-900"/> : <textarea value={String(card[key] ?? "")} maxLength={3000} onChange={e => patch(key, e.target.value)} placeholder={placeholder} className="mt-1.5 min-h-24 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-slate-900"/>}</label>)}</div>{card.sourceQuotes?.length ? <p className="mt-3 text-xs text-slate-600">来源证据：{card.sourceQuotes.map(q => q.quote).join("；")}</p> : null}{!candidateSourceCurrent && <p role="alert" className="mt-3 text-sm text-amber-900">候选依据已变化。可以继续保存草稿，但请重新核对来源后再确认个人事实。</p>}<label className="mt-4 flex gap-2 text-sm leading-6 text-slate-700"><input type="checkbox" checked={card.confirmed} disabled={!candidateSourceCurrent && !initial?.confirmed} onChange={e => patch("confirmed", e.target.checked)} className="mt-1 size-4 disabled:cursor-not-allowed disabled:opacity-50"/>我确认这张卡中的个人贡献、结果和边界真实可用。</label><button onClick={save} className="mt-4 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white">保存经历卡</button>{notice && <p role="status" className="mt-3 text-sm text-slate-600">{notice}</p>}</section>;
}

function ExperienceSummary({ card, materials, onEdit, onDelete, onPractice }: { card: ExperienceCard; materials: ResumeMaterial[]; onEdit: () => void; onDelete: () => void; onPractice?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const overview = [card.situation, card.action, card.result].filter(Boolean).join("；");
  const sources = [...new Set([card.sourceResumeId, ...(card.sourceQuotes ?? []).map(source => source.materialId)].filter(Boolean))];
  const fields = [["经历类型", card.type], ["背景与目标", card.situation], ["本人行动", card.action], ["工具/方法", card.tools], ["结果或证据", card.result], ["复盘", card.reflection], ["备注", card.notes]];
  return <article className="min-w-0 rounded-xl border border-border bg-card p-4 transition-colors hover:border-[#94A3B8]">
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

function SourceEvidence({ sources, materials }: { sources: Array<{ materialId: string; quote: string }>; materials: ResumeMaterial[] }) {
  if (!sources.length) return <p className="text-[14px] text-muted-foreground">手工新建，暂无简历原文依据。</p>;
  return <details className="rounded-lg border border-border bg-card px-4 py-3">
    <summary className="cursor-pointer text-[16px] font-medium text-muted-foreground transition-colors hover:text-foreground">查看来源原文</summary>
    <div className="mt-3 space-y-3">
      {sources.map((source, index) => <blockquote key={`${source.materialId}-${index}`} className="border-l-2 border-border pl-3 text-[16px] leading-7 text-muted-foreground">
        <p className="mb-1 text-[14px] text-muted-foreground">{materials.find(item => item.id === source.materialId)?.fileName ?? "原资料已缺失，请人工核对"}</p>
        {source.quote}
      </blockquote>)}
    </div>
  </details>;
}

function CandidateCard({ candidate, materials, persisted, current, onReview, onDiscard }: { candidate: ExperienceCandidate; materials: ResumeMaterial[]; persisted: boolean; current: boolean; onReview: () => void; onDiscard: () => void }) {
  const result = candidate.result || "原文未明确结果，可在核对时如实补充或保留为空。";
  return <article className="rounded-[14px] border border-border bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[14px] font-medium ${persisted && current ? "bg-amber-50 text-amber-800" : "bg-destructive/10 text-destructive"}`}>{persisted ? current ? "候选" : "来源已变化" : "未保存"}</span><h3 className="min-w-0 break-words text-[18px] font-semibold text-foreground">{candidate.title}</h3></div>
        <p className="mt-3 text-[14px] text-muted-foreground">{candidate.type || "从简历文字提取"}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button disabled={!persisted || !current} onClick={onReview} className="rounded-md border border-border bg-white px-4 py-2 text-[16px] font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">核对经历</button>
        <button onClick={onDiscard} className="rounded-md px-4 py-2 text-[16px] text-primary transition-all hover:bg-accent active:scale-[0.98]">放弃候选</button>
      </div>
    </div>
    <div className="mt-4 grid gap-4 border-y border-border py-4 min-[900px]:grid-cols-2">
      <div><p className="text-[14px] font-medium text-muted-foreground">本人行动</p><p className="mt-1 whitespace-pre-wrap text-[16px] leading-7 text-foreground">{candidate.action || "模型未提供明确行动，核对时请如实补充。"}</p></div>
      <div><p className="text-[14px] font-medium text-muted-foreground">结果或依据</p><p className="mt-1 whitespace-pre-wrap text-[16px] leading-7 text-foreground">{result}</p></div>
    </div>
    {!persisted && <p role="alert" className="mt-3 flex gap-2 text-[16px] leading-6 text-destructive"><AlertTriangle className="mt-0.5 shrink-0" size={17}/>候选尚未保存，本页关闭或刷新后无法恢复；请重试保存。</p>}
    {persisted && !current && <p role="alert" className="mt-3 flex gap-2 text-[16px] leading-6 text-amber-800"><AlertTriangle className="mt-0.5 shrink-0" size={17}/>来源资料已变化，不能作为个人事实确认；请重新提取或放弃候选。</p>}
    <div className="mt-4"><SourceEvidence sources={candidate.sourceQuotes} materials={materials}/></div>
  </article>;
}

function ExperienceStateCard({ card, materials, sourceCurrent, onReview, onDelete, onPractice }: { card: ExperienceCard; materials: ResumeMaterial[]; sourceCurrent: boolean; onReview: () => void; onDelete: () => void; onPractice?: () => void }) {
  const confirmed = card.confirmed;
  const draft = !confirmed && card.origin === "ai";
  const stateLabel = confirmed ? "已确认" : draft ? "草稿" : "待确认";
  const stateClass = confirmed ? "bg-emerald-50 text-emerald-700" : draft ? "bg-amber-50 text-amber-800" : "bg-indigo-50 text-indigo-700";
  const overview = card.action || card.situation || "尚未填写具体内容。";
  return <article className={`rounded-[14px] border bg-white p-5 ${confirmed ? "border-border" : "border-border shadow-sm"}`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[14px] font-medium ${stateClass}`}>{stateLabel}</span><h3 className="min-w-0 break-words text-[18px] font-semibold text-foreground">{card.title || "未命名经历"}</h3></div>
        <p className="mt-2 text-[14px] text-muted-foreground">{card.type || (confirmed ? "已保存到个人事实库" : "等待你核对的经历草稿")}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button onClick={onReview} className="rounded-md border border-border bg-white px-4 py-2 text-[16px] font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-[0.98]">{confirmed ? "查看与管理" : "继续核对"}</button>
        {confirmed && onPractice && <button onClick={onPractice} className="rounded-md border border-border bg-accent px-4 py-2 text-[16px] font-medium text-primary transition-all hover:bg-accent active:scale-[0.98]">练习这段经历</button>}
        <button onClick={onDelete} className="rounded-md px-3 py-2 text-[16px] text-primary transition-all hover:bg-accent active:scale-[0.98]">删除</button>
      </div>
    </div>
    <p className="mt-4 line-clamp-2 whitespace-pre-wrap text-[16px] leading-7 text-foreground">{overview}</p>
    {!confirmed && !sourceCurrent && <p role="alert" className="mt-3 flex gap-2 text-[16px] leading-6 text-amber-800"><AlertTriangle className="mt-0.5 shrink-0" size={17}/>来源资料已变化，可继续保存草稿；重新核对来源后才能确认。</p>}
    <div className="mt-4"><SourceEvidence sources={card.sourceQuotes ?? []} materials={materials}/></div>
  </article>;
}

function ExperienceReviewEditor({ initial, materials, candidateSourceCurrent = true, onSave, onCancel }: { initial?: ExperienceCard; materials: ResumeMaterial[]; candidateSourceCurrent?: boolean; onSave: (card: ExperienceCard) => string | null; onCancel: () => void }) {
  const [card, setCard] = useState<ExperienceCard>(() => initial ?? blankCard());
  const [notice, setNotice] = useState("");
  const navigate = useSafeNavigation();
  const original = useRef(card);
  const fieldGroups: Array<{ key: keyof ExperienceCard; label: string; placeholder: string; optional?: boolean }> = [
    { key: "title", label: "经历标题", placeholder: "例如：企业知识库 POC 推进" },
    { key: "type", label: "经历类型", placeholder: "项目 / 工作 / 学习", optional: true },
    { key: "situation", label: "背景与目标", placeholder: "项目背景、目标与边界", optional: true },
    { key: "action", label: "本人行动", placeholder: "只写自己实际做过的动作" },
    { key: "tools", label: "关键方法与工具", placeholder: "使用的工具、方法或协作方式", optional: true },
    { key: "result", label: "结果或依据", placeholder: "如原文未提供数字，可留空或标注待核实", optional: true },
    { key: "reflection", label: "复盘", placeholder: "学到什么、下次如何改进", optional: true },
    { key: "notes", label: "备注", placeholder: "待补充或需核验的信息", optional: true },
  ];
  const persist = (confirm: boolean) => {
    if (!card.title.trim()) { const message = "请填写经历标题。"; setNotice(message); return message; }
    if (confirm && !card.action.trim()) { const message = "确认前请至少核对本人行动；没有结果数字可以留空。"; setNotice(message); return message; }
    if (confirm && !candidateSourceCurrent) { const message = "候选依据已变化，请重新核对来源或手工新建后再确认。"; setNotice(message); return message; }
    if (confirm && !card.confirmed) { const message = "请先勾选个人事实确认。"; setNotice(message); return message; }
    const next: ExperienceCard = { ...card, title: card.title.trim(), confirmed: confirm, candidateSourceVersions: confirm ? undefined : card.candidateSourceVersions, updatedAt: new Date().toISOString() };
    const error = onSave(next);
    if (error) { setNotice(`保存失败：${error} 当前编辑内容仍在本页。`); return error; }
    original.current = next;
    setCard(next);
    setNotice(confirm ? "确认成功，已保存到个人事实库。" : "草稿已保存，可稍后继续核对。");
    return null;
  };
  const patch = (key: keyof ExperienceCard, value: string | boolean) => setCard(current => ({ ...current, [key]: value, confirmed: key === "confirmed" ? Boolean(value) : false, updatedAt: new Date().toISOString() }));
  useUnsavedChanges(`profile-card:${card.id}`, JSON.stringify(card) !== JSON.stringify(original.current), { label: "经历核对内容", save: () => persist(card.confirmed), discard: () => setCard(original.current) });
  const saveAndReturn = (confirm: boolean) => { const error = persist(confirm); if (!error) onCancel(); };
  const checklist = [
    ["经历标题", Boolean(card.title.trim())],
    ["本人行动", Boolean(card.action.trim())],
    ["来源依据", (card.sourceQuotes?.length ?? 0) > 0 || card.origin === "manual"],
  ] as const;
  return <section aria-label="核对经历卡" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><button onClick={() => navigate(onCancel)} className="inline-flex items-center gap-1 text-[16px] text-muted-foreground transition-colors hover:text-foreground"><ChevronDown className="rotate-90" size={17}/>返回我的经历</button><div className="mt-3 flex flex-wrap items-center gap-2"><h2 className="text-[22px] font-semibold text-foreground">核对经历卡</h2><span className={`rounded-full px-2.5 py-1 text-[14px] font-medium ${card.confirmed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{card.confirmed ? "待重新确认" : card.origin === "ai" ? "草稿" : "待确认"}</span></div><p className="mt-2 text-[16px] leading-7 text-muted-foreground">逐项核对后再确认；不会要求补写原始简历没有提供的量化成果。</p></div>
      <button onClick={() => navigate(onCancel)} className="rounded-md px-4 py-2 text-[16px] text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]">取消</button>
    </div>
    <div className="grid gap-6 min-[1360px]:grid-cols-[minmax(0,1fr)_324px]">
      <div className="rounded-[14px] border border-border bg-white p-6">
        <div className="space-y-5">
          {fieldGroups.map(field => <label key={field.key} className="block"><span className="flex flex-wrap items-center gap-2 text-[16px] font-medium text-foreground">{field.label}{field.optional && <span className="text-[14px] font-normal text-muted-foreground">可选</span>}</span>{field.key === "title" || field.key === "type" ? <input aria-label={field.label} value={String(card[field.key] ?? "")} maxLength={field.key === "title" ? 120 : 80} onChange={event => patch(field.key, event.target.value)} placeholder={field.placeholder} className="mt-2 w-full rounded-md border border-border bg-card px-4 py-3 text-[16px] leading-6 text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"/> : <textarea aria-label={field.label} value={String(card[field.key] ?? "")} maxLength={3000} onChange={event => patch(field.key, event.target.value)} placeholder={field.placeholder} className="mt-2 min-h-28 w-full rounded-md border border-border bg-card px-4 py-3 text-[16px] leading-7 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"/>}</label>)}
        </div>
        <div className="mt-6"><SourceEvidence sources={card.sourceQuotes ?? []} materials={materials}/></div>
        {!candidateSourceCurrent && <p role="alert" className="mt-5 flex gap-2 rounded-lg bg-amber-50 p-4 text-[16px] leading-7 text-amber-800"><AlertTriangle className="mt-1 shrink-0" size={18}/>候选依据已变化。你可以保存当前草稿，但不能把它确认成个人事实。</p>}
        {notice && <p role={notice.startsWith("保存失败") || notice.includes("请") || notice.includes("变化") ? "alert" : "status"} className={`mt-5 rounded-lg p-4 text-[16px] leading-7 ${notice.startsWith("保存失败") ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-muted-foreground"}`}>{notice}</p>}
      </div>
      <aside className="h-fit rounded-[14px] border border-border bg-white p-5">
        <div className="flex items-center justify-between"><h3 className="text-[18px] font-semibold text-foreground">核对清单</h3><span className="text-[14px] text-muted-foreground">{checklist.filter(([, done]) => done).length} / {checklist.length}</span></div>
        <ul className="mt-4 space-y-3">{checklist.map(([label, done]) => <li key={label} className="flex items-center gap-3 text-[16px] text-muted-foreground"><span className={`inline-flex size-5 items-center justify-center rounded-full ${done ? "bg-emerald-50 text-emerald-700" : "border border-border bg-card"}`}>{done && <CheckCircle2 size={14}/>}</span>{label}{label === "来源依据" && card.origin === "manual" && <span className="text-[14px] text-muted-foreground">手工填写</span>}</li>)}</ul>
        <label className="mt-6 flex cursor-pointer gap-3 rounded-lg bg-card p-4 text-[16px] leading-7 text-foreground"><input aria-label="我确认这张经历中的个人行动、结果和边界真实可用" type="checkbox" checked={card.confirmed} disabled={!candidateSourceCurrent} onChange={event => patch("confirmed", event.target.checked)} className="mt-1 size-4 accent-[#C4622D] disabled:cursor-not-allowed disabled:opacity-50"/><span>我确认这张经历中的个人行动、结果和边界真实可用。</span></label>
        <button disabled={!candidateSourceCurrent || !card.confirmed} onClick={() => saveAndReturn(true)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-[16px] font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"><CheckCircle2 size={18}/>确认并保存</button>
        <button onClick={() => saveAndReturn(false)} className="mt-3 w-full rounded-md border border-border bg-white px-4 py-2.5 text-[16px] font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]">保存草稿并返回</button>
        <p className="mt-4 text-[14px] leading-6 text-muted-foreground">确认后仍可编辑；每次修改会要求你重新确认，AI 不会自动修改已确认内容。</p>
      </aside>
    </div>
  </section>;
}

export function ProfileLibrary({ profile, onSave, onPractice, onPrepareResume }: { profile: UserProfile; onSave: (profile: UserProfile) => string | null; onPractice?: (id: string) => void; onPrepareResume?: () => void }) {
  const navigate = useSafeNavigation();
  const latestProfile = useRef(profile); latestProfile.current = profile;
  const [tab, setTab] = useState<"materials" | "experiences">("experiences"), [notice, setNotice] = useState(() => profile.experienceCandidates?.length ? `已恢复 ${profile.experienceCandidates.length} 条上次候选，可继续核对。` : ""), [editing, setEditing] = useState<string | "new" | null>(null), [dragging,setDragging] = useState(false), [pendingCandidates, setPendingCandidates] = useState<ExperienceCandidate[]>([]), [extracting,setExtracting] = useState(false), [stoppingExtraction, setStoppingExtraction] = useState(false), [experienceFilter, setExperienceFilter] = useState<"all" | "candidate" | "draft" | "confirmed">("all"); const inputRef = useRef<HTMLInputElement>(null);
  const extractionRequest = useRef<AbortController | null>(null);
  const save = (next: UserProfile) => onSave({ ...next, updatedAt: new Date().toISOString() });
  const [pendingMaterial, setPendingMaterial] = useState<ResumeMaterial | null>(null);
  const [pendingCard, setPendingCard] = useState<ExperienceCard | null>(null);
  const [importing, setImporting] = useState(false); const importBusy = useRef(false);
  const [deleting, setDeleting] = useState(false), [deleteError, setDeleteError] = useState("");
  const candidates = [...(profile.experienceCandidates ?? []), ...pendingCandidates];
  const linkedCards = pendingMaterial ? materialLinkedExperiences(profile, pendingMaterial.id) : [];
  const linkedCandidates = pendingMaterial ? materialLinkedExperienceCandidates(profile, pendingMaterial.id) : [];
  useUnsavedChanges("profile-operation", deleting || importing || extracting, { label: "资料处理", save: () => "正在处理资料，请稍后再离开。", discard: () => { throw new Error("正在处理资料，请稍后再离开。"); } });
  useEffect(() => { const cancel = () => extractionRequest.current?.abort(); window.addEventListener("pagehide", cancel); return () => { window.removeEventListener("pagehide", cancel); cancel(); }; }, []);
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
  const persistCandidates = (incoming: ExperienceCandidate[]) => {
    try {
      const current = loadUserProfile();
      const before = current.experienceCandidates?.length ?? 0;
      const next = addExperienceCandidates({ ...current, aiExperienceExtractionConsent: true }, incoming);
      const added = (next.experienceCandidates?.length ?? 0) - before;
      const error = save(next);
      if (error) { setPendingCandidates(incoming); setNotice(`候选经历保存失败：${error} 当前结果仍在本页，可重试保存。`); return false; }
      setPendingCandidates([]);
      setNotice(added ? `已保存 ${added} 条候选经历，请选择、编辑并逐张确认。` : "没有新增候选；已有同来源候选和编辑内容已保留。");
      return true;
    } catch (error) {
      setPendingCandidates(incoming);
      setNotice(`候选经历保存失败：${error instanceof Error ? error.message : "本地存储错误"} 当前结果仍在本页，可重试保存。`);
      return false;
    }
  };
  const generate = async () => {
    if (extracting || extractionRequest.current) return;
    if (pendingCandidates.length) { persistCandidates(pendingCandidates); return; }
    const inputProfile = latestProfile.current;
    const sources = inputProfile.resumes.filter(item => item.reviewedAt && item.extractedText.trim());
    if (!sources.length) return setNotice("请先保存至少一份已核对的资料文字。");
    if (!inputProfile.aiExperienceExtractionConsent && !window.confirm("将把已核对的资料文字发送至已配置的模型服务生成候选经历卡。不会自动保存为个人事实。是否同意？")) return;
    if ((inputProfile.experienceCandidates?.length ?? 0) > 0 && !window.confirm("重新提取会保留已有候选和编辑内容，只新增不同来源的候选。是否继续？")) return;
    const controller = new AbortController(); extractionRequest.current = controller;
    const sourceVersions = new Map(sources.map(source => [source.id, resumeMaterialVersion(source)]));
    setTab("experiences"); setExtracting(true); setStoppingExtraction(false); setNotice("");
    try {
      const result = await extractExperienceCandidates(sources, { signal: controller.signal });
      if (controller.signal.aborted || extractionRequest.current !== controller) return;
      const current = loadUserProfile();
      if (sources.some(source => {
        const latest = current.resumes.find(item => item.id === source.id);
        return !latest || resumeMaterialVersion(latest) !== sourceVersions.get(source.id);
      })) {
        setNotice("已核对资料在提取期间变化，未保存旧依据的候选；请重新提取。"); return;
      }
      const now = new Date().toISOString();
      const stored = result.map((candidate: ExperienceCandidateInput): ExperienceCandidate => {
        const quotes = candidate.sourceQuotes ?? [];
        return { id: id("candidate"), title: candidate.title, situation: candidate.situation, action: candidate.action, result: candidate.result, reflection: candidate.reflection,
          ...(candidate.type ? { type: candidate.type } : {}), ...(candidate.tools ? { tools: candidate.tools } : {}), ...(candidate.notes ? { notes: candidate.notes } : {}), sourceQuotes: quotes,
          sourceVersions: [...new Set(quotes.map(quote => quote.materialId))].map(materialId => ({ materialId, contentVersion: sourceVersions.get(materialId)! })), createdAt: now, updatedAt: now };
      }).filter(candidate => candidate.sourceVersions.every(source => Boolean(source.contentVersion)));
      if (!stored.length) { setNotice("未找到有可靠文字依据的候选经历；可手工新建。"); return; }
      persistCandidates(stored);
    } catch (error) {
      if (controller.signal.aborted) setNotice("已停止 AI 提取，现有候选和经历草稿未改变。");
      else setNotice(error instanceof Error ? error.message : "生成失败；可继续手工新建。");
    } finally {
      if (extractionRequest.current === controller) { extractionRequest.current = null; setExtracting(false); setStoppingExtraction(false); }
    }
  };
  const stopExtraction = () => {
    const controller = extractionRequest.current;
    if (!controller || controller.signal.aborted) return;
    setStoppingExtraction(true);
    setNotice("正在停止 AI 提取…");
    controller.abort();
  };
  const selectCandidate = (candidate: ExperienceCandidate) => {
    if (pendingCandidates.some(item => item.id === candidate.id)) return setNotice("候选尚未成功保存，请先重试保存后再编辑。");
    const current = loadUserProfile();
    const stored = current.experienceCandidates?.find(item => item.id === candidate.id);
    if (!stored) return setNotice("候选经历已不存在，请刷新后重试。");
    if (!isExperienceCandidateCurrent(current, stored)) return setNotice("候选依据已变化，请重新提取或放弃候选后再继续。");
    const now = new Date().toISOString();
    const card: ExperienceCard = { ...blankCard(), id: id("experience"), title: stored.title, situation: stored.situation, action: stored.action, result: stored.result, reflection: stored.reflection,
      ...(stored.type ? { type: stored.type } : {}), ...(stored.tools ? { tools: stored.tools } : {}), ...(stored.notes ? { notes: stored.notes } : {}), sourceQuotes: stored.sourceQuotes, candidateSourceVersions: stored.sourceVersions, origin: "ai", confirmed: false, createdAt: now, updatedAt: now };
    const withoutCandidate = withoutExperienceCandidate(current, stored.id);
    const error = save({ ...withoutCandidate, experiences: [card, ...withoutCandidate.experiences] });
    if (error) setNotice(error); else { setEditing(card.id); setNotice("候选已保存为待核对草稿；确认前不会进入个人事实集合。"); }
  };
  const discardCandidate = (candidate: ExperienceCandidate) => {
    if (pendingCandidates.some(item => item.id === candidate.id)) { setPendingCandidates(items => items.filter(item => item.id !== candidate.id)); setNotice("已放弃未保存候选。"); return; }
    try { const error = save(withoutExperienceCandidate(loadUserProfile(), candidate.id)); setNotice(error || "已放弃候选经历。"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "放弃候选失败，当前内容保留。"); }
  };
  const unconfirmedCards = profile.experiences.filter(card => !card.confirmed);
  const confirmedCards = profile.experiences.filter(card => card.confirmed);
  const candidateCount = candidates.length;
  const totalCount = candidateCount + profile.experiences.length;
  const activeEdit = editing === "new" ? undefined : profile.experiences.find(card => card.id === editing);
  const visibleCandidates = experienceFilter === "all" || experienceFilter === "candidate";
  const visibleDrafts = experienceFilter === "all" || experienceFilter === "draft";
  const visibleConfirmed = experienceFilter === "all" || experienceFilter === "confirmed";
  const noticeIsRisk = /失败|变化|请先|未保存|取消/.test(notice);
  const profileDialogs = <>
    <Dialog open={Boolean(pendingMaterial)} onOpenChange={open => { if (!open && !deleting) setPendingMaterial(null); }}>
      <DialogContent showCloseButton={!deleting}><DialogHeader><DialogTitle>删除个人资料</DialogTitle><DialogDescription>将删除“{pendingMaterial?.fileName}”的资料文字与未被其他资料引用的原件，不删除经历卡、岗位资料或训练记录。此操作不可撤销。</DialogDescription></DialogHeader>
        {linkedCards.length > 0 && <p role="alert" className="break-words text-[16px] text-amber-800">无法删除：仍被经历卡引用（{linkedCards.map(card => card.title).join("、")}）。请先处理关联经历；不会自动删卡或移除来源。</p>}
        {linkedCandidates.length > 0 && <p role="alert" className="break-words text-[16px] text-amber-800">无法删除：仍被候选经历引用（{linkedCandidates.map(candidate => candidate.title).join("、")}）。请先重新提取或放弃候选；不会自动丢弃候选内容。</p>}
        {deleteError && <p role="alert" className="text-[16px] text-destructive">{deleteError}</p>}
        <DialogFooter><button disabled={deleting} onClick={() => setPendingMaterial(null)} className="rounded-md border border-border bg-white px-4 py-2 text-[16px] text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">取消</button><button disabled={deleting || linkedCards.length > 0 || linkedCandidates.length > 0} onClick={() => void deleteMaterial()} className="rounded-md bg-destructive px-4 py-2 text-[16px] font-medium text-white transition-all hover:bg-destructive/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{deleting ? "正在删除…" : "确认删除"}</button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(pendingCard)} onOpenChange={open => { if (!open) setPendingCard(null); }}>
      <DialogContent><DialogHeader><DialogTitle>删除经历卡</DialogTitle><DialogDescription>删除“{pendingCard?.title}”后，它不再进入新的已确认个人事实上下文。来源资料、原件、岗位和历史训练记录不会删除；此操作不可撤销。</DialogDescription></DialogHeader>
        {deleteError && <p role="alert" className="text-[16px] text-destructive">{deleteError}</p>}
        <DialogFooter><button onClick={() => setPendingCard(null)} className="rounded-md border border-border bg-white px-4 py-2 text-[16px] text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]">取消</button><button onClick={deleteCard} className="rounded-md bg-destructive px-4 py-2 text-[16px] font-medium text-white transition-all hover:bg-destructive/90 active:scale-[0.98]">确认删除</button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
  if (editing && (editing === "new" || activeEdit)) return <div className="space-y-6"><ExperienceReviewEditor key={editing} initial={activeEdit} materials={profile.resumes} candidateSourceCurrent={activeEdit ? isCandidateDraftCurrent(profile, activeEdit) : true} onSave={card => { const nextExperiences = activeEdit ? profile.experiences.map(item => item.id === card.id ? card : item) : [card, ...profile.experiences]; return save({ ...profile, experiences: nextExperiences }); }} onCancel={() => setEditing(null)}/>{profileDialogs}</div>;
  return <div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-3"><h1 className="text-[26px] font-semibold tracking-[-0.03em] text-foreground">个人资料</h1><div className="flex items-center gap-3 text-sm text-muted-foreground"><span><strong className="font-semibold text-foreground">{confirmedCards.length}</strong> 已确认</span><span className="h-4 w-px bg-muted"/><span><strong className="font-semibold text-foreground">{candidateCount + unconfirmedCards.length}</strong> 待核对</span></div></header>
    {extracting && <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-4 text-[16px] text-muted-foreground"><span>{stoppingExtraction ? "正在停止 AI 提取…" : "AI 正在提取候选经历…"}</span><button type="button" disabled={stoppingExtraction} onClick={stopExtraction} className="rounded-md border border-border bg-white px-4 py-2 text-[16px] font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{stoppingExtraction ? "正在停止…" : "停止 AI 提取"}</button></div>}
    <fieldset disabled={deleting || importing || extracting} className="min-w-0">
      <div>
        <div role="tablist" aria-label="个人资料库选项" className="flex gap-5 border-b border-border"><button role="tab" aria-selected={tab === "experiences"} onClick={() => navigate(() => setTab("experiences"))} className={`border-b-2 px-1 pb-3 text-[16px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] ${tab === "experiences" ? "border-ring text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>我的经历</button><button role="tab" aria-selected={tab === "materials"} onClick={() => navigate(() => setTab("materials"))} className={`border-b-2 px-1 pb-3 text-[16px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.98] ${tab === "materials" ? "border-ring text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>简历资料</button></div>
         {notice && <p role={noticeIsRisk ? "alert" : "status"} className={`mt-5 rounded-lg p-4 text-[16px] leading-7 ${noticeIsRisk ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{notice}</p>}
         {tab === "materials" ? <div className="pt-6">
          <div><h2 className="text-[22px] font-semibold text-foreground">简历资料</h2><p className="mt-2 text-[16px] leading-7 text-muted-foreground">上传简历后先核对文字，再提取候选经历。核对文字不等于确认个人事实。</p></div>
           <section className="mt-6 space-y-5 rounded-2xl border border-border bg-background p-6"><div><h3 className="text-[20px] font-semibold text-foreground">添加简历资料</h3><p className="mt-2 text-[16px] leading-7 text-muted-foreground">上传后先核对文字，再从已核对资料中提取候选经历。</p></div><div tabIndex={0} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void importFiles(Array.from(event.dataTransfer.files)); }} onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); void importFiles(files); } }} className={`rounded-[10px] border-2 border-dashed p-5 text-center transition-colors ${dragging ? "border-ring bg-amber-50" : "border-border bg-white"}`}><FileText className="mx-auto text-primary" size={24}/><p className="mt-2 text-sm leading-6 text-muted-foreground">拖入文件、粘贴图片，或选择简历文件</p><div className="mt-3 flex flex-wrap justify-center gap-2"><button className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98]" onClick={() => inputRef.current?.click()}><Upload size={16}/>选择文件</button><button className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-4 py-2 text-sm text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]" onClick={addPasted}><ClipboardPaste size={16}/>粘贴文字</button></div><input ref={inputRef} aria-label="上传个人资料文件" type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,image/png,image/jpeg" className="sr-only" onChange={event => { void importFiles(Array.from(event.target.files || [])); event.target.value = ""; }}/></div></section>
          <section className="mt-6 space-y-4"><div className="flex flex-wrap items-center justify-between gap-4"><h3 className="text-[18px] font-semibold text-foreground">已保存资料</h3><button disabled={extracting || (!pendingCandidates.length && !profile.resumes.some(item => item.reviewedAt && item.extractedText.trim()))} onClick={() => navigate(() => void generate())} className="inline-flex items-center gap-2 rounded-md border border-border bg-accent px-4 py-2 text-[16px] font-medium text-primary transition-all hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"><Sparkles size={18}/>{extracting ? "正在提取…" : pendingCandidates.length ? "重试保存候选" : "AI 提取经历"}</button></div>{importing && <p role="status" className="rounded-lg bg-indigo-50 p-4 text-[16px] text-indigo-700">正在导入资料，请稍候再编辑或删除。</p>}{profile.resumes.length ? profile.resumes.map(item => <SourceEditor key={item.id} material={item} onSave={next => save({ ...profile, resumes: profile.resumes.map(item => item.id === next.id ? next : item) })} onDelete={() => requestMaterialDelete(item)}/>) : <p className="rounded-[14px] border border-dashed border-border p-6 text-[16px] leading-7 text-muted-foreground">暂无资料。上传后需要先核对文字，才能用于 AI 候选经历提取。</p>}</section>
         </div> : <div className="pt-4">
           <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"><p className="text-sm text-muted-foreground">优先核对待确认经历；确认后才会用于岗位准备。</p><div className="flex flex-wrap gap-2"><button onClick={() => navigate(() => setTab("materials"))} className="rounded-md border border-border bg-white px-4 py-2 text-sm text-muted-foreground transition-all hover:bg-muted active:scale-[0.98]">上传简历资料</button><button disabled={extracting || (!pendingCandidates.length && !profile.resumes.some(item => item.reviewedAt && item.extractedText.trim()))} onClick={() => void generate()} className="inline-flex items-center gap-2 rounded-md border border-border bg-accent px-4 py-2 text-sm font-medium text-primary transition-all hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"><Sparkles size={16}/>{extracting ? "正在提取…" : pendingCandidates.length ? "重试保存候选" : "AI 提取经历"}</button><button onClick={() => navigate(() => setEditing("new"))} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98]"><Plus size={16}/>手工新建</button></div></div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap gap-2">{([ ["all", `全部 ${totalCount}`], ["candidate", `候选 ${candidateCount}`], ["draft", `待确认 ${unconfirmedCards.length}`], ["confirmed", `已确认 ${confirmedCards.length}`] ] as const).map(([value, label]) => <button key={value} aria-pressed={experienceFilter === value} onClick={() => setExperienceFilter(value)} className={`rounded-full px-3 py-1.5 text-[16px] transition-all active:scale-[0.98] ${experienceFilter === value ? "bg-accent text-primary" : "bg-background text-muted-foreground hover:bg-accent"}`}>{label}</button>)}</div><div className="flex items-center gap-2 text-[14px] text-muted-foreground"><span>已确认</span><progress aria-label="已确认经历进度" value={confirmedCards.length} max={Math.max(totalCount, 1)} className="h-1.5 w-28 accent-[#C4622D]">{confirmedCards.length} / {totalCount}</progress><span>{confirmedCards.length} / {totalCount}</span></div></div>
          <div className="mt-5 space-y-4">{visibleCandidates && candidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} materials={profile.resumes} persisted={Boolean(profile.experienceCandidates?.some(item => item.id === candidate.id))} current={isExperienceCandidateCurrent(profile, candidate)} onReview={() => navigate(() => selectCandidate(candidate))} onDiscard={() => discardCandidate(candidate)}/>)}{visibleDrafts && unconfirmedCards.map(card => <ExperienceStateCard key={card.id} card={card} materials={profile.resumes} sourceCurrent={isCandidateDraftCurrent(profile, card)} onReview={() => navigate(() => setEditing(card.id))} onDelete={() => requestCardDelete(card)}/>) }{visibleConfirmed && confirmedCards.length > 0 && <><div className="flex items-center gap-3 py-2"><span className="h-px flex-1 bg-muted"/><span className="text-[14px] text-muted-foreground">已确认 {confirmedCards.length} 条</span><span className="h-px flex-1 bg-muted"/></div>{confirmedCards.map(card => <ExperienceStateCard key={card.id} card={card} materials={profile.resumes} sourceCurrent={true} onReview={() => navigate(() => setEditing(card.id))} onDelete={() => requestCardDelete(card)} onPractice={onPractice ? () => navigate(() => onPractice(card.id)) : undefined}/>)}</>}{!candidateCount && !profile.experiences.length && <div className="rounded-[14px] border border-dashed border-border bg-card p-8 text-center"><h2 className="text-[18px] font-semibold text-foreground">还没有可核对的经历</h2><p className="mt-2 text-[16px] leading-7 text-muted-foreground">先上传并核对简历文字，或手工新建一段真实经历。</p></div>}</div>
          {confirmedCards.length > 0 && <section className="mt-5 rounded-[14px] border border-border bg-card p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-[18px] font-semibold text-foreground">接下来可准备简历面试题</h2><p className="mt-1 text-sm text-muted-foreground">已确认经历会用于生成针对性题目。</p></div><button onClick={onPrepareResume} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98]">准备简历面试题</button></div></section>}
        </div>}
      </div>
    </fieldset>
    {profileDialogs}
  </div>;
  return <div className="max-w-6xl space-y-6"><fieldset disabled={deleting || importing || extracting} className="min-w-0"><div className="rounded-2xl border border-slate-200 bg-white p-4"><div role="tablist" aria-label="个人资料库选项" className="flex gap-2 border-b border-slate-200"><button role="tab" aria-selected={tab === "materials"} onClick={() => navigate(() => setTab("materials"))} className={`px-4 py-2.5 text-sm font-medium ${tab === "materials" ? "border-b-2 border-blue-700 text-blue-800" : "text-slate-600"}`}>我的资料</button><button role="tab" aria-selected={tab === "experiences"} onClick={() => navigate(() => setTab("experiences"))} className={`px-4 py-2.5 text-sm font-medium ${tab === "experiences" ? "border-b-2 border-blue-700 text-blue-800" : "text-slate-600"}`}>我的经历</button></div>{tab === "materials" ? <div className="pt-5"><section className="rounded-xl border border-blue-100 bg-blue-50/50 p-5"><h2 className="font-semibold text-slate-950">上传或粘贴资料</h2><p className="mt-1 text-sm leading-6 text-slate-600">上传简历后核对文字，再提取并确认经历。支持文档和图片。</p><div tabIndex={0} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void importFiles(Array.from(e.dataTransfer.files)); }} onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void importFiles(files); } }} className={`mt-4 rounded-xl border-2 border-dashed p-6 text-center ${dragging ? "border-blue-600 bg-blue-100" : "border-blue-200 bg-white"}`}><ImageUp className="mx-auto text-blue-700"/><p className="mt-2 text-sm text-slate-700">拖入多个文件，聚焦后粘贴图片，或选择文件</p><div className="mt-3 flex justify-center gap-2"><button className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white" onClick={() => inputRef.current?.click()}><Upload size={16}/>选择文件</button><button className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700" onClick={addPasted}><ClipboardPaste size={16}/>粘贴文字</button></div><input ref={inputRef} aria-label="上传个人资料文件" type="file" multiple accept=".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,image/png,image/jpeg" className="sr-only" onChange={e => { void importFiles(Array.from(e.target.files || [])); e.target.value = ""; }}/></div><p className="mt-2 text-xs text-slate-500">图片原件最大 {Math.round(MAX_OCR_IMAGE_BYTES / 1024 / 1024)}MB，其他文件最大 {Math.round(materialFileLimit / 1024 / 1024)}MB；图片 OCR 首次需下载资源。</p></section><section className="mt-5 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-slate-950">已保存资料</h2><button disabled={extracting || (!pendingCandidates.length && !profile.resumes.some(item => item.reviewedAt && item.extractedText.trim()))} onClick={() => navigate(() => void generate())} className="rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-800 disabled:opacity-50">{pendingCandidates.length ? "重试保存候选" : "从已核对简历提取经历"}</button></div>{importing && <p role="status" className="text-sm text-slate-600">正在导入资料，请稍候再编辑或删除。</p>}{profile.resumes.length ? profile.resumes.map(item => <SourceEditor key={item.id} material={item} onSave={next => save({ ...profile, resumes: profile.resumes.map(item => item.id === next.id ? next : item) })} onDelete={() => requestMaterialDelete(item)}/>) : <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">暂无资料。上传后需先核对文本，才能用于 AI 候选经历提取。</p>}</section></div> : <div className="pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-950">我的经历</h2><p className="mt-1 text-sm text-slate-600">确认后用于岗位准备。也可手工补充简历未写的真实项目。</p></div><div className="flex gap-2"><button disabled={extracting} onClick={() => void generate()} className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 disabled:opacity-50"><Sparkles size={16}/>{extracting ? "正在提取…" : pendingCandidates.length ? "重试保存候选" : "AI 提取经历"}</button><button onClick={() => navigate(() => setEditing("new"))} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white"><Plus size={16}/>手工新建</button></div></div>{candidates.length > 0 && <section className="mt-5 rounded-xl border border-violet-200 bg-violet-50/40 p-4"><h3 className="font-medium text-slate-950">候选经历（尚未保存为事实）</h3><div className="mt-3 space-y-3">{candidates.map(candidate => { const persisted = Boolean(profile.experienceCandidates?.some(item => item.id === candidate.id)); const current = isExperienceCandidateCurrent(profile, candidate); return <article key={candidate.id} className="rounded-lg border border-violet-100 bg-white p-3"><p className="font-medium text-slate-950">{candidate.title}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{[candidate.situation,candidate.action,candidate.result].filter(Boolean).join("\n") || "模型未提供完整字段，请编辑补充。"}</p>{!persisted && <p role="alert" className="mt-2 text-sm text-amber-900">候选尚未保存；请重试保存后再编辑。</p>}{persisted && !current && <p role="alert" className="mt-2 text-sm text-amber-900">来源资料已变化，请重新提取或放弃候选。</p>}<div className="mt-2 flex flex-wrap gap-2"><button disabled={!persisted || !current} onClick={() => navigate(() => selectCandidate(candidate))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">选择并编辑</button><button onClick={() => discardCandidate(candidate)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 active:scale-[0.98] transition-all">放弃候选</button></div></article>; })}</div></section>}{editing === "new" && <div className="mt-5"><CardEditor onSave={card => { const error = save({ ...profile, experiences: [card, ...profile.experiences] }); if (!error) setEditing(null); return error; }} onCancel={() => setEditing(null)}/></div>}<div className="mt-5 space-y-3">{profile.experiences.map(card => editing === card.id ? <CardEditor key={card.id} initial={card} candidateSourceCurrent={isCandidateDraftCurrent(profile, card)} onSave={next => { const error = save({ ...profile, experiences: profile.experiences.map(item => item.id === next.id ? next : item) }); if (!error) setEditing(null); return error; }} onCancel={() => setEditing(null)}/> : <ExperienceSummary key={card.id} card={card} materials={profile.resumes} onEdit={() => navigate(() => setEditing(card.id))} onDelete={() => requestCardDelete(card)} onPractice={onPractice ? () => navigate(() => onPractice(card.id)) : undefined}/>)}{!profile.experiences.length && editing !== "new" && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-600">暂无经历卡。可以手工新建，或在核对资料后请求候选卡。</p>}</div></div>}{notice && <p role="status" className="mt-5 text-sm text-slate-700">{notice}</p>}</div></fieldset>
    <Dialog open={Boolean(pendingMaterial)} onOpenChange={open => { if (!open && !deleting) setPendingMaterial(null); }}>
      <DialogContent showCloseButton={!deleting}><DialogHeader><DialogTitle>删除个人资料</DialogTitle><DialogDescription>将删除“{pendingMaterial?.fileName}”的资料文字与未被其他资料引用的原件，不删除经历卡、岗位资料或训练记录。此操作不可撤销。</DialogDescription></DialogHeader>
        {linkedCards.length > 0 && <p role="alert" className="break-words text-sm text-amber-900">无法删除：仍被经历卡引用（{linkedCards.map(card => card.title).join("、")}）。请先处理关联经历；不会自动删卡或移除来源。</p>}
        {linkedCandidates.length > 0 && <p role="alert" className="break-words text-sm text-amber-900">无法删除：仍被候选经历引用（{linkedCandidates.map(candidate => candidate.title).join("、")}）。请先重新提取或放弃候选；不会自动丢弃候选内容。</p>}
        {deleteError && <p role="alert" className="text-sm text-red-700">{deleteError}</p>}
        <DialogFooter><button disabled={deleting} onClick={() => setPendingMaterial(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">取消</button><button disabled={deleting || linkedCards.length > 0 || linkedCandidates.length > 0} onClick={() => void deleteMaterial()} className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50">{deleting ? "正在删除…" : "确认删除"}</button></DialogFooter>
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
