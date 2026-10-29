import type { InterviewProject, Question } from "./domain";

export interface AnalysisQuestionSelection { projectId: string; analysisId: string; rowIndex: number }

/** Read only our explicit new source/ID contract, never infer provenance from question wording. */
export function analysisPracticeOrigin(question?: Pick<Question, "id" | "sourceType">): AnalysisQuestionSelection | null {
  if (question?.sourceType !== "analysis_recommendation") return null;
  const match = /^analysis:([^:]+):([^:]+):(\d+)$/.exec(question.id);
  if (!match || !Number.isSafeInteger(Number(match[3]))) return null;
  try { return { projectId: decodeURIComponent(match[1]), analysisId: decodeURIComponent(match[2]), rowIndex: Number(match[3]) }; }
  catch { return null; }
}

/** Only new recommendation IDs carry this reference; existing question IDs are never rewritten. */
export function analysisPracticeQuestion(project: InterviewProject, selection: AnalysisQuestionSelection): Question {
  if (selection.projectId !== project.id) throw new Error("推荐题与当前岗位不一致，未开始训练。");
  const analysis = project.aiAnalyses?.find(item => item.id === selection.analysisId);
  const row = Number.isInteger(selection.rowIndex) && selection.rowIndex >= 0 ? analysis?.rows[selection.rowIndex] : undefined;
  if (!analysis || !row?.practiceQuestion.trim()) throw new Error("原分析或推荐题已不存在，未开始训练。");
  const knownBasis = analysis.basis?.projectId === project.id;
  return {
    id: `analysis:${encodeURIComponent(project.id)}:${encodeURIComponent(analysis.id)}:${selection.rowIndex}`,
    text: row.practiceQuestion,
    // Analysis rows contain no question-type metadata. Keep the existing conservative coaching path.
    category: "方案与业务", technical: false, sourceType: "analysis_recommendation",
    source: `AI 岗位分析推荐（非企业面试原题）；岗位：${project.jobTitle}（${project.id}）；分析：${analysis.id}；生成时间：${analysis.generatedAt}；第${selection.rowIndex + 1}行；${knownBasis ? "生成依据已记录，是否陈旧请查看原分析" : "分析依据未知，不推断为JD原文题、面经或本人经历"}`,
  };
}
