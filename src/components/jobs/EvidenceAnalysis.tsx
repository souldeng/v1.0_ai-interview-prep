import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert, FileText, Lightbulb, Sparkles, Target } from "lucide-react";
import type { InterviewProject, JobAnalysisBasis, SavedJobAnalysis, UserProfile } from "../../lib/domain";
import { buildInterviewContext } from "../../lib/interviewContext";
import { usableMaterial } from "../../lib/jobMaterialFlow";
import { analyzeJobWithModel } from "../../services/modelClient";
import { analysisFreshness, analysisSources, buildAnalysisBasis, createSavedAnalysis } from "../../lib/jobAnalysis";
import { jobAnalysisPrompt } from "../../lib/modelPrompts";
import type { AnalysisQuestionSelection } from "../../lib/analysisPractice";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function confirmedExperienceText(profile: UserProfile) {
  return buildInterviewContext({ profile }).confirmedUserFacts.join("\n");
}

export function jobRequirementText(project: InterviewProject) {
  return [project.jobDescription, ...(project.materials || []).filter(material => material.kind === "job_description" && usableMaterial(material)).map(material => material.content)].filter(Boolean).join("\n");
}

export function thirdPartyInterviewNotes(project: InterviewProject) {
  return (project.materials || []).filter(material => material.kind === "interview_experience" && usableMaterial(material));
}

type Props = {
  project: InterviewProject;
  profile: UserProfile;
  modelAvailable?: boolean;
  onSaveAnalysis: (projectId: string, result: SavedJobAnalysis) => string | null;
  onFailure?: (message: string) => void;
  onPractice?: (selection: AnalysisQuestionSelection) => void;
  practiceDisabled?: boolean;
  initialSelectedId?: string | null;
  onAddToLibrary?: (analysisId: string, rowIndex: number, question: string) => string | null;
  addedRecommendedRows?: Set<string>;
  onRequestMaterials?: () => void;
};

const evidenceTone = {
  direct: { label: "直接匹配", tone: "bg-emerald-50 text-emerald-700" },
  transferable: { label: "可迁移", tone: "bg-indigo-50 text-indigo-700" },
  no_evidence: { label: "待补强", tone: "bg-accent text-primary" },
  unknown: { label: "待核对", tone: "bg-muted text-muted-foreground" },
} as const;

