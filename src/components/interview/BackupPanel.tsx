import { useState } from "react";
import { exportBackup, importBackup, parseBackup } from "../../lib/backup";
import { loadDrafts } from "../../lib/drafts";
export function BackupPanel({ onRestored }: { onRestored: () => void }) {
  const [text, setText] = useState(""); const [preview, setPreview] = useState(""); const [notice, setNotice] = useState(""); const [exported, setExported] = useState("");
  function download() {
    try {
      const value = exportBackup(); setExported(value);
      const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `AI面试通-文字与训练备份-${new Date().toISOString().slice(0,10)}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("已生成文字与训练备份；如未下载，可复制下方 JSON 保存为文件。");
    } catch { setNotice("读取备份失败，请检查浏览器是否允许本地存储。"); }
  }
  return <details className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><summary className="cursor-pointer font-semibold text-slate-950">文字与训练备份及恢复</summary>
    <p className="mt-3 text-sm leading-6 text-slate-600">包含本地项目、个人资料库的文字与元数据、材料、案例关联、原回答、重答版本、题库收藏、跨岗位答案草稿、训练记录及草稿。JSON 备份不包含 IndexedDB 中的原始附件，请另外保留原文件；恢复后如提示“原文件未保存”，请重新上传原件。旧版备份仍可导入；导入资料会追加为副本，不覆盖当前资料。</p>
    <button className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" onClick={download}>导出文字与训练备份</button>
    {exported && <label className="mt-3 block text-sm">可复制的文字与训练备份<textarea aria-label="可复制的文字与训练备份" readOnly value={exported} className="form-control mt-2 min-h-24"/></label>}
    <label className="mt-5 block text-sm">选择本地 JSON 备份文件<input aria-label="选择备份文件" type="file" accept=".json,application/json" className="mt-2 block" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; setPreview(""); try { if(f.size > 5*1024*1024) throw new Error("备份超过 5MB。"); setText(await f.text()); setNotice(""); } catch (error) { setNotice(String(error)); } }}/></label>
    <label className="mt-3 block text-sm">或粘贴备份 JSON<textarea aria-label="待恢复的备份" maxLength={5*1024*1024} value={text} onChange={e => { setText(e.target.value); setPreview(""); }} className="form-control mt-2 min-h-24"/></label>
    <button className="mt-3 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => { try { const b = parseBackup(text); setPreview(`将新增 ${b.projects.length} 个项目副本、${b.history.length} 条训练记录${b.version >= 2 ? "，并追加个人资料库文本" : ""}${b.version === 3 ? "及可关联的题库收藏、跨岗位草稿" : ""}，并恢复关联草稿；原记录不会覆盖。`); setNotice(""); } catch(error) { setPreview(""); setNotice(error instanceof Error ? error.message : "格式错误"); } }}>检查备份</button>
    {preview && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p>{preview}</p><button className="mt-3 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800" onClick={() => { try { importBackup(text); onRestored(); setPreview(""); setText(""); setNotice("导入成功，原有项目保留，新项目标记为导入副本。"); } catch(error) { setNotice(error instanceof Error ? error.message : "导入失败"); } }}>确认导入为副本</button></div>}
    {Object.entries(loadDrafts()).filter(([key]) => key.startsWith("recovered:")).map(([key,value], i) => <details key={key} className="mt-3"><summary>未关联的恢复草稿 {i+1}（可复制，未覆盖当前草稿）</summary><textarea aria-label={`恢复草稿 ${i+1}`} readOnly value={value} className="form-control mt-2 min-h-24"/></details>)}
    {notice && <p role="status" className="mt-3 text-sm text-slate-700">{notice}</p>}
  </details>;
}
