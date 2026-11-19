import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { buildQuestionSetDocx, buildQuestionSetPdf, buildTrainingRecordsDocx, buildTrainingRecordsPdf, download, type QuestionExportOptions, type TrainingExportOptions } from "../../lib/interviewExport";
import type { LibraryQuestion } from "../../lib/questionLibrary";
import type { TrainingRecord } from "../../lib/trainingRecords";

type ExportMode = "questions" | "training";
type ExportFormat = "docx" | "pdf";

const buttonClass = "rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22] disabled:cursor-not-allowed disabled:opacity-50";
const primaryClass = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22] disabled:cursor-not-allowed disabled:opacity-50";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "文件生成失败，请重试。";
}

export function ExportPanel({ entries, records }: { entries: LibraryQuestion[]; records: TrainingRecord[] }) {
  const [mode, setMode] = useState<ExportMode>("questions");
  const [format, setFormat] = useState<ExportFormat>("docx");
  const [selectedQuestionKeys, setSelectedQuestionKeys] = useState<Set<string>>(() => new Set());
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(() => new Set());
  const [questionOptions, setQuestionOptions] = useState<QuestionExportOptions>({
    includeOriginalAnswer: true, includeSuggestion: true, includeFinalAnswer: true,
  });
  const [trainingOptions, setTrainingOptions] = useState<TrainingExportOptions>({
    includeOriginalAnswers: true, includeRevisions: true, includeFinalAnswers: true, includeCoachFeedback: true, includeReport: true,
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "status" | "error"; text: string } | null>(null);

  const selectedQuestions = useMemo(() => entries.filter(entry => selectedQuestionKeys.has(entry.key)), [entries, selectedQuestionKeys]);
  const selectedRecords = useMemo(() => records.filter(record => selectedRecordIds.has(record.id)), [records, selectedRecordIds]);
  const hasSelection = mode === "questions" ? selectedQuestions.length > 0 : selectedRecords.length > 0;

  function toggleQuestion(key: string) {
    setSelectedQuestionKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleRecord(id: string) {
    setSelectedRecordIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleQuestionOption(key: keyof QuestionExportOptions) {
    setQuestionOptions(current => ({ ...current, [key]: !current[key] }));
  }

  function toggleTrainingOption(key: keyof TrainingExportOptions) {
    setTrainingOptions(current => ({ ...current, [key]: !current[key] }));
  }

  async function generate() {
    if (busy || !hasSelection) return;
    setBusy(true);
    setNotice({ kind: "status", text: "正在生成文件…" });
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    try {
      const selectedTrainingData = selectedRecords.map(record => ({ project: record.project, session: record.session, report: record.session.report ?? null }));
      const blob = mode === "questions"
        ? format === "docx" ? buildQuestionSetDocx(selectedQuestions, questionOptions) : buildQuestionSetPdf(selectedQuestions, questionOptions)
        : format === "docx" ? buildTrainingRecordsDocx(selectedTrainingData, trainingOptions) : buildTrainingRecordsPdf(selectedTrainingData, trainingOptions);
      const title = mode === "questions" ? "面试题准备资料" : "训练复盘";
      download(blob, `AI面试通-${title}-${new Date().toISOString().slice(0, 10)}.${format}`);
      setNotice({ kind: "status", text: "文件已交给浏览器下载。重复导出不会修改题库或训练记录。" });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  const questionCountText = `${selectedQuestions.length} 道题目已选`;
  const recordCountText = `${selectedRecords.length} 条训练记录已选`;

  return <div className="space-y-4">
    <section className="rounded-[14px] border border-border bg-white p-5">
      <h2 className="text-base font-semibold text-foreground">选择导出范围</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">只导出当前勾选的数据。来源与岗位信息始终保留；未填写的答案会标为未保存，不会补写。</p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="导出资料类型">
        <button type="button" aria-pressed={mode === "questions"} className={mode === "questions" ? primaryClass : buttonClass} onClick={() => { setMode("questions"); setNotice(null); }}>题目资料</button>
        <button type="button" aria-pressed={mode === "training"} className={mode === "training" ? primaryClass : buttonClass} onClick={() => { setMode("training"); setNotice(null); }}>训练复盘</button>
      </div>
      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-foreground">文件格式</legend>
        <div className="mt-2 flex gap-5">
          {(["docx", "pdf"] as const).map(value => <label key={value} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input type="radio" name="export-format" value={value} checked={format === value} onChange={() => setFormat(value)} disabled={busy} className="accent-[#A84E22]" />
            {value.toUpperCase()}
          </label>)}
        </div>
      </fieldset>
    </section>

    {mode === "questions" ? <section className="rounded-[14px] border border-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold text-foreground">选择题目</h2><p className="mt-1 text-sm text-muted-foreground">{entries.length ? questionCountText : "题库中还没有可导出的题目。"}</p></div>
        <button type="button" className={buttonClass} disabled={busy || entries.length === 0} onClick={() => setSelectedQuestionKeys(new Set(entries.map(entry => entry.key)))}>全选题目</button>
      </div>
      {entries.length > 0 && <div className="mt-4 max-h-[360px] space-y-2 overflow-auto">
        {entries.map(entry => <label key={entry.key} className="flex cursor-pointer gap-3 rounded-[10px] border border-border p-3 transition-colors hover:bg-muted">
          <input type="checkbox" checked={selectedQuestionKeys.has(entry.key)} onChange={() => toggleQuestion(entry.key)} disabled={busy} className="mt-1 accent-[#A84E22]" aria-label={`选择题目：${entry.question}`} />
          <span className="min-w-0"><span className="block text-sm font-medium text-foreground">{entry.question}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{entry.projectName}{entry.company ? ` · ${entry.company}` : ""} · {entry.category} · {entry.source}</span></span>
        </label>)}
      </div>}
      <fieldset className="mt-5 space-y-2">
        <legend className="mb-2 text-sm font-medium text-foreground">包含内容</legend>
        {([
          ["includeOriginalAnswer", "用户原回答"],
          ["includeSuggestion", "已保存的参考答案 / AI 改进建议（标注为参考，不是本人确认事实）"],
          ["includeFinalAnswer", "用户当前确认答案"],
        ] as Array<[keyof QuestionExportOptions, string]>).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <input type="checkbox" checked={questionOptions[key]} onChange={() => toggleQuestionOption(key)} disabled={busy} className="mt-1 accent-[#A84E22]" />{label}
        </label>)}
      </fieldset>
    </section> : <section className="rounded-[14px] border border-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold text-foreground">选择训练记录</h2><p className="mt-1 text-sm text-muted-foreground">{records.length ? recordCountText : "还没有可导出的训练记录。"}</p></div>
        <button type="button" className={buttonClass} disabled={busy || records.length === 0} onClick={() => setSelectedRecordIds(new Set(records.map(record => record.id)))}>全选记录</button>
      </div>
      {records.length > 0 && <div className="mt-4 max-h-[360px] space-y-2 overflow-auto">
        {records.map(record => <label key={record.id} className="flex cursor-pointer gap-3 rounded-[10px] border border-border p-3 transition-colors hover:bg-muted">
          <input type="checkbox" checked={selectedRecordIds.has(record.id)} onChange={() => toggleRecord(record.id)} disabled={busy} className="mt-1 accent-[#A84E22]" aria-label={`选择训练记录：${record.title}`} />
          <span className="min-w-0"><span className="block text-sm font-medium text-foreground">{record.title}</span><span className="mt-1 block text-xs text-muted-foreground">{record.sourceLabel} · {record.totals.total} 题 · {new Date(record.activityAt).toLocaleDateString("zh-CN")}</span></span>
        </label>)}
      </div>}
      <fieldset className="mt-5 space-y-2">
        <legend className="mb-2 text-sm font-medium text-foreground">包含内容</legend>
        {([
          ["includeOriginalAnswers", "用户原回答"],
          ["includeRevisions", "历史重答版本"],
          ["includeFinalAnswers", "用户当前确认答案"],
          ["includeCoachFeedback", "已保存的 AI 教练反馈（标注为参考建议）"],
          ["includeReport", "已保存的训练复盘报告"],
        ] as Array<[keyof TrainingExportOptions, string]>).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <input type="checkbox" checked={trainingOptions[key]} onChange={() => toggleTrainingOption(key)} disabled={busy} className="mt-1 accent-[#A84E22]" />{label}
        </label>)}
      </fieldset>
    </section>}

    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-border bg-card p-4">
      <div className="flex items-start gap-3"><FileText className="mt-0.5 text-primary" size={18} /><p className="text-sm leading-6 text-muted-foreground">文件仅使用已保存的数据。AI 参考答案与反馈不是用户确认事实；没有答案时会显示“未保存”。</p></div>
      <button type="button" className={primaryClass} onClick={generate} disabled={busy || !hasSelection}><Download size={16} className="mr-2" />{busy ? "正在生成…" : `生成 ${format.toUpperCase()}`}</button>
    </section>
    {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`text-sm ${notice.kind === "error" ? "text-red-700" : "text-muted-foreground"}`}>{notice.text}</p>}
  </div>;
}