function SourcesPanel({ sources, selected, records, selectedId, onSelect }: { sources: ReturnType<typeof analysisSources>; selected: SavedJobAnalysis; records: SavedJobAnalysis[]; selectedId: string; onSelect: (value: string) => void }) {
  return <section className="border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Lightbulb size={16} className="text-primary"/><span>优先练习最贴近岗位要求的问题，再补强薄弱项。</span></div><details className="text-sm text-muted-foreground"><summary className="cursor-pointer underline decoration-[#D8C4B0] underline-offset-4 hover:text-foreground">查看分析依据与来源</summary><div className="mt-4 grid gap-5 rounded-xl bg-card p-4 sm:grid-cols-2"><div><p className="text-xs font-medium text-muted-foreground">当前资料</p><ul className="mt-2 space-y-1.5">{sources.map((source, index) => <li key={index}>{source.label}</li>)}</ul></div>{selected.basis && <div><p className="text-xs font-medium text-muted-foreground">生成时使用</p><ul className="mt-2 space-y-1.5">{selected.basis.sources.map((source, index) => <li key={index}>{source.label}</li>)}</ul></div>}</div></details></div>
    {records.length > 1 && <details className="mt-4 text-sm text-muted-foreground"><summary className="cursor-pointer underline decoration-[#D8C4B0] underline-offset-4 hover:text-foreground">查看历史分析（{records.length}）</summary><select aria-label="选择已保存分析" value={selectedId} onChange={event => onSelect(event.target.value)} className="form-control mt-3 max-w-sm">{records.map((item, index) => <option key={item.id} value={item.id}>第 {index + 1} 次 · {new Date(item.generatedAt).toLocaleString("zh-CN")}</option>)}</select></details>}
  </section>;
}

export function EvidenceAnalysis({ project, profile, modelAvailable, onSaveAnalysis, onFailure, onPractice, practiceDisabled, initialSelectedId, onAddToLibrary, addedRecommendedRows, onRequestMaterials }: Props) {
  const context = buildInterviewContext({ project, profile });
  const requirements = context.targetJob.jd;
  const records = project.aiAnalyses ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const selected = records.find(item => item.id === selectedId) ?? records.at(-1);
  const [basisState, setBasisState] = useState<{ key: string; basis: JobAnalysisBasis } | null>(null);
  const [basisError, setBasisError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const requesting = useRef(false);
  const sources = analysisSources(project, profile, context);
  const contextKey = JSON.stringify([jobAnalysisPrompt(context), sources]);
  const currentBasis = basisState?.key === contextKey ? basisState.basis : null;
  const freshness = selected ? analysisFreshness(selected, currentBasis, { project, profile }) : "unknown";
  const hasRequirements = Boolean(requirements.trim());
  const confirmedCount = profile.experiences.filter(card => card.confirmed).length;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    setBasisError("");
    void buildAnalysisBasis(project, profile, context).then(basis => {
      if (!cancelled) setBasisState({ key: contextKey, basis });
    }).catch(error => {
      if (!cancelled) { setBasisState(null); setBasisError(error instanceof Error ? error.message : "分析依据暂时无法核对。"); }
    });
    return () => { cancelled = true; };
  }, [contextKey]);

  const analyze = async () => {
    if (requesting.current) return;
    if (!modelAvailable) return setNotice("尚未配置模型服务；已保存分析与本地线索仍可查看。");
    if (!requirements.trim()) return setNotice("请先提供岗位 JD；旧分析仍保留。");
    requesting.current = true;
    setLoading(true);
    setNotice("");
    try {
      const basis = await buildAnalysisBasis(project, profile, context);
      const rows = await analyzeJobWithModel(context);
      const result = createSavedAnalysis(rows, basis);
      const error = onSaveAnalysis(project.id, result);
      if (error) throw new Error("分析保存失败：" + error + "。此前分析仍保留，请重试。");
      if (alive.current) { setSelectedId(result.id); setNotice("AI 分析已保存；建议结合真实项目经历进一步核对。"); }
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型分析失败，此前结果仍保留。";
      if (alive.current) setNotice(message);
      else onFailure?.("岗位“" + project.jobTitle + "”分析未完成：" + message + "。此前已保存分析与资料仍保留。");
    } finally {
      requesting.current = false;
      if (alive.current) setLoading(false);
    }
  };

  if (!hasRequirements) return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
    <section className="rounded-2xl border border-border bg-gradient-to-br from-background to-white p-6 md:p-8"><div className="flex size-11 items-center justify-center rounded-xl bg-accent text-primary"><CircleAlert size={21}/></div><p className="mt-5 text-sm font-medium text-primary">岗位资料不完整</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">补充岗位 JD，再开始分析</h2><p className="mt-3 max-w-xl text-[16px] leading-7 text-muted-foreground">当前岗位没有可用于分析的职责或任职要求。补充原始 JD 后，分析才会基于真实岗位要求生成。</p><div className="mt-6 flex flex-wrap gap-3"><Button onClick={onRequestMaterials} className="h-10 bg-primary px-4 text-white hover:bg-primary/90 active:scale-[0.98]"><FileText size={16}/>补充岗位 JD<ArrowRight size={16}/></Button><Button variant="outline" onClick={onRequestMaterials} className="h-10 border-border bg-white text-muted-foreground hover:bg-amber-50">查看岗位资料</Button></div>{notice && <p role="status" className="mt-5 text-sm text-primary">{notice}</p>}</section>
    <aside className="rounded-2xl border border-border bg-white p-5"><p className="text-sm font-medium text-foreground">分析需要什么</p><ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground"><li>岗位职责与任职要求</li><li>已确认经历作为匹配依据</li></ul><p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">不会把待确认经历作为个人事实。</p></aside>
  </div>;

  if (!selected) return <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
    <section className="rounded-2xl border border-border bg-gradient-to-br from-background via-white to-white p-6 md:p-8"><div className="flex flex-wrap items-start justify-between gap-5"><div><div className="flex size-11 items-center justify-center rounded-xl bg-accent text-primary"><Sparkles size={20}/></div><p className="mt-5 text-sm font-medium text-primary">AI 岗位分析</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-foreground">把岗位要求变成准备重点</h2><p className="mt-3 max-w-xl text-[16px] leading-7 text-muted-foreground">分析会对照岗位 JD 与已确认经历，定位可直接讲述的能力、需要迁移的经验与待补强方向。</p></div><Button onClick={() => void analyze()} disabled={loading} className="h-10 bg-primary px-4 text-white hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50">{loading ? "正在分析…" : "开始岗位分析"}<ArrowRight size={16}/></Button></div><div className="mt-7 grid gap-3 border-t border-border pt-5 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">岗位 JD</p><p className="mt-1 text-sm font-medium text-foreground">已就绪</p></div><div><p className="text-xs text-muted-foreground">确认经历</p><p className="mt-1 text-sm font-medium text-foreground">{confirmedCount} 条</p></div><div><p className="text-xs text-muted-foreground">分析输出</p><p className="mt-1 text-sm font-medium text-foreground">重点与练习题</p></div></div>{notice && <p role="status" className="mt-5 text-sm text-primary">{notice}</p>}</section>
    <aside className="rounded-2xl border border-border bg-white p-5"><Target size={19} className="text-primary"/><p className="mt-4 text-sm font-medium text-foreground">分析后你可以</p><ul className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground"><li>扫描能力重点与差距</li><li>从推荐问题直接进入练习</li><li>把有价值的问题加入岗位题库</li></ul></aside>
  </div>;

  const freshCopy = freshness === "current" ? { badge: "资料一致", tone: "bg-emerald-50 text-emerald-700", text: "分析依据与当前资料一致" } : freshness === "stale" ? { badge: "建议更新", tone: "bg-accent text-primary", text: "岗位或经历资料已有变化" } : { badge: "待核对", tone: "bg-muted text-muted-foreground", text: "正在核对分析依据" };
  return <div className="space-y-5">
    <section className="min-w-0"><div className="border-b border-border pb-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-primary">AI 岗位分析</p><h2 className="mt-1 text-[26px] font-semibold tracking-[-0.035em] text-foreground">优先准备这些能力与问题</h2><p className="mt-2 text-[15px] leading-6 text-muted-foreground">共 {selected.rows.length} 项结论，按岗位要求与已确认经历整理。</p></div><Button variant="outline" size="sm" onClick={() => void analyze()} disabled={loading} className="border-border bg-white text-muted-foreground hover:bg-amber-50">{loading ? "正在更新…" : "重新分析"}</Button></div><div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><Badge className={"border-0 px-2.5 py-1 text-xs font-medium " + freshCopy.tone}>{freshCopy.badge}</Badge><span>{basisError || freshCopy.text}</span></div></div>
      <div className="mt-5 space-y-3">{selected.rows.map((row, index) => { const state = evidenceTone[row.status]; const added = addedRecommendedRows?.has(selected.id + ":" + index) ?? false; return <article key={index} className="rounded-xl border border-border bg-white p-4 transition-colors hover:border-[#94A3B8] md:p-5"><div className="flex gap-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-sm font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge className={"border-0 px-2 py-0.5 text-xs font-medium " + state.tone}>{state.label}</Badge><h3 className="text-[17px] font-semibold leading-6 text-foreground">{row.requirement}</h3></div>{row.practiceQuestion && <div className="mt-3 rounded-lg bg-amber-50 px-3.5 py-3"><p className="text-xs font-medium text-primary">建议优先准备</p><p className="mt-1 text-[15px] font-medium leading-6 text-foreground">{row.practiceQuestion}</p></div>}<div className="mt-3 flex flex-wrap items-center justify-between gap-3"><details className="text-sm text-muted-foreground"><summary className="cursor-pointer list-none underline decoration-[#D8C4B0] underline-offset-4 hover:text-foreground">查看分析依据</summary><div className="mt-3 rounded-lg border border-border bg-card p-3 text-sm leading-6"><p><span className="font-medium text-muted-foreground">{state.label}</span>{row.evidenceQuote && " · 已确认经历：“" + row.evidenceQuote + "”"}</p><p className="mt-2">{row.reason}</p>{row.studyTopic && <p className="mt-2 text-muted-foreground">建议补充：{row.studyTopic}</p>}</div></details>{row.practiceQuestion.trim() && <div className="flex flex-wrap gap-2">{onPractice && <Button size="sm" onClick={() => onPractice({ projectId: project.id, analysisId: selected.id, rowIndex: index })} disabled={practiceDisabled || loading} className="bg-primary text-white hover:bg-primary/90 active:scale-[0.98]">练习这道题<ArrowRight size={14}/></Button>}{onAddToLibrary && (added ? <span className="inline-flex h-7 items-center rounded-md bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700">已在岗位题库</span> : <Button size="sm" variant="outline" onClick={() => { const message = onAddToLibrary(selected.id, index, row.practiceQuestion); setNotice(message ?? "已加入岗位专项题库；可从题库继续练习。"); }} disabled={loading} className="border-border bg-white text-muted-foreground hover:bg-amber-50">加入题库</Button>)}</div>}</div></div></div></article>; })}</div>
      {notice && <p role="status" className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-primary">{notice}</p>}
    </section>
    <SourcesPanel sources={sources} selected={selected} records={records} selectedId={selected.id} onSelect={setSelectedId}/>
  </div>;
}
