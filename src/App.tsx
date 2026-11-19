import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Activity, Archive, ArrowLeft, Bell, Bookmark, ChevronDown, Database, Globe2, Layers, LayoutDashboard, MapPin, Menu, Radar, Radio, Search, ShieldCheck, Telescope, TrendingUp, WifiOff, X } from 'lucide-react'
import Assistant from './Assistant'
import Briefing from './Briefing'
import { ArticleDetail, FilterBar, Modal, NoItems, PanelHeading, SearchBox, Skeleton, StoryRow } from './components'
import { useFeed, usePreferences } from './data'
import EventMap from './EventMap'
import Research from './Research'
import Watchlist, { LocationForm } from './Watchlist'
import { dateTime, relative, type IntelEvent, type Page, type Scope } from './types'

const menu = [
  {page:'briefing',path:'/',label:'Command center',icon:LayoutDashboard},
  {page:'map',path:'/map',label:'Live map',icon:Globe2},
  {page:'trending',path:'/trending',label:'Trending 24h',icon:TrendingUp},
  {page:'rabbit',path:'/rabbit-hole',label:'Rabbit hole',icon:Telescope},
  {page:'investigate',path:'/investigate',label:'Investigate',icon:Search},
  {page:'watchlist',path:'/watchlist',label:'Watchlist',icon:Bookmark},
  {page:'archive',path:'/archive',label:'Archive',icon:Archive},
  {page:'health',path:'/sources',label:'Source health',icon:Activity},
] as const
const paths=Object.fromEntries(menu.map(x=>[x.page,x.path]))
const headings:Record<string,[string,string]> = {
  briefing:['Command center','Your local, national, and global briefing.'],
  map:['Live map','Explore natural hazards with published coordinates and trace each marker to its source.'],
  trending:['Trending 24h','Reports gaining attention in the past 24 hours.'],
  rabbit:['Rabbit hole','Trace unusual reports, emerging theories, and the evidence behind each claim.'],
  investigate:['Investigate','Search the archive and follow the evidence across reports.'],
  watchlist:['Your watchlist','Keep track of stories, topics, and alerts that matter to you.'],
  archive:['Archive','Find earlier reports, updates, and source material.'],
  health:['Source health','See when each provider last delivered a successful response.']
}
function route(){
  const url=new URL(window.location.href)
  const path=url.pathname.replace(/\/+$/,'')||'/'
  const page:Page|'missing'=path.startsWith('/story/')?'story':menu.find(x=>x.path===path)?.page||'missing'
  let id=''
  try {if(page==='story')id=decodeURIComponent(path.slice(7))}catch{/* Invalid links get the unavailable story state. */}
  return {page,id,query:url.searchParams.get('q')?.slice(0,180)||''}
}
function Brand(){return <span className="brand"><span className="brand-mark" aria-hidden="true"><Radar size={28} strokeWidth={1.7}/></span><strong>EOTW</strong><span className="brand-name">END OF THE<br/>WORLD WATCH</span></span>}
export default function App(){
  const [current,setCurrent]=useState(route)
  const [scope,setScope]=useState<Scope|'conspiracy'>('all')
  const [category,setCategory]=useState('')
  const [drawer,setDrawer]=useState(false)
  const [ask,setAsk]=useState(false)
  const [place,setPlace]=useState(false)
  const [search,setSearch]=useState(false)
  const [message,setMessage]=useState('')
  const [online,setOnline]=useState(navigator.onLine)
  const prefsState=usePreferences()
  const {prefs,change}=prefsState
  const {page,id,query}=current
  const isStory=page==='story'
  const loadPage= !['watchlist','missing'].includes(page) && !(page==='investigate'&&!query) && !(isStory&&!id)
  const requestView=page==='trending'?'trending':page==='rabbit'?'rabbit':['story','archive','investigate'].includes(page)?'archive':'briefing'
  const feed=useFeed({view:requestView,scope,location:prefs.location,...(query?{q:query}:{}),...(isStory&&id?{id}:{})},loadPage)
  const extraAlerts=useFeed({view:'briefing',scope:'all',location:prefs.location},prefs.notifications&&page!=='briefing')
  const events=feed.data.events
  const selected=isStory?events.find(e=>e.id===id):undefined
  const navigate=useCallback((path:string)=>{
    if(window.location.pathname+window.location.search!==path)window.history.pushState({},'',path)
    setCurrent(route());setScope('all');setCategory('');setDrawer(false);setSearch(false)
    window.scrollTo(0,0)
    document.getElementById('main-content')?.focus({preventScroll:true})
  },[])
  const go=(p:Page)=>navigate(paths[p]||'/')
  const open=(e:IntelEvent)=>navigate('/story/'+encodeURIComponent(e.id))
  const save=(e:IntelEvent)=>{
    if(!prefs.saved.includes(e.id)&&prefs.saved.length>=200){setMessage('Your watchlist already contains 200 saved stories.');return}
    change(p=>({...p,saved:p.saved.includes(e.id)?p.saved.filter(x=>x!==e.id):[e.id,...p.saved]}))
  }
  const lookup=(q:string,dest='investigate')=>navigate('/'+dest+(q?'?q='+encodeURIComponent(q):''))
  const intercept=(ev:MouseEvent<HTMLAnchorElement>,url:string)=>{if(ev.button===0&&!ev.ctrlKey&&!ev.altKey&&!ev.metaKey&&!ev.shiftKey){ev.preventDefault();navigate(url)}}
  useEffect(()=>{
    const pop=()=>{setCurrent(route());setScope('all');setCategory('');setDrawer(false);setSearch(false);setPlace(false);setAsk(false)}
    const network=()=>setOnline(navigator.onLine)
    const shortcut=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setAsk(false);setPlace(false);setDrawer(false);setSearch(v=>!v)}}
    window.addEventListener('popstate',pop);window.addEventListener('online',network);window.addEventListener('offline',network);window.addEventListener('keydown',shortcut)
    return ()=>{window.removeEventListener('popstate',pop);window.removeEventListener('online',network);window.removeEventListener('offline',network);window.removeEventListener('keydown',shortcut)}
  },[])
  useEffect(()=>{
    if(!message)return
    const timer=setTimeout(()=>setMessage(''),6500)
    return ()=>clearTimeout(timer)
  },[message])
  const title=selected?.title || headings[page]?.[0] || (isStory?'Story':'Page unavailable')
  useEffect(()=>{
    document.title=title+' · EOTW'
    document.querySelector('meta[name="description"]')?.setAttribute('content',selected?.summary||headings[page]?.[1]||'EOTW sourced current-events coverage.')
  },[page,title,selected?.summary])
  const seenAlerts=useRef<Set<string>|null>(null)
  const personalFeed=page==='briefing'?feed.data:extraAlerts.data
  useEffect(()=>{
    if(!prefs.notifications){seenAlerts.current=null;return}
    if(!personalFeed.updatedAt)return
    const matched=personalFeed.events.filter(e=>e.severity==='high'&&(e.scope==='local'||prefs.saved.includes(e.id)||prefs.topics.some(t=>(e.title+' '+e.summary+' '+e.category).toLowerCase().includes(t.toLowerCase()))))
    const sig=(e:IntelEvent)=>e.id+'|'+e.updatedAt
    if(seenAlerts.current===null){seenAlerts.current=new Set(matched.map(sig));return}
    const fresh=matched.filter(e=>!seenAlerts.current!.has(sig(e)))
    for(const e of fresh)seenAlerts.current.add(sig(e))
    if(seenAlerts.current.size>1500)seenAlerts.current=new Set(matched.map(sig))
    if(!fresh.length)return
    const e=fresh[0];setMessage('New priority report: '+e.title)
    if('Notification' in window&&Notification.permission==='granted')try { const n=new Notification('EOTW · Priority report',{body:e.title,tag:e.id});n.onclick=()=>{window.focus();navigate('/story/'+encodeURIComponent(e.id));n.close()} }catch{/* In-app alert remains available. */}
  },[personalFeed,prefs.notifications,prefs.saved,prefs.topics,navigate])
  const nav=(mobile=false)=><nav className="side-nav" aria-label={mobile?'Mobile navigation':'Main navigation'}>{menu.map((item,i)=><div key={item.page}>{(i===0||i===4||i===7)&&<div className="nav-group">{i===0?'Monitor':i===4?'Research':'System'}</div>}<a href={item.path} onClick={e=>intercept(e,item.path)} aria-current={page===item.page?'page':undefined}><item.icon size={18} strokeWidth={1.7}/><span>{item.label}</span>{item.page==='watchlist'&&prefs.saved.length>0&&<small>{prefs.saved.length}</small>}</a></div>)}</nav>
  const mapped=events.filter(e=>Number.isFinite(e.lat)&&Number.isFinite(e.lon))
  const mapRows=mapped.filter(e=>!category||category===e.category)
  const fail=feed.error||(!online?'You are offline.':'')
  const last=feed.data.updatedAt
  const stale=last&&Date.now()-Date.parse(last)>1000*60*75
  const loadMore=feed.data.nextCursor&&<button className="load-more" onClick={feed.loadMore} disabled={feed.more}>{feed.more?'Loading…':'Load more reports'}</button>
  const list=(rows:IntelEvent[],empty:string,indexed=false):ReactNode=>rows.length?<>{rows.map((e,i)=><StoryRow key={e.id} e={e} open={open} saved={prefs.saved.includes(e.id)} save={()=>save(e)} index={indexed?i:undefined}/>)}</>:feed.busy?<Skeleton/>:<NoItems title={empty} detail={fail?'You can retry the feed above.':query?'Try another word or a broader filter.':'New reports appear here as sources update.'}/>
  return <div className="app-shell"><a href="#main-content" className="skip">Skip to content</a>
    <header className="masthead"><div className="mast-brand"><button className="mobile-toggle icon-button" aria-label="Open navigation" onClick={()=>setDrawer(true)}><Menu size={21}/></button><a href="/" aria-label="EOTW home" onClick={e=>intercept(e,'/')}><Brand/></a></div>
      <div className="mast-tools"><button className="top-search" aria-label="Search reports" onClick={()=>setSearch(true)}><Search size={16}/><span>Search reports</span><kbd>⌘/Ctrl K</kbd></button><button className="ask-button" onClick={()=>setAsk(true)}><Radio size={17}/><span>Ask EOTW</span></button></div></header>
    <div className="workspace"><aside className="rail">{nav()}<div className="rail-foot"><span className="section-kicker"><MapPin size={13}/>Local focus</span><button onClick={()=>setPlace(true)}>{prefs.location}<ChevronDown size={16}/></button></div></aside>
      <main id="main-content" tabIndex={-1}><div className="main-inner">
        {(!online || (loadPage && fail))&&<div className="network-note" role="status"><WifiOff size={17}/><span>{!online?'Offline. ':''}{last?'Showing the last available update from '+dateTime(last)+'.':feed.error||'Some records may be unavailable.'}</span><button onClick={feed.retry}>Retry</button></div>}
        {loadPage&&!isStory&&page!=='health'&&stale&&!fail&&<div className="network-note"><Activity size={16}/>Latest source collection was {relative(last)}.<a href="/sources" onClick={e=>intercept(e,'/sources')}>Check sources</a></div>}
        {headings[page]&&<div className="page-head"><div className="page-heading-copy"><div className="dateline"><span/>{new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date())}</div><h1>{headings[page][0]}</h1><p>{headings[page][1]}</p></div>
          {loadPage&&page!=='investigate'&&<div className="freshness"><span><i className={last&&!fail&&!stale?'good':''}/>{fail?'Feed unavailable':last?'Last collection':'Awaiting collection'}</span>{last&&<time dateTime={last} title={dateTime(last)}>{relative(last)}</time>}</div>}</div>}
        {page==='briefing'&&<Briefing data={feed.data} busy={feed.busy} state={prefsState} open={open} save={save} go={go} setLocation={()=>setPlace(true)}/>}
        {page==='map'&&<><div className="map-tools"><FilterBar scope={scope} set={setScope}/><label>Category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{[...new Set(mapped.map(e=>e.category))].sort().map(c=><option key={c}>{c}</option>)}</select></label></div><section className="panel full-map"><EventMap events={mapRows} onSelect={open}/><div className="map-caption"><span><i className="map-dot"/>{mapRows.length} located reports in this view</span><span>Published coordinates</span></div></section><section className="panel"><PanelHeading icon={<MapPin size={18}/>}>Mapped reports</PanelHeading>{list(mapRows,'No located reports in this view')}{loadMore}</section></>}
        {(page==='trending'||page==='rabbit'||page==='archive')&&<>{page==='archive'&&<SearchBox label="Search the archive" defaultValue={query} submit={q=>lookup(q,'archive')}/>}<div className="list-tools"><FilterBar scope={scope} set={setScope} conspiracy={page==='trending'}/></div>
          {page==='rabbit'&&<div className="editor-note"><ShieldCheck size={19}/><p><strong>Evidence policy</strong> Claim tracking records who said what, when, and where it was published. Each report carries a verification label.</p></div>}
          {page==='trending'&&<details className="method"><summary>How are stories ranked?</summary><p>Ranking uses published signals such as recency, severity, source coverage, and observed discussion. Each story lists the factors available for its ranking.</p></details>}
          <section className="panel"><PanelHeading icon={page==='trending'?<TrendingUp size={18}/>:page==='archive'?<Database size={18}/>:<Layers size={18}/>}>{page==='trending'?'Ranked reports':query?'Search results':page==='archive'?'Historical reports':'Claim tracker'}</PanelHeading>{list(events,'No reports match this view',page==='trending')}{loadMore}</section></>}
        {page==='investigate'&&<><Research key={query} query={query} events={events} busy={feed.busy} submit={q=>lookup(q)} open={open} saved={prefs.saved} save={save} ask={()=>setAsk(true)}/>{loadMore}</>}
        {page==='watchlist'&&<Watchlist state={prefsState} open={open} notify={setMessage}/>}
        {page==='health'&&<section className="panel"><PanelHeading icon={<Activity size={18}/>}>Provider status</PanelHeading>{feed.data.health.length?<div className="health-grid">{feed.data.health.map(s=><article key={s.id}><div><h3>{s.name}</h3><span className={'health-tag '+s.status}>{s.status==='ok'?'Healthy':s.status==='error'?'Unavailable':s.status==='disabled'?'Disabled':'Pending'}</span></div><small>Last successful check</small><time dateTime={s.lastSuccess||undefined}>{s.lastSuccess?dateTime(s.lastSuccess):'No successful check recorded'}</time>{s.detail&&<p>{s.detail}</p>}</article>)}</div>:feed.busy?<Skeleton/>:<NoItems title="Provider checks pending" detail="The collector records the outcome of each source check."/>}</section>}
        {isStory&&<><a className="back-link" href="/" onClick={e=>intercept(e,'/')}><ArrowLeft size={15}/>Command center</a>{selected?<ArticleDetail e={selected} saved={prefs.saved.includes(selected.id)} save={()=>save(selected)} ask={()=>setAsk(true)} investigate={q=>lookup(q)}/>:feed.busy&&!!id?<Skeleton/>:<NoItems title="Story unavailable" detail="Search the archive for its title or try again after the next update."/>}</>}
        {page==='missing'&&<section className="panel section-pad"><h1>Page unavailable</h1><a href="/" onClick={e=>intercept(e,'/')}>Return to command center</a></section>}
      </div></main></div>
    {drawer&&<Modal title="Navigation" onClose={()=>setDrawer(false)} className="mobile-nav-dialog">{nav(true)}</Modal>}
    {place&&<Modal title="Set local focus" onClose={()=>setPlace(false)}><div className="section-pad"><LocationForm value={prefs.location} onSave={value=>{change(p=>({...p,location:value}));setPlace(false);setMessage('Local focus updated.')}}/></div></Modal>}
    {search&&<Modal title="Search reports" onClose={()=>setSearch(false)}><div className="section-pad"><SearchBox label="Search all reports" defaultValue="" submit={q=>lookup(q,'archive')} /></div></Modal>}
    <Assistant open={ask} onClose={()=>setAsk(false)} state={prefsState} story={selected} page={page} scope={scope} query={query}/>
    {message&&<div role="status" className="toast"><Bell size={16}/>{message}<button onClick={()=>setMessage('')} className="icon-button" aria-label="Dismiss notification"><X size={15}/></button></div>}
  </div>
}
