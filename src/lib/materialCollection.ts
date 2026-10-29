import type { JobMaterial, Question, UserProfile } from "./domain";
import { buildInterviewContext } from "./interviewContext";
import { validJobMaterial } from "./validation";

export type CollectionKind = "job_description" | "interview_experience" | "knowledge" | "mixed";
export interface CollectedMaterial extends JobMaterial { processing: "processing" | "recognized" | "failed"; error?: string; groupId?: string; groupOrder?: number; }
export interface ExtractedMaterial {
  warnings?: string[];
  materialId: string; contentVersion: string; type: CollectionKind; jobTitle: string; duties: string[]; requirements: string[]; skills: string[]; knowledgePoints: string[];
  questions: Array<{ text: string; origin: "original" | "derived"; evidenceQuote: string; technical: boolean }>;
}
export interface SourceConclusion { text: string; evidence: Array<{ materialId: string; quote: string }> }
export interface CollectionSummary { commonRequirements: SourceConclusion[]; topics: SourceConclusion[]; priorities: SourceConclusion[] }
export interface CollectionFailure { materialId: string; message: string; stage: "recognition" | "extraction" }
export interface CollectionAnalysis extends CollectionSummary { id: string; createdAt: string; items: ExtractedMaterial[]; questions: Question[]; hiddenQuestionIds?: string[]; sources?: Array<{materialId:string;contentVersion:string}>; failures?: CollectionFailure[]; summaryError?: string; summaryMaterialIds?: string[]; }
export interface MaterialCollection { materials: CollectedMaterial[]; analyses: CollectionAnalysis[]; extractions?: ExtractedMaterial[]; activeMaterialIds?: string[]; }
export const emptyCollection = (): MaterialCollection => ({ materials: [], analyses: [] });
export const collectionKindLabels: Record<CollectionKind, string> = { job_description: "岗位 JD", interview_experience: "第三方面经", knowledge: "知识笔记", mixed: "混合 / 无法确定" };
export function createCollectedMaterial(name: string, text = ""): CollectedMaterial {
  const now = new Date().toISOString();
  return { id: `collected-${crypto.randomUUID()}`, title: name.slice(0,160), kind: "reference", content: text, initialContent: text, source: "manual_text", processing: text.trim() ? "recognized" : "processing", createdAt: now, updatedAt: now };
}
// Exact content version, no clock or status fields: reopening never invalidates a result.
export const collectionVersion = (m: CollectedMaterial) => JSON.stringify([m.content, m.groupId ?? "", m.groupId ? m.groupOrder ?? 0 : 0]);
export const normalizeCollectedQuestion = (text: string) => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
export const activeCollectionMaterials = (c: MaterialCollection) => c.materials.filter(m => c.activeMaterialIds === undefined || c.activeMaterialIds.includes(m.id));
export const analysisSources = (a: CollectionAnalysis) => a.sources ?? a.items;
export function currentCollectionAnalysis(collection: MaterialCollection, materials: CollectedMaterial[]) {
  if (!materials.length) return undefined;
  return [...collection.analyses].reverse().find(a => analysisSources(a).length === materials.length && materials.every(m => analysisSources(a).some(i => i.materialId === m.id && i.contentVersion === collectionVersion(m))));
}
/** Detach from this work area only. Sources and blobs stay available to archived evidence/history. */
export function removeFromCollectionBatch(c: MaterialCollection, id: string): MaterialCollection {
  return { ...c, activeMaterialIds: activeCollectionMaterials(c).filter(m => m.id !== id).map(m => m.id) };
}
export function nextCollectionBatch(c: MaterialCollection, result: CollectionAnalysis): MaterialCollection {
  if (!c.analyses.some(a => a.id === result.id)) throw new Error("请先保存整理结果，再开始下一批。");
  return { ...c, activeMaterialIds: [] };
}
/** Retrying the same batch keeps existing question IDs, hidden state and training references. */
export function saveCollectionAttempt(c: MaterialCollection, result: CollectionAnalysis): MaterialCollection {
  const sources = analysisSources(result);
  const previous = [...c.analyses].reverse().find(a => analysisSources(a).length === sources.length && sources.every(s => analysisSources(a).some(p => p.materialId === s.materialId)) && a.items.every(i=>sources.some(s=>s.materialId===i.materialId && s.contentVersion===i.contentVersion)));
  const saved = previous ? { ...result, id: previous.id, questions: result.questions.map(q => {
    const old = previous.questions.find(p => normalizeCollectedQuestion(p.text) === normalizeCollectedQuestion(q.text));
    return { ...q, id:old?.id ?? q.id, collectionOrigin: { ...q.collectionOrigin!, analysisId: previous.id } };
  }), hiddenQuestionIds: previous.hiddenQuestionIds } : result;
  // Old questions remain addressable even when a partial retry produces fewer questions.
  if (previous) saved.questions.push(...previous.questions.filter(q => !saved.questions.some(n => n.id === q.id)));
  const combinedItems = previous ? [...saved.items, ...previous.items.filter(i => !saved.items.some(n => n.materialId === i.materialId))] : saved.items;
  saved.items = combinedItems;
  if (previous && result.summaryError && (previous.commonRequirements.length || previous.topics.length || previous.priorities.length)) {
    saved.commonRequirements=previous.commonRequirements; saved.topics=previous.topics; saved.priorities=previous.priorities;
    saved.summaryMaterialIds=previous.summaryMaterialIds ?? previous.items.map(i=>i.materialId);
  }
  return { ...c, analyses: previous ? c.analyses.map(a => a.id === previous.id ? saved : a) : [...c.analyses,saved], extractions: [...(c.extractions ?? []).filter(i => !saved.items.some(n => n.materialId === i.materialId)),...saved.items] };
}
export function validateMaterialExtractions(materials: CollectedMaterial[], value: unknown): ExtractedMaterial[] {
  if (!Array.isArray(value) || value.length !== materials.length || new Set(value.map(i => i?.materialId)).size !== materials.length) throw new Error("资料分类结果不完整，已有结果保留。");
  return materials.map(m => {
    const item = value.find(i => i?.materialId === m.id);
    if (!item || !["job_description", "interview_experience", "knowledge", "mixed"].includes(item.type) || item.jobTitle != null && typeof item.jobTitle !== "string") throw new Error("资料分类格式无效。");
    const unsupportedTitle = Boolean(item.jobTitle && !m.content.includes(item.jobTitle));
    const warnings = unsupportedTitle ? ["岗位名称缺少原文依据，已留空；请对照原文检查。"] : Array.isArray(item.warnings) ? item.warnings.filter((w: unknown): w is string => typeof w === "string" && w.length <= 300).slice(0,8) : [];
    const list = (key: string) => { if (!Array.isArray(item[key]) || item[key].length > 12 || !item[key].every((v: unknown) => typeof v === "string" && v.trim() && v.length <= 500 && m.content.includes(v))) throw new Error("资料提取字段缺少原文依据。"); return item[key] as string[]; };
    if (!Array.isArray(item.questions) || item.questions.length > 8) throw new Error("题目数量无效。");
    const seen = new Set<string>();
    const questions = item.questions.filter((q: any) => {
      if (!q || typeof q.text !== "string" || !q.text.trim() || q.text.length > 300 || !["original", "derived"].includes(q.origin) || typeof q.evidenceQuote !== "string" || !q.evidenceQuote.trim() || !m.content.includes(q.evidenceQuote) || q.evidenceQuote.length > 1000 || typeof q.technical !== "boolean") throw new Error("问题缺少可靠原文依据，未保存本次结果。");
      if (q.origin === "original" && (item.type !== "interview_experience" || !m.content.includes(q.text))) throw new Error("原题必须逐字存在于第三方面经原文中。");
      const key = normalizeCollectedQuestion(q.text); if (seen.has(key)) return false; seen.add(key); return true;
    });
    return { materialId: m.id, contentVersion: collectionVersion(m), type: item.type, jobTitle: unsupportedTitle ? "" : (item.jobTitle ?? "").slice(0,160), ...(warnings.length ? { warnings } : {}), duties: list("duties"), requirements: list("requirements"), skills: list("skills"), knowledgePoints: list("knowledgePoints"), questions };
  });
}
function validateCollectionSummary(materials: CollectedMaterial[], checked: ExtractedMaterial[], value: unknown): CollectionSummary {
  const raw = value as CollectionSummary;
  const conclusions = (key: keyof CollectionSummary): SourceConclusion[] => {
    if (!raw || !Array.isArray(raw[key]) || raw[key].length > 8) throw new Error("综合分析格式无效。");
    return raw[key].map(row => {
      if (!row || typeof row.text !== "string" || !row.text.trim() || row.text.length > 600 || !Array.isArray(row.evidence) || !row.evidence.length || row.evidence.length > materials.length || !row.evidence.every(e => typeof e.quote === "string" && e.quote.trim() && e.quote.length <= 1000 && materials.some(m => m.id === e.materialId && m.content.includes(e.quote)))) throw new Error("分析缺少可复核的资料依据。");
      if (key === "commonRequirements") {
        const jd = checked.filter(i => i.type === "job_description");
        const distinct = (ids: string[]) => new Set(ids.map(id => materials.find(m => m.id === id)?.groupId ?? id)).size;
        if (row.evidence.some(e => !jd.some(i => i.materialId === e.materialId)) || distinct(row.evidence.map(e => e.materialId)) < Math.min(2, distinct(jd.map(i => i.materialId)))) throw new Error("共同岗位要求必须有不同JD来源依据，不能混成同一家岗位。");
      }
      return row;
    });
  };
  return { commonRequirements: conclusions("commonRequirements"), topics: conclusions("topics"), priorities: conclusions("priorities") };
}
export function createCollectionAnalysis(materials: CollectedMaterial[], items: ExtractedMaterial[], value: unknown): CollectionAnalysis {
  const checked = validateMaterialExtractions(materials, items);
  const summary = validateCollectionSummary(materials, checked, value);
  const id = `collection-analysis-${crypto.randomUUID()}`;
  const questions: Question[] = checked.flatMap(item => item.questions.map(q => ({ id: `collected-question-${crypto.randomUUID()}`, text: q.text, category: q.technical ? "技术理解" as const : "方案与业务" as const, technical: q.technical,
    sourceType: q.origin === "original" ? "third_party" as const : "material_derived" as const,
    source: `${q.origin === "original" ? "第三方资料提及的问题，未经企业认证" : "AI 根据资料衍生的练习题"}：${materials.find(m => m.id === item.materialId)!.title}`,
    collectionOrigin: { materialId: item.materialId, analysisId: id, contentVersion: item.contentVersion, kind: item.type, evidenceQuote: q.evidenceQuote, origin: q.origin } })));
  const uniqueByText = new Map<string, Question>();
  for (const q of questions) { const key = normalizeCollectedQuestion(q.text), previous = uniqueByText.get(key); if (!previous || previous.sourceType !== "third_party" && q.sourceType === "third_party") uniqueByText.set(key,q); }
  const unique = [...uniqueByText.values()];
  return { id, createdAt: new Date().toISOString(), items: checked, questions: unique, ...summary };
}
export function collectionPracticeContext(profile: UserProfile, question: Question, userAnswer?: string) {
  const context = buildInterviewContext({ profile, currentQuestion: question.text, userAnswer });
  context.targetJob = { id: null, title: "面试资料单题练习", jd: "" };
  if (question.collectionOrigin) context.thirdPartyInterviewMaterials = [{ id: question.collectionOrigin.materialId, title: "第三方参考依据，绝非本人事实", text: question.collectionOrigin.evidenceQuote }];
  return context;
}
export function validMaterialCollection(value: any): value is MaterialCollection {
  const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  const snapshots = (items: ExtractedMaterial[]) => items.map(i => { const values = JSON.parse(i.contentVersion); const source = value.materials.find((m: CollectedMaterial) => m.id === i.materialId); if (!source || !Array.isArray(values) || typeof values[0] !== "string") throw new Error(); return { ...source, content: values[0], groupId: values[1] || undefined, groupOrder: values[2] ?? 0 }; });
  const cachedValid = () => { try { return value.extractions === undefined || Array.isArray(value.extractions) && value.extractions.length <= 80 && value.extractions.every((i: ExtractedMaterial) => validateMaterialExtractions(snapshots([i]), [i]).length === 1); } catch { return false; } };
  return Boolean(value && Array.isArray(value.materials) && value.materials.length <= 80 && value.materials.every((m: any) => m && ["processing", "recognized", "failed"].includes(m.processing) && (m.groupId === undefined || typeof m.groupId === "string") && (m.groupOrder === undefined || Number.isInteger(m.groupOrder) && m.groupOrder >= 0) && (m.error === undefined || typeof m.error === "string") && validJobMaterial(m))
    && new Set(value.materials.map((m: CollectedMaterial) => m.id)).size === value.materials.length
    && (value.activeMaterialIds === undefined || Array.isArray(value.activeMaterialIds) && new Set(value.activeMaterialIds).size === value.activeMaterialIds.length && value.activeMaterialIds.every((id: unknown) => value.materials.some((m: CollectedMaterial) => m.id === id)))
    && cachedValid()
    && Array.isArray(value.analyses) && value.analyses.length <= 80 && value.analyses.every((a: any) => {
      if (!a || typeof a.id !== "string" || !date(a.createdAt) || !Array.isArray(a.items) || !a.items.length || !Array.isArray(a.questions) || a.questions.length > 640) return false;
      try {
        if (a.sources !== undefined && (!Array.isArray(a.sources) || !a.sources.length || new Set(a.sources.map((s:any)=>s.materialId)).size !== a.sources.length || !a.sources.every((s:any)=>typeof s.contentVersion === "string" && snapshots([s]).length === 1 && a.items.every((i:ExtractedMaterial)=>a.sources.some((p:any)=>p.materialId===i.materialId && p.contentVersion===i.contentVersion))))) return false;
        if (a.failures !== undefined && (!Array.isArray(a.failures) || a.failures.length > 80 || !a.failures.every((f:any)=>["recognition","extraction"].includes(f.stage) && typeof f.message === "string" && f.message.length <= 2000 && (a.sources ?? a.items).some((s:any)=>s.materialId===f.materialId)))) return false;
        if (a.summaryError !== undefined && (typeof a.summaryError !== "string" || a.summaryError.length > 2000)) return false;
        // Saved extraction snapshots remain valid even after the source is edited.
        const sources = snapshots(a.items);
        const checked = validateMaterialExtractions(sources, a.items);
        if (a.summaryMaterialIds !== undefined && (!a.summaryError || !Array.isArray(a.summaryMaterialIds) || !a.summaryMaterialIds.length || new Set(a.summaryMaterialIds).size !== a.summaryMaterialIds.length || !a.summaryMaterialIds.every((id:unknown)=>checked.some(i=>i.materialId===id)))) return false;
        validateCollectionSummary(a.summaryMaterialIds ? sources.filter(m=>a.summaryMaterialIds.includes(m.id)) : sources, a.summaryMaterialIds ? checked.filter(i=>a.summaryMaterialIds.includes(i.materialId)) : checked, a);
        return a.questions.every((q: any) => typeof q.id === "string" && typeof q.text === "string" && typeof q.technical === "boolean" && typeof q.source === "string" && ["third_party", "material_derived"].includes(q.sourceType) && q.collectionOrigin?.analysisId === a.id && a.items.some((i: any) => i.materialId === q.collectionOrigin.materialId && i.contentVersion === q.collectionOrigin.contentVersion && i.questions.some((original: any) => original.text === q.text && original.evidenceQuote === q.collectionOrigin.evidenceQuote && original.origin === q.collectionOrigin.origin)))
          && new Set(a.questions.map((q: any) => q.id)).size === a.questions.length
          && (a.hiddenQuestionIds === undefined || Array.isArray(a.hiddenQuestionIds) && a.hiddenQuestionIds.every((id: unknown) => a.questions.some((q: any) => q.id === id)));
      } catch { return false; }
    }) && new Set(value.analyses.map((a: CollectionAnalysis) => a.id)).size === value.analyses.length);
}
