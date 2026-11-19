import type { InterviewProject, InterviewSession, Report } from "./domain";

export interface InterviewExportData { project: InterviewProject | null; session: InterviewSession; report: Report | null; }
export interface QuestionExportData { projectName: string; company: string; question: string; category?: string; source: string; originalAnswer: string; suggestion: string; finalAnswer: string; }
export interface QuestionExportOptions { includeOriginalAnswer: boolean; includeSuggestion: boolean; includeFinalAnswer: boolean; }
export interface TrainingExportOptions { includeOriginalAnswers: boolean; includeRevisions: boolean; includeFinalAnswers: boolean; includeCoachFeedback: boolean; includeReport: boolean; }

const defaultQuestionOptions: QuestionExportOptions = { includeOriginalAnswer: true, includeSuggestion: true, includeFinalAnswer: true };
const defaultTrainingOptions: TrainingExportOptions = { includeOriginalAnswers: true, includeRevisions: true, includeFinalAnswers: true, includeCoachFeedback: true, includeReport: true };

function xml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function linesForText(value: string, width = 38) {
  const result: string[] = [];
  for (const raw of value.replace(/\r/g, "").split("\n")) {
    if (!raw) { result.push(""); continue; }
    for (let start = 0; start < raw.length; start += width) result.push(raw.slice(start, start + width));
  }
  return result;
}

function feedbackLines(turn: InterviewSession["turns"][number]) {
  const reviews = [...(turn.coachReviews ?? [])];
  if (turn.aiCoach && !reviews.some(review => review.feedback.generatedAt === turn.aiCoach?.generatedAt)) {
    reviews.unshift({ answerVersion: 1, answer: turn.answer, feedback: turn.aiCoach });
  }
  return reviews.flatMap(review => {
    const feedback = review.feedback;
    return [
      `AI 教练反馈（回答版本 ${review.answerVersion}；参考建议，不是本人已确认事实）`,
      ...(feedback.strengths.length ? ["优势：", ...feedback.strengths.map(item => `- ${item}`)] : []),
      ...(feedback.issues.length ? ["待改进：", ...feedback.issues.map(item => `- ${item}`)] : []),
      ...(feedback.factRisks.length ? ["事实边界提醒：", ...feedback.factRisks.map(item => `- ${item}`)] : []),
      ...(feedback.suggestions.length ? ["改进建议：", ...feedback.suggestions.map(item => `- ${item}`)] : []),
      ...(feedback.answerStructure ? ["回答结构建议：", feedback.answerStructure] : []),
      ...(feedback.studyTopics.length ? ["待核对知识：", ...feedback.studyTopics.map(item => `- ${item}`)] : []),
      ...(feedback.optimizedExample ? ["AI 改写示例（未确认）：", feedback.optimizedExample] : []),
      ...(feedback.referenceUncertainties?.length ? ["参考依据不确定项：", ...feedback.referenceUncertainties.map(item => `- ${item}`)] : []),
      ...(feedback.referenceBasis?.length ? ["引用的已确认资料线索：", ...feedback.referenceBasis.map(item => `- ${item.title}：${item.quote}`)] : []),
      "",
    ];
  });
}

