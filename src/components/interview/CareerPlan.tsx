import { useState } from "react";
import type { EvidenceNote, InterviewProject } from "../../lib/domain";
import { buildEvidenceTasks, getEvidenceNotes, getSprintTasks, isEvidenceReady, renderPreparationBrief, type EvidenceTask } from "../../lib/careerPlan";
interface Props {
  project: InterviewProject;
  onSave: (noteId: string, note: EvidenceNote) => string | null;
  onPatch: (project: InterviewProject) => string | null;
  onMinutes: (minutes: 30 | 60 | 120) => void;
  onPractice: (tasks: EvidenceTask[]) => void;
  onUnsaved: (value: boolean) => void;
  trainingEntryLabel?: string;
}
const emptyNote = (): EvidenceNote => ({ action: "", result: "", reflection: "", confirmed: false, updatedAt: new Date().toISOString() });
export function CareerPlan({ project, onSave, onPatch, onMinutes, onPractice, onUnsaved, trainingEntryLabel }: Props) {
  const [failed, setFailed] = useState<Record<string, EvidenceNote>>({});
  const [notice, setNotice] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [exportText, setExportText] = useState("");
  const [caseTitles, setCaseTitles] = useState<Record<string, string>>({});
  const tasks = buildEvidenceTasks(project);
  const notes = getEvidenceNotes(project);
  const minutes = project.prepMinutes ?? 30;
  const sprint = getSprintTasks(tasks, notes, minutes);
  const ready = tasks.filter(task => isEvidenceReady(notes[task.id])).length;
  const hasUnsaved = Object.keys(failed).length > 0;
  const visible = showAll ? tasks : tasks.filter(t => sprint.includes(t) || isEvidenceReady(notes[t.id]) || failed[t.id]);
  function save(id: string, note: EvidenceNote) {
    const next = { ...failed };
    const error = onSave(id, { ...note, updatedAt: new Date().toISOString() });
    if (error) next[id] = note; else delete next[id];
    setFailed(next); onUnsaved(Object.keys(next).length > 0);
    setNotice(error || "材料草稿已自动保存到当前浏览器。本人确认后才计入已准备材料。");
  }
  function patch(next: InterviewProject) {
    const error = onPatch({ ...next, updatedAt: new Date().toISOString() });
    setNotice(error || "案例关联已保存。关联同一案例的要求会同步读取该材料。");
  }
  function download() {
    const text = renderPreparationBrief(project, tasks); setExportText(text);
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "面试准备摘要.md"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-6">
    <section className="rounded-2xl border border-blue-200 bg-blue-50/60 p-6">
      <p className="text-sm font-medium text-blue-700">AI 岗位转型 · 证据准备</p>
      <h2 className="mt-2 text-2xl font-bold text-slate-950">让真实经历，经得起下一次追问</h2>
      <p className="mt-2 text-slate-600">{project.jobTitle} · {project.company || "目标公司未填写"}</p>
      <p className="mt-4 text-sm leading-6">材料逐次自动保存；同一个真实案例可以关联多个岗位要求。文字关联与本人确认均不等于事实核验。</p>
      <button disabled={hasUnsaved} onClick={download} className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">导出准备摘要</button>
      <p className="mt-2 text-xs text-slate-600">摘要含求职材料；完整恢复请用工作台的项目备份。</p>
      {exportText && <label className="mt-4 block text-sm">若浏览器未下载，可全选复制<textarea aria-label="可复制的准备摘要" readOnly value={exportText} className="form-control mt-2 min-h-52"/></label>}
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-bold text-slate-950">这次有多少准备时间？</h3>
      <div className="mt-3 flex flex-wrap gap-2">{([30,60,120] as const).map(value => <button disabled={hasUnsaved} key={value} aria-pressed={minutes === value} onClick={() => onMinutes(value)} className={`rounded-lg px-4 py-2 text-sm font-medium ${minutes === value ? "bg-blue-700 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{value} 分钟</button>)}</div>
      <p className="mt-4 text-sm text-slate-600">本人确认材料 {ready} / {tasks.length} 项 · 当前优先补充 {sprint.length} 项 · 建议约 {sprint.length * 15} 分钟，非完成时间保证</p>
      <ol className="mt-4 space-y-2">{sprint.map((task, i) => <li key={task.id} className="text-sm">{i + 1}. <a className="underline" href={`#task-${task.id}`}>{task.title}</a></li>)}</ol>
      <button disabled={hasUnsaved} onClick={() => onPractice(sprint.length ? sprint : tasks)} className="mt-5 rounded-lg bg-blue-700 px-4 py-3 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-40">{trainingEntryLabel ?? "按这条路线练习"}</button>
    </section>
    {notice && <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{notice}</p>}
    {hasUnsaved && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">部分材料未保存，请在下方重试；暂时不能离开本页或开始练习。</p>}
    <div className="grid gap-5 lg:grid-cols-2">{visible.map(task => {
      const note = failed[task.id] ?? notes[task.id] ?? emptyNote();
      const link = project.caseLinks?.[task.id];
      return <article id={`task-${task.id}`} key={task.id} className="scroll-mt-28 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold text-slate-950">{task.title} <span className="text-xs font-normal text-slate-500">{failed[task.id] ? "未保存" : isEvidenceReady(note) ? "本人已确认" : "草稿 / 待确认"}</span></h3>
        <p className="text-sm text-slate-600">{task.reason}</p>
        <details className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><summary className="cursor-pointer font-medium">查看原文与经历线索</summary><p className="mt-2 whitespace-pre-wrap">{task.requirement}</p><p className="mt-2 text-slate-600">经历原文：{task.background || "暂无对应肯定经历线索，请人工核对。"}</p></details>
        <label className="block text-sm">复用已有案例<select disabled={hasUnsaved} aria-label={`${task.title}：复用已有案例`} className="form-control mt-2" value={link ?? ""} onChange={e => {
          const links = { ...project.caseLinks };
          if (e.target.value) links[task.id] = e.target.value; else delete links[task.id];
          patch({ ...project, caseLinks: links, evidenceNotes: { ...project.evidenceNotes, [task.id]: { ...note } } });
        }}><option value="">独立材料（不关联案例）</option>{Object.entries(project.cases ?? {}).map(([id, c]) => <option key={id} value={id}>{c.title}</option>)}</select></label>
        {link && <p className="text-xs text-amber-800">正在编辑共享案例，改动会同步到当前项目所有关联要求；改为独立材料可解除关联。</p>}
        {([["action","我的具体贡献"],["result","可核验的结果或产物"],["reflection","能力边界与反思"]] as const).map(([field,label]) => <label key={field} className="block text-sm">{label}<textarea aria-label={`${task.title}：${label}`} maxLength={4000} className="form-control mt-2 min-h-24" value={note[field]} onChange={e => save(task.id, { ...note, [field]: e.target.value, confirmed: false })}/></label>)}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={note.confirmed} disabled={!note.action.trim() || !note.result.trim() || !note.reflection.trim()} onChange={e => save(task.id, { ...note, confirmed: e.target.checked })}/>我确认这是本人的真实情况，可用于练习（不是外部核验）。</label>
        {!link && <div className="flex flex-wrap gap-2"><input aria-label={`${task.title}：案例名称`} className="form-control" placeholder="给可复用案例起一个名称" maxLength={80} value={caseTitles[task.id] ?? ""} onChange={e => setCaseTitles({ ...caseTitles, [task.id]: e.target.value })}/><button disabled={hasUnsaved || !caseTitles[task.id]?.trim()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40" onClick={() => { const id = crypto.randomUUID(); patch({ ...project, cases: { ...project.cases, [id]: { ...note, title: caseTitles[task.id].trim() } }, caseLinks: { ...project.caseLinks, [task.id]: id } }); }}>保存为共享案例</button></div>}
        <div className="flex flex-wrap gap-3"><button onClick={() => save(task.id,note)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">保存材料 / 重试</button><button disabled={hasUnsaved} onClick={() => onPractice([task])} className="rounded-lg border border-blue-200 px-4 py-2 text-sm font-medium text-blue-800 hover:bg-blue-50 disabled:opacity-40">{trainingEntryLabel ?? "围绕这项练习"}</button></div>
      </article>;
    })}</div>
    {visible.length < tasks.length && <button onClick={() => setShowAll(true)} className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">查看其余 {tasks.length-visible.length} 项岗位要求</button>}
  </div>;
}
