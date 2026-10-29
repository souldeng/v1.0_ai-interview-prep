import { useEffect, useRef, useState } from "react";

interface RecognitionEvent { results: ArrayLike<{ 0: { transcript: string } }> }
interface RecognitionError { error: string }
interface RecognitionInstance {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionError) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}
type RecognitionWindow = Window & { SpeechRecognition?: new () => RecognitionInstance; webkitSpeechRecognition?: new () => RecognitionInstance };

export function VoicePracticeControls({ questionId, questionText, answer, onAnswer, disabled }: {
  questionId: string; questionText: string; answer: string; onAnswer: (text: string) => void; disabled: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState("");
  const recognition = useRef<RecognitionInstance | null>(null);
  const latestAnswer = useRef(answer);
  latestAnswer.current = answer;
  useEffect(() => () => { recognition.current?.stop(); recognition.current = null; window.speechSynthesis?.cancel(); }, [questionId]);
  const stopListening = () => { recognition.current?.stop(); recognition.current = null; setListening(false); };
  const startListening = () => {
    const host = window as RecognitionWindow;
    const Constructor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
    if (!Constructor) return setNotice("此浏览器不支持语音识别。可使用系统键盘的语音输入，文字输入始终可用。");
    try {
      const current = new Constructor(); current.lang = "zh-CN"; current.interimResults = false; current.continuous = false;
      current.onresult = event => { const text = Array.from(event.results).map(result => result[0]?.transcript ?? "").join(" ").trim(); if (text) onAnswer([latestAnswer.current.trim(), text].filter(Boolean).join("\n")); setNotice(text ? "识别文字已插入回答框，请核对后手动提交。" : "未识别到文字，请重试或键入回答。"); };
      current.onerror = event => { setNotice(event.error === "not-allowed" || event.error === "service-not-allowed" ? "麦克风权限未获允许，请在浏览器设置中授权或继续键入。" : `语音识别失败（${event.error}），已保留文字回答。`); setListening(false); };
      current.onend = () => { setListening(false); recognition.current = null; };
      recognition.current = current; current.start(); setListening(true); setNotice("正在等待语音识别；结果会进入回答框，不会自动提交。");
    } catch { setListening(false); setNotice("无法启动麦克风；请检查权限或继续键入回答。"); }
  };
  const readQuestion = () => {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return setNotice("当前设备没有可用的题目朗读功能；文字题目仍可正常阅读。");
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(questionText); utterance.lang = "zh-CN"; utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false); utterance.onerror = () => { setSpeaking(false); setNotice("题目朗读失败，请直接阅读文字题目。"); };
    window.speechSynthesis.speak(utterance); setSpeaking(true);
  };
  return <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={disabled} onClick={listening ? stopListening : startListening} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50">{listening ? "停止语音输入" : "🎤 语音输入"}</button><button type="button" onClick={speaking ? () => { window.speechSynthesis?.cancel(); setSpeaking(false); } : readQuestion} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">{speaking ? "停止朗读" : "🔊 朗读问题"}</button>{notice && <p role="status" className="w-full text-xs leading-5 text-slate-600">{notice}</p>}</div>;
}
