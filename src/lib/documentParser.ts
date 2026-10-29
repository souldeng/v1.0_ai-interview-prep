import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { ResumeMaterial } from "./domain";
import { isOcrImage, recognizeScreenshot, validateOcrImage } from "./localOcr";

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
type ExtractedResume = { text: string; parser: ResumeMaterial["parser"]; warning?: string };
export const pdfExtractionNotice = "PDF 仅提取可读取的文字层，可能只有页眉等部分文字，不保证正文完整。请打开原件逐页核对并补充；图片或扫描正文不会自动识别，可将缺失页面截图后使用图片 OCR，或手工录入。";

// Vite emits this worker as a same-origin asset in both dev and production.
// Without this explicit URL, PDF.js falls back to an undefined worker path.
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function ensureReadableFile(file: File) {
  if (file.size === 0) throw new Error("文件为空，未保存任何资料。");
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error("文件超过 8MB 的本地解析上限，未保存任何资料。");
}

function decodeXml(value: string) {
  const document = new DOMParser().parseFromString(`<root>${value}</root>`, "text/xml");
  return document.documentElement.textContent ?? "";
}

async function unzipEntry(bytes: Uint8Array, entryName: string): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset++) if (view.getUint32(offset, true) === 0x06054b50) end = offset;
  if (end < 0) throw new Error("Word 文件结构无效，未保存任何资料。");
  const directoryOffset = view.getUint32(end + 16, true);
  const entries = view.getUint16(end + 10, true);
  let cursor = directoryOffset;
  const decoder = new TextDecoder();
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name !== entryName) continue;
    if (uncompressedSize > MAX_DOCUMENT_BYTES) throw new Error("Word 正文解压后超过 8MB 的安全上限，未保存任何资料。");
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) break;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const source = bytes.slice(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
    if (method === 0) return source;
    if (method === 8 && "DecompressionStream" in window) {
      const stream = new Blob([source]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error("当前浏览器无法解压此 Word 文件，请改用最新版 Chrome 或 Edge，或粘贴文本。");
  }
  throw new Error("Word 文件中未找到正文，未保存任何资料。");
}

async function extractDocx(file: File) {
  const xml = new TextDecoder().decode(await unzipEntry(new Uint8Array(await file.arrayBuffer()), "word/document.xml"));
  const withBreaks = xml.replace(/<w:tab\b[^/>]*\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<\/w:tr>/g, "\n");
  const text = decodeXml(withBreaks.replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("未从 Word 文件读取到可用文字。扫描版文档请改为粘贴文本，或先人工核对。");
  return text;
}

async function extractPdf(file: File) {
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: `${import.meta.env.BASE_URL}pdf-cmaps/`, cMapPacked: true });
  try {
    const pdf = await loadingTask.promise;
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      let page = "";
      for (const item of content.items) if ("str" in item) page += `${item.str}${item.hasEOL ? "\n" : " "}`;
      if (page.trim()) pages.push(page.trim());
    }
    const text = pages.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) throw new Error("未从 PDF 读取到可用文字。它可能是扫描件图片；请人工核对后粘贴文字。");
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|密码/i.test(message)) throw new Error("PDF 受密码保护，无法在浏览器本地提取文字；请提供可读取版本或粘贴文字。");
    if (message.startsWith("未从 PDF")) throw error;
    throw new Error("无法读取 PDF 的文字层。扫描版、损坏或受保护 PDF 不支持；请人工核对后粘贴文字。");
  } finally { await loadingTask.destroy(); }
}

export async function extractResumeText(file: File, onOcrProgress?: Parameters<typeof recognizeScreenshot>[1]): Promise<ExtractedResume> {
  // Images have their own byte and decoded-pixel limits; documents retain the 8MB guard.
  if (isOcrImage(file)) return { text: await recognizeScreenshot(file, onOcrProgress || (() => undefined)), parser: "ocr" };
  ensureReadableFile(file);
  if (file.type === "text/plain" || file.type === "text/markdown" || /\.(txt|md|markdown)$/i.test(file.name)) return { text: await file.text(), parser: "plain-text" };
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return { text: await extractPdf(file), parser: "pdf", warning: pdfExtractionNotice };
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name)) return { text: await extractDocx(file), parser: "docx" };
  if (file.type.startsWith("image/") || /\.(png|jpe?g)$/i.test(file.name)) { validateOcrImage(file); return { text: await recognizeScreenshot(file, onOcrProgress || (() => undefined)), parser: "ocr" }; }
  throw new Error("当前支持 TXT、Markdown、DOCX、含文字层的 PDF 和 PNG/JPG 截图。");
}
