import { useEffect, useState } from "react";
import type { InterviewExperienceCategory, InterviewProject, JobMaterial, JobMaterialKind, JobMaterialPart } from "../../lib/domain";
import { pdfExtractionNotice } from "../../lib/documentParser";
import { combinedMaterialText } from "../../lib/jobMaterialFlow";
import { deleteMaterialFile, getMaterialFile } from "../../lib/materialFileStorage";
import { JobMaterialUpload } from "./JobMaterialUpload";
import { useSafeNavigation, useUnsavedChanges } from "../shared/UnsavedChanges";
import { PROFILE_KEY } from "../../lib/profileStorage";
import { DRAFT_KEY } from "../../lib/drafts";
import { inspectOcrImage } from "../../lib/localOcr";

const labels: Record<JobMaterialKind, string> = { job_description: "JD / 岗位要求", interview_experience: "第三方面经", reference: "其他岗位参考" };
const categoryOptions: Array<{ value: InterviewExperienceCategory; label: string }> = [
  { value: "company", label: "公司/流程" }, { value: "role", label: "岗位职责" }, { value: "technical", label: "技术问题" }, { value: "culture", label: "团队文化" }, { value: "other", label: "其他" },
];

export function Original({ part, legacyDataUrl }: { part: JobMaterialPart; legacyDataUrl?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [previewError,setPreviewError]=useState("");
  useEffect(() => {
    let created = ""; let active = true;
    setUrl(null);setMissing(false);setPreviewError("");
    if (part.fileId && part.originalSaved) void getMaterialFile(part.fileId).then(async file => {
      if (!active) return;
      if (!file) setMissing(true);
      else {
        let warning="";
        if(part.mimeType.startsWith("image/"))try{await inspectOcrImage(new File([file.blob],file.name,{type:file.type||part.mimeType}));}catch(e){warning=e instanceof Error?e.message:"无法安全预览图片";}
        if(!active)return;setPreviewError(warning);created = URL.createObjectURL(file.blob); setUrl(created);
      }
    }).catch(() => { if (active) setMissing(true); });
    return () => { active = false; if (created) URL.revokeObjectURL(created); };
  }, [part.fileId, part.originalSaved]);
  if ((!part.fileId || !part.originalSaved) && legacyDataUrl) return <div className="mt-2"><p className="text-xs text-amber-700">旧版图片副本保存在项目 JSON 中，并非 IndexedDB 原件。</p><img src={legacyDataUrl} alt={`${part.fileName} 旧版图片副本`} className="mt-2 max-h-80 w-full object-contain"/></div>;
  if (!part.fileId || !part.originalSaved || missing) return <p className="mt-2 text-xs text-amber-700">原文件未保存，可继续使用已有文字；如需查看原件，请重新上传。</p>;
  if (!url) return <p className="mt-2 text-xs text-slate-500">正在读取原件…</p>;
  return <div className="mt-2">{previewError ? <p className="text-sm text-amber-900">未自动打开预览：{previewError} 原件仍可下载。</p> : part.mimeType.startsWith("image/") ? <img src={url} alt={`${part.fileName} 原图`} className="max-h-80 w-full object-contain"/> : part.mimeType === "application/pdf" ? <iframe title={`${part.fileName} PDF 预览`} src={url} className="h-96 w-full"/> : <p className="text-xs text-slate-600">此格式可下载原件，正文见核对文字。</p>}<a href={url} download={part.fileName} className="mt-2 inline-block text-sm text-blue-700 underline hover:text-blue-900 active:text-blue-950 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed transition-all">下载原件</a></div>;
}

function MaterialDetail({ material, onSave, onClose }: { material: JobMaterial; onSave: (value: JobMaterial) => string | null; onClose: () => void }) {
  const navigate = useSafeNavigation();
  const [title, setTitle] = useState(material.title);
  const [kind, setKind] = useState(material.kind);
  const [category, setCategory] = useState(material.category ?? "other");
  const [parts, setParts] = useState(material.parts ?? []);
  const [text, setText] = useState(material.content);
  const [notice, setNotice] = useState("");
  const save = () => {
    if (!title.trim()) { setNotice("请填写资料名称。"); return "请填写资料名称。"; }
    const nextText = parts.length ? combinedMaterialText(parts) : text.trim();
    if (!nextText.trim()) { setNotice("请填写核对文字。"); return "请填写核对文字。"; }
    const updated: JobMaterial = { ...material, title: title.trim(), kind, category: kind === "interview_experience" ? category : undefined, content: nextText, parts: parts.length ? parts : material.parts, reviewedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const error = onSave(updated); if (error) setNotice(error); else onClose();
    return error;
  };
  useUnsavedChanges(`job-material:${material.id}`, title !== material.title || kind !== material.kind || category !== (material.category ?? "other") || text !== material.content || JSON.stringify(parts) !== JSON.stringify(material.parts ?? []), {
    label: material.title, save,
    discard: () => { setTitle(material.title); setKind(material.kind); setCategory(material.category ?? "other"); setText(material.content); setParts(material.parts ?? []); },
  });
  const previewParts = parts.length ? parts : [{ id: material.id, fileId: material.fileId, fileName: material.sourceFileName ?? material.title, mimeType: material.sourceMimeType ?? "", size: 0, initialText: material.initialContent ?? material.content, reviewedText: material.content, originalSaved: Boolean(material.originalSaved) }];
  return <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-700">资料名称<input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5"/></label><label className="text-sm text-slate-700">分类<select value={kind} onChange={event => setKind(event.target.value as JobMaterialKind)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5"><option value="job_description">JD / 岗位要求</option><option value="interview_experience">第三方面经</option><option value="reference">其他岗位参考资料</option></select></label>{kind === "interview_experience" && <label className="text-sm text-slate-700">面经细分<select value={category} onChange={event => setCategory(event.target.value as InterviewExperienceCategory)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5">{categoryOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}</div>
    {previewParts.map((part,index) => <section key={part.id} className="mt-4 rounded-lg border border-slate-200 bg-white p-3"><h4 className="text-sm font-medium text-slate-900">{index + 1}. {part.fileName}</h4>{part.mimeType === "application/pdf" && <p className="mt-2 text-sm text-amber-900">{pdfExtractionNotice}</p>}<div className="grid gap-3 lg:grid-cols-2"><div><Original part={part} legacyDataUrl={parts.length ? undefined : material.sourceDataUrl}/><details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">初始提取文字</summary><pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap">{part.initialText || "无初始文字"}</pre></details></div>{parts.length ? <label className="mt-2 text-sm text-slate-700">核对文字<textarea value={part.reviewedText} onChange={event => setParts(old => old.map((value,i) => i === index ? { ...value, reviewedText: event.target.value } : value))} className="mt-1 min-h-32 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6"/></label> : <label className="mt-2 text-sm text-slate-700">核对文字<textarea value={text} onChange={event => setText(event.target.value)} className="mt-1 min-h-32 w-full rounded-lg border border-slate-300 p-3 text-sm leading-6"/></label>}</div></section>)}
    <div className="mt-4 flex gap-2"><button onClick={save} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white">保存修改</button><button onClick={() => navigate(onClose)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">取消</button></div>{notice && <p role="status" className="mt-3 text-sm text-red-700">{notice}</p>}
  </div>;
}

export function JobMaterials({ project, onPatch }: { project: InterviewProject; onPatch: (project: InterviewProject) => string | null }) {
  const navigate = useSafeNavigation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const save = (material: JobMaterial) => {
    const exists = project.materials?.some(item => item.id === material.id);
    const materials = exists ? project.materials!.map(item => item.id === material.id ? material : item) : [material, ...(project.materials ?? [])];
    return onPatch({ ...project, materials, updatedAt: new Date().toISOString() });
  };
  const remove = async (material: JobMaterial) => {
    if (!window.confirm(`删除“${material.title}”？该资料的核对文字和当前岗位的原文件关联将移除，此操作不可撤销。`)) return;
    const error = onPatch({ ...project, materials: (project.materials ?? []).filter(item => item.id !== material.id), updatedAt: new Date().toISOString() });
    if (error) return setNotice(error);
    setOpenId(null);
    const fileIds = [...new Set([material.fileId, ...(material.parts ?? []).map(part => part.fileId)].filter((value): value is string => Boolean(value)))];
    let unreferenced: string[];
    try {
      // The record is already removed. Preserve any stable file ID still referenced by
      // another job, personal material or saved/recovered draft. Conservative retention
      // is safer than deleting a shared original; this is not a cross-tab transaction.
      const remaining = ["ai-interview-projects-v1", PROFILE_KEY, DRAFT_KEY, "ai-interview-question-library-v1"].map(key => localStorage.getItem(key) ?? "");
      unreferenced = fileIds.filter(fileId => !remaining.some(raw => raw.includes(fileId)));
    } catch { setNotice("资料已从当前岗位删除；原件引用无法核对，已保留原文件。"); return; }
    const results = await Promise.allSettled(unreferenced.map(deleteMaterialFile));
    setNotice(results.some(result => result.status === "rejected") ? "资料已删除，但部分原文件清理失败；请检查浏览器存储。" : "资料已从当前岗位删除。");
  };
  return <div className="space-y-6"><details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-medium text-slate-700">原始岗位 JD</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{project.jobDescription || "此岗位尚无原始 JD。可在下方补充岗位资料。"}</p></details><JobMaterialUpload key={project.id} projectId={project.id} onSave={save}/><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold text-slate-950">已保存的岗位资料</h2>{(project.materials ?? []).length ? <div className="mt-4 space-y-3">{project.materials!.map(material => <article key={material.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-medium text-slate-950">{material.title}</h3><p className="mt-1 text-xs text-slate-600">{labels[material.kind]} · {material.parts?.length ?? (material.sourceFileName ? 1 : 0)} 个原件 · {material.reviewedAt ? "已核对" : "旧资料，核对状态未记录"} · {material.sourceFileName ?? "手工文字"}</p></div><div className="flex gap-2"><button onClick={() => navigate(() => setOpenId(openId === material.id ? null : material.id))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">{openId === material.id ? "收起" : "查看 / 编辑"}</button><button onClick={() => void remove(material)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700">删除</button></div></div>{!material.sourceDataUrl && !material.fileId && !(material.parts ?? []).some(part => part.fileId) && <p className="mt-2 text-xs text-amber-700">原文件未保存，可继续使用已有文字；如需查看原件，请重新上传。</p>}{openId === material.id && <MaterialDetail key={material.id} material={material} onSave={save} onClose={() => setOpenId(null)}/>}</article>)}</div> : <p className="mt-3 text-sm text-slate-600">暂无额外资料。</p>}{notice && <p role="status" className="mt-3 text-sm text-slate-700">{notice}</p>}</section></div>;
}
