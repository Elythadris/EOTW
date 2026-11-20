import {test,expect} from "@playwright/test";
test.use({serviceWorkers:"block"});

test("weather controls retain model times and switch to the requested location and layer coverage",async({page})=>{
  const maui={label:"Wailuku, Hawaii, United States of America",latitude:20.891,longitude:-156.505};
  const tokyo={label:"Tokyo, Japan",latitude:35.67,longitude:139.73};
  const stamp="2026-11-20T10:00:00Z";
  await page.route("**/api/weather?**",route=>{
    const url=new URL(route.request().url()),q=url.searchParams,view=q.get("view");
    if(view==="places")return route.fulfill({json:{places:[q.get("q")?.includes("Tokyo")?tokyo:maui]}});
    if(view==="image")return route.fulfill({contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z5xkAAAAASUVORK5CYII=","base64")});
    const japan=q.get("lat")===String(tokyo.latitude),p=japan?tokyo:maui;
    const envelope=(data:unknown)=>({status:"ok",data});
    return route.fulfill({json:{
      point:p,checkedAt:stamp,forecast:envelope({issuedAt:stamp,hours:[{time:stamp,temp:20,wind:0,rain:0,humidity:80,direction:90,symbol:"cloudy"}],days:[{date:"2026-11-20",low:15,high:22,wind:0,symbol:"cloudy"}]}),
      alerts:japan?{status:"regional",data:null}:envelope([]),nhc:envelope([]),eonet:envelope([]),
      radar:japan?{status:"regional",data:null,region:null}:{status:"ok",region:"hawaii",data:["2026-11-20T09:50:00Z",stamp]},
      satelliteDates:["2026-11-19","2026-11-18"],station:envelope(null),airspace:envelope([]),
      bounds:{wide:[-180,-90,180,90],close:[-180,-90,180,90],regional:[-180,-90,180,90]},
    }});
  });
  await page.goto("/weather");
  await expect(page.getByRole("heading",{name:maui.label})).toBeVisible();
  await page.getByRole("button",{name:"°F",exact:true}).click();
  await expect(page.locator(".wx-current b")).toHaveText("68°");
  const layer=page.getByRole("group",{name:"Weather map layers"});
  await layer.getByRole("button",{name:"Radar",exact:true}).click();
  const times=page.getByRole("combobox",{name:"Radar observation"});
  await times.selectOption("1");
  await expect(page.locator("img[alt^='Radar imagery']")).toHaveAttribute("src",/09%3A50/);
  await page.getByRole("button",{name:"Play radar history"}).click();
  await expect(page.getByRole("button",{name:"Pause radar history"})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Pause radar history"}).click();
  await page.getByLabel("Forecast location").fill("Tokyo");
  await page.locator(".wx-search").getByRole("button",{name:"Search",exact:true}).click();
  await expect(page.getByRole("heading",{name:tokyo.label})).toBeVisible();
  await expect(page.getByText(/NOAA radar mosaics cover selected U.S. regions/)).toBeVisible();
  await expect(page.getByText(/outside the NOAA regional alert view/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Ask about this weather"})).toBeVisible();
});