export function interviewExportLines({ project, session, report }: InterviewExportData, options: TrainingExportOptions = defaultTrainingOptions) {
  const lines = [
    `AI 面试通｜${project?.jobTitle || session.preparation.job.title || "模拟面试"}准备记录`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    `公司：${project?.company || "未填写"}`,
    "说明：本文件只汇总已保存的训练内容，不是事实核验、专业评审或录用预测。AI 反馈仅供参考。",
    "",
  ];
  session.turns.forEach((turn, index) => {
    const question = session.questions.find(item => item.id === turn.questionId) ?? session.preparation.questions.find(item => item.id === turn.questionId);
    lines.push(`第 ${index + 1} 题｜${turn.question}`, `分类：${question?.category ?? "未分类"}`, `来源：${question?.source || "未记录"}`);
    if (options.includeOriginalAnswers) lines.push("原回答：", turn.answer || "（未填写）");
    if (options.includeRevisions) turn.revisions?.forEach((revision, revisionIndex) => lines.push(`重答 ${revisionIndex + 1}：`, revision.answer || "（未填写）"));
    if (options.includeFinalAnswers) {
      lines.push(turn.finalAnswer?.trim() ? "本人确认的最终答案（用户手动确认）：" : "最终确认答案：未保存");
      if (turn.finalAnswer?.trim()) lines.push(turn.finalAnswer.trim());
    }
    if (options.includeCoachFeedback) lines.push(...feedbackLines(turn));
    if (turn.score.referenceAnswer) lines.push("参考回答思路（本地提示，需核对，不是本人事实）：", turn.score.referenceAnswer);
    lines.push("");
  });
  if (report && options.includeReport) {
    lines.push("复盘报告（基于各轮最新回答的本地规则整理）", `整体评价：${report.overall}`);
    ([["已提供的回答线索", report.strengths], ["风险问题", report.risks], ["待补充的回答材料", report.gaps], ["仍需人工核对", report.studyTopics], ["下一轮训练重点", report.nextFocus]] as Array<[string, string[]]>).forEach(([title, items]) => lines.push(title, ...items.map(item => `- ${item}`), ""));
  }
  return lines;
}

function questionLines(data: QuestionExportData, index: number, options: QuestionExportOptions) {
  const title = `第 ${index + 1} 题｜${data.category ? `${data.category}｜` : ""}${data.question}`;
  const lines = [
    title,
    `岗位：${data.projectName || "未关联岗位"}`,
    `公司：${data.company || "未填写"}`,
    `来源：${data.source || "未记录"}`,
  ];
  if (options.includeOriginalAnswer) lines.push("原回答：", data.originalAnswer || "（未填写）");
  if (options.includeSuggestion) lines.push("参考答案 / AI 改进建议（需本人核对，不代表本人已确认事实）：", data.suggestion || "（未保存）");
  if (options.includeFinalAnswer) {
    lines.push(data.finalAnswer.trim() ? "最终确认答案（由用户手动确认）：" : "最终确认答案：未保存");
    if (data.finalAnswer.trim()) lines.push(data.finalAnswer.trim());
  }
  return [...lines, ""];
}

function questionDocumentLines(title: string, data: QuestionExportData[], options: QuestionExportOptions) {
  if (!data.length) throw new Error("请至少选择一题后再导出。");
  return [
    `AI 面试通｜${title}`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "说明：只汇总当前勾选的既有题目。AI 参考答案 / 改进建议不是本人已确认事实；最终确认答案仅指用户手动保存的版本。",
    "",
    ...data.flatMap((item, index) => questionLines(item, index, options)),
  ];
}

export function questionExportLines(data: QuestionExportData, options: QuestionExportOptions = defaultQuestionOptions) {
  return questionDocumentLines(`${data.projectName || "岗位"}题目准备记录`, [data], options);
}

export function questionSetExportLines(data: QuestionExportData[], options: QuestionExportOptions = defaultQuestionOptions) {
  return questionDocumentLines("面试题准备资料", data, options);
}

export function trainingSetExportLines(data: InterviewExportData[], options: TrainingExportOptions = defaultTrainingOptions) {
  if (!data.length) throw new Error("请至少选择一条训练记录后再导出。");
  return data.flatMap((record, index) => [...(index ? ["", ""] : []), ...interviewExportLines(record, options)]);
}
function crc32(value: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of value) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value: number) { return Uint8Array.of(value & 255, (value >>> 8) & 255); }
function u32(value: number) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
function join(parts: Uint8Array[]) { const size = parts.reduce((total, item) => total + item.length, 0); const output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }

function zip(files: Array<[string, string]>) {
  const encoder = new TextEncoder(); const locals: Uint8Array[] = []; const directories: Uint8Array[] = []; let offset = 0;
  for (const [name, content] of files) {
    const fileName = encoder.encode(name); const payload = encoder.encode(content); const crc = crc32(payload);
    const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(payload.length), u32(payload.length), u16(fileName.length), u16(0), fileName, payload]);
    locals.push(local);
    directories.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(payload.length), u32(payload.length), u16(fileName.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), fileName]));
    offset += local.length;
  }
  const directory = join(directories);
  return join([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(directory.length), u32(offset), u16(0)]);
}

