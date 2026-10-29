import { expect, test } from "@playwright/test";

test("可选真实本地OCR：匿名密集中文长截图保留开头、中部、分段边界和末尾",async({page,context},info)=>{
  test.skip(process.env.RUN_LIVE_LARGE_OCR!=="1" || info.project.name!=="desktop","真实OCR需首次免费资源下载，仅显式启用的桌面验收运行");
  test.setTimeout(420000);
  const downloads:Array<{url:string;status?:number;error?:string}>=[];let modelCalls=0;
  await page.route("**/api/health",r=>r.fulfill({json:{modelConfigured:false}}));
  await page.route("**/api/model/chat",r=>{modelCalls++;return r.abort();});
  context.on("response",r=>{if(/traineddata|tesseract|worker\.min/.test(r.url()))downloads.push({url:r.url(),status:r.status()});});
  context.on("requestfailed",r=>{if(/traineddata|tesseract|worker\.min/.test(r.url()))downloads.push({url:r.url(),error:r.failure()?.errorText});});
  await page.goto("/");
  const data=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");canvas.width=1080;canvas.height=6500;
    const ctx=canvas.getContext("2d")!,pixels=ctx.createImageData(1080,6500);let seed=1001;
    // Low-amplitude background noise produces a genuinely multi-MB encoded image,
    // while preserving high contrast for anonymous 24px text.
    for(let i=0;i<pixels.data.length;i+=4){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const noisy=(i/4)%1080>=720;pixels.data[i]=noisy?248+(seed&3):255;pixels.data[i+1]=noisy?248+((seed>>>8)&3):255;pixels.data[i+2]=noisy?248+((seed>>>16)&3):255;pixels.data[i+3]=255;}
    ctx.putImageData(pixels,0,0);ctx.fillStyle="black";ctx.font='24px "Microsoft YaHei",sans-serif';
    for(let i=0;i<180;i++)ctx.fillText(`${String(i+1).padStart(3,"0")} 匿名招聘资料：RAG先检索再生成，需求访谈记录需要核对来源。`,24,120+i*34);
    const anchors=[{y:60,text:"岗位要求：理解检索与生成"},{y:2750,text:"边界甲：检索结果需要可追溯"},{y:3200,text:"评测必须区分检索质量和生成质量"},{y:5445,text:"边界乙：证据来源不得省略"},{y:6420,text:"末尾验收 ZXCV9876"}];
    for(const a of anchors){ctx.fillStyle="white";ctx.fillRect(0,a.y-40,1080,55);ctx.fillStyle="black";ctx.font='30px "Microsoft YaHei",sans-serif';ctx.fillText(a.text,24,a.y);}
    return {png:canvas.toDataURL("image/png").split(",")[1],anchors:anchors.map(a=>a.text)};
  });
  const image=Buffer.from(data.png,"base64");
  expect(image.length).toBeGreaterThan(4*1024*1024);expect(image.length).toBeLessThanOrEqual(10*1024*1024);
  const menu=page.getByRole("button",{name:"打开导航"});if(await menu.isVisible())await menu.click();
  await page.getByRole("button",{name:/AI 面试题库/}).first().click();await page.getByRole("button",{name:"面试资料收集",exact:true}).click();
  const started=Date.now();
  await page.getByLabel("上传面试收集资料").setInputFiles({name:"匿名密集中文长图.png",mimeType:"image/png",buffer:image});
  await expect(page.getByRole("button",{name:"批量添加文件",exact:true})).toBeEnabled({timeout:360000});
  const material=await page.evaluate(()=>JSON.parse(localStorage.getItem("ai-interview-question-library-v1")!).collection.materials[0]);
  const normalize=(text:string)=>text.replace(/[\s：:，,。]/g,"");
  const anchors=data.anchors.map(text=>({text,found:normalize(material.content).includes(normalize(text))}));
  await info.attach("真实OCR匿名指标",{body:JSON.stringify({bytes:image.length,width:1080,height:6500,elapsedMs:Date.now()-started,processing:material.processing,error:material.error??null,characters:material.content.length,anchors,downloads,modelCalls},null,2),contentType:"application/json"});
  await info.attach("真实OCR匿名文本",{body:material.content,contentType:"text/plain"});
  expect(material.processing,material.error).toBe("recognized");expect(material.originalSaved).toBe(true);
  expect(anchors.every(a=>a.found)).toBe(true);expect(material.content.length).toBeGreaterThan(2000);expect(modelCalls).toBe(0);
  await page.locator("article").getByRole("button",{name:"查看 / 核对",exact:true}).click();
  await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:info.outputPath("ocr-live-long.png"),fullPage:true});
});
