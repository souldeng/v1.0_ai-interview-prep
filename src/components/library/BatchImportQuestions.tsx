import { useMemo, useState } from "react";
import { ClipboardPaste, ListChecks } from "lucide-react";
import type { InterviewProject } from "../../lib/domain";
import { parseInterviewRecord, type ParsedRecordCandidate } from "../../lib/interviewRecordParser";
import { normalizeCollectedQuestion } from "../../lib/materialCollection";
import { loadDrafts, saveDraft } from "../../lib/drafts";
import { loadQuestionLibrary, type ImportedQuestionDraft, type ImportedRecordSourceType } from "../../lib/questionLibrary";
import { useUnsavedChanges } from "../shared/UnsavedChanges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const button = "rounded-md border border-border bg-white px-4 py-2 text-[16px] text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

const MAX_QUESTION_CHARS = 600;
const draftKey = "recorded-batch-import";

export interface BatchImportSavePayload {
  drafts: ImportedQuestionDraft[];
  source: { title: string; content: string; feedback: string[]; sourceType: ImportedRecordSourceType };
}

/**
 * 批量导入题目（本地解析，不扩大第三方资料或个人事实边界）。
 *
 * 流程：粘贴面试记录 → 本地规则解析（不调用付费模型）→ 展示解析预览 →
 * 人工编辑、调整分类、取消选择 → 确认保存 → 生成独立题目。
 *
 * 拆分模式：传入 splitFromId 与 initialText 时，对一道历史超长题目做同样的
 * 预览与确认；旧记录保留原样，新题通过 splitFromId 追溯。
 */
