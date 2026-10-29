import type { AnalysisSource, InterviewProject, JobAnalysisBasis, JobAnalysisItem, SavedJobAnalysis, UserProfile } from "./domain";
import { buildInterviewContext, type InterviewContext } from "./interviewContext";
import { usableMaterial } from "./jobMaterialFlow";
import { jobAnalysisPrompt } from "./modelPrompts";
import { loadProjects, saveProject, type StorageLike } from "./projectStorage";
import { validSavedJobAnalysis } from "./validation";

/** Names/IDs aid inspection; freshness uses the exact bounded prompt, not updatedAt. */
export function analysisSources(project: InterviewProject, profile: UserProfile, context: InterviewContext): AnalysisSource[] {
  const sources: AnalysisSource[] = profile.experiences.filter(card => card.confirmed).slice(0, 20).map(card => ({ id: card.id, kind: "experience", label: card.title.slice(0, 120) }));
  const jdParts = [{ id: project.id, label: "岗位原始 JD", text: project.jobDescription }, ...(project.materials ?? []).filter(material => material.kind === "job_description" && usableMaterial(material)).map(material => ({ id: material.id, label: material.title.slice(0, 120), text: material.content }))].filter(part => Boolean(part.text));
  const fullJd = jdParts.map(part => part.text).join("\n");
  const start = fullJd.length - fullJd.trimStart().length;
  const end = start + context.targetJob.jd.length;
  let offset = 0;
  for (const part of jdParts) {
    if (offset < end && offset + part.text.length > start) sources.push({ id: part.id, kind: "jd", label: part.label });
    offset += part.text.length + 1;
  }
  sources.push(...context.confirmedJobMaterials.map(item => ({ id: item.id, kind: "reference" as const, label: item.title.slice(0, 120) })),
    ...context.thirdPartyInterviewMaterials.map(item => ({ id: item.id, kind: "third_party" as const, label: item.title.slice(0, 120) })));
  if (project.session) {
    const session = project.session;
    sources.push(...session.turns.map((turn, index) => ({ turn, index })).filter(item => item.turn.finalAnswer?.trim()).slice(-5)
      .map(item => ({ id: `${session.id}:${item.index}`, kind: "previous_answer" as const, label: `第 ${item.index + 1} 轮本人最终确认答案` })));
  }
  return sources;
}

export async function buildAnalysisBasis(project: InterviewProject, profile: UserProfile, context = buildInterviewContext({ project, profile })): Promise<JobAnalysisBasis> {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境无法记录分析依据，请在 localhost 或 HTTPS 下重试；旧分析仍保留。");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(jobAnalysisPrompt(context))));
  return { version: 1, projectId: project.id, fingerprint: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""), sources: analysisSources(project, profile, context) };
}

export function analysisFreshness(analysis: SavedJobAnalysis, current: JobAnalysisBasis | null, available?: { project: InterviewProject; profile: UserProfile }): "current" | "stale" | "unknown" {
  if (!analysis.basis || !current || analysis.basis.projectId !== current.projectId) return "unknown";
  const recoverable = (source: AnalysisSource) => {
    if (!available) return current.sources.some(item => item.id === source.id && item.kind === source.kind);
    if (source.kind === "experience") return available.profile.experiences.some(card => card.id === source.id);
    if (source.kind === "jd" && source.id === available.project.id) return true;
    if (source.kind === "previous_answer") return available.project.session?.turns.some((_turn, index) => `${available.project.session!.id}:${index}` === source.id) ?? false;
    return available.project.materials?.some(material => material.id === source.id) ?? false;
  };
  if (analysis.basis.sources.some(source => !recoverable(source))) return "unknown";
  return analysis.basis.fingerprint === current.fingerprint ? "current" : "stale";
}

export function createSavedAnalysis(rows: JobAnalysisItem[], basis: JobAnalysisBasis, now = new Date()): SavedJobAnalysis {
  const result = { id: crypto.randomUUID(), generatedAt: now.toISOString(), rows, basis };
  if (!validSavedJobAnalysis(result)) throw new Error("AI 未返回可保存的有效分析，旧结果仍保留。");
  return result;
}

/** Read the latest job before appending; never write a request-time copy of its training/materials. */
export function saveProjectAnalysis(projectId: string, result: SavedJobAnalysis, storage: StorageLike = localStorage): InterviewProject[] {
  if (!validSavedJobAnalysis(result) || result.basis?.projectId !== projectId) throw new Error("分析与岗位依据不一致，未保存。");
  const project = loadProjects(storage).find(item => item.id === projectId);
  if (!project) throw new Error("岗位已不存在或无法安全读取，未保存分析。");
  if (project.aiAnalyses?.some(item => item.id === result.id)) throw new Error("该分析已经保存，未重复写入。");
  return saveProject({ ...project, aiAnalyses: [...(project.aiAnalyses ?? []), result], updatedAt: new Date().toISOString() }, storage);
}
