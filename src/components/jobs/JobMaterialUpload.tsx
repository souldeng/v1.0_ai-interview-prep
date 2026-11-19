import { useEffect, useRef, useState } from "react";
import type { InterviewExperienceCategory, JobMaterial, JobMaterialKind, JobMaterialPart } from "../../lib/domain";
import { extractResumeText, pdfExtractionNotice } from "../../lib/documentParser";
import { createReviewedJobMaterial } from "../../lib/jobMaterialFlow";
import { deleteMaterialFile, storeMaterialFile } from "../../lib/materialFileStorage";
import { useUnsavedChanges } from "../shared/UnsavedChanges";
import { inspectOcrImage, isOcrImage } from "../../lib/localOcr";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type StageStatus = "等待识别" | "OCR 中" | "OCR 成功" | "OCR 失败" | "解析成功" | "解析失败" | "已修改" | "已确认";
type StageItem = {
  id: string; file?: File; fileName: string; mimeType: string; size: number;
  url?: string; initialText: string; text: string; status: StageStatus;
  progress: number; busy?: boolean; error?: string; selected: boolean; reviewed: boolean;
};
const uid = () => `job-file-${crypto.randomUUID()}`;
const accept = ".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,image/png,image/jpeg";
const isImage = (type: string) => type.startsWith("image/");
const isPdf = (type: string, name: string) => type === "application/pdf" || /\.pdf$/i.test(name);

