import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, FileWarning, ShieldCheck } from "lucide-react";
import type { InterviewProject, JobAnalysisBasis, SavedJobAnalysis, UserProfile } from "../../lib/domain";
import { createPreparation } from "../../lib/interview";
import { buildInterviewContext } from "../../lib/interviewContext";
import { usableMaterial } from "../../lib/jobMaterialFlow";
import { analyzeJobWithModel } from "../../services/modelClient";

import { analysisFreshness, analysisSources, buildAnalysisBasis, createSavedAnalysis } from "../../lib/jobAnalysis";
import { jobAnalysisPrompt } from "../../lib/modelPrompts";
import type { AnalysisQuestionSelection } from "../../lib/analysisPractice";

export function confirmedExperienceText(profile: UserProfile) {
  return buildInterviewContext({ profile }).confirmedUserFacts.join("\n");
}

export function jobRequirementText(project: InterviewProject) {
  return [project.jobDescription, ...(project.materials || []).filter(material => material.kind === "job_description" && usableMaterial(material)).map(material => material.content)].filter(Boolean).join("\n");
}

export function thirdPartyInterviewNotes(project: InterviewProject) {
  return (project.materials || []).filter(material => material.kind === "interview_experience" && usableMaterial(material));
}

export function EvidenceAnalysis({ project, profile, modelAvailable, onSaveAnalysis, onFailure, onPractice, practiceDisabled, initialSelectedId }: { project: InterviewProject; profile: UserProfile; modelAvailable?: boolean; onSaveAnalysis: (projectId: string, result: SavedJobAnalysis) => string | null; onFailure?: (message: string) => void; onPractice?: (selection: AnalysisQuestionSelection) => void; practiceDisabled?: boolean; initialSelectedId?: string | null }) {
  const context = buildInterviewContext({ project, profile });
  const evidence = context.confirmedUserFacts.join("\n");
  const requirements = context.targetJob.jd;
  const notes = thirdPartyInterviewNotes(project);
  const preparation = evidence && requirements ? createPreparation(evidence, requirements) : null;
  const records = project.aiAnalyses ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const selected = records.find(item => item.id === selectedId) ?? records.at(-1);
  const [basisState, setBasisState] = useState<{ key: string; basis: JobAnalysisBasis } | null>(null);
  const [basisError, setBasisError] = useState("");
  const sources = analysisSources(project, profile, context);
  const contextKey = JSON.stringify([jobAnalysisPrompt(context), sources]);
  const currentBasis = basisState?.key === contextKey ? basisState.basis : null;
  const alive = useRef(true);
  const requesting = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false; setBasisError("");
    void buildAnalysisBasis(project, profile, context).then(basis => { if (!cancelled) setBasisState({ key: contextKey, basis }); })
      .catch(error => { if (!cancelled) { setBasisState(null); setBasisError(error instanceof Error ? error.message : "分析依据暂时无法核对。"); } });
    return () => { cancelled = true; };
  }, [contextKey]);
  const freshness = selected ? analysisFreshness(selected, currentBasis, { project, profile }) : "unknown";
  const inputsChanged = selected?.basis && currentBasis && selected.basis.projectId === project.id && selected.basis.fingerprint !== currentBasis.fingerprint;
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const analyze = async () => {
    if (requesting.current) return;
    if (!modelAvailable) return setNotice("尚未配置模型服务；已保存分析与本地线索仍可查看。");
    if (!requirements.trim()) return setNotice("请先提供岗位 JD；旧分析仍保留。");
    requesting.current = true; setLoading(true); setNotice("");
    try {
      const basis = await buildAnalysisBasis(project, profile, context);
      const rows = await analyzeJobWithModel(context);
      const result = createSavedAnalysis(rows, basis);
      const error = onSaveAnalysis(project.id, result);
      if (error) throw new Error(`分析保存失败：${error}。此前分析仍保留，请重试。`);
      if (alive.current) { setSelectedId(result.id); setNotice("AI 分析已保存；依据为本次请求时的资料，结论仍需人工核对。"); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型分析失败，此前结果仍保留。";
      if (alive.current) setNotice(message);
      else onFailure?.(`岗位“${project.jobTitle}”分析未完成：${message}。此前已保存分析与资料仍保留。`);
    }
    finally { requesting.current = false; if (alive.current) setLoading(false); }
  };
  return <div className="space-y-6"><section className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-6"><div className="flex items-start gap-3"><span className="rounded-xl bg-white p-2.5 text-emerald-700"><ShieldCheck size={20}/></span><div><h2 className="text-lg font-semibold text-slate-950">基于已确认经历的分析</h2><p className="mt-1 text-sm leading-6 text-slate-600">根据岗位要求与已确认经历，选择最值得准备的问题。</p></div></div>{selected && <section aria-label="已保存的 AI 分析" className="mt-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-950">已保存的 AI 分析</h3><p className="text-xs text-slate-600">生成时间：{new Date(selected.generatedAt).toLocaleString("zh-CN")}</p></div>
    <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{selected.basis && !currentBasis && !basisError ? "正在核对分析依据…" : freshness === "current" ? "分析依据与当前资料一致" : freshness === "stale" ? "岗位资料已有变化，建议重新分析" : "分析依据未知，无法判断是否对应当前资料"}</p>
    {freshness === "unknown" && inputsChanged && <p role="alert" className="text-sm text-amber-900">岗位资料已有变化，建议重新分析</p>}
    {basisError && <p className="text-sm text-amber-900">{basisError}</p>}
    <p className="text-xs text-slate-600">已保存不代表事实已核验；推荐题是 AI 准备建议，不是企业真实面试原题，选择后才会进入训练。</p>
    {selected.rows.map((row, index) => <article key={index} className="rounded-lg border border-slate-200 p-3 text-sm">
      <h4 className="font-medium text-slate-950">{row.requirement}</h4><details className="mt-2"><summary className="cursor-pointer text-xs text-slate-600">分析理由与依据</summary><p className="mt-1 text-slate-700">{({ direct: "直接证据", transferable: "可迁移经验", no_evidence: "暂无证据", unknown: "无法判断" } as const)[row.status]}{row.evidenceQuote && ` · 生成时已确认经历原句：“${row.evidenceQuote}”`}</p><p className="mt-1 text-slate-600">{row.reason}</p>{row.studyTopic && <p className="mt-1 text-slate-600">补充学习：{row.studyTopic}</p>}</details>{row.practiceQuestion && <p className="mt-1 text-slate-600">建议准备：{row.practiceQuestion}</p>}
      {row.practiceQuestion.trim() && onPractice && <button onClick={() => onPractice({ projectId: project.id, analysisId: selected.id, rowIndex: index })} disabled={practiceDisabled || loading} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">练习这道题</button>}
    </article>)}
    <details className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700"><summary className="cursor-pointer font-medium">查看分析依据</summary>
      <p className="mt-3 font-medium">生成时使用的资料</p>{selected.basis ? <ul className="mt-2 list-disc pl-5">{selected.basis.sources.map((source, i) => <li key={i}>{({ jd: "JD", experience: "已确认经历", reference: "企业/岗位参考", third_party: "第三方面经（非本人事实）", previous_answer: "既有最终确认答案" } as const)[source.kind]}：{source.label}</li>)}</ul> : <p>未记录依据；不能推断旧分析仍然有效。</p>}
      <p className="mt-3 font-medium">当前用于分析的资料</p><ul className="mt-2 list-disc pl-5">{sources.map((source, i) => <li key={i}>{source.label}（{({ jd: "JD", experience: "已确认经历", reference: "企业/岗位参考", third_party: "第三方面经", previous_answer: "既有最终确认答案" } as const)[source.kind]}）</li>)}</ul>
      {selected.basis && <details className="mt-3"><summary className="cursor-pointer text-xs">内容标识详情</summary><p className="mt-2 break-all text-xs">生成时内容特征：{selected.basis.fingerprint}</p><p className="mt-2 text-xs">记录的是模型实际输入与任务模板的内容特征，不保存完整历史原文；未确认经历不会进入本人事实。</p></details>}
    </details>
    {records.length > 1 && <details className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700"><summary className="cursor-pointer">查看其他已保存分析（{records.length} 次）</summary><select aria-label="选择已保存分析" value={selected.id} onChange={event => setSelectedId(event.target.value)} className="form-control mt-3">{records.map((item, index) => <option key={item.id} value={item.id}>第 {index + 1} 次 · {new Date(item.generatedAt).toLocaleString("zh-CN")}</option>)}</select></details>}
    {selected.id !== records.at(-1)?.id && <button onClick={() => setSelectedId(records.at(-1)!.id)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">查看最近一次分析</button>}
  </section>}{preparation && <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">本地材料线索（辅助）</summary>{!evidence ? <p className="mt-4 rounded-xl border border-emerald-100 bg-white p-4 text-sm leading-6 text-slate-600">确认简历经历后，可获得更有针对性的分析。</p> : !requirements ? <p className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900">未发现可分析的 JD 文本。</p> : <div className="mt-5 overflow-x-auto rounded-xl border border-emerald-100 bg-white"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-emerald-50 text-slate-600"><tr><th>能力主题</th><th>岗位文字线索</th><th>已确认经历文字线索</th><th>边界</th></tr></thead><tbody>{preparation?.matrix.map(row => <tr key={row.capability} className="border-t border-slate-100 align-top text-slate-700"><td className="font-medium text-slate-950">{row.capability}</td><td>{row.requirement}</td><td>{row.evidence || "未发现已确认文字线索"}</td><td>{row.gap}</td></tr>)}</tbody></table></div>}</details>}<button onClick={() => void analyze()} disabled={loading} className="mt-4 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-800 disabled:opacity-50">{loading ? "正在分析…" : selected ? "重新分析" : "AI 分析岗位"}</button>{notice && <p role="status" className="mt-2 text-sm text-slate-700">{notice}</p>}</section><details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-medium text-slate-700">岗位来源范围</summary><div className="hidden"><div><p className="mt-1 text-sm leading-6 text-slate-600">岗位原始 JD 与已核对补充材料分别保留。</p></div></div><ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600"><li>原项目 JD：{project.jobDescription ? "已保存" : "未保存"}</li><li>已核对额外 JD：{(project.materials || []).filter(material => material.kind === "job_description" && usableMaterial(material)).length} 条</li><li>已确认经历卡：{profile.experiences.filter(card => card.confirmed).length} 张</li></ul></details>{notes.length > 0 && <section className="rounded-2xl border border-amber-100 bg-amber-50/60 p-6"><div className="flex items-start gap-3"><span className="rounded-xl bg-white p-2.5 text-amber-700"><FileWarning size={20}/></span><div><h2 className="text-lg font-semibold text-slate-950">第三方面经：仅作准备参考</h2><p className="mt-1 text-sm leading-6 text-slate-600">面经不会进入个人事实或匹配证据。</p></div></div>{notes.length === 0 ? <p className="mt-4 text-sm text-slate-600">暂无已核对面经文字记录。</p> : <ul className="mt-4 space-y-2 text-sm text-slate-700">{notes.map(note => <li key={note.id} className="rounded-lg border border-amber-100 bg-white p-3"><span className="font-medium">{note.title}</span><p className="mt-1 line-clamp-2 whitespace-pre-wrap leading-6">{note.content}</p></li>)}</ul>}</section>}</div>;
}
