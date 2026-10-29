export const DRAFT_KEY = "ai-interview-drafts-v1";
export const MAX_DRAFT_BYTES = 512 * 1024;
export function loadDrafts(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, v]) => typeof v === "string" && !["__proto__", "constructor", "prototype"].includes(key))) as Record<string, string>;
  } catch { return {}; }
}
export function saveDraft(key: string, value: string): void {
  const drafts = loadDrafts();
  if (value) drafts[key] = value; else delete drafts[key];
  const encoded = JSON.stringify(drafts);
  if (new Blob([encoded]).size > MAX_DRAFT_BYTES) throw new Error("草稿空间不足，请先备份并清理已完成项目；当前输入仍保留在页面。");
  localStorage.setItem(DRAFT_KEY, encoded);
}