export function BatchImportQuestions({ projects, onSave, disabled, initialText = "", initialTitle = "", splitFromId, existingSplitCount = 0 }: {
  projects: InterviewProject[];
  onSave: (payload: BatchImportSavePayload, splitFromId?: string) => string | null;
  disabled?: boolean;
  initialText?: string;
  initialTitle?: string;
  splitFromId?: string;
  existingSplitCount?: number;
}) {
  const isSplit = Boolean(splitFromId);
  const [text, setText] = useState(initialText || (() => loadDrafts()[draftKey] ?? ""));
  const [parsed, setParsed] = useState<ReturnType<typeof parseInterviewRecord> | null>(initialText ? parseInterviewRecord(initialText) : null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [categoryEdits, setCategoryEdits] = useState<Record<number, string>>({});
  const [projectChoice, setProjectChoice] = useState<Record<number, string>>({});
  const [checked, setChecked] = useState<Set<number> | null>(null);
  const [sourceType, setSourceType] = useState<ImportedRecordSourceType>("user_recorded");
  const [notice, setNotice] = useState<{ message: string; tone: "info" | "success" | "error" } | null>(null);
  const [locked, setLocked] = useState(false);

  const candidates = parsed?.candidates ?? [];
  const checkedSet = checked ?? new Set(candidates.filter(c => c.confidence === "confirmed").map(c => c.order));
  const lockedAll = disabled || locked;

  useUnsavedChanges("recorded-batch-import", Boolean(text.trim() && !parsed) || (isSplit && text.trim() !== initialText && Boolean(parsed)), {
    label: isSplit ? "拆分预览" : "批量导入",
    save: () => { try { saveDraft(draftKey, text); return null; } catch (e) { return String(e instanceof Error ? e.message : e); } },
    discard: () => { setText(initialText || (loadDrafts()[draftKey] ?? "")); setParsed(initialText ? parseInterviewRecord(initialText) : null); setEdits({}); setCategoryEdits({}); setChecked(null); },
  });

  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>();
    for (const candidate of candidates) {
      const key = normalizeCollectedQuestion(currentText(candidate));
      if (!key) continue;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [candidates, edits]);

  // 跨批次重复提示（P2-1）：预览阶段与题库已有题目/已有导入源比对，仅提示不阻止，由人工勾选决定。
  const existingLibrary = useMemo(() => loadQuestionLibrary(), [parsed]);
  const existingQuestionKeys = useMemo(() => new Set((existingLibrary.recordedQuestions ?? []).map(item => normalizeCollectedQuestion(item.question))), [existingLibrary]);
  const existingSourceMatch = useMemo(() => {
    if (isSplit || !text.trim()) return null;
    return (existingLibrary.importSources ?? []).find(source => source.content === text) ?? null;
  }, [existingLibrary, text, isSplit]);
  const duplicatesExisting = (candidate: ParsedRecordCandidate) => existingQuestionKeys.has(normalizeCollectedQuestion(currentText(candidate)));

  function currentText(candidate: ParsedRecordCandidate): string {
    return (edits[candidate.order] ?? candidate.text).trim();
  }
  function currentCategory(candidate: ParsedRecordCandidate): string {
    return (categoryEdits[candidate.order] ?? candidate.category).trim();
  }

  function runParse() {
    if (!text.trim()) { setNotice({ message: "请先粘贴题目原文。", tone: "error" }); return; }
    const result = parseInterviewRecord(text);
    if (!result.candidates.length && !result.feedback.length) { setNotice({ message: "未能从这段文字中识别出任何候选题目；请检查 Markdown 标题、编号或逐题录入。", tone: "error" }); return; }
    setParsed(result); setEdits({}); setCategoryEdits({}); setProjectChoice({}); setChecked(null);
    setNotice({ message: `识别出 ${result.candidates.length} 道候选题目${result.feedback.length ? `、${result.feedback.length} 段面试反馈` : ""}；请核对后再保存。`, tone: "info" });
  }

  function toggle(order: number) {
    const next = new Set(checkedSet);
    next.has(order) ? next.delete(order) : next.add(order);
    setChecked(next);
  }

  function save() {
    const selected = candidates.filter(candidate => checkedSet.has(candidate.order) && currentText(candidate));
    if (!selected.length) { setNotice({ message: "请至少选择一道题目再保存。", tone: "error" }); return; }
    const overLimit = selected.filter(candidate => currentText(candidate).length > MAX_QUESTION_CHARS);
    if (overLimit.length) { setNotice({ message: `${overLimit.map(c => `第${c.order}题`).join("、")}超过600字上限，整批未保存；请在预览中精简后再导入。`, tone: "error" }); return; }
    setLocked(true);
    try {
      const payload: BatchImportSavePayload = {
        drafts: selected.map(candidate => ({
          question: currentText(candidate),
          ...(currentCategory(candidate) ? { category: currentCategory(candidate) } : {}),
          order: candidate.order,
          projectId: projectChoice[candidate.order] || undefined,
        })),
        source: { title: initialTitle || (sourceType === "ai_prediction" ? "粘贴的 AI 预测题" : "粘贴的真实面试记录"), content: text, feedback: parsed?.feedback ?? [], sourceType },
      };
      const error = onSave(payload, splitFromId);
      if (error) { setNotice({ message: `保存失败，预览内容已保留，可直接重试：${error}`, tone: "error" }); return; }
      setNotice({ message: `已保存 ${selected.length} 道独立题目${isSplit ? "；原题目与已有回答、训练历史保持不变" : "，原始记录已保留用于追溯"}。`, tone: "success" });
      setText(""); setParsed(null); setEdits({}); setCategoryEdits({}); setChecked(null);
      try { saveDraft(draftKey, ""); } catch { /* 草稿清理失败不影响保存结果。 */ }
    } finally { setLocked(false); }
  }

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const candidate of candidates) { const key = currentCategory(candidate); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
    return [...counts.entries()];
  }, [candidates, categoryEdits]);

  return <section aria-label={isSplit ? "拆分为多道题" : "批量导入题目"} className="space-y-4 rounded-[16px] border border-border bg-white p-6">
    <header>
      <h3 className="text-[20px] font-semibold text-foreground">{isSplit ? "把这道历史题目拆分为多道题" : "批量导入题目"}</h3>
      <p className="mt-1 text-[15px] leading-6 text-muted-foreground">
        {isSplit
          ? <>粘贴或保留原题全文，系统按章节与编号在本地解析候选题目；先预览、人工核对，再保存。原题目、已有回答与训练历史不会被删除或改写。{existingSplitCount > 0 && `这道题此前已拆分过 ${existingSplitCount} 次。`}</>
          : <>粘贴完整的 Markdown 或普通文本题库；先选择来源，再在本机解析标题、编号和题目顺序。不会调用模型。保存后可在题库「手动题目与预测题」列表查看并练习。</>}
      </p>
    </header>
    {!isSplit && <fieldset className="rounded-[12px] border border-border bg-card p-4">
      <legend className="px-1 text-[15px] font-medium text-foreground">题目来源</legend>
      <div className="mt-1 flex flex-wrap gap-3">
        <label className={`flex flex-1 cursor-pointer items-start gap-2.5 rounded-[10px] border p-3 text-[15px] transition-all has-[:checked]:border-border has-[:checked]:bg-white ${sourceType === "user_recorded" ? "border-border bg-white" : "border-transparent bg-white/60"}`}>
          <input type="radio" name="batch-source" className="mt-1" checked={sourceType === "user_recorded"} disabled={lockedAll} onChange={() => setSourceType("user_recorded")} />
          <span><strong>本人记录的真实面试题</strong><small className="mt-1 block text-[14px] leading-5 text-muted-foreground">仅表示本人记录，平台不会独立验证面试发生。</small></span>
        </label>
        <label className={`flex flex-1 cursor-pointer items-start gap-2.5 rounded-[10px] border p-3 text-[15px] transition-all has-[:checked]:border-border has-[:checked]:bg-white ${sourceType === "ai_prediction" ? "border-border bg-white" : "border-transparent bg-white/60"}`}>
          <input type="radio" name="batch-source" className="mt-1" checked={sourceType === "ai_prediction"} disabled={lockedAll} onChange={() => setSourceType("ai_prediction")} />
          <span><strong>AI 预测题</strong><small className="mt-1 block text-[14px] leading-5 text-muted-foreground">仅供练习；不会标记为企业真实题、第三方面经或个人经历。</small></span>
        </label>
      </div>
    </fieldset>}

    <label className="block text-[15px] font-medium text-foreground">
      {isSplit ? "原题全文" : "题库原文"}
      <Textarea aria-label={isSplit ? "原题全文" : "粘贴题目原文"} value={text} disabled={lockedAll} onChange={event => { setText(event.target.value); if (parsed) setParsed(null); try { saveDraft(draftKey, event.target.value); } catch { /* 超限时输入仍保留在页面。 */ } }}
        placeholder={isSplit ? "原题全文已带入，可直接解析或先编辑…" : "粘贴 Markdown 题库或编号题目…"}
        className="mt-2 min-h-48 w-full resize-y bg-white" />
    </label>
    {!parsed && <div className="flex flex-wrap items-center gap-3">
      <Button data-cta="primary" disabled={lockedAll || !text.trim()} onClick={runParse}><ClipboardPaste size={17} className="mr-1 inline" />解析并预览候选题目</Button>
      <p className="text-[14px] text-muted-foreground">已经整理好的题库不需要 AI 智能整理；可在预览中编辑、取消选择或关联岗位。</p>
    </div>}

    {notice && <p role={notice.tone === "error" ? "alert" : "status"} className={`text-[15px] ${notice.tone === "error" ? "text-red-700" : notice.tone === "success" ? "text-emerald-800" : "text-muted-foreground"}`}>{notice.message}</p>}

    {parsed && <div className="space-y-4">
      {parsed.warnings.map(warning => <p key={warning} className="rounded-[10px] bg-amber-50 p-3 text-[15px] text-amber-800">{warning}</p>)}
      {existingSourceMatch && <p role="status" className="rounded-[10px] bg-amber-50 p-3 text-[15px] text-amber-800">这份记录与已有导入源「{existingSourceMatch.title}」内容相同；再次保存会产生重复题目，请核对后只勾选仍需要的题目。</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <p className="flex items-center gap-1.5 text-[15px] text-muted-foreground"><ListChecks size={16} className="text-primary" aria-hidden />候选题目 {candidates.length} 道 · 已选 {candidates.filter(c => checkedSet.has(c.order)).length} 道{parsed.feedback.length ? ` · 面试反馈 ${parsed.feedback.length} 段（保存为备注，不作为题目）` : ""}</p>
        {categoryCounts.length > 1 && <span className="flex flex-wrap items-center gap-1.5">{categoryCounts.map(([category, count]) => <Badge key={category} variant="secondary" className="bg-muted text-muted-foreground">{category} {count}</Badge>)}</span>}
      </div>

      {parsed.feedback.length > 0 && <details className="rounded-[10px] border border-border bg-card p-4 text-[15px] text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">非题目内容：面试官反馈与评价</summary>
        <ul className="mt-2 list-inside list-disc space-y-1">{parsed.feedback.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul>
      </details>}

      <div className="space-y-3">
        {candidates.map(candidate => {
          const text = currentText(candidate);
          const overLimit = text.length > MAX_QUESTION_CHARS;
          const duplicate = duplicateKeys.has(normalizeCollectedQuestion(text));
          const isChecked = checkedSet.has(candidate.order);
          return <article key={candidate.order} className={`rounded-[10px] border p-4 ${isChecked && !overLimit ? "border-border bg-white" : "border-border bg-card"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[15px] font-medium text-foreground">
                <input type="checkbox" aria-label={`选择第${candidate.order}题`} checked={isChecked} disabled={lockedAll} onChange={() => toggle(candidate.order)} />
                第 {candidate.order} 题{candidate.confidence === "needs_review" && <span className="rounded bg-amber-50 px-2 py-0.5 text-[13px] text-amber-800">待核对</span>}
                {currentCategory(candidate) && <span className="text-[13px] font-normal text-muted-foreground">{currentCategory(candidate)}</span>}
              </label>
              {duplicate && <span className="rounded bg-amber-50 px-2 py-0.5 text-[13px] text-amber-800">与其他候选题重复，请核对</span>}
              {!duplicate && duplicatesExisting(candidate) && <span className="rounded bg-amber-50 px-2 py-0.5 text-[13px] text-amber-800">与已有题目重复，请核对</span>}
            </div>
            {candidate.warnings.map(warning => <p key={warning} className="mt-1 text-[13px] text-amber-800">{warning}</p>)}
            <Textarea aria-label={`编辑第${candidate.order}题`} value={text} disabled={lockedAll} maxLength={Math.max(MAX_QUESTION_CHARS, text.length)} onChange={event => setEdits(current => ({ ...current, [candidate.order]: event.target.value }))}
              className="mt-2 min-h-20 w-full bg-white" />
            <p className="mt-1 text-[13px] text-muted-foreground">{text.length}/600 字{overLimit && <span className="ml-2 text-destructive">超过单题上限，请精简后再导入</span>}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[14px] text-muted-foreground">
              <label className="flex items-center gap-2">分类<input aria-label={`第${candidate.order}题分类`} value={currentCategory(candidate)} disabled={lockedAll} onChange={event => setCategoryEdits(current => ({ ...current, [candidate.order]: event.target.value }))} className="w-56 rounded-md border border-border bg-white px-2 py-1.5 text-[14px]" /></label>
              <label className="flex items-center gap-2">关联岗位<select aria-label={`第${candidate.order}题关联岗位`} value={projectChoice[candidate.order] ?? ""} disabled={lockedAll} onChange={event => setProjectChoice(current => ({ ...current, [candidate.order]: event.target.value }))} className="max-w-56 rounded-md border border-border bg-white px-2 py-1.5 text-[14px]">
                <option value="">不关联岗位，独立练习</option>
                {projects.map(project => <option key={project.id} value={project.id}>{project.jobTitle}</option>)}
              </select></label>
            </div>
          </article>;
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button data-cta="primary" disabled={lockedAll || !candidates.some(c => checkedSet.has(c.order))} onClick={save}>确认保存所选题目</Button>
        <Button variant="outline" disabled={lockedAll} onClick={() => { setParsed(null); setChecked(null); setEdits({}); setCategoryEdits({}); }}>返回重新粘贴</Button>
      </div>
    </div>}
  </section>;
}
