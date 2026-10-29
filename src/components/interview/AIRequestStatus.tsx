import { useEffect, useState } from "react";

/** Presentation only: cancellation and request/version ownership stay in App. */
export function AIRequestStatus({ starting, question, answer, cancelling, onCancel }: {
  starting: boolean; question?: string; answer?: string; cancelling: boolean; onCancel: () => void;
}) {
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [started]);
  return <section aria-label={starting ? "训练启动状态" : "AI请求等待状态"} className="mb-5 space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-5 text-sm text-slate-800">
    <p role="status" className="font-medium">{starting ? "正在准备训练" : "AI 正在分析回答"} · 已等待 {seconds} 秒</p>
    {seconds >= 20 && <p>模型仍在处理，你可以阅读当前内容，或取消后稍后重试。</p>}
    {question && <div><h3 className="font-medium">正在点评的问题</h3><p className="mt-1 whitespace-pre-wrap break-words leading-6">{question}</p></div>}
    {answer && <div><h3 className="font-medium">本次回答</h3><p className="mt-1 whitespace-pre-wrap break-words leading-6">{answer}</p></div>}
    <button onClick={onCancel} disabled={cancelling} className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium disabled:opacity-50">{cancelling ? "正在取消…" : "取消AI等待"}</button>
    <details className="text-xs text-slate-600"><summary className="cursor-pointer">等待与隐私说明</summary><p className="mt-2 leading-5">问题、回答和相关材料将发送至已配置的模型。取消或超时不自动重试；刷新会中断等待。取消连接不保证服务商停止推理或计费。</p></details>
  </section>;
}
