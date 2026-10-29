import type { InterviewProject } from "./domain";
import { validProject } from "./validation";
import { DRAFT_KEY } from "./drafts";

const KEY = "ai-interview-projects-v1";
export const MAX_PROJECTS = 20;
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike {
  if (typeof localStorage === "undefined") throw new Error("当前环境不支持本地存储。");
  return localStorage;
}


export function loadProjects(storage?: StorageLike): InterviewProject[] {
  try {
    const raw = (storage ?? browserStorage()).getItem(KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter(validProject) : [];
  } catch {
    return [];
  }
}

export function saveProject(project: InterviewProject, storage: StorageLike = browserStorage()): InterviewProject[] {
  if (!validProject(project)) throw new Error("项目结构无效，未保存。");
  const raw = storage.getItem(KEY);
  if (raw && (!Array.isArray(JSON.parse(raw)) || !JSON.parse(raw).every(validProject))) throw new Error("已有项目含损坏数据，请先导出文字与训练备份，避免覆盖。");
  const next = [project, ...loadProjects(storage).filter(item => item.id !== project.id)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (next.length > MAX_PROJECTS) throw new Error("已达到 20 个项目上限，本次未新增，已有项目不会被自动删除。");
  const encoded = JSON.stringify(next);
  if (new Blob([encoded]).size > MAX_PROJECT_BYTES) {
    throw new Error("面试项目超过约 2MB 的本地容量限制，请清理旧记录后重试。");
  }
  storage.setItem(KEY, encoded);
  return next;
}

export function deleteProject(id: string, storage: StorageLike = browserStorage()): InterviewProject[] {
  const raw = storage.getItem(KEY);
  const current = JSON.parse(raw || "[]");
  if (!Array.isArray(current) || !current.every(validProject)) throw new Error("已有损坏项目，请先导出文字与训练备份，未执行删除。");
  const target = current.find((p: InterviewProject) => p.id === id);
  const next = current.filter((item: InterviewProject) => item.id !== id);
  const draftRaw = storage.getItem(DRAFT_KEY);
  const drafts = JSON.parse(draftRaw || "{}");
  const history = JSON.parse(storage.getItem("ai-interview-prep-history-v1") || "[]");
  if (!drafts || typeof drafts !== "object" || Array.isArray(drafts) || !Array.isArray(history)) throw new Error("草稿或历史损坏，请先备份，未执行删除。");
  delete drafts[`edit:${id}`];
  const sessionId = target?.session?.id;
  if (sessionId && !history.some((s: any) => s?.id === sessionId) && !next.some((p: InterviewProject) => p.session?.id === sessionId)) {
    for (const key of Object.keys(drafts)) if (key.startsWith(`answer:${sessionId}:`) || key.startsWith(`retry:${sessionId}:`)) delete drafts[key];
  }
  storage.setItem(KEY, JSON.stringify(next));
  try { storage.setItem(DRAFT_KEY, JSON.stringify(drafts)); }
  catch { try { raw === null ? storage.removeItem(KEY) : storage.setItem(KEY, raw); } catch { throw new Error("删除失败且回滚未完成，请保留备份并停止操作。"); } throw new Error("草稿清理失败，删除已回滚。"); }
  return next;
}

export function clearProjects(storage: StorageLike = browserStorage()): void {
  storage.removeItem(KEY);
}
