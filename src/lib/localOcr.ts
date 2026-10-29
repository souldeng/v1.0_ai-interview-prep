export const MAX_OCR_IMAGE_BYTES = 10 * 1024 * 1024;
// Byte size alone cannot bound decoded memory. Check headers before allocating a bitmap.
const MAX_IMAGE_PIXELS = 24_000_000;
const MAX_IMAGE_WIDTH = 8192;
const MAX_IMAGE_HEIGHT = 60_000;
const TILE_PIXELS = 3_000_000;
const TILE_HEIGHT = 4096;
const TILE_OVERLAP = 96;
export type OcrProgress = { status: string; progress: number };
export const isOcrImage = (file: Pick<File,"name"|"type">) => ["image/png","image/jpeg"].includes(file.type) || /\.(png|jpe?g)$/i.test(file.name);

export function validateOcrImage(file: Pick<File, "type" | "size" | "name">) {
  if (!isOcrImage(file)) throw new Error("仅支持 PNG、JPG 或 JPEG 截图。");
  if (!file.size) throw new Error("图片为空，未开始识别。");
  if (file.size > MAX_OCR_IMAGE_BYTES) throw new Error("图片超过 10MB 上传上限，请压缩或裁剪后重试。");
}

function checkDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error("图片尺寸无效，请重新导出 PNG/JPEG。");
  if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT || width * height > MAX_IMAGE_PIXELS) throw new Error(`图片尺寸 ${width}×${height} 过大：本地 OCR 最多2400万像素，宽8192、高60000像素。请按原分辨率裁剪为多张后重试，避免浏览器内存不足。`);
}
async function imageSize(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && view.getUint32(12) === 0x49484452) {
    return { width:view.getUint32(16), height:view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (sof.has(marker) && length >= 8) return { width:view.getUint16(offset+5), height:view.getUint16(offset+3) };
      offset += length;
    }
  }
  throw new Error("无法读取 PNG/JPEG 图片头，图片可能损坏或格式不符；请重新导出或裁剪后重试。");
}
/** Shared by OCR and original previews so previewing cannot bypass the decoded-memory guard. */
export async function inspectOcrImage(file:File) {
  validateOcrImage(file);const size=await imageSize(file);checkDimensions(size.width,size.height);return size;
}
function appendSegment(previous: string, next: string) {
  if (!previous) return next;
  if (!next) return previous;
  const before=previous.split("\n"),after=next.split("\n");let overlap=0;
  // Only remove exact adjacent boundary lines, never globally deduplicate the source.
  for (let n=1;n<=Math.min(6,before.length,after.length);n++) if (before.slice(-n).every((line,i)=>line.trim()===after[i].trim())) overlap=n;
  return [...before,...after.slice(overlap)].join("\n");
}

export async function recognizeScreenshot(file: File, onProgress: (progress: OcrProgress) => void) {
  validateOcrImage(file);
  onProgress({status:"正在检查图片尺寸…",progress:0});
  const size=await inspectOcrImage(file);
  const needsPreparation=file.size>=2*1024*1024 || size.width*size.height>TILE_PIXELS || size.height>TILE_HEIGHT;
  let bitmap:ImageBitmap|null=null,canvas:HTMLCanvasElement|null=null;
  try {
    if (needsPreparation) {
      onProgress({status:"正在准备图片，保留原分辨率与原件…",progress:1});
      if (typeof createImageBitmap !== "function") throw new Error("当前浏览器不支持安全的大图预处理，请使用新版Chrome或Edge，或裁剪后重试。");
      try { bitmap=await createImageBitmap(file); } catch { throw new Error("图片无法解码，请保留原图，重新导出 PNG/JPEG 后重试。"); }
      checkDimensions(bitmap.width,bitmap.height);
      canvas=document.createElement("canvas");
    }
    const width=bitmap?.width ?? size.width,height=bitmap?.height ?? size.height;
    const tileHeight=Math.min(TILE_HEIGHT,Math.floor(TILE_PIXELS/width));
    const count=bitmap && height>tileHeight ? 1+Math.ceil((height-tileHeight)/(tileHeight-TILE_OVERLAP)) : 1;
    let part=0,loading=true;
    const { createWorker }=await import("tesseract.js");
    onProgress({status:"正在加载本地 OCR 引擎与中英文语言数据…",progress:2});
    const worker=await createWorker(["chi_sim","eng"],1,{
      // Promise rejection is handled below; do not let Tesseract throw a second global error.
      errorHandler:()=>{},
      logger:message=>onProgress({status:loading?`正在加载OCR资源：${message.status}`:`正在识别第${part+1}/${count}段：${message.status}`,progress:loading?Math.round(Math.max(0,Math.min(1,message.progress || 0))*5):Math.round(5+90*(part+Math.max(0,Math.min(1,message.progress || 0)))/count)}),
    });
    loading=false;
    try {
      let text="",top=0;
      for (part=0;part<count;part++) {
        let input:File|Blob=file;
        if (bitmap && canvas) {
          onProgress({status:`正在预处理第${part+1}/${count}段（不缩小文字）…`,progress:Math.round(5+90*part/count)});
          canvas.width=width;canvas.height=Math.min(tileHeight,height-top);
          const ctx=canvas.getContext("2d");if(!ctx)throw new Error("浏览器无法分配图片处理内存，请裁剪为更小截图后重试。");
          ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.drawImage(bitmap,0,top,width,canvas.height,0,0,width,canvas.height);
          input=await new Promise<Blob>((resolve,reject)=>canvas!.toBlob(blob=>blob?resolve(blob):reject(new Error("图片预处理失败，请裁剪后重试。")),"image/png"));
          top+=canvas.height-TILE_OVERLAP;
        }
        onProgress({status:`正在识别第${part+1}/${count}段…`,progress:Math.round(5+90*part/count)});
        try { const result=await worker.recognize(input);text=appendSegment(text,result.data.text.replace(/\n{3,}/g,"\n\n").trim()); }
        catch { throw new Error(`第${part+1}/${count}段 OCR 识别失败，可重试；如持续失败，请裁剪该区域或手工核对文字。`); }
      }
      if (!text.trim()) throw new Error("未识别到可编辑文字；请确认图片清晰，或改为手工录入。");
      onProgress({status:"识别完成，等待人工核对",progress:100});return text.trim();
    } finally { await worker.terminate(); }
  } finally { bitmap?.close();if(canvas){canvas.width=0;canvas.height=0;} }
}

export function toDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("图片读取失败")); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
}
