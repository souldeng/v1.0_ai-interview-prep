import { useEffect, useState } from "react";

/** Presentation only: cancellation and request/version ownership stay in App. */
export function AIRequestStatus({ starting, cancelling, onCancel }: {
  starting: boolean; cancelling: boolean; onCancel: () => void;
}) {
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [started]);
  return <section aria-label={starting ? "训练启动状态" : "AI请求等待状态"} className="mb-5 space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-5 text-base text-slate-800">
    <p role="status" className="font-medium">{starting ? "正在准备训练" : "AI 正在分析回答"} · 已等待 {seconds} 秒</p>
    {seconds >= 20 && <p>模型仍在处理，你可以阅读当前内容，或取消后稍后重试。</p>}
    <button onClick={onCancel} disabled={cancelling} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-base font-medium hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed">{cancelling ? "正在取消…" : "取消AI等待"}</button>
  </section>;
}
