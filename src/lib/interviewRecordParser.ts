/**
 * 真实面试记录的结构化规则解析（P0 整改）。
 *
 * 目标：把用户粘贴的完整面经（Markdown 标题、A/B/C 分类、连续编号问题、
 * 面试官反馈）拆成独立候选题目，供人工核对后批量导入题库。
 *
 * 边界：
 * - 纯本地规则，不调用任何付费模型；解析结果全部进入人工预览，由用户确认。
 * - 不依据问号数量拆题：一道题可以包含背景、多个问号与连续追问。
 * - 无法确定的边界标记 needs_review，不强行拆分。
 */

export type ParsedCandidateKind = "question" | "feedback";

export interface ParsedRecordCandidate {
  /** 原始记录中的出现顺序（从 1 开始）。 */
  order: number;
  /** 清理 Markdown 标记后的题干；供编辑和最终保存。 */
  text: string;
  /** 所属分类标题（如「A. 个人背景与职业选择」）；未识别出分类时为空字符串。 */
  category: string;
  kind: ParsedCandidateKind;
  /** confirmed 表示解析边界可靠；needs_review 表示需要人工核对后才建议导入。 */
  confidence: "confirmed" | "needs_review";
  warnings: string[];
  /** 未清理 Markdown 标记前的原始片段，用于追溯。 */
  rawText: string;
}

export interface ParsedInterviewRecord {
  candidates: ParsedRecordCandidate[];
  /** 非题目性质的面试反馈/评价段落（kind 为 feedback 的候选不在此列，二者互不重叠）。 */
  feedback: string[];
  /** 识别出的分类标题，保持原文顺序。 */
  categories: string[];
  /** 解析整体提示（如检测到换行丢失）。 */
  warnings: string[];
}

/** Only explicit feedback headings enter the feedback area. Categories such as「复盘与发展规划」remain question categories. */
const FEEDBACK_HEADING = /^(?:面试官(?:整体)?(?:反馈|评价|点评|评语)|(?:整体)?面试(?:反馈|评价|点评|总结|结果)|面试建议|反馈与建议|结果与建议)$/;
const SKIPPED_SECTION_HEADING = /^(?:训练要求|训练说明|使用说明|导入说明|注意事项)$/;

/** 行首编号模式：1. / 1、 / 1） / 1) / Q1 / 问题1。 */
const NUMBERED_LINE = /^\s*(?:(\d{1,3})\s*[.、．)）]|[Qq]\s*(\d{1,3})\s*[.、．)）]?|问题\s*(\d{1,3})\s*[.、．)）]?)[\s、.．:：]*/;
/** 面经开头的元信息行（面试时间/岗位/形式等），既不是题目也不是反馈。 */
const META_LINE = /^\s*(面试时间|面试岗位|面试公司|面试轮次|面试形式|面试官|面试职位|应聘岗位|应聘职位|岗位方向|资料来源|题目性质|题目来源|训练要求|时间|地点|公司|岗位|轮次|形式)\s*[：:]/;
/** 分类标题：Markdown 标题、字母编号（A、/ A. / A)、中文序号（一、二、）。 */
const MD_HEADING = /^\s*#{1,6}\s*/;
const LETTER_HEADING = /^\s*([A-Za-z])\s*[、.．:：)）]\s*\S/;
const CN_HEADING = /^\s*[一二三四五六七八九十]+\s*[、.．:：]\s*\S/;
const HEADING_PREFIX = /^(?:[A-Za-z]|[一二三四五六七八九十]+)\s*[、.．:：)）]\s*/;

function headingCore(value: string) {
  return stripInlineMarkdown(value).trim().replace(HEADING_PREFIX, "").replace(/[：:]/g, "").trim();
}
function isFeedbackHeading(value: string) { return FEEDBACK_HEADING.test(headingCore(value)); }
function isSkippedSectionHeading(value: string) { return SKIPPED_SECTION_HEADING.test(headingCore(value)); }

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(MD_HEADING, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)\*(\S[^*]*?)\*/g, "$1$2")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*#{1,6}\s*/g, "");
}

