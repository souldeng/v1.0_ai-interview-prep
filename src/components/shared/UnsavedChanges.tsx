import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

type Change = { label: string; save: () => string | null | Promise<string | null>; discard: () => void };
const Safety = createContext({ navigate: (action: () => void) => action(), register: (_id: string, _change: Change | null) => {} });

/** One guard for page, tab, question and filter changes. It never confirms facts on its own. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const changes = useRef(new Map<string, Change>());
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const register = useCallback((id: string, change: Change | null) => {
    if (change) changes.current.set(id, change); else changes.current.delete(id);
    setDirty(changes.current.size > 0);
  }, []);
  const navigate = useCallback((action: () => void) => {
    if (!changes.current.size) return action();
    setNotice(""); setPending(() => action);
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function leave(save: boolean) {
    if (!pending || saving) return;
    setSaving(true); setNotice("");
    try {
      for (const [id] of [...changes.current]) {
        const change = changes.current.get(id); if (!change) continue;
        if (save) {
          // Commit each saved editor before reading the next one's latest callback.
          let result: ReturnType<Change["save"]> = null;
          flushSync(() => { result = change.save(); });
          const error = await result; if (error) { setNotice(error); return; }
        }
        else change.discard();
        flushSync(() => register(id, null));
      }
      const action = pending; setPending(null); action();
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败，修改仍保留，请留在当前页重试。"); }
    finally { setSaving(false); }
  }
  const value = useMemo(() => ({ navigate, register }), [navigate, register]);
  return <Safety.Provider value={value}>{children}<Dialog open={Boolean(pending)} onOpenChange={open => { if (!open && !saving) setPending(null); }}>
    <DialogContent showCloseButton={!saving}><DialogHeader><DialogTitle>未保存的修改</DialogTitle><DialogDescription>当前有尚未保存的资料或答案。保存成功才会离开；放弃只撤销本次修改，不删除已保存内容。</DialogDescription></DialogHeader>
      {notice && <p role="alert" className="text-sm text-red-700">{notice}</p>}
      <DialogFooter><button disabled={saving} onClick={() => void leave(true)} className="rounded-lg bg-blue-700 px-4 py-2 text-sm text-white">{saving ? "正在保存…" : "保存后离开"}</button><button disabled={saving} onClick={() => void leave(false)} className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-700">放弃修改</button><button disabled={saving} onClick={() => setPending(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700">留在当前页</button></DialogFooter>
    </DialogContent>
  </Dialog></Safety.Provider>;
}

export function useSafeNavigation() { return useContext(Safety).navigate; }
export function useUnsavedChanges(id: string, dirty: boolean, change: Change) {
  const { register } = useContext(Safety);
  useLayoutEffect(() => { register(id, dirty ? change : null); });
  useEffect(() => () => register(id, null), [id, register]);
}