function docxFromLines(lines: string[]) {
  const paragraphStyle = (line: string, index: number) => index === 0 ? "Title"
    : /^AI 面试通｜|^第 \d+ 题｜|^复盘报告/.test(line) ? "Heading1"
      : /^(导出时间|公司|岗位|分类|来源|原回答|重答 \d+|最终确认答案|参考答案|参考回答思路|改进建议|参考答案 \/ AI 改进建议|AI 教练反馈|优势：|待改进：|事实边界提醒：|回答结构建议：|待核对知识：|AI 改写示例|引用的已确认资料线索|已提供的回答线索|风险问题|待补充的回答材料|仍需人工核对|下一轮训练重点|整体评价)：?/.test(line) ? "Heading2" : null;
  const paragraphs = lines.map((line, index) => {
    const style = paragraphStyle(line, index);
    return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`;
  }).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style></w:styles>`;
  return new Blob([zip([
    ["[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/></Types>"],
    ["_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"],
    ["word/_rels/document.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>"],
    ["word/document.xml", document],
    ["word/styles.xml", styles],
  ])], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export function buildDocx(data: InterviewExportData, options?: TrainingExportOptions) { return docxFromLines(interviewExportLines(data, options)); }
export function buildQuestionDocx(data: QuestionExportData, options?: QuestionExportOptions) { return docxFromLines(questionExportLines(data, options)); }
export function buildQuestionSetDocx(data: QuestionExportData[], options?: QuestionExportOptions) { return docxFromLines(questionSetExportLines(data, options)); }
export function buildTrainingRecordsDocx(data: InterviewExportData[], options?: TrainingExportOptions) { return docxFromLines(trainingSetExportLines(data, options)); }

function utf16Hex(value: string) { return `FEFF${Array.from(value).map(char => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}`; }
function pdfFromLines(lines: string[]) {
  const pages: Array<Array<{ text: string; size: number; y: number }>> = [[]];
  const top = 790, bottom = 52;
  let y = top;
  lines.forEach((line, index) => {
    const size = index === 0 ? 16 : /^AI 面试通｜|^第 \d+ 题｜|^复盘报告/.test(line) ? 13 : 11;
    for (const text of linesForText(line, Math.max(18, Math.floor(470 / size)))) {
      const height = size + 5;
      if (y - height < bottom) { pages.push([]); y = top; }
      pages[pages.length - 1].push({ text, size, y });
      y -= height;
    }
  });
  const streams = pages.map(page => page.map(line => `BT\n/F1 ${line.size} Tf\n1 0 0 1 52 ${line.y} Tm\n<${utf16Hex(line.text)}> Tj\nET`).join("\n"));
  const bodies: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>] >>"];
  streams.forEach((stream, index) => { const contentId = 5 + index * 2; bodies.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`, `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`); });
  const encoder = new TextEncoder(); const chunks: string[] = ["%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n"]; const offsets = [0]; let position = encoder.encode(chunks[0]).length;
  bodies.forEach((body, index) => { offsets.push(position); const object = `${index + 1} 0 obj\n${body}\nendobj\n`; chunks.push(object); position += encoder.encode(object).length; });
  const xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF`;
  return new Blob([chunks.join(""), xref], { type: "application/pdf" });
}

export function buildPdf(data: InterviewExportData, options?: TrainingExportOptions) { return pdfFromLines(interviewExportLines(data, options)); }
export function buildQuestionPdf(data: QuestionExportData, options?: QuestionExportOptions) { return pdfFromLines(questionExportLines(data, options)); }
export function buildQuestionSetPdf(data: QuestionExportData[], options?: QuestionExportOptions) { return pdfFromLines(questionSetExportLines(data, options)); }
export function buildTrainingRecordsPdf(data: InterviewExportData[], options?: TrainingExportOptions) { return pdfFromLines(trainingSetExportLines(data, options)); }

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
