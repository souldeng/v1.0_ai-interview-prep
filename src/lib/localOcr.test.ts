import assert from "node:assert/strict";
import test from "node:test";
import { MAX_OCR_IMAGE_BYTES, recognizeScreenshot, validateOcrImage } from "./localOcr";

test("OCR 图片限制只接受 PNG/JPEG 且拒绝异常大小", () => {
  assert.doesNotThrow(() => validateOcrImage({ name: "jd.png", type: "image/png", size: 12 }));
  assert.doesNotThrow(() => validateOcrImage({ name: "note.JPG", type: "", size: 12 }));
  for (const mb of [2,4,8,10]) assert.doesNotThrow(() => validateOcrImage({name:`匿名${mb}MB.png`,type:"image/png",size:mb*1024*1024}));
  assert.throws(() => validateOcrImage({ name: "note.webp", type: "image/webp", size: 12 }), /PNG/);
  assert.throws(() => validateOcrImage({ name: "large.jpg", type: "image/jpeg", size: MAX_OCR_IMAGE_BYTES + 1 }), /10MB/);
  assert.throws(() => validateOcrImage({name:"空.png",type:"image/png",size:0}),/为空/);
});
test("超大像素/宽高与损坏图片在解码和加载OCR前拒绝，不以MB大小代替内存边界",async()=>{
  for(const [width,height] of [[8193,100],[1080,60001],[6000,5000],[0,600]]){
    const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);const view=new DataView(bytes.buffer);view.setUint32(12,0x49484452);view.setUint32(16,width);view.setUint32(20,height);
    const progress:string[]=[];
    await assert.rejects(()=>recognizeScreenshot(new File([bytes],"匿名危险尺寸.png",{type:"image/png"}),p=>progress.push(p.status)),/尺寸/);
    assert.ok(!progress.some(p=>p.includes("加载")));
  }
  await assert.rejects(()=>recognizeScreenshot(new File(["not an image"],"损坏.png",{type:"image/png"}),()=>{}),/图片头/);
});
test("JPEG错误段长度和未包含尺寸的头不会越界读取或启动OCR",async()=>{
  for(const bytes of [[255,216,255,192,0,0],[255,216,255,192,255,255,1],[255,216,255,218,0,2]]){
    await assert.rejects(()=>recognizeScreenshot(new File([new Uint8Array(bytes)],"损坏.jpg",{type:"image/jpeg"}),()=>{}),/图片头/);
  }
});
