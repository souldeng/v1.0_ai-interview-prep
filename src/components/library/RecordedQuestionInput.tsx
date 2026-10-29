import { useState } from "react";
import type { InterviewProject } from "../../lib/domain";
import { loadDrafts, saveDraft } from "../../lib/drafts";
import { useUnsavedChanges } from "../shared/UnsavedChanges";

const draftKey = "recorded-question-input";
export function RecordedQuestionInput({ projects, onSave, disabled }: { projects: InterviewProject[]; onSave: (text: string, projectId?: string) => string | null; disabled?: boolean }) {
  const [text, setText] = useState(() => loadDrafts()[draftKey] ?? ""), [projectId, setProjectId] = useState("");
  const [notice, setNotice] = useState(""), [unsaved, setUnsaved] = useState(false);
  const persistDraft = (value: string) => { try { saveDraft(draftKey, value); setUnsaved(false); return null; } catch (cause) { const error = cause instanceof Error ? cause.message : "草稿保存失败，文字仍保留。"; setUnsaved(true); setNotice(error); return error; } };
  useUnsavedChanges("recorded-question-input", unsaved, { label: "真实题输入", save: () => persistDraft(text), discard: () => { setText(loadDrafts()[draftKey] ?? ""); setUnsaved(false); } });
  return <section aria-label="记录真实面试题" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-950">记录一道真实面试题</h2>
    <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">题目来源说明</summary><p className="mt-1">本人记录的面试问题，平台未独立验证面试发生。</p></details>
    <label className="mt-4 block text-sm font-medium text-slate-700">真实面试问题<textarea value={text} maxLength={600} disabled={disabled} onChange={event => { setText(event.target.value); persistDraft(event.target.value); }} className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm leading-6"/></label>
    <label className="mt-3 block text-sm text-slate-700">关联岗位（可选）<select value={projectId} disabled={disabled} onChange={event => setProjectId(event.target.value)} className="form-control mt-2"><option value="">不关联岗位，独立练习</option>{projects.map(project => <option key={project.id} value={project.id}>{project.jobTitle}</option>)}</select></label>
    <button disabled={disabled || !text.trim()} onClick={() => { const error = onSave(text, projectId || undefined); setNotice(error ?? "题目已保存，可从题库再次练习。"); if (!error) { setText(""); setProjectId(""); persistDraft(""); } }} className="mt-4 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">保存并练习</button>
    {notice && <p role="status" className="mt-3 text-sm text-amber-900">{notice}</p>}
  </section>;
}
