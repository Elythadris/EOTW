import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "@playwright/test";

const output = new URL("../screenshots/", import.meta.url);
const targetText = process.env.EOTW_CAPTURE_URL || await readFile(new URL("./target.txt", import.meta.url), "utf8");
const target = new URL(targetText.trim());
if (target.protocol !== "https:" || target.username || target.password ||
    !/^(?:[a-z0-9-]+--)?eotw-watch\.netlify\.app$/.test(target.hostname) || target.port ||
    target.pathname !== "/" || target.search || target.hash) {
  throw new Error("Expected the HTTPS homepage of the EOTW Netlify site or one of its deploys.");
}
await mkdir(output,{recursive:true});
await mkdir(new URL("./empty-functions/",import.meta.url),{recursive:true});

const browser = await chromium.launch();
const captures = [
  { file:"desktop", label:"Desktop", width:1440, height:950, mobile:false },
  { file:"phone", label:"Phone", width:390, height:844, mobile:true },
];
const time = new Date().toISOString();
try {
  for (const capture of captures) {
    const context = await browser.newContext({
      ...(capture.mobile ? devices["Pixel 7"] : devices["Desktop Chrome"]),
      viewport:{ width:capture.width, height:capture.height },
      screen:{ width:capture.width, height:capture.height },
      deviceScaleFactor:1,
      isMobile:capture.mobile, hasTouch:capture.mobile,
      locale:"en-US", timezoneId:"Pacific/Honolulu",
    });
    try {
      const page=await context.newPage();
      page.setDefaultTimeout(45_000);
      // Observe the application's own request with no routing, fixtures or DOM replacement.
      const feedPromise=page.waitForResponse(response=>{
        const url=new URL(response.url());
        return url.origin===target.origin && url.pathname==="/api/feed" &&
          url.searchParams.get("view")==="signals" && url.searchParams.get("scope")==="all";
      },{timeout:55_000}).catch(error=>error);
      const response=await page.goto(target.href,{waitUntil:"domcontentloaded",timeout:45_000});
      if(!response?.ok())throw new Error("Dashboard navigation failed: "+(response?.status()||"no response"));
      const feed=await feedPromise;
      if(feed instanceof Error)throw feed;
      if(!feed.ok())throw new Error("Dashboard signal feed failed: "+feed.status());
      const snapshot=await feed.json();
      if(!Number.isFinite(Date.parse(snapshot.intelligence?.lastScan)) ||
         !Array.isArray(snapshot.events) || !Array.isArray(snapshot.health) ||
         !snapshot.health.some(h=>h.status==="ok" && Number.isFinite(Date.parse(h.lastSuccess)))) {
        throw new Error("The deployment has not completed a successful provider scan.");
      }
      await page.getByRole("heading",{name:"Command center",level:1,exact:true}).waitFor();
      await page.locator(".atlas-sheet").waitFor();
      await page.locator('.atlas-sheet svg[aria-label="Interactive world event map"]').waitFor();
      await page.waitForFunction(()=>{
        const last=document.querySelector(".atlas-sheet .time-number")?.textContent?.trim();
        const canvas=document.querySelector('.atlas-sheet svg[aria-label="Interactive world event map"]');
        return last && !/pending|awaiting/i.test(last) && canvas?.querySelector("path") &&
          canvas.getBoundingClientRect().width>150;
      });
      await page.evaluate(async()=>{
        await document.fonts.ready;
        const visible=Array.from(document.images).filter(img=>{
          const r=img.getBoundingClientRect();
          return r.width>0 && r.height>0 && r.top<innerHeight && r.bottom>0;
        });
        await Promise.all(visible.map(img=>img.decode()));
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      });
      await page.screenshot({path:fileURLToPath(new URL(capture.file+".png",output)),type:"png",fullPage:false,scale:"css"});
      console.log(capture.label+" captured at "+capture.width+"×"+capture.height+" from scan "+snapshot.intelligence.lastScan);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const cards=captures.map(({file,label,width,height})=>`<figure><a href="${file}.png"><img src="${file}.png" width="${width}" height="${height}" alt="${label} EOTW dashboard snapshot"/></a><figcaption>${label} · ${width} × ${height}</figcaption></figure>`).join("\n");
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>EOTW dashboard captures</title><style>html{font:16px/1.5 system-ui;color:#ecf3ec;background:#101923}body{margin:clamp(16px,4vw,56px)}a{color:#a5e2d3}main{display:grid;grid-template-columns:minmax(0,2.1fr) minmax(180px,.9fr);gap:1.25rem}figure{margin:0}img{width:100%;height:auto;display:block;border:1px solid #435766}figcaption,p{color:#c3d3d6}figcaption{margin:.5rem 0}@media(max-width:700px){main{grid-template-columns:1fr}}</style><h1>EOTW dashboard captures</h1><p><a href="${target.href}">Captured dashboard</a> · <time datetime="${time}">${time}</time></p><main>${cards}</main></html>`;
await writeFile(new URL("index.html",output),html);
