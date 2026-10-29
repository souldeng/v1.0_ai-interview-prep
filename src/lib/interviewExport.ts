import type { InterviewProject, InterviewSession, Report } from "./domain";

export interface InterviewExportData { project: InterviewProject | null; session: InterviewSession; report: Report | null; }
export interface QuestionExportData { projectName: string; company: string; question: string; source: string; originalAnswer: string; suggestion: string; finalAnswer: string; }

function xml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function linesForText(value: string, width = 38) {
  const result: string[] = [];
  for (const raw of value.replace(/\r/g, "").split("\n")) {
    if (!raw) { result.push(""); continue; }
    for (let start = 0; start < raw.length; start += width) result.push(raw.slice(start, start + width));
  }
  return result;
}

export function interviewExportLines({ project, session, report }: InterviewExportData) {
  const lines = [
    `AI 面试通｜${project?.jobTitle || session.preparation.job.title || "模拟面试"}准备记录`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    `公司：${project?.company || "未填写"}`,
    "说明：本文件保存用户原回答、用户最终确认答案和本地规则复盘。它不是事实核验、专业评审或录用预测。",
    "",
  ];
  session.turns.forEach((turn, index) => {
    lines.push(`第 ${index + 1} 题｜${turn.question}`, "原回答：", turn.answer || "（未填写）");
    if (turn.revisions?.length) turn.revisions.forEach((revision, revisionIndex) => lines.push(`重答 ${revisionIndex + 1}：`, revision.answer));
    lines.push(turn.finalAnswer?.trim() ? "最终确认答案（由用户手动确认）：" : "最终确认答案：未保存");
    if (turn.finalAnswer?.trim()) lines.push(turn.finalAnswer.trim());
    lines.push("");
  });
  if (report) {
    lines.push("复盘报告（基于各轮最新回答的本地规则整理）", `整体评价：${report.overall}`);
    ([["已提供的回答线索", report.strengths], ["风险问题", report.risks], ["待补充的回答材料", report.gaps], ["仍需人工核对", report.studyTopics], ["下一轮训练重点", report.nextFocus]] as Array<[string, string[]]>).forEach(([title, items]) => lines.push(title, ...items.map(item => `- ${item}`), ""));
  }
  return lines;
}

export function questionExportLines(data: QuestionExportData) {
  return [
    `AI 面试通｜${data.projectName || "岗位"}题目准备记录`,
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    `公司：${data.company || "未填写"}`,
    "说明：本文件只汇总当前选中的既有题目与答案。最终确认答案仅指用户手动保存的版本，不代表事实核验或录用预测。",
    "",
    `题目：${data.question}`,
    `来源：${data.source || "未记录"}`,
    "原回答：", data.originalAnswer || "（未填写）",
    "改进建议（如存在，来自既有训练记录）：", data.suggestion || "（未保存）",
    data.finalAnswer.trim() ? "最终确认答案（由用户手动确认）：" : "最终确认答案：未保存",
    ...(data.finalAnswer.trim() ? [data.finalAnswer.trim()] : []),
  ];
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
  const paragraphs = lines.map(line => `<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return new Blob([zip([
    ["[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"],
    ["_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"],
    ["word/document.xml", document],
  ])], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

export function buildDocx(data: InterviewExportData) { return docxFromLines(interviewExportLines(data)); }
export function buildQuestionDocx(data: QuestionExportData) { return docxFromLines(questionExportLines(data)); }

function utf16Hex(value: string) { return `FEFF${Array.from(value).map(char => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}`; }
function pdfFromLines(lines: string[]) {
  const wrapped = lines.flatMap(line => linesForText(line));
  const pageLines = 44; const pages = Array.from({ length: Math.max(1, Math.ceil(wrapped.length / pageLines)) }, (_, index) => wrapped.slice(index * pageLines, (index + 1) * pageLines));
  const streams = pages.map(lines => `BT\n/F1 11 Tf\n${lines.map((line, index) => `1 0 0 1 52 ${790 - index * 16} Tm\n<${utf16Hex(line)}> Tj`).join("\n")}\nET`);
  const bodies: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>] >>"];
  streams.forEach((stream, index) => { const contentId = 5 + index * 2; bodies.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`, `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`); });
  const encoder = new TextEncoder(); const chunks: string[] = ["%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n"]; const offsets = [0]; let position = encoder.encode(chunks[0]).length;
  bodies.forEach((body, index) => { offsets.push(position); const object = `${index + 1} 0 obj\n${body}\nendobj\n`; chunks.push(object); position += encoder.encode(object).length; });
  const xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${position}\n%%EOF`;
  return new Blob([chunks.join(""), xref], { type: "application/pdf" });
}

export function buildPdf(data: InterviewExportData) { return pdfFromLines(interviewExportLines(data)); }
export function buildQuestionPdf(data: QuestionExportData) { return pdfFromLines(questionExportLines(data)); }

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
