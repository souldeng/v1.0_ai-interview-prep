import type { InterviewSession } from "../../lib/domain";
import { buildDocx, buildPdf, download } from "../../lib/interviewExport";
import { AnswerReview as ExistingAnswerReview, type AnswerReviewProps } from "./AnswerReview";

function ExportPanel({ session }: { session: InterviewSession }) {
  return <details className="mx-auto mt-4 max-w-5xl rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-sm font-medium text-slate-700">导出准备记录</summary><div className="mt-3 flex flex-wrap gap-3"><button onClick={() => download(buildDocx({ project: null, session, report: session.report ?? null }), "AI面试通-准备记录.docx")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">导出 DOCX</button><button onClick={() => download(buildPdf({ project: null, session, report: session.report ?? null }), "AI面试通-准备记录.pdf")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">导出 PDF</button></div></details>;
}

export function AnswerReview(props: AnswerReviewProps) {
  return <><ExistingAnswerReview {...props}/><ExportPanel session={props.session}/></>;
}
