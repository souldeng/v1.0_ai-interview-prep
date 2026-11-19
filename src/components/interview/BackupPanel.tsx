import { useState } from "react";
import { exportBackup, importBackup, MAX_BACKUP_BYTES, parseBackup, type Backup } from "../../lib/backup";
import { loadDrafts } from "../../lib/drafts";

type Notice = { kind: "status" | "error"; text: string };
type BackupCounts = {
  projectCount: number;
  savedAnalyses: number;
  projectSessions: number;
  historySessions: number;
  resumes: number;
  confirmedExperiences: number;
  questionCount: number;
  savedMaterials: number;
  drafts: number;
  inlineImages: number;
  attachmentReferences: number;
};

const primaryButton = "rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-muted active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A84E22] disabled:cursor-not-allowed disabled:opacity-50";

function backupCounts(backup: Backup): BackupCounts {
  const profile = backup.version === 2 || backup.version === 3 ? backup.profile : null;
  const library = backup.version === 3 ? backup.library : null;
  const projectMaterials = backup.projects.flatMap(project => project.materials ?? []);
  const collectionMaterials = library?.collection?.materials ?? [];
  const attachmentReferences = [
    ...(profile?.resumes ?? []).map(item => item.fileId),
    ...projectMaterials.flatMap(item => [item.fileId, ...(item.parts ?? []).map(part => part.fileId)]),
    ...collectionMaterials.flatMap(item => [item.fileId, ...(item.parts ?? []).map(part => part.fileId)]),
  ].filter(Boolean).length;
  const questions = backup.projects.reduce((sum, project) => sum + project.questions.length, 0)
    + (library?.recordedQuestions?.length ?? 0)
    + (library?.experienceSets?.reduce((sum, set) => sum + set.questions.length, 0) ?? 0)
    + (library?.resumeSets?.reduce((sum, set) => sum + set.questions.length, 0) ?? 0)
    + (library?.collection?.analyses.reduce((sum, analysis) => sum + analysis.questions.length, 0) ?? 0);
  return {
    projectCount: backup.projects.length,
    savedAnalyses: backup.projects.filter(project => Boolean(project.analysis || project.aiAnalyses?.length)).length,
    projectSessions: backup.projects.filter(project => Boolean(project.session)).length,
    historySessions: backup.history.length,
    resumes: profile?.resumes.length ?? 0,
    confirmedExperiences: profile?.experiences.filter(item => item.confirmed).length ?? 0,
    questionCount: questions,
    savedMaterials: projectMaterials.length + collectionMaterials.length,
    drafts: Object.keys(backup.drafts).length,
    inlineImages: [...projectMaterials, ...collectionMaterials].filter(item => Boolean(item.sourceDataUrl)).length,
    attachmentReferences,
  };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，现有数据未主动清除。";
}

function yieldToPaint() {
  return new Promise<void>(resolve => window.setTimeout(resolve, 0));
}