export function JobMaterialUpload({ projectId, onSave, jdOnly = false }: { projectId: string; onSave: (material: JobMaterial) => string | null; jdOnly?: boolean }) {
  const [items, setItems] = useState<StageItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<JobMaterialKind>("job_description");
  const [category, setCategory] = useState<InterviewExperienceCategory>("other");
  const [pastedText, setPastedText] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const removed = useRef(new Set<string>());
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); }, []);
  const update = (id: string, patch: Partial<StageItem>) => setItems(old => old.map(item => item.id === id ? { ...item, ...patch } : item));
  const process = async (item: StageItem) => {
    if (!item.file || saveLock.current) return;
    update(item.id, { status: isImage(item.mimeType) ? "OCR 中" : "等待识别", error: undefined, progress: 0, reviewed: false, busy: true });
    try {
      if (isImage(item.mimeType)) {
        await inspectOcrImage(item.file);
        if(removed.current.has(item.id))return;
        if(!item.url){const url=URL.createObjectURL(item.file);urls.current.add(url);update(item.id,{url});}
      }
      const extracted = await extractResumeText(item.file, progress => update(item.id, { status: "OCR 中", progress: progress.progress }));
      if (removed.current.has(item.id)) return;
      setItems(old => old.map(current => current.id === item.id ? {
        ...current,
        initialText: extracted.text,
        text: current.text || extracted.text,
        status: current.text ? "已修改" : extracted.parser === "ocr" ? "OCR 成功" : "解析成功",
        progress: 100,
        reviewed: false,
      } : current));
    } catch (error) {
      if (removed.current.has(item.id)) return;
      update(item.id, { status: isImage(item.mimeType) ? "OCR 失败" : "解析失败", error: error instanceof Error ? error.message : "读取失败", reviewed: false });
    } finally { update(item.id, { busy: false }); }
  };
  const enqueue = (files: File[]) => {
    if (saveLock.current) return;
    const next = files.map(file => {
      const image=file.type.startsWith("image/") || isOcrImage(file);
      const url = image ? undefined : URL.createObjectURL(file); if(url)urls.current.add(url);
      return { id: uid(), file, fileName: file.name, mimeType: file.type || (image ? /\.png$/i.test(file.name) ? "image/png":"image/jpeg" : isPdf("", file.name) ? "application/pdf" : "application/octet-stream"), size: file.size, url, initialText: "", text: "", status: "等待识别" as StageStatus, progress: 0, selected: true, reviewed: false, busy: true };
    });
    if (!next.length) return;
    setItems(old => [...old, ...next]); setCurrentId(id => id ?? next[0].id);
    void next.reduce((chain, item) => chain.then(() => process(item)), Promise.resolve());
  };
  const addPasted = () => {
    if (!pastedText.trim()) return setNotice("请先粘贴资料文字。");
    const item: StageItem = { id: uid(), fileName: "粘贴文字", mimeType: "text/plain", size: new Blob([pastedText]).size, initialText: pastedText.trim(), text: pastedText.trim(), status: "已修改", progress: 100, selected: true, reviewed: false };
    setItems(old => [...old, item]); setCurrentId(item.id); setPastedText(""); setNotice(jdOnly ? "文字已加入待核对 JD，请核对后确认并使用。" : "文字已加入待核对资料，请确认后分类保存。");
  };
  const remove = (id: string) => {
    removed.current.add(id);
    const item = items.find(value => value.id === id);
    if (item?.url) { URL.revokeObjectURL(item.url); urls.current.delete(item.url); }
    setItems(old => old.filter(value => value.id !== id));
    if (currentId === id) setCurrentId(items.find(value => value.id !== id)?.id ?? null);
  };
  const move = (id: string, direction: -1 | 1) => setItems(old => {
    const index = old.findIndex(item => item.id === id), other = index + direction;
    if (index < 0 || other < 0 || other >= old.length) return old;
    const next = [...old]; [next[index], next[other]] = [next[other], next[index]]; return next;
  });
  const selected = items.filter(item => item.selected);
  const current = items.find(item => item.id === currentId) ?? items[0];
  const selectedPendingReview = selected.filter(item => item.busy || !item.text.trim());
  // These are review hints, not a semantic JD filter. Never discard source text.
  const platformLines = jdOnly ? current?.text.split(/\n/).filter(line => /立即沟通|回复率|沟通中|已读未回|首页.*(?:职位|消息)|(?:推荐|职位).*消息/.test(line)).slice(0, 4) ?? [] : [];
  const saveGroup = async (): Promise<string | null> => {
    const fail = (message: string) => { setNotice(message); return message; };
    if (jdOnly && selected.some(item => item.busy)) return fail("正在识别所选文件，请等待完成后核对文字。");
    if (!selected.length) return fail("请先选择要合并的文件。");
    if (selected.some(item => !item.reviewed || !item.text.trim())) return fail("请先逐张核对并确认所选文件的文字。");
    if (!jdOnly && !title.trim()) return fail("请为这组资料填写名称。");
    if (saveLock.current) return "正在保存，请稍候。";
    saveLock.current = true;
    setSaving(true); setNotice("");
    const storedIds: string[] = [];
    try {
      const parts: JobMaterialPart[] = [];
      for (const item of selected) {
        let fileId: string | undefined;
        if (item.file) {
          fileId = item.id;
          await storeMaterialFile(fileId, item.file);
          storedIds.push(fileId);
        }
        parts.push({ id: item.id, ...(fileId ? { fileId } : {}), fileName: item.fileName, mimeType: item.mimeType, size: item.size, initialText: item.initialText, reviewedText: item.text.trim(), originalSaved: Boolean(fileId) });
      }
      const material = createReviewedJobMaterial({ id: `material-${crypto.randomUUID()}`, projectId, title: jdOnly ? `JD · ${selected[0].fileName}${selected.length > 1 ? ` 等 ${selected.length} 项` : ""}`.slice(0, 160) : title, kind: jdOnly ? "job_description" : kind, parts, now: new Date().toISOString() });
      if (kind === "interview_experience") material.category = category;
      const error = onSave(material);
      if (error) throw new Error(error);
      selected.forEach(item => remove(item.id)); setTitle(""); setNotice(jdOnly ? "已填入岗位 JD 并保存创建草稿。创建岗位后才会保存到岗位。" : `“${material.title}”已保存到当前岗位。`);
      return items.length > selected.length || pastedText.trim() ? "仍有未保存资料，请留在当前页核对并保存，或明确放弃。" : null;
    } catch (error) {
      await Promise.allSettled(storedIds.map(deleteMaterialFile));
      return fail(jdOnly ? `JD 未应用，保存失败：${error instanceof Error ? error.message : "请重试"}。核对文字仍保留。` : error instanceof Error ? error.message : "保存失败；核对文字仍保留，请重试。");
    } finally { saveLock.current = false; setSaving(false); }
  };
  const confirmSelected = () => {
    if (saving) return;
    if (!selected.length) { setNotice("请先选择要核对的资料。"); return; }
    if (selectedPendingReview.length) { setNotice(`还有 ${selectedPendingReview.length} 份资料正在识别或没有文字，请完成后再集中确认。`); return; }
    const ids = new Set(selected.map(item => item.id));
    setItems(old => old.map(item => ids.has(item.id) ? { ...item, reviewed: true, status: "已确认", error: undefined } : item));
    setNotice(`已集中确认 ${selected.length} 份资料文字，可继续${jdOnly ? "使用此 JD" : "分类保存"}。`);
  };
  useUnsavedChanges(`job-batch:${projectId}`, items.length > 0 || Boolean(pastedText.trim()), {
    label: "岗位待核对资料", save: saveGroup,
    discard: () => { items.forEach(item => remove(item.id)); setPastedText(""); setTitle(""); },
  });
  return <section className="rounded-[16px] border border-border bg-white p-6">
    <fieldset disabled={saving} className="min-w-0">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-[20px] font-semibold text-foreground">{jdOnly ? "上传 JD" : "添加岗位资料"}</h2><p className="mt-1 text-[15px] leading-6 text-muted-foreground">{jdOnly ? "上传后集中核对文字，再使用这份 JD。原件和原始文字会保留。" : "一次处理多份资料；完成核对后，再按分类保存。"}</p></div>{items.length > 0 && <span className="rounded-full bg-accent px-3 py-1 text-[14px] font-medium text-primary">{items.length} 份待处理</span>}</div>
    <div tabIndex={0} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); enqueue(Array.from(event.dataTransfer.files)); }} onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); enqueue(files); } }} className={`mt-5 rounded-[12px] border-2 border-dashed p-6 text-center ${dragging ? "border-ring bg-amber-50" : "border-border bg-card"}`}>
      <p className="text-[16px] text-muted-foreground">一次选择多张截图或文档，也可拖入或粘贴图片</p>
      <Button type="button" data-cta="primary" onClick={() => inputRef.current?.click()} disabled={saving} className="mt-3 px-4">选择文件</Button>
      <input ref={inputRef} aria-label="选择岗位资料文件" type="file" accept={accept} multiple className="sr-only" onChange={event => { enqueue(Array.from(event.target.files ?? [])); event.target.value = ""; }}/>
    </div>
    <div className="mt-3 flex flex-col gap-2 sm:flex-row"><Textarea aria-label="直接粘贴岗位资料文字" value={pastedText} onChange={event => setPastedText(event.target.value)} className="min-h-20 flex-1 bg-white" placeholder={jdOnly ? "或直接粘贴 JD 文字…" : "或在此直接粘贴 JD、第三方面经或参考资料文字…"}/><Button type="button" variant="outline" disabled={saving || !pastedText.trim()} onClick={addPasted} className="h-fit">加入核对</Button></div>
    {items.length > 0 && <div className="mt-6 space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[20px] font-semibold text-foreground">集中核对</h3><p className="mt-1 text-[15px] text-muted-foreground">逐份修改是可选操作；确认后可一次保存所选资料。</p></div><p role="status" aria-live="polite" className="text-[15px] text-muted-foreground">共 {items.length} 份 · 已识别 {items.filter(item => !item.busy && item.text.trim()).length} 份 · 已确认 {items.filter(item => item.reviewed).length} 份</p></div><div className="grid gap-4 lg:grid-cols-[minmax(180px,0.75fr)_minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="space-y-2">{items.map((item, index) => <div key={item.id} className={`rounded-[10px] border p-3 ${current?.id === item.id ? "border-[#94A3B8] bg-amber-50" : "border-border bg-white"}`}><div className="flex items-start gap-2"><input aria-label={`选择 ${item.fileName}`} type="checkbox" checked={item.selected} onChange={event => update(item.id, { selected: event.target.checked })} className="mt-1"/><button type="button" className="min-w-0 flex-1 truncate text-left text-[15px] font-medium text-foreground" onClick={() => setCurrentId(item.id)}>{index + 1}. {item.fileName}</button></div><p className="mt-1 pl-5 text-[13px] text-muted-foreground">{item.status}{jdOnly && !item.busy ? item.reviewed ? " · 待使用" : " · 待核对" : ""}{item.progress > 0 && item.progress < 100 ? ` · ${item.progress}%` : ""}</p><div className="mt-2 flex gap-3 pl-5 text-[13px]"><button type="button" aria-label={`上移 ${item.fileName}`} disabled={index === 0} onClick={() => move(item.id, -1)} className="text-primary disabled:opacity-30">上移</button><button type="button" aria-label={`下移 ${item.fileName}`} disabled={index === items.length - 1} onClick={() => move(item.id, 1)} className="text-primary disabled:opacity-30">下移</button><button type="button" aria-label={`移除 ${item.fileName}`} onClick={() => remove(item.id)} className="text-red-700">移除</button></div></div>)}</div>
      <div className="min-w-0 rounded-[10px] border border-border bg-card p-4"><p className="text-[16px] font-medium text-foreground">原件预览</p>{current?.url && isImage(current.mimeType) ? <img src={current.url} alt={`${current.fileName} 原图`} className="mt-3 max-h-96 w-full object-contain"/> : current?.url && isPdf(current.mimeType,current.fileName) ? <iframe title={`${current.fileName} PDF 预览`} src={current.url} className="mt-3 h-96 w-full"/> : <p className="mt-3 text-[15px] text-muted-foreground">{current?.file ? "此格式可下载原件，右侧可核对提取文字。" : "粘贴文字没有原始文件。"}</p>}{current?.url && <a className="mt-3 inline-block text-[15px] text-primary underline" href={current.url} download={current.fileName}>下载当前原件</a>}</div>
      <div className="min-w-0"><p className="text-[16px] font-medium text-foreground">当前文件文字</p>{current && isPdf(current.mimeType, current.fileName) && <p role="status" className="mt-2 text-[15px] text-amber-900">PDF 文字可能不完整，请核对后使用</p>}<details className="mt-2 rounded-[10px] border border-border p-3 text-[14px] text-muted-foreground"><summary className="cursor-pointer">查看初始识别文字</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap">{current?.initialText || "识别失败或尚无初始文字"}</pre></details><Textarea aria-label="当前文件核对文字" value={current?.text ?? ""} onChange={event => current && update(current.id, { text: event.target.value, status: jdOnly && current.busy ? current.status : "已修改", reviewed: false })} className="mt-3 min-h-56 w-full bg-white" placeholder="核对 OCR/解析结果；失败时可直接输入文字"/>{current?.error && <p role="alert" className="mt-2 text-[15px] text-red-700">{current.error}</p>}<div className="mt-2 flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!current?.file || Boolean(current?.busy)} onClick={() => current && void process(current)}>重新识别</Button><Button type="button" variant="outline" disabled={!current?.text.trim() || Boolean(current?.busy)} onClick={() => current && update(current.id, { reviewed: true, status: "已确认", error: undefined })} className="border-border bg-accent font-medium text-primary hover:bg-accent">确认当前文字</Button></div></div>
    </div><details className="rounded-[10px] border border-border bg-card p-4"><summary className="cursor-pointer text-[16px] font-medium text-foreground">查看按当前顺序合并的文字</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-[15px] leading-7 text-muted-foreground">{selected.map((item,index) => `${index + 1}. ${item.fileName}\n${item.text}`).join("\n\n")}</pre></details>
      {jdOnly && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p>识别完成不等于已核对。请对照原件，删除不需要的平台导航、沟通状态，保留完整职责与要求，再确认文字；系统不会自动删改。</p>{platformLines.length > 0 && <p className="mt-2 break-words">发现疑似平台信息（仅提示）：{platformLines.join("；").slice(0, 300)}</p>}</div>}
      {!jdOnly && <div className="grid gap-3 sm:grid-cols-2"><label className="text-[16px] font-medium text-muted-foreground">资料名称<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} className="mt-1 w-full rounded-md border border-border p-2.5 text-[16px] text-foreground" placeholder="例如：岗位要求截图 / 候选人面经"/></label><label className="text-[16px] font-medium text-muted-foreground">保存分类<select value={kind} onChange={event => setKind(event.target.value as JobMaterialKind)} className="mt-1 w-full rounded-md border border-border p-2.5 text-[16px] text-foreground"><option value="job_description">JD / 岗位要求</option><option value="interview_experience">第三方面经</option><option value="reference">其他岗位参考资料</option></select></label>{kind === "interview_experience" && <label className="text-[16px] font-medium text-muted-foreground">面经细分<select value={category} onChange={event => setCategory(event.target.value as InterviewExperienceCategory)} className="mt-1 w-full rounded-md border border-border p-2.5 text-[16px] text-foreground"><option value="other">其他</option><option value="technical">技术问题</option><option value="role">岗位职责</option><option value="company">公司/流程</option><option value="culture">团队文化</option></select></label>}</div>}
      {selectedPendingReview.length > 0 && <p role="status" className="text-[15px] text-primary">所选资料还有 {selectedPendingReview.length} 份正在识别或没有文字；已有手工修改会保留。</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={saving || !selected.length || selectedPendingReview.length > 0} onClick={confirmSelected} className="font-medium text-primary hover:bg-amber-50">集中确认所选文字</Button><Button type="button" data-cta="primary" disabled={saving || !selected.length || selectedPendingReview.length > 0} onClick={() => void saveGroup()}>{saving ? jdOnly ? "正在应用并保存草稿…" : "正在保存…" : jdOnly ? "使用此 JD" : `保存所选 ${selected.length} 项为一份资料`}</Button></div>{!jdOnly && <details className="text-[14px] text-muted-foreground"><summary className="cursor-pointer">查看资料边界</summary><p className="mt-2">勾选一组文件后分类保存。第三方面经只作参考，不会成为本人经历。</p></details>}
    </div>}{notice && <p role="status" className="mt-4 text-[15px] text-muted-foreground">{notice}</p>}
    </fieldset>
  </section>;
}
