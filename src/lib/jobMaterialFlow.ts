import type { JobMaterial, JobMaterialKind, JobMaterialPart } from "./domain";

export function combinedMaterialText(parts: Pick<JobMaterialPart, "fileName" | "reviewedText">[]): string {
  return parts.map((part, index) => `${index + 1}. ${part.fileName}\n${part.reviewedText.trim()}`).join("\n\n").trim();
}

export function createReviewedJobMaterial(input: {
  id: string; projectId: string; title: string; kind: JobMaterialKind;
  parts: JobMaterialPart[]; now: string;
}): JobMaterial {
  const { id, projectId, title, kind, parts, now } = input;
  if (!projectId || !title.trim() || !parts.length || parts.some(part => !part.reviewedText.trim())) throw new Error("请先核对并填写所有选中资料的文字。");
  const content = combinedMaterialText(parts);
  if (new Blob([content]).size > 128 * 1024) throw new Error("合并文字超过 128KB；请拆分为多份资料。");
  return {
    id, projectId, kind, title: title.trim(), content,
    source: !parts[0].fileId ? "manual_text" : parts[0].mimeType.startsWith("image/") ? "screenshot" : "file",
    sourceFileName: parts[0].fileName, sourceMimeType: parts[0].mimeType,
    fileId: parts[0].fileId, originalSaved: parts.every(part => part.originalSaved),
    initialContent: parts.map(part => part.initialText).join("\n\n"),
    parts, reviewedAt: now, createdAt: now, updatedAt: now,
  };
}

/** Formal analysis requires review; legacy text remains visible for manual confirmation. */
export function usableMaterial(material: JobMaterial): boolean {
  return Boolean(material.content.trim() && material.reviewedAt);
}
