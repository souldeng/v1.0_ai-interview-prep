import { expect, test, type Page } from "@playwright/test";

async function enter(page:Page) {
  const menu=page.getByRole("button",{name:"打开导航"});if(await menu.isVisible())await menu.click();
  await page.getByRole("button",{name:/AI 面试题库/}).first().click();
  await page.getByRole("button",{name:"面试资料收集",exact:true}).click();
}
async function pngFixture(page:Page,height=600) {
  return Buffer.from(await page.evaluate(h=>{
    const canvas=document.createElement("canvas");canvas.width=1080;canvas.height=h;
    const ctx=canvas.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,1080,h);ctx.fillStyle="black";ctx.font="24px sans-serif";
    for(let y=40;y<h;y+=36)ctx.fillText(`匿名岗位要求 ${y}：理解RAG检索、生成与评测，不代表本人经历。`,24,y);
    return canvas.toDataURL("image/png").split(",")[1];
  },height),"base64");
}
// Valid PNG ancillary text makes byte-boundary fixtures without allocating enormous bitmaps.
// These are byte-limit fixtures, not evidence of dense-image OCR accuracy.
function sizedPng(png:Buffer,size:number) {
  const data=Buffer.alloc(size-png.length-12,32);data.write("Comment\0");
  const type=Buffer.from("tEXt"),length=Buffer.alloc(4);length.writeUInt32BE(data.length);
  const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  let crc=0xffffffff;for(const byte of Buffer.concat([type,data]))crc=table[(crc^byte)&255]^(crc>>>8);
  const check=Buffer.alloc(4);check.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([png.subarray(0,-12),length,type,data,check,png.subarray(-12)]);
}
test("2/4/8/10MB图片上传OCR后原件逐字节保留，刷新可预览",async({page,context},info)=>{
  await page.route("**/api/health",r=>r.fulfill({json:{modelConfigured:false}}));
  await context.route(/tesseract.*\/worker\.min\.js/,r=>r.fulfill({contentType:"application/javascript",body:`self.onmessage=({data:m})=>self.postMessage({...m,status:'resolve',data:m.action==='recognize'?{text:'匿名JD：理解RAG检索与生成。'}:{}})`}));
  await page.goto("/");const base=await pngFixture(page);await enter(page);
  const files=[2,4,8,10].map(mb=>({name:`匿名${mb}MB.png`,mimeType:"image/png",buffer:sizedPng(base,mb*1024*1024)}));
  await page.getByLabel("上传面试收集资料").setInputFiles(files);
  await expect(page.getByRole("button",{name:"批量添加文件",exact:true})).toBeEnabled({timeout:30000});
  const entries=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection.materials);
  expect(entries.map((m:any)=>m.processing)).toEqual(["recognized","recognized","recognized","recognized"]);
  const stored=[];
  for(const file of files){
    const row=page.locator("article").filter({has:page.getByRole("heading",{name:new RegExp(file.name.replaceAll(".","\\."))})});
    await row.getByRole("button",{name:"查看 / 核对",exact:true}).click();
    const download=row.getByRole("link",{name:"下载原件",exact:true});await expect(download).toBeVisible();
    const url=await download.getAttribute("href");
    stored.push(await page.evaluate(async url=>{const blob=await(await fetch(url!)).blob(),hash=await crypto.subtle.digest("SHA-256",await blob.arrayBuffer());return{size:blob.size,hash:Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,"0")).join("")};},url));
  }
  const {createHash}=await import("node:crypto");
  expect(stored).toEqual(files.map(f=>({size:f.buffer.length,hash:createHash("sha256").update(f.buffer).digest("hex")})));
  await page.reload();await enter(page);
  await page.locator("article").filter({has:page.getByRole("heading",{name:/匿名10MB.png/})}).getByRole("button",{name:"查看 / 核对",exact:true}).click();
  await expect(page.getByRole("img",{name:"匿名10MB.png 原图",exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath("ocr-large-upload.png"),fullPage:true});
});
test("长图按原分辨率有界分段，单图失败可重试且不影响其他原件或成功文字",async({page,context},info)=>{
  // Canvas encoding and the instrumented worker exchange are asynchronous, not a 10s OCR SLA.
  test.setTimeout(90_000);
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/api/health",r=>r.fulfill({json:{modelConfigured:false}}));
  const probes:Array<{worker:number;call:number;width:number;height:number;bytes:number}>=[];let workers=0;
  await context.route("**/__ocr_probe",r=>{probes.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}});});
  await context.route(/tesseract.*\/worker\.min\.js/,r=>{
    const worker=workers++,origin=new URL(page.url()).origin;
    return r.fulfill({contentType:"application/javascript",body:`let call=0;self.onmessage=async({data:m})=>{
      if(m.action!=='recognize'){self.postMessage({...m,status:'resolve',data:{}});return}
      call++;const image=m.payload.image,view=new DataView(image.buffer,image.byteOffset,image.byteLength);
      await fetch('${origin}/__ocr_probe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({worker:${worker},call,width:view.getUint32(16),height:view.getUint32(20),bytes:image.byteLength})});
      if(${worker}===1&&call===2){self.postMessage({...m,status:'reject',data:'匿名长图中段识别失败'});return}
      const text=${worker}===0?'短图成功':${worker}===2?'其他资料成功':call===1?'起始问题\\n共享边界':call===2?'共享边界\\n中间知识\\n共同下界':'共同下界\\n结束复盘';
      self.postMessage({...m,status:'resolve',data:{text}});
    }`});
  });
  await page.goto("/");const small=await pngFixture(page),long=await pngFixture(page,7000);await enter(page);
  await page.getByLabel("上传面试收集资料").setInputFiles([
    {name:"短图.png",mimeType:"image/png",buffer:sizedPng(small,2*1024*1024)},
    {name:"面经长图.png",mimeType:"image/png",buffer:sizedPng(long,4*1024*1024)},
    {name:"其他JD.png",mimeType:"image/png",buffer:sizedPng(small,8*1024*1024)},
  ]);
  await expect(page.getByRole("button",{name:"批量添加文件",exact:true})).toBeEnabled({timeout:30000});
  const row=page.locator("article").filter({has:page.getByRole("heading",{name:/面经长图.png/})});
  await expect(row).toContainText("识别失败");
  expect(probes.every(p=>p.width===1080 && p.width*p.height<=3_000_000 && p.height<=4096)).toBe(true);
  expect(probes.find(p=>p.worker===0)!.bytes).toBeLessThan(2*1024*1024);
  await row.getByRole("button",{name:"查看 / 核对",exact:true}).click();
  await expect(page.getByRole("img",{name:"面经长图.png 原图",exact:true})).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath("ocr-failure-original-kept.png"),fullPage:true});
  await row.getByRole("button",{name:"重新识别",exact:true}).click();
  await expect(row).toContainText("已识别",{timeout:30000});
  const materials=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection.materials);
  expect(materials.map((m:any)=>m.originalSaved)).toEqual([true,true,true]);
  expect(materials.map((m:any)=>m.content)).toEqual(["短图成功","起始问题\n共享边界\n中间知识\n共同下界\n结束复盘","其他资料成功"]);
  await expect(row.getByRole("textbox",{name:"核对文字 面经长图.png",exact:true})).toHaveValue("起始问题\n共享边界\n中间知识\n共同下界\n结束复盘");
  expect(probes.filter(p=>p.worker===3)).toHaveLength(3);
  expect(probes.filter(p=>p.worker===3).map(p=>p.height)).toEqual([2777,2777,1638]);
  await row.getByRole("textbox",{name:"核对文字 面经长图.png",exact:true}).fill("用户核对后保留的文字");
  await row.getByRole("button",{name:"保存并确认文字",exact:true}).click();
  await row.getByRole("button",{name:"重新识别",exact:true}).click();
  await expect(page.getByRole("button",{name:"批量添加文件",exact:true})).toBeEnabled({timeout:30000});
  await expect(row.getByRole("textbox",{name:"核对文字 面经长图.png",exact:true})).toHaveValue("用户核对后保留的文字");
  await page.reload();await enter(page);
  await page.locator("article").filter({has:page.getByRole("heading",{name:/面经长图.png/})}).getByRole("button",{name:"查看 / 核对",exact:true}).click();
  await expect(page.getByRole("img",{name:"面经长图.png 原图",exact:true})).toBeVisible();
  await expect(page.getByRole("textbox",{name:"核对文字 面经长图.png",exact:true})).toHaveValue("用户核对后保留的文字");
  expect(errors).toEqual([]);
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath("ocr-long-retried.png"),fullPage:true});
});
test("危险尺寸在解码前被拦截且原件只供下载，后续JPEG上传仍正常",async({page,context},info)=>{
  await page.route("**/api/health",r=>r.fulfill({json:{modelConfigured:false}}));let workers=0;
  await context.route(/tesseract.*\/worker\.min\.js/,r=>{workers++;return r.fulfill({contentType:"application/javascript",body:`self.onmessage=({data:m})=>self.postMessage({...m,status:'resolve',data:m.action==='recognize'?{text:'JPEG截图可核对'}:{}})`});});
  await page.goto("/");const jpeg=Buffer.from(await page.evaluate(()=>{const c=document.createElement("canvas");c.width=1080;c.height=7000;const x=c.getContext("2d")!;x.fillStyle="white";x.fillRect(0,0,c.width,c.height);x.fillStyle="black";x.font="24px sans-serif";x.fillText("匿名JPEG岗位截图",24,60);return c.toDataURL("image/jpeg",0.95).split(",")[1];}),"base64");await enter(page);
  const header=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(header);header.write("IHDR",12);header.writeUInt32BE(50000,16);header.writeUInt32BE(50000,20);
  await page.getByLabel("上传面试收集资料").setInputFiles([{name:"危险尺寸.png",mimeType:"image/png",buffer:header},{name:"正常长图.jpg",mimeType:"image/jpeg",buffer:jpeg}]);
  await expect(page.getByRole("button",{name:"批量添加文件",exact:true})).toBeEnabled({timeout:30000});expect(workers).toBe(1);
  const bad=page.locator("article").filter({has:page.getByRole("heading",{name:/危险尺寸.png/})});
  await expect(bad).toContainText("2400万像素");await bad.getByRole("button",{name:"查看 / 核对",exact:true}).click();
  await expect(bad.getByRole("link",{name:"下载原件",exact:true})).toBeVisible();
  await expect(bad.getByRole("img")).toHaveCount(0);
  await expect(bad).toContainText("未自动打开预览");
  const m=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection.materials);
  expect(m.map((i:any)=>i.originalSaved)).toEqual([true,true]);expect(m[1].content).toBe("JPEG截图可核对");
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath("ocr-pixel-guard.png"),fullPage:true});
});
