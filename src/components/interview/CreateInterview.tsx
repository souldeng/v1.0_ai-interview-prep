import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, BriefcaseBusiness, Loader2, Sparkles, UserRound } from "lucide-react";
import { loadDrafts, saveDraft } from "../../lib/drafts";
import { validateInterviewProject, type InterviewProjectErrors, type InterviewProjectInput } from "../../lib/projects";
import type { JobMaterial } from "../../lib/domain";
import { validJobMaterial } from "../../lib/validation";
import { JobMaterialUpload } from "../jobs/JobMaterialUpload";
import { Original } from "../jobs/JobMaterials";
import { useSafeNavigation } from "../shared/UnsavedChanges";

type CreateDraft = InterviewProjectInput & { jdMaterials?: JobMaterial[] };
export function CreateInterview({ demoInput, onBack, onCreate, initialInput, draftId = "create", onUnsaved = () => {}, confirmedExperienceCount = 0 }: { demoInput: InterviewProjectInput; onBack: () => void; onCreate: (input: InterviewProjectInput, materials?: JobMaterial[]) => Promise<string | null>; initialInput?: InterviewProjectInput; draftId?: string; onUnsaved?: (value: boolean) => void; confirmedExperienceCount?: number }) {
  const navigate = useSafeNavigation();
  const [form, setForm] = useState<CreateDraft>(() => { const fallback = initialInput ?? { company: "", jobTitle: "", jobDescription: "", candidateBackground: "", concerns: "" }; try { const d = JSON.parse(loadDrafts()[draftId] || "null"); return d && ["company","jobTitle","jobDescription","candidateBackground","concerns"].every(k => typeof d[k] === "string") && (d.jdMaterials === undefined || Array.isArray(d.jdMaterials) && d.jdMaterials.every(validJobMaterial)) ? d : fallback; } catch { return fallback; } });
  const [fieldErrors, setFieldErrors] = useState<InterviewProjectErrors>({});
  const latestForm = useRef(form); latestForm.current = form;
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [jdNotice, setJDNotice] = useState("");
  const jdField = useRef<HTMLTextAreaElement>(null);
  const update = (field: keyof InterviewProjectInput, value: string) => { persistForm({ ...form, [field]: value }); if (field === "jobTitle" || field === "jobDescription") setFieldErrors(current => ({ ...current, [field]: undefined })); };
  function persistForm(next: CreateDraft) { setForm(next); try { saveDraft(draftId, JSON.stringify(next)); onUnsaved(false); setSubmitError(""); } catch (e) { onUnsaved(true); setSubmitError(e instanceof Error ? e.message : "草稿保存失败，请保留本页"); } }
  function saveJD(material: JobMaterial): string | null {
    const current = latestForm.current;
    const text = material.parts?.map(part => part.reviewedText).join("\n\n") || material.content;
    const next = { ...current, jobDescription: [current.jobDescription.trim(), text].filter(Boolean).join("\n\n"), jdMaterials: [...(current.jdMaterials ?? []), material] };
    try { saveDraft(draftId, JSON.stringify(next)); setForm(next); onUnsaved(false); setSubmitError(""); setJDNotice("已填入岗位 JD 并保存创建草稿。请检查上方内容，再创建岗位。"); requestAnimationFrame(() => { jdField.current?.focus({ preventScroll: true }); jdField.current?.scrollIntoView({ block: "center" }); }); return null; }
    catch (error) { return error instanceof Error ? error.message : "JD 草稿保存失败，请重试。"; }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const errors = validateInterviewProject(form);
    setFieldErrors(errors); setSubmitError("");
    if (Object.keys(errors).length > 0) return;
    navigate(() => void commit());
  }
  async function commit() {
    setSubmitting(true);
    const current = latestForm.current;
    const nextError = await onCreate(current, current.jdMaterials);
    if (nextError) setSubmitError(nextError);
    else { try { saveDraft(draftId, ""); onUnsaved(false); } catch {} }
    setSubmitting(false);
  }
  return <form onSubmit={submit} className="mx-auto max-w-4xl space-y-6">
    <button type="button" onClick={() => navigate(onBack)} className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-950"><ArrowLeft size={16}/>返回我的岗位</button>
    <div><p className="text-sm font-medium text-blue-700">{initialInput ? "编辑岗位材料" : "创建岗位"}</p><h2 className="mt-2 text-3xl font-bold text-slate-950">填写目标岗位</h2><p className="mt-3 text-slate-600">{initialInput ? "保存岗位资料，已有训练和材料保留。" : ""}</p></div>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <SectionTitle icon={<BriefcaseBusiness className="text-blue-700" />}>目标岗位</SectionTitle>
      <div className="mt-5 grid gap-5 sm:grid-cols-2"><Field label="公司名称" hint="可选"><input value={form.company} onChange={event => update("company", event.target.value)} placeholder="例如：字节跳动" className="form-control" /></Field><Field label="岗位名称" required error={fieldErrors.jobTitle}><input value={form.jobTitle} onChange={event => update("jobTitle", event.target.value)} placeholder="例如：AI 产品经理" aria-invalid={Boolean(fieldErrors.jobTitle)} className="form-control" /></Field></div>
      <div className="mt-5"><Field label="岗位 JD" required error={fieldErrors.jobDescription}><textarea ref={jdField} value={form.jobDescription} onChange={event => { update("jobDescription", event.target.value); setJDNotice(""); }} placeholder="粘贴完整的岗位职责与任职要求" aria-invalid={Boolean(fieldErrors.jobDescription)} className="form-control min-h-52 resize-y leading-7" /></Field></div>
      {jdNotice && <p role="status" className="mt-3 text-sm text-blue-800">{jdNotice}</p>}
      <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-blue-800">从截图或文档填写 JD</summary><div className="mt-3"><JobMaterialUpload projectId={`draft:${draftId}`} jdOnly onSave={saveJD}/></div></details>
      {Boolean(form.jdMaterials?.length) && <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">查看已使用的 JD 原件与核对文字</summary><p className="mt-2 text-xs text-slate-600">原件随岗位保存；上方 JD 可继续编辑，不会改写初始识别文字。</p>{form.jdMaterials!.map(material => <div key={material.id} className="mt-3 min-w-0 border-t border-slate-200 pt-3"><p className="break-words text-sm font-medium">{material.title}</p>{(material.parts ?? []).map(part => <div key={part.id} className="mt-3 min-w-0"><p className="break-words text-xs text-slate-600">{part.fileName}</p><Original part={part}/><details className="mt-2 text-sm"><summary className="cursor-pointer">初始提取文字</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{part.initialText || "无初始识别文字，可参考原件和核对文字。"}</pre></details><details className="mt-2 text-sm"><summary className="cursor-pointer">使用时的核对文字</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{part.reviewedText}</pre></details></div>)}</div>)}</details>}
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><SectionTitle icon={<UserRound className="text-blue-700" />}>面试准备</SectionTitle><p className="mt-3 text-sm text-slate-600">{confirmedExperienceCount ? `将复用个人资料中的 ${confirmedExperienceCount} 条已确认经历，无需重复填写。` : "可先创建岗位，之后在个人资料中补充并确认经历。"}</p><details className="mt-4" open={Boolean(form.candidateBackground) || undefined}><summary className="cursor-pointer text-sm text-slate-700">补充个人背景（可选）</summary><div className="mt-3"><Field label="个人经历" hint="不会自动成为已确认事实"><textarea value={form.candidateBackground} onChange={event => update("candidateBackground", event.target.value)} placeholder="粘贴简历文本，或简要介绍工作经历、项目与转岗背景" className="form-control min-h-44 resize-y leading-7" /></Field></div></details><div className="mt-5"><Field label="面试顾虑" hint="可选"><textarea value={form.concerns} onChange={event => update("concerns", event.target.value)} placeholder="例如：Gap 时间较长；没有正式 AI 产品经验；担心被追问项目细节" className="form-control min-h-32 resize-y leading-7" /></Field></div></section>
    {submitError && <p className="text-sm text-red-700" role="alert">{submitError}</p>}
    <div className="flex flex-wrap gap-3"><button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60">{submitting ? <Loader2 className="animate-spin" size={18}/> : <Sparkles size={18}/>} {submitting ? "正在创建岗位" : initialInput ? "保存新版本准备方案" : "创建岗位准备方案"}</button></div>
  </form>;
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <h2 className="flex items-center gap-2 text-xl font-bold text-slate-950">{icon}{children}</h2>;
}

function Field({ label, hint, required, error, children }: { label: string; hint?: string; required?: boolean; error?: string; children: ReactNode }) {
  return <label className="block"><span className="flex items-center gap-2 text-sm font-medium text-slate-800">{label}{required && <span className="text-red-700">必填</span>}{hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}</span><div className="mt-2">{children}</div>{error && <span className="mt-2 block text-sm text-red-700">{error}</span>}</label>;
}
