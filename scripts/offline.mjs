import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'

// Generate a versioned worker after Vite has finished writing all entry points and lazy chunks.
const dist = new URL('../dist/', import.meta.url)
const assetPaths = (await readdir(new URL('assets/',dist), {withFileTypes:true}))
  .filter(f=>f.isFile()).map(f=>'/assets/'+f.name).sort()
const html = await readFile(new URL('index.html',dist),'utf8')
const entries = [...html.matchAll(/\b(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(m=>m[1])
if(!entries.length || entries.some(p=>!assetPaths.includes(p)))throw Error('Production reader entry point missing')
const files = await Promise.all(assetPaths.map(async path => [
  path, 'sha256-'+createHash('sha256').update(await readFile(new URL(path.slice(1),dist))).digest('base64')
]))
const version = createHash('sha256').update(html).update(JSON.stringify(files)).digest('hex').slice(0,16)

function installReader(version, entries, assets) {
  const prefix='eotw-public-shell-'
  const name=prefix+version
  const root=new URL('/',self.location.origin).href
  const appPath=path=>/^\/(?:|map|trending|rabbit-hole|investigate|archive|sources|watchlist|story\/[^/]+)\/?$/.test(path)
  const request=(href,integrity='')=>new Request(href,{credentials:'omit',cache:'reload',integrity})
  self.addEventListener('install',event=>{
    event.waitUntil((async()=>{
      const cache=await caches.open(name)
      const shell=await fetch(request(root))
      if(!shell.ok || !shell.headers.get('content-type')?.includes('text/html'))throw Error('Reader shell unavailable')
      const markup=await shell.clone().text()
      const found=[...markup.matchAll(/\b(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(m=>m[1])
      if(found.length!==entries.length || entries.some(p=>!found.includes(p)))throw Error('Reader changed during installation')
      await cache.addAll(assets.map(([path,integrity])=>request(new URL(path,root),integrity)))
      await cache.put(root,shell)
      await self.skipWaiting()
    })())
  })
  self.addEventListener('activate',event=>{
    event.waitUntil((async()=>{
      const previous=(await caches.keys()).filter(k=>k.startsWith(prefix)&&k!==name)
      // A previously open reader may still request its lazy account or map bundle.
      await Promise.all(previous.slice(0,-1).map(k=>caches.delete(k)))
      await self.clients.claim()
    })())
  })
  self.addEventListener('fetch',event=>{
    const url=new URL(event.request.url)
    if(event.request.method!=='GET'||url.origin!==self.location.origin)return
    if(event.request.mode==='navigate' && appPath(url.pathname)){
      event.respondWith((async()=>{
        try {
          const live=await fetch(event.request)
          if(live.status<500)return live
          return (await (await caches.open(name)).match(root)) || live
        } catch {
          return (await (await caches.open(name)).match(root)) || new Response('Reconnect to open EOTW.',{status:503})
        }
      })())
      return
    }
    if(!/^\/assets\/[\w.-]+$/.test(url.pathname))return
    event.respondWith((async()=>{
      const cache=await caches.open(name)
      const fromCurrent=await cache.match(event.request)
      if(fromCurrent)return fromCurrent
      const previous=(await caches.keys()).filter(k=>k.startsWith(prefix)&&k!==name).at(-1)
      if(previous){const old=await (await caches.open(previous)).match(event.request);if(old)return old}
      return fetch(event.request)
    })())
  })
}
await writeFile(new URL('sw.js',dist),'('+installReader.toString()+')('+JSON.stringify(version)+','+JSON.stringify(entries)+','+JSON.stringify(files)+')\n')
