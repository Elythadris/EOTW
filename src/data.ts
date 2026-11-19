import { useCallback, useEffect, useRef, useState } from 'react'
import { emptyFeed, type Feed, type Preferences } from './types'

const defaults: Preferences = {saved: [], topics: [], location: 'Maui', notifications: false, history: []}
function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch { return fallback }
}
function cacheLocal(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Private mode and full caches still support live reading. */ }
}
function validPrefs(value: Partial<Preferences> | null): Preferences {
  if (!value) return {...defaults}
  return {
    location: typeof value.location === 'string' && value.location.trim() ? value.location.trim().slice(0,100) : 'Maui',
    saved: Array.isArray(value.saved) ? value.saved.filter(x => typeof x === 'string').slice(0,200) : [],
    topics: Array.isArray(value.topics) ? value.topics.filter(x => typeof x === 'string').slice(0,32) : [],
    notifications: value.notifications === true,
    history: Array.isArray(value.history) ? value.history.filter(x => x && ['user','assistant'].includes(x.role) && typeof x.text === 'string').slice(-24) : []
  }
}
const prefsKey = 'eotw.preferences.v1'
function combineEdits(base: Preferences, local: Preferences, remote: Preferences): Preferences {
  const mergeList = (before:string[], mine:string[], theirs:string[], limit:number) => {
    const removed = new Set(before.filter(id=>!mine.includes(id)))
    return [...new Set([...mine.filter(id=>!before.includes(id)),...theirs.filter(id=>!removed.has(id))])].slice(0,limit)
  }
  const historyChanged = JSON.stringify(base.history) !== JSON.stringify(local.history)
  let history = remote.history
  if (historyChanged) {
    let common = Math.min(base.history.length,local.history.length)
    while (common && JSON.stringify(base.history.slice(-common)) !== JSON.stringify(local.history.slice(0,common))) common--
    const added=local.history.slice(common)
    let overlap=Math.min(added.length,remote.history.length)
    while(overlap && JSON.stringify(remote.history.slice(-overlap))!==JSON.stringify(added.slice(0,overlap)))overlap--
    history = [...remote.history,...added.slice(overlap)].slice(-24)
  }
  return {
    saved:mergeList(base.saved,local.saved,remote.saved,200),
    topics:mergeList(base.topics,local.topics,remote.topics,32),
    location:base.location===local.location?remote.location:local.location,
    notifications:base.notifications===local.notifications?remote.notifications:local.notifications,
    history
  }
}
let preferencesRead:Promise<Response>|null=null
// Initial readers on the same screen must share the GET that establishes the guest cookie.
export async function fetchPreferences(): Promise<Response> {
  preferencesRead ??= fetch('/api/preferences',{cache:'no-store',signal:AbortSignal.timeout(10000)})
    .finally(()=>{preferencesRead=null})
  return (await preferencesRead).clone()
}
export function usePreferences() {
  const [prefs, setPrefs] = useState(() => validPrefs(readLocal(prefsKey, defaults)))
  const ref = useRef(prefs)
  const [sync, setSync] = useState<'loading'|'syncing'|'saved'|'device'|'pending'>('loading')
  const queue = useRef<Promise<void>>(Promise.resolve())
  const serial = useRef(0)
  const ready = useRef(false)
  const signedIn = useRef(readLocal('eotw.private-session', false))
  const etag = useRef<string|null>(null)
  const baseline = useRef(prefs)
  const unsynced = useRef(false)
  const readRemote = useCallback(async () => {
    const r = await fetchPreferences()
    if(!r.ok)throw Error('Preferences unavailable')
    const raw = await r.json()
    if(!Array.isArray(raw.saved)||!Array.isArray(raw.history))throw Error('Invalid preferences')
    signedIn.current=raw.account?.signedIn===true
    cacheLocal('eotw.private-session',signedIn.current)
    if(signedIn.current){try{localStorage.removeItem(prefsKey);localStorage.removeItem(prefsKey+'.pending')}catch{/* Storage can be disabled. */}}
    etag.current=r.headers.get('etag')
    ready.current=true
    return validPrefs(raw)
  },[])
  const persist = useCallback((next: Preferences) => {
    const seq = ++serial.current
    const requestedBase=baseline.current
    unsynced.current=true
    setSync('syncing')
    if(!signedIn.current){cacheLocal(prefsKey,next);cacheLocal(prefsKey+'.pending',true)}
    queue.current = queue.current.then(async () => {
      if(seq!==serial.current)return
      try {
        let desired=requestedBase===baseline.current?next:combineEdits(requestedBase,next,baseline.current)
        if(!ready.current){
          const remote=await readRemote()
          desired=combineEdits(baseline.current,next,remote)
          baseline.current=remote
        }
        for(let attempt=0;attempt<2;attempt++){
          const headers:Record<string,string>={'Content-Type':'application/json'}
          if(etag.current)headers['If-Match']=etag.current
          const r=await fetch('/api/preferences',{method:'PUT',headers,body:JSON.stringify(desired),signal:AbortSignal.timeout(10000)})
          if(r.status===412 && attempt===0){
            const remote=await readRemote()
            desired=combineEdits(baseline.current,desired,remote)
            baseline.current=remote
            continue
          }
          if(!r.ok)throw Error('Save unavailable')
          etag.current=r.headers.get('etag');baseline.current=desired
          if(seq===serial.current){
            ref.current=desired;setPrefs(desired);unsynced.current=false;setSync('saved')
            if(!signedIn.current){cacheLocal(prefsKey,desired);cacheLocal(prefsKey+'.pending',false)}
          }
          return
        }
      } catch {
        if(seq===serial.current){
          if(signedIn.current)setSync('pending')
          else {cacheLocal(prefsKey,next);cacheLocal(prefsKey+'.pending',true);setSync('device')}
        }
      }
    })
  },[readRemote])
  useEffect(() => {
    let active=true
    const hydrate=async()=>{
      try{
        const remote=await readRemote()
        if(!active)return
        if(unsynced.current || (!signedIn.current && readLocal(prefsKey+'.pending',false))){
          if(!unsynced.current)baseline.current=remote
          persist(ref.current)
        } else {
          baseline.current=remote;ref.current=remote;setPrefs(remote);setSync('saved')
          if(!signedIn.current)cacheLocal(prefsKey,remote)
        }
      }catch{if(active)setSync(signedIn.current?'pending':'device')}
    }
    void hydrate()
    window.addEventListener('online',hydrate)
    return ()=>{active=false;window.removeEventListener('online',hydrate)}
  },[persist,readRemote])
  const change=useCallback((fn:(prev:Preferences)=>Preferences)=>{
    const next=validPrefs(fn(ref.current))
    ref.current=next;setPrefs(next);persist(next)
  },[persist])
  return {prefs,change,sync}
}
export type PrefsState = ReturnType<typeof usePreferences>
type Cache = {query: string, data: Feed}
const recent = new Map<string, Feed>()
function recall(query: string) {
  if (recent.has(query)) return recent.get(query)!
  const cache = readLocal<Cache | null>('eotw.briefing.v1',null)
  const cached=cache?.data
  if(cache?.query===query && Array.isArray(cached?.events) && Array.isArray(cached.health))return cached
  const id=new URLSearchParams(query).get('id')
  if(id){
    // A reader following a saved link offline may already have this public record in the briefing.
    const feeds=[...recent.values(),...(cached && Array.isArray(cached.events) && Array.isArray(cached.health)?[cached]:[])]
    for(const feed of feeds){
      const event=feed.events.find(e=>e.id===id)
      if(event)return {...feed,events:[event],nextCursor:null}
    }
  }
  return emptyFeed
}
function merge(first: Feed, next: Feed): Feed {
  return {...next, events: [...new Map([...first.events,...next.events].map(e=>[e.id,e])).values()]}
}
export function useFeed(params: Record<string,string>, enabled = true) {
  const query = new URLSearchParams(params).toString()
  const [snapshot, setSnapshot] = useState({key:query,data:recall(query),busy:true,error:'',more:false})
  const [version, setVersion] = useState(0)
  const [page, setPage] = useState({query:'',cursor:''})
  const cursor = page.query === query ? page.cursor : ''
  const current = snapshot.key === query ? snapshot : {key:query,data:recall(query),busy:true,error:'',more:false}
  useEffect(() => {
    if (!enabled) return
    let active = true
    let controller: AbortController | undefined
    const load = async (quiet = false) => {
      if (!active || (quiet && document.hidden)) return
      controller?.abort()
      const ac = new AbortController()
      controller = ac
      const timer = setTimeout(() => ac.abort(),15000)
      setSnapshot(s => s.key === query ? {...s, more:!!cursor, busy:!quiet && !cursor, error:quiet?s.error:''} : {key:query,data:recall(query),busy:true,error:'',more:false})
      try {
        const r = await fetch('/api/feed?' + query + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), {signal:ac.signal})
        if (!r.ok) throw Error('Feed temporarily unavailable')
        const data: Feed = await r.json()
        if (!Array.isArray(data.events) || !Array.isArray(data.health)) throw Error('Invalid feed')
        if (!active || controller !== ac) return
        const next = cursor ? merge(recent.get(query) || emptyFeed,data) : data
        recent.set(query, next)
        if (recent.size > 40) recent.delete(recent.keys().next().value!)
        const keys = new URLSearchParams(query)
        if (keys.get('view') === 'briefing' && !keys.has('id') && !keys.get('q') && keys.get('scope') === 'all') cacheLocal('eotw.briefing.v1',{query,data:next})
        setSnapshot({key:query,data:next,busy:false,error:'',more:false})
      } catch {
        if (active && controller === ac) setSnapshot(s=>({...s,busy:false,more:false,error:'The feed could not be reached.'}))
      } finally { clearTimeout(timer) }
    }
    void load()
    const refresh = () => { if (!cursor) void load(true) }
    const interval = window.setInterval(refresh,45000)
    window.addEventListener('online',refresh)
    document.addEventListener('visibilitychange',refresh)
    return () => { active = false; controller?.abort(); clearInterval(interval); window.removeEventListener('online',refresh); document.removeEventListener('visibilitychange',refresh) }
  }, [query,cursor,version,enabled])
  return {
    ...current,
    retry: () => setVersion(v=>v+1),
    loadMore: () => { if (current.data.nextCursor) setPage({query,cursor:current.data.nextCursor}) }
  }
}