/** 显示层清理：仅用于渲染，不改动任何已保存的题目、回答或训练记录。 */
export function displayQuestionText(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map(line => stripInlineMarkdown(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeLines(input: string): string[] {
  return input.replace(/\r\n?/g, "\n").split("\n");
}

/**
 * 复制粘贴可能把多道题连成同一段文本。若一行内出现两个及以上有序编号，
 * 按编号边界切分；编号顺序严格递增才算可靠，否则保留整行并交给人工核对。
 */
function splitLostLineBreaks(lines: string[]): { lines: string[]; lost: boolean } {
  const output: string[] = [];
  let lost = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { output.push(line); continue; }
    const marks = [...trimmed.matchAll(/(?:^|[。；;！？!?!\s])(\d{1,3})\s*[.、．)）]/g)].map(m => Number(m[1]));
    const strictlyIncreasing = marks.length >= 2 && marks.every((n, i) => i === 0 || n > marks[i - 1]);
    if (!strictlyIncreasing) { output.push(line); continue; }
    // 在「句末标点 + 编号」的边界切开；编号本身保留在段首。
    const pieces = trimmed.split(/(?<=[。；;！？!?!.])\s*(?=\d{1,3}\s*[.、．)）])/g).map(p => p.trim()).filter(Boolean);
    if (pieces.length < 2) { output.push(line); continue; }
    lost = true;
    output.push(...pieces);
  }
  return { lines: output, lost };
}

function newCandidate(order: number, kind: ParsedCandidateKind, category: string, rawText: string): ParsedRecordCandidate {
  return { order, kind, category, text: "", rawText, confidence: "confirmed", warnings: [] };
}

/** 追加一段内容到当前候选：题干内保留换行结构，但不再复制 Markdown 标记。 */
function appendSegment(candidate: ParsedRecordCandidate, segment: string, cleaned: string) {
  candidate.rawText += (candidate.rawText ? "\n" : "") + segment;
  candidate.text += (candidate.text ? "\n" : "") + cleaned;
}

export function parseInterviewRecord(input: string): ParsedInterviewRecord {
  const warnings: string[] = [];
  const source = input.replace(/\r\n?/g, "\n").trim();
  if (!source) return { candidates: [], feedback: [], categories: [], warnings: [] };

  const split = splitLostLineBreaks(normalizeLines(source));
  if (split.lost) warnings.push("检测到原文可能丢失换行（多道题连在同一段），已按编号边界尝试切分；请逐题核对题干完整性。");
  const lines = split.lines;

  const candidates: ParsedRecordCandidate[] = [];
  const feedback: string[] = [];
  const categories: string[] = [];
  let order = 0;
  let currentCategory = "";
  let feedbackSection = false;
  let skippedSection = false;
  let current: ParsedRecordCandidate | null = null;

  const pushCurrent = () => { if (current) { if (current.text.trim()) candidates.push(current); current = null; } };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (!trimmed) { pushCurrent(); continue; }

    const cleaned = stripInlineMarkdown(trimmed).trim();
    const headingText = trimmed.replace(MD_HEADING, "").trim();

    if (MD_HEADING.test(trimmed) || LETTER_HEADING.test(trimmed) || CN_HEADING.test(trimmed)) {
      pushCurrent();
      feedbackSection = isFeedbackHeading(headingText) && !NUMBERED_LINE.test(headingText);
      skippedSection = !feedbackSection && isSkippedSectionHeading(headingText);
      currentCategory = feedbackSection || skippedSection ? "" : cleaned;
      if (!feedbackSection && !skippedSection && cleaned && !categories.includes(cleaned)) categories.push(cleaned);
      continue;
    }

    const numbered = NUMBERED_LINE.exec(trimmed);
    if (numbered) {
      pushCurrent();
      order += 1;
      current = newCandidate(order, "question", currentCategory, trimmed);
      current.text = cleaned.replace(NUMBERED_LINE, "").trim();
      // 编号本身保留在 text 中由编辑者决定；这里去掉编号避免题干出现「1.」残留。
      if (feedbackSection) { current.kind = "question"; current.warnings.push("该编号内容出现在反馈章节，请确认它是否为面试中被问到的问题。"); current.confidence = "needs_review"; }
      continue;
    }

    if (feedbackSection) { pushCurrent(); feedback.push(cleaned); continue; }
    if (skippedSection) continue;

    if (!current && META_LINE.test(cleaned) && cleaned.length <= 60) continue;

    if (!current) {
      // 无编号、无当前题：可能是面经开头的说明性文字。标记为待核对候选，不强行判断。
      order += 1;
      current = newCandidate(order, "question", currentCategory, trimmed);
      current.text = cleaned;
      current.confidence = "needs_review";
      current.warnings.push("未能识别编号边界；请人工核对本段是否为一道完整题目，可编辑或取消选择。");
      continue;
    }

    appendSegment(current, trimmed, cleaned);
  }
  pushCurrent();

  return { candidates, feedback, categories, warnings };
}
