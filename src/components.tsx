import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  FileText,
  Layers,
  Minus,
  ChevronRight,
  Clock3,
  Globe2,
  MapPin,
  Radio,
  Search,
  X,
} from "lucide-react";
import {
  dateTime,
  relative,
  sourceURL,
  type IntelEvent,
  type Scope,
} from "./types";
import "./story-visuals.css";

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    const before = document.activeElement as HTMLElement | null;
    node?.showModal();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = prev;
      before?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={"modal " + (wide ? "wide " : "") + className}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="icon-button"
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Status({ value }: { value: IntelEvent["status"] }) {
  return (
    <span className={"status " + value}>
      <i aria-hidden="true" />
      {value === "speculation" ? "Unverified claim" : value}
    </span>
  );
}
export function SaveButton({
  saved,
  toggle,
}: {
  saved: boolean;
  toggle: () => void;
}) {
  return (
    <button
      type="button"
      className={"icon-button save " + (saved ? "active" : "")}
      aria-label={saved ? "Remove saved story" : "Save story"}
      aria-pressed={saved}
      onClick={toggle}
    >
      {saved ? (
        <Bookmark size={17} fill="currentColor" />
      ) : (
        <Bookmark size={17} />
      )}
    </button>
  );
}
export function StoryRow({
  e,
  open,
  saved,
  save,
  index,
}: {
  e: IntelEvent;
  open: (e: IntelEvent) => void;
  saved: boolean;
  save: () => void;
  index?: number;
}) {
  return (
    <article className="story-row">
      {index != null && (
        <span className="rank">{String(index + 1).padStart(2, "0")}</span>
      )}
      <div className="story-copy">
        <div className="story-meta">
          <span className="category">{e.category}</span>
          <span className="dot-separator">·</span>
          <time dateTime={e.publishedAt} title={dateTime(e.publishedAt)}>
            {relative(e.publishedAt)}
          </time>
        </div>
        <h3>
          <a
            href={"/story/" + encodeURIComponent(e.id)}
            onClick={(ev) => {
              if (!ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
                ev.preventDefault();
                open(e);
              }
            }}
          >
            {e.title}
          </a>
        </h3>
        {e.summary && e.summary !== e.title && (
          <p className="summary clamp">{e.summary}</p>
        )}
        <div className="byline">
          <span>{e.source}</span>
          {e.location && (
            <span>
              <MapPin size={12} />
              {e.location}
            </span>
          )}
          <Status value={e.status} />
        </div>
      </div>
      <SaveButton saved={saved} toggle={save} />
    </article>
  );
}
export function NoItems({
  title,
  detail,
  icon = "radio",
}: {
  title: string;
  detail?: string;
  icon?: "radio" | "search" | "saved" | "globe";
}) {
  const Icon = { radio: Radio, search: Search, saved: Bookmark, globe: Globe2 }[
    icon
  ];
  return (
    <div className="empty">
      <Icon size={24} strokeWidth={1.45} />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="skeletons" role="status" aria-label="Loading reports">
      {[0, 1, 2].map((x) => (
        <div className="skeleton" key={x}>
          <i />
          <b />
          <span />
        </div>
      ))}
    </div>
  );
}
export function PanelHeading({
  icon,
  children,
  action,
  actionLabel,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="panel-heading">
      <h2>
        {icon}
        {children}
      </h2>
      {action && (
        <button className="link-button" onClick={action}>
          {actionLabel}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}
export function FilterBar({
  scope,
  set,
  conspiracy = false,
}: {
  scope: string;
  set: (s: Scope | "conspiracy") => void;
  conspiracy?: boolean;
}) {
  const choices: [Scope | "conspiracy", string][] = [
    ["all", "All"],
    ["local", "Local"],
    ["us", "U.S."],
    ["global", "Global"],
  ];
  if (conspiracy) choices.push(["conspiracy", "Conspiracy"]);
  return (
    <div className="filter-bar" role="group" aria-label="Filter by coverage">
      {choices.map(([id, label]) => (
        <button
          key={id}
          className={scope === id ? "selected" : ""}
          aria-pressed={scope === id}
          onClick={() => set(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function SearchBox({
  defaultValue = "",
  submit,
  label,
  placeholder = "Search events, people, or topics",
  button = "Search",
}: {
  defaultValue?: string;
  submit: (q: string) => void;
  label: string;
  placeholder?: string;
  button?: string;
}) {
  const onSubmit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    submit(String(new FormData(ev.currentTarget).get("q") || "").trim());
  };
  return (
    <form
      className="search-box"
      role="search"
      aria-label={label}
      onSubmit={onSubmit}
    >
      <Search size={19} />
      <input
        name="q"
        key={defaultValue}
        aria-label={label}
        placeholder={placeholder}
        defaultValue={defaultValue}
        maxLength={180}
      />
      <button className="primary" type="submit">
        {button}
      </button>
    </form>
  );
}

type Assessment = NonNullable<IntelEvent["intelligence"]>;
type Finding = NonNullable<IntelEvent["evidence"]>[number];

const scoreAxes = [
  { key:"impact", label:"Impact", max:30 },
  { key:"severity", label:"Severity", max:20 },
  { key:"urgency", label:"Urgency", max:20 },
  { key:"credibility", label:"Credibility", max:15 },
  { key:"proximity", label:"Proximity", max:5 },
  { key:"acceleration", label:"Acceleration", max:10 },
] as const;

export function PriorityStamp({ assessment }: { assessment: Assessment }) {
  return <span className={"sv-priority-stamp sv-tone-" + assessment.level}>
    <span className="sv-priority-reading" aria-label={"Priority " + assessment.score + " out of 100"}>
      {assessment.score}<small>/100</small>
    </span>
    <span className="sv-level"><i aria-hidden="true" />{assessment.level}</span>
  </span>;
}

export function ScoreBreakdown({ e }: { e: IntelEvent }) {
  const assessment = e.intelligence;
  if (!assessment) return null;
  const rawTier = assessment.score >= 79 ? "high" : assessment.score >= 63 ? "elevated" : "watch";
  const factors = [...new Set(assessment.reasons || [])].filter(reason => reason && reason !== assessment.why);
  const safe = sourceURL(e.url);
  return <div className={"sv-score sv-tone-" + assessment.level}>
    <div className="sv-score-heading"><h3>Priority score</h3><PriorityStamp assessment={assessment}/></div>
    <ul className="sv-score-axes" aria-label="Six priority score factors">
      {scoreAxes.map(axis => {
        const value = assessment.axes?.[axis.key];
        const available = typeof value === "number" && Number.isFinite(value);
        return <li key={axis.key} className={available ? "" : "sv-axis-empty"}>
          <span>{axis.label}</span>
          <span className="sv-axis-track" aria-hidden="true">{available && <i style={{width:Math.max(0,Math.min(100,value / axis.max * 100)) + "%"}}/>}</span>
          <span className="sv-axis-value">{available ? <><b>{value}</b> / {axis.max}</> : <><span>Unavailable</span> / {axis.max}</>}</span>
        </li>;
      })}
    </ul>
    <div className="sv-tier-key" aria-label="Score bands">
      <span className="sv-tier-floor">Below threshold <b>0–39</b></span>
      <span className="sv-tier-watch">Watch <b>40–62</b></span>
      <span className="sv-tier-elevated">Elevated <b>63–78</b></span>
      <span className="sv-tier-high">High <b>79–100</b></span>
    </div>
    {assessment.level !== rawTier && <p className="sv-cap-note">The raw score reaches {rawTier}. The published assessment is capped at {assessment.level}.</p>}
    {e.source === "National Weather Service" && <p className="sv-score-policy">NWS watches or missing urgency or certainty are limited to Watch. High requires an immediate warning with likely or observed conditions.</p>}
    {!!factors.length && <ul className="sv-reasons">{factors.map(factor => <li key={factor}>{factor}</li>)}</ul>}
    {safe && <a className="sv-origin-link" href={safe} target="_blank" rel="noreferrer"><FileText size={14} aria-hidden="true"/>{e.source}<ArrowUpRight size={13} aria-hidden="true"/></a>}
  </div>;
}

function indexedFindings(records?: Finding[]) {
  const seen = new Set<string>();
  return (records || []).filter(record => {
    const url = sourceURL(record.url);
    const key = url + "\n" + record.finding?.trim();
    if (!url || !record.finding?.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function EvidenceCounts({ e }: { e: IntelEvent }) {
  const counts = [indexedFindings(e.evidence).length,indexedFindings(e.counterevidence).length];
  return <span className="sv-evidence-counts">
    {counts.map((count,index) => <span key={index} className={"sv-evidence-count " + (index ? "sv-contrary" : "sv-supporting")}>
      <b>{count}</b><span>{index ? "Contrary" : "Supporting"} finding{count === 1 ? "" : "s"}</span>
    </span>)}
  </span>;
}

export function EvidenceComparison({ e }: { e: IntelEvent }) {
  const groups = [
    {title:"Supporting evidence", side:"sv-supporting", records:indexedFindings(e.evidence), empty:"No supporting findings are indexed."},
    {title:"Counterevidence", side:"sv-contrary", records:indexedFindings(e.counterevidence), empty:"No contrary findings are indexed."},
  ];
  return <div className="sv-evidence-grid">
    {groups.map(group => <section key={group.side} className={"sv-evidence-side " + group.side}>
      <header><h3>{group.title}</h3><span aria-label={group.records.length + (group.records.length === 1 ? " indexed finding" : " indexed findings")}>{group.records.length}</span></header>
      {group.records.length ? <ul>{group.records.map(record => <li key={record.url + record.finding}>
        <i className="sv-finding-node" aria-hidden="true"/><p>{record.finding}</p>
        <a href={sourceURL(record.url)} target="_blank" rel="noreferrer">{record.name || new URL(record.url).hostname}<ArrowUpRight size={13} aria-hidden="true"/></a>
      </li>)}</ul> : <p className="sv-empty-finding"><Minus size={15} aria-hidden="true"/>{group.empty}</p>}
    </section>)}
  </div>;
}

const utcDay = new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
const utcTime = new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit",timeZone:"UTC",timeZoneName:"short"});

function StoryChronology({ e }: { e: IntelEvent }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const input = e.timeline?.length ? e.timeline : [{at:e.publishedAt,text:"First published by " + e.source}];
  const entries = input.map((item,index) => ({...item,ms:Date.parse(item.at),key:item.at + "|" + item.text + "|" + index}))
    .sort((a,b) => (Number.isFinite(a.ms) ? a.ms : Infinity) - (Number.isFinite(b.ms) ? b.ms : Infinity));
  const dated = entries.filter(entry => Number.isFinite(entry.ms));
  const latest = dated.at(-1) || entries[0];
  const active = entries.find(entry => entry.key === chosen) || latest;
  const at = entries.indexOf(active);
  const first = dated[0]?.ms, last = dated.at(-1)?.ms;
  const utcStamp = (ms:number) => Number.isFinite(ms) ? utcDay.format(ms) + " · " + utcTime.format(ms) : "Time unavailable";
  const canPlot = first !== undefined && last !== undefined;
  const canSeek = canPlot && last > first;
  const axisLabel = (ms:number) => canSeek && utcDay.format(first) === utcDay.format(last) ? utcTime.format(ms) : utcDay.format(ms);
  const stamps = [...new Set(dated.map(entry=>entry.ms))];
  function selectByTime(ms:number) {
    let nearest = dated[0];
    for (const entry of dated) if (Math.abs(entry.ms-ms) < Math.abs(nearest.ms-ms)) nearest = entry;
    setChosen(nearest.key);
  }
  return <section className="sv-panel sv-chronology">
    <header className="sv-panel-header"><h2><Clock3 size={18} aria-hidden="true"/>Timeline</h2><span>{entries.length} update{entries.length === 1 ? "" : "s"}</span></header>
    {canPlot && <div className="sv-plot">
      <div className="sv-plot-track">
        <div className="sv-track-ruler" aria-hidden="true"/>
        {stamps.map(ms => <i aria-hidden="true" key={ms} className={ms === active.ms ? "is-selected" : ""}
          style={{left:(canSeek ? (ms-first)/(last-first)*100 : 50) + "%"}}/>)}
        {canSeek && <input className="sv-time-input" type="range" aria-label="Explore updates by time"
          min={first} max={last} step={1} value={Number.isFinite(active.ms) ? active.ms : last} aria-valuetext={utcStamp(active.ms)}
          onChange={ev => selectByTime(Number(ev.currentTarget.value))}
          onKeyDown={ev => {
            const dir = ["ArrowRight","ArrowUp"].includes(ev.key) ? 1 : ["ArrowLeft","ArrowDown"].includes(ev.key) ? -1 : 0;
            if (dir) { ev.preventDefault(); setChosen(entries[Math.max(0,Math.min(entries.length-1,at+dir))].key); }
          }}/>}
      </div>
      <div className="sv-plot-labels"><time dateTime={dated[0].at}>{axisLabel(first)}</time>{canSeek && <time dateTime={latest.at}>{axisLabel(last)}</time>}</div>
    </div>}
    <div className="sv-entry-toolbar">
      {entries.length > 1 ? <>
        <label><span className="sr-only">Choose timeline update</span><select value={active.key} onChange={ev=>setChosen(ev.target.value)}>
          {entries.map((entry,i)=><option key={entry.key} value={entry.key}>{i+1} · {utcStamp(entry.ms)}</option>)}
        </select></label>
        <div className="sv-entry-arrows">
          <button type="button" aria-label="Previous update" disabled={at===0} onClick={()=>setChosen(entries[at-1].key)}><ChevronLeft size={18}/></button>
          <button type="button" aria-label="Next update" disabled={at===entries.length-1} onClick={()=>setChosen(entries[at+1].key)}><ChevronRight size={18}/></button>
        </div>
      </> : <time dateTime={active.at}>{utcStamp(active.ms)}</time>}
    </div>
    <details key={active.key} open className="sv-history-entry">
      <summary>Recorded update <ChevronDown size={15} aria-hidden="true"/></summary>
      <p>{active.text}</p>
    </details>
  </section>;
}


export function ArticleDetail({
  e, saved, save, ask, investigate,
}: {
  e: IntelEvent;
  saved: boolean;
  save: () => void;
  ask: () => void;
  investigate: (q: string) => void;
}) {
  const bulletins = (e.bulletins || []).filter(notice => sourceURL(notice.url));
  const seen = new Set<string>();
  const sources = [{name:e.source,url:e.url}, ...(e.sources || [])].filter(record => {
    const href = sourceURL(record.url);
    if (!href || seen.has(href)) return false;
    seen.add(href);
    return true;
  });
  const monitor = e.intelligence?.monitor;
  const corrected = e.editorialType === "correction" && e.supersedes && sourceURL(e.supersedes.url);
  return <article className={"detail-page sv-dossier sv-tone-" + (e.intelligence?.level || "neutral")}>
    <header className="sv-dossier-head">
      <div className="sv-report-kicker"><span>{e.category}</span><Status value={e.status}/></div>
      <h1>{e.title}</h1>
      <div className="sv-attribution"><span><FileText size={15} aria-hidden="true"/>{e.source}</span>
        <time dateTime={e.publishedAt}><Clock3 size={15} aria-hidden="true"/>{dateTime(e.publishedAt)}</time>
      </div>
      <div className="sv-facts">
        <div><span><MapPin size={15} aria-hidden="true"/>Where</span><strong>{e.location || "Location unspecified"}</strong></div>
        <div><span><Activity size={15} aria-hidden="true"/>Reported severity</span><strong className={"sv-severity sv-severity-" + e.severity}>{e.severity}</strong></div>
        <div className="sv-next"><span><Radio size={15} aria-hidden="true"/>Monitor next</span><p>{monitor || "No follow-up is indexed for this report."}</p></div>
      </div>
      <div className="detail-actions sv-actions">
        <button className="primary" onClick={ask}><Activity size={16} aria-hidden="true"/>Ask about this story</button>
        <button className="secondary" onClick={save} aria-pressed={saved}>
          {saved ? <Check size={16} aria-hidden="true"/> : <Bookmark size={16} aria-hidden="true"/>}{saved ? "Saved to watchlist" : "Save story"}
        </button>
      </div>
    </header>
    <div className="sv-dossier-grid">
      <div className="sv-column">
        <section className="sv-panel">
          <header className="sv-panel-header"><h2><FileText size={18} aria-hidden="true"/>Report summary</h2></header>
          <p className="sv-summary">{e.summary || "The publisher provides the full report at the source link."}</p>
          {e.status === "speculation" && <p className="sv-caution">The originating source reports an allegation. Independent verification is unresolved.</p>}
          {e.intelligence?.why && <div className="sv-matters"><h3>Why it matters</h3><p>{e.intelligence.why}</p></div>}
        </section>
        {bulletins.length > 0 && (e.bulletinCount || bulletins.length) > 1 && <section className="sv-panel">
          <header className="sv-panel-header"><h2><MapPin size={18} aria-hidden="true"/>Area bulletins</h2></header>
          <p>{e.bulletinCount || bulletins.length} publisher notices cover this event. Select an area for its published instructions.</p>
          <details className="sv-notices sv-expand"><summary><span>View publisher notices ({bulletins.length})</span><ChevronDown size={16} aria-hidden="true"/></summary>
            <div>{bulletins.map((notice,index) => <a key={notice.id + index} className="sv-source-link"
              href={sourceURL(notice.url)} target="_blank" rel="noreferrer">
              <span>{notice.location || "Publisher bulletin " + (index+1)}</span><ArrowUpRight size={15} aria-hidden="true"/>
            </a>)}</div>
          </details>
        </section>}
        <StoryChronology key={e.id} e={e}/>
        <section className="sv-panel">
          <header className="sv-panel-header"><h2><Layers size={18} aria-hidden="true"/>Evidence comparison</h2></header>
          <EvidenceComparison e={e}/>
        </section>
      </div>
      <aside className="sv-column" aria-label="Assessment and sources">
        {e.intelligence && <section className="sv-panel">
          <header className="sv-panel-header"><h2><Activity size={18} aria-hidden="true"/>Signal assessment</h2></header>
          <ScoreBreakdown e={e}/>
        </section>}
        <section className="sv-panel">
          <header className="sv-panel-header"><h2><FileText size={18} aria-hidden="true"/>Sources &amp; evidence</h2></header>
          {corrected && e.supersedes && <a className="sv-source-link sv-correction" href={corrected} target="_blank" rel="noreferrer">
            <span><small>Report being corrected</small>{e.supersedes.name}</span><ArrowUpRight size={16} aria-hidden="true"/>
          </a>}
          {sources.length ? sources.map((record,i) => <a key={record.url} className="sv-source-link" href={sourceURL(record.url)} target="_blank" rel="noreferrer">
            <span><small>Source {i+1}</small>{record.name || new URL(record.url).hostname}</span><ArrowUpRight size={16} aria-hidden="true"/>
          </a>) : <p>Source link unavailable.</p>}
        </section>
        <section className="sv-panel">
          <header className="sv-panel-header"><h2>Reporting context</h2></header>
          <dl className="sv-context">
            <div><dt>Latest recorded update</dt><dd><time dateTime={e.updatedAt}>{dateTime(e.updatedAt)}</time></dd></div>
            {e.severityReason && <div><dt>Severity basis</dt><dd>{e.severityReason}</dd></div>}
            {e.expiresAt && <div><dt>Expires</dt><dd><time dateTime={e.expiresAt}>{dateTime(e.expiresAt)}</time></dd></div>}
            {e.mapNote && <div><dt>Map location</dt><dd>{e.mapNote}</dd></div>}
          </dl>
          {!e.intelligence && !!e.rankReasons?.length && <ul className="sv-reasons">{e.rankReasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>}
          <button className="link-button" onClick={()=>investigate(e.title)}>Search the archive <ChevronRight size={16} aria-hidden="true"/></button>
        </section>
      </aside>
    </div>
  </article>;
}