export function BackupPanel({ onRestored }: { onRestored: () => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<{ version: number; counts: BackupCounts } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [exported, setExported] = useState("");
  const [busy, setBusy] = useState<"backup" | "reading" | "validating" | "restoring" | null>(null);
  const recoveredDrafts = Object.entries(loadDrafts()).filter(([key]) => key.startsWith("recovered:"));

  async function createBackup() {
    if (busy) return;
    setBusy("backup");
    setNotice({ kind: "status", text: "正在检查并生成备份…" });
    await yieldToPaint();
    try {
      const value = exportBackup();
      const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `AI面试通-本地备份-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setExported(value);
      setNotice({ kind: "status", text: "备份文件已交给浏览器下载。若未自动保存，可复制下方 JSON；本次不会修改应用数据。" });
    } catch (error) {
      setNotice({ kind: "error", text: describeError(error) });
    } finally {
      setBusy(null);
    }
  }

  async function readBackupFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy("reading");
    setPreview(null);
    setNotice(null);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error("备份超过 5MB 上限，未读取。");
      const value = await file.text();
      setText(value);
      setFileName(file.name);
      setNotice({ kind: "status", text: "文件已读取。下一步请检查备份结构与恢复范围。" });
    } catch (error) {
      setText("");
      setFileName("");
      setNotice({ kind: "error", text: describeError(error) });
    } finally {
      setBusy(null);
    }
  }

  async function inspectBackup() {
    if (busy || !text.trim()) return;
    setBusy("validating");
    setPreview(null);
    setNotice({ kind: "status", text: "正在校验版本与数据结构…" });
    await yieldToPaint();
    try {
      const backup = parseBackup(text);
      setPreview({ version: backup.version, counts: backupCounts(backup) });
      setNotice({ kind: "status", text: "校验通过。请核对下方范围，再确认追加为副本。" });
    } catch (error) {
      setNotice({ kind: "error", text: describeError(error) });
    } finally {
      setBusy(null);
    }
  }

  async function restoreBackup() {
    if (busy || !preview) return;
    setBusy("restoring");
    setNotice({ kind: "status", text: "正在追加备份副本并核对写入结果…" });
    await yieldToPaint();
    try {
      importBackup(text);
      onRestored();
      setText("");
      setFileName("");
      setPreview(null);
      setNotice({ kind: "status", text: "恢复完成。当前数据已重新读取；原有数据保留，导入内容以副本形式追加。" });
    } catch (error) {
      setNotice({ kind: "error", text: describeError(error) });
    } finally {
      setBusy(null);
    }
  }

  return <div className="space-y-4">
    <section className="rounded-[14px] border border-border bg-white p-5">
      <h2 className="text-base font-semibold text-foreground">备份范围</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
        <li>包含岗位、已保存分析与题目、题库与收藏、已保存答案和训练记录、个人资料文字与已确认经历、资料文字/元数据及草稿。</li>
        <li>未确认的个人经历候选不会导出；草稿可能包含尚未提交的回答。</li>
        <li>不包含 IndexedDB 中的原始附件 Blob。附件引用会保留，但恢复副本会标记原文件未保存；请另存原件。</li>
        <li>项目或资料中已有的 <code>sourceDataUrl</code> 内联图片数据会随 JSON 一并导出。应用密钥和服务端环境变量不作为备份字段。</li>
      </ul>
    </section>

    <section className="rounded-[14px] border border-border bg-white p-5">
      <h2 className="text-base font-semibold text-foreground">创建本地备份</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">JSON 最大 5MB。备份只下载到你的设备，不会自动上传；创建失败不会修改现有资料。</p>
      <button type="button" className={`${primaryButton} mt-4`} onClick={createBackup} disabled={busy !== null}>{busy === "backup" ? "正在生成…" : "下载 JSON 备份"}</button>
      {exported && <label className="mt-4 block text-sm text-foreground">可复制的备份 JSON<textarea aria-label="可复制的备份 JSON" readOnly value={exported} className="mt-2 min-h-28 w-full rounded-md border border-border p-3 font-mono text-xs text-foreground" /></label>}
    </section>

    <section className="space-y-4 rounded-[14px] border border-border bg-white p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">恢复本地备份</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">选择文件后先校验版本与结构，再查看恢复范围。导入会追加副本，不覆盖当前记录；再次导入同一文件会再次产生副本。</p>
      </div>
      <label className="block text-sm font-medium text-foreground">选择 JSON 备份文件
        <input aria-label="选择备份文件" type="file" accept=".json,application/json" disabled={busy !== null} onChange={event => { void readBackupFile(event.target.files?.[0]); event.currentTarget.value = ""; }} className="mt-2 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-white file:px-4 file:py-2 file:text-sm file:text-muted-foreground hover:file:bg-background disabled:cursor-not-allowed disabled:opacity-50" />
      </label>
      {fileName && <p className="text-sm text-muted-foreground">已选择：{fileName}</p>}
      <label className="block text-sm font-medium text-foreground">或粘贴备份 JSON
        <textarea aria-label="待恢复的备份" value={text} onChange={event => { setText(event.target.value); setPreview(null); setNotice(null); }} disabled={busy !== null} className="mt-2 min-h-28 w-full rounded-md border border-border p-3 font-mono text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50" />
      </label>
      <button type="button" className={secondaryButton} onClick={() => { void inspectBackup(); }} disabled={busy !== null || !text.trim()}>{busy === "validating" ? "正在校验…" : "校验并预览"}</button>
      {preview && <div role="region" className="space-y-3 rounded-[10px] border border-border bg-card p-4" aria-label="恢复范围预览">
        <h3 className="text-sm font-semibold text-foreground">V{preview.version} 备份 · 将追加为副本，不覆盖当前数据</h3>
        <ul className="grid gap-x-6 gap-y-1 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
          <li>{preview.counts.projectCount} 个岗位，{preview.counts.savedAnalyses} 个含已保存分析的岗位</li>
          <li>{preview.counts.projectSessions} 个岗位训练会话 + {preview.counts.historySessions} 条独立训练记录</li>
          <li>{preview.counts.resumes} 份个人资料文字，{preview.counts.confirmedExperiences} 段已确认经历</li>
          <li>{preview.counts.questionCount} 道已保存题目，{preview.counts.savedMaterials} 份资料/文字</li>
          <li>{preview.counts.drafts} 条草稿；可能包含未提交回答</li>
          <li>{preview.counts.attachmentReferences} 个附件引用；IndexedDB 原件不随备份恢复</li>
          {preview.counts.inlineImages > 0 && <li>{preview.counts.inlineImages} 份内联图片数据会随备份导入</li>}
        </ul>
        <p className="text-sm leading-6 text-muted-foreground">同一备份重复导入会生成重复副本。若目标存储容量不足或写入核对失败，会尝试回滚；若回滚失败，请保留备份并停止后续操作。</p>
        <button type="button" className={primaryButton} onClick={() => { void restoreBackup(); }} disabled={busy !== null}>{busy === "restoring" ? "正在恢复…" : "确认追加为副本"}</button>
      </div>}
      {recoveredDrafts.map(([key, value], index) => <details key={key} className="rounded-[10px] border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">未关联的恢复草稿 {index + 1}（只读查看）</summary>
        <textarea aria-label={`恢复草稿 ${index + 1}`} readOnly value={value} className="mt-2 min-h-24 w-full rounded-md border border-border p-3 text-sm text-foreground" />
      </details>)}
    </section>
    {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`text-sm leading-6 ${notice.kind === "error" ? "text-red-700" : "text-muted-foreground"}`}>{notice.text}</p>}
  </div>;
}
