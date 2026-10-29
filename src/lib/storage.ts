import type { InterviewSession } from "./domain";
import { validSession } from "./validation";
const KEY = "ai-interview-prep-history-v1"; const MAX_ITEMS = 20; const MAX_BYTES = 2 * 1024 * 1024;
export function loadHistory(): InterviewSession[] { try { const raw = localStorage.getItem(KEY); const data = raw ? JSON.parse(raw) : []; return Array.isArray(data) ? data.filter(validSession) : []; } catch { return []; } }
export function saveHistory(session: InterviewSession): void { if (!validSession(session)) throw new Error("训练记录结构无效，未写入。"); const original = JSON.parse(localStorage.getItem(KEY) || "[]"); if (!Array.isArray(original) || !original.every(validSession)) throw new Error("已有训练记录损坏，请先备份，避免覆盖。"); const next = [session, ...original.filter(item => item.id !== session.id)]; if (next.length > MAX_ITEMS) throw new Error("训练记录达到 20 条上限，请先备份并整理旧记录，不会自动删除。"); const encoded = JSON.stringify(next); if (new Blob([encoded]).size > MAX_BYTES) throw new Error("历史记录超过约 2MB 的本地容量限制，请删除旧记录后重试。"); localStorage.setItem(KEY, encoded); }
export function deleteHistory(id: string): void {
  const original = JSON.parse(localStorage.getItem(KEY) || "[]");
  if (!Array.isArray(original) || !original.every(validSession)) throw new Error("已有训练记录损坏，请先备份，未执行删除。");
  localStorage.setItem(KEY, JSON.stringify(original.filter((item: InterviewSession) => item.id !== id)));
}
export function clearHistory(): void { localStorage.removeItem(KEY); }
