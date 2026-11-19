import { useState } from "react";
import type { InterviewProject } from "../../lib/domain";
import { loadDrafts, saveDraft } from "../../lib/drafts";
import type { ImportedQuestionDraft } from "../../lib/questionLibrary";
import { BatchImportQuestions, type BatchImportSavePayload } from "./BatchImportQuestions";
import { useUnsavedChanges } from "../shared/UnsavedChanges";

const button = "rounded-[9px] px-4 py-2 text-[16px] font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

const draftKey = "recorded-question-input";

export function RecordedQuestionInput({ projects, onSave, onBatchSave, disabled, initialMode = "single" }: {
  projects: InterviewProject[];
  onSave: (text: string, projectId?: string) => string | null;
  onBatchSave: (payload: BatchImportSavePayload) => string | null;
  disabled?: boolean;
  /** 入口跳转用的初始录入模式（仅挂载时生效；组件内部切换不受影响）。 */
  initialMode?: "single" | "batch";
}) {
  const [mode, setMode] = useState<"single" | "batch">(initialMode);
  const [text, setText] = useState(() => loadDrafts()[draftKey] ?? ""), [projectId, setProjectId] = useState("");
  const [notice, setNotice] = useState(""), [unsaved, setUnsaved] = useState(false);
  const persistDraft = (value: string) => { try { saveDraft(draftKey, value); setUnsaved(false); return null; } catch (cause) { const error = cause instanceof Error ? cause.message : "草稿保存失败，文字仍保留。"; setUnsaved(true); setNotice(error); return error; } };
  useUnsavedChanges("recorded-question-input", unsaved, { label: "真实题输入", save: () => persistDraft(text), discard: () => { setText(loadDrafts()[draftKey] ?? ""); setUnsaved(false); } });
  return <section aria-label="导入与记录面试题" className="space-y-4">
    <header className="space-y-1">
      <p className="text-[14px] font-medium text-primary">手动题目与预测题</p>
      <h2 className="text-[22px] font-semibold tracking-tight text-foreground">导入题目，练习并复盘</h2>
      <p className="text-[15px] leading-6 text-muted-foreground">单题录入仅用于本人记录的真实面试题；批量导入可明确标记为本人记录或 AI 预测题。</p>
    </header>
    <nav aria-label="录入方式" className="flex flex-wrap gap-2 rounded-[12px] border border-border bg-white p-1">
      {([["single", "添加单道真实题"], ["batch", "批量导入题目"]] as const).map(([id, label]) => <button key={id} aria-pressed={mode === id} disabled={disabled}
        onClick={() => setMode(id)} className={`${button} ${mode === id ? "bg-accent text-primary" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>)}
    </nav>
    {mode === "batch"
      ? <BatchImportQuestions projects={projects} onSave={payload => onBatchSave(payload)} disabled={disabled} />
      : <section className="rounded-[16px] border border-border bg-white p-5">
        <h3 className="text-[18px] font-semibold text-foreground">记录一道真实面试题</h3>
        <details className="mt-2 text-[14px] text-muted-foreground"><summary className="cursor-pointer">题目来源说明</summary><p className="mt-1">本人记录的面试问题，平台未独立验证面试发生。一道题可以包含背景、补充条件和连续追问；多道题请使用批量导入。</p></details>
        <label className="mt-4 block text-[15px] font-medium text-foreground">真实面试问题
          <textarea value={text} maxLength={600} disabled={disabled} onChange={event => { setText(event.target.value); persistDraft(event.target.value); }}
            className="mt-2 min-h-24 w-full rounded-md border border-border bg-white p-3 text-[16px] leading-7 text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="只输入一道题；可以带背景和追问。" /></label>
        <p className="mt-1 text-[13px] text-muted-foreground">{text.length}/600 字</p>
        <label className="mt-3 block text-[15px] text-foreground">关联岗位（可选）
          <select value={projectId} disabled={disabled} onChange={event => setProjectId(event.target.value)} className="mt-2 w-full max-w-sm rounded-md border border-border bg-white px-3 py-2 text-[15px] disabled:cursor-not-allowed disabled:opacity-50">
            <option value="">不关联岗位，独立练习</option>
            {projects.map(project => <option key={project.id} value={project.id}>{project.jobTitle}</option>)}
          </select></label>
        <button disabled={disabled || !text.trim()} onClick={() => { const error = onSave(text, projectId || undefined); setNotice(error ?? "题目已保存，可从题库再次练习。"); if (!error) { setText(""); setProjectId(""); persistDraft(""); } }}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-[16px] font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">保存并练习</button>
        {notice && <p role="status" className="mt-3 text-[15px] text-amber-800">{notice}</p>}
      </section>}
  </section>;
}

export type { ImportedQuestionDraft };
