import { expect, test, type Page } from '@playwright/test'
import type { IntelEvent, Preferences } from '../src/types'

const event:IntelEvent = {
  id:'fixture-report',title:'Test bulletin for Maui',summary:'A controlled bulletin for testing the reading and saving flow.',
  url:'https://example.org/bulletin',source:'Fixture agency',publishedAt:'2026-01-14T12:00:00Z',updatedAt:'2026-01-14T12:05:00Z',
  category:'Weather',scope:'local',location:'Maui',lat:20.8,lon:-156.4,status:'confirmed',severity:'routine',
  sources:[{name:'Fixture agency',url:'https://example.org/bulletin'}],timeline:[{at:'2026-01-14T12:05:00Z',text:'Published update'}],
  rank:1,rankReasons:['Recently published']
}
async function mockAPI(page:Page, events:IntelEvent[]=[event]){
  let prefs:Preferences = {saved:[],topics:[],location:'Maui',notifications:false,history:[]}
  await page.route('**/api/preferences',async r=>{
    if(r.request().method()==='PUT')prefs=r.request().postDataJSON()
    await r.fulfill({json:{...prefs,account:{enabled:false,signedIn:false}}})
  })
  await page.route('**/api/feed?**',async r=>{
    const p=new URL(r.request().url()).searchParams
    const results=events.filter(e=>(!p.get('id')||p.get('id')===e.id)&&(!p.get('q')||e.title.toLowerCase().includes(p.get('q')!.toLowerCase()))&&(!p.get('scope')||['all',e.scope].includes(p.get('scope')!)))
    await r.fulfill({json:{events:results,updatedAt:new Date().toISOString(),health:[{id:'fixture',name:'Fixture agency',status:'ok',lastSuccess:new Date().toISOString()}]}})
  })
  await page.route('**/api/ask',r=>r.fulfill({json:{answer:'The bulletin records an update [1].',mode:'sources',citations:[{id:'1',title:'Original bulletin',url:event.url}]}}))
}
async function nav(page:Page,name:string){
  const mobile=page.getByRole('button',{name:'Open navigation'})
  if(await mobile.isVisible())await mobile.click()
  await page.getByRole('navigation').filter({visible:true}).getByRole('link',{name,exact:true}).click()
}
test('open a source-backed story, save it and read its timeline from the watchlist',async({page})=>{
  await mockAPI(page);await page.goto('/')
  await expect(page.getByRole('heading',{name:'Command center',level:1})).toBeVisible()
  await page.getByRole('link',{name:event.title}).first().click()
  await expect(page).toHaveURL(/\/story\/fixture-report$/)
  await expect(page.getByRole('heading',{name:event.title,level:1})).toBeVisible()
  await expect(page.getByText('Published update',{exact:true})).toBeVisible()
  await expect(page.getByRole('link',{name:/Source 1 Fixture agency/})).toHaveAttribute('href',event.url)
  await page.getByRole('button',{name:'Save story',exact:true}).click()
  await expect(page.getByRole('button',{name:'Saved to watchlist'})).toBeVisible()
  const mobile=page.getByRole('button',{name:'Open navigation'})
  if(await mobile.isVisible())await mobile.click()
  await page.getByRole('navigation').filter({visible:true}).getByRole('link',{name:/Watchlist/}).click()
  await expect(page.getByRole('link',{name:event.title})).toBeVisible()
  await page.getByRole('button',{name:'Remove saved story'}).click()
  await expect(page.getByRole('heading',{name:'No saved stories yet'})).toBeVisible()
})
test('search and compare evidence, then follow citations from the assistant',async({page})=>{
  await mockAPI(page);await page.goto('/investigate')
  await page.getByRole('textbox',{name:'Investigation subject'}).fill('Maui')
  await page.getByRole('button',{name:'Investigate',exact:true}).click()
  await expect(page).toHaveURL(/q=Maui/)
  await page.getByRole('button',{name:'Evidence',exact:true}).click()
  await expect(page.getByRole('link',{name:'Fixture agency'})).toHaveAttribute('href',event.url)
  await page.getByRole('button',{name:'Ask about the evidence'}).click()
  const pane=page.getByRole('dialog',{name:'Ask EOTW'})
  await pane.getByRole('textbox',{name:'Your question'}).fill('What did the bulletin document?')
  await pane.getByRole('button',{name:'Send question'}).click()
  await expect(pane.getByRole('link',{name:/Original bulletin/})).toHaveAttribute('href',event.url)
  await pane.getByRole('button',{name:'Close dialog'}).click()
  await expect(pane).toHaveCount(0)
})
test('read and filter the map, then reach an empty archive on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});await mockAPI(page);await page.goto('/')
  await nav(page,'Live map')
  await expect(page.getByRole('heading',{name:'Mapped reports'})).toBeVisible()
  await expect(page.getByRole('link',{name:event.title})).toBeVisible()
  await page.getByRole('button',{name:'Global',exact:true}).click()
  await expect(page.getByRole('heading',{name:'No located reports in this view'})).toBeVisible()
  await nav(page,'Archive')
  await page.getByRole('textbox',{name:'Search the archive'}).fill('nothingmatches')
  await page.getByRole('button',{name:'Search',exact:true}).click()
  await expect(page.getByRole('heading',{name:'No reports match this view'})).toBeVisible()
  const dimensions=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,window:window.innerWidth}))
  expect(dimensions.doc).toBeLessThanOrEqual(dimensions.window)
})
test('shows an offline state with an honest retry path when feeds fail',async({page})=>{
  await mockAPI(page,[]);await page.route('**/api/feed?**',r=>r.fulfill({status:503,body:'Unavailable'}));await page.goto('/')
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Awaiting published reports'})).toBeVisible()
  await expect(page.getByRole('link',{name:event.title})).toHaveCount(0)
})

test('reopens the static reader offline with the last public briefing', async({page,context})=>{
  await mockAPI(page)
  await page.goto('/')
  await expect(page.getByRole('link',{name:event.title}).first()).toBeVisible()
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready
    if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}))
  })
  await page.unroute('**/api/feed?**')
  await page.unroute('**/api/preferences')
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading',{name:'Command center',level:1})).toBeVisible()
  await expect(page.getByText(/Offline\. Showing the last available update/)).toBeVisible()
  await expect(page.getByRole('link',{name:event.title}).first()).toBeVisible()
})
