import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import EventAssessment from "./EventAssessment";
import { EvidenceComparison, EvidenceCounts, PriorityStamp, SaveButton, ScoreBreakdown, Status } from "./components";
import { dateTime, relative, sourceURL, type IntelEvent } from "./types";

export function OpsPanel({
  title,
  icon,
  children,
  action,
  className = "",
  initiallyOpen = true,
  count,
  reveal = 0,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  initiallyOpen?: boolean;
  count?: number;
  reveal?: number;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  useEffect(() => {
    if (reveal > 0) setOpen(true);
  }, [reveal]);
  return (
    <section className={"ops-panel " + className}>
      <div className="ops-panel-head">
        <h2>
          <button
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            {icon}
            <span>{title}</span>
            {count !== undefined && <small>{count}</small>}
            <ChevronDown
              size={15}
              className={open ? "disclosure open" : "disclosure"}
            />
          </button>
        </h2>
        {action}
      </div>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
export function StoryLink({
  event,
  open,
  children,
}: {
  event: IntelEvent;
  open: (e: IntelEvent) => void;
  children?: ReactNode;
}) {
  return (
    <a
      href={"/story/" + encodeURIComponent(event.id)}
      onClick={(ev) => {
        if (
          ev.button === 0 &&
          !ev.ctrlKey &&
          !ev.metaKey &&
          !ev.shiftKey &&
          !ev.altKey
        ) {
          ev.preventDefault();
          open(event);
        }
      }}
    >
      {children || event.title}
    </a>
  );
}
export function StoryReview({
  event, open, saved, save, rank, location,
}: {
  event: IntelEvent;
  open: (e: IntelEvent) => void;
  saved: boolean;
  save: () => void;
  rank?: number;
  location: string;
}) {
  const assessment = event.intelligence;
  const source = sourceURL(event.url);
  return <article className={"assessment-card sv-priority-card sv-tone-" + (assessment?.level || "neutral")}>
    <div className="sv-card-bar">
      <span className="sv-category">{rank !== undefined && <b aria-label={"Rank " + (rank+1)}>{String(rank+1).padStart(2,"0")}</b>}{assessment?.category || event.category}</span>
      <SaveButton saved={saved} toggle={save}/>
    </div>
    <div className="sv-title-line">
      <h3><StoryLink event={event} open={open}/></h3>
      {assessment && <PriorityStamp assessment={assessment}/>}
    </div>
    <div className="sv-meta">
      {event.location && <span><MapPin size={13} aria-hidden="true"/>{event.location}</span>}
      <span>{event.source}</span>
      {rank !== undefined && event.hotAt
        ? <time dateTime={event.hotAt} title={dateTime(event.hotAt)}>Qualifying report {relative(event.hotAt)}</time>
        : <time dateTime={event.updatedAt} title={dateTime(event.updatedAt)}>{relative(event.updatedAt)}</time>}
      {!!event.bulletinCount && event.bulletinCount > 1 && <span className="sv-group">{event.bulletinCount} area bulletins</span>}
      {rank !== undefined && (event.topicClaim || event.status === "speculation") && <span>Narrative tracking · <Status value={event.status}/></span>}
    </div>
    {assessment?.why && <p className="sv-card-why">{assessment.why}</p>}
    <details className="assessment-details sv-expand">
      <summary><span>Assessment &amp; sources</span><ChevronDown size={15} aria-hidden="true"/></summary>
      <div className="sv-card-body">
        {!assessment?.why && event.summary && <p>{event.summary}</p>}
        {assessment?.monitor && <div className="sv-monitor"><strong>Monitor next</strong><p>{assessment.monitor}</p></div>}
        {assessment && <ScoreBreakdown e={event}/>}
        {(rank !== undefined || !assessment) && !!event.rankReasons?.length && <ul className="sv-reasons" aria-label="Ranking reasons">{event.rankReasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>}
        <EventAssessment event={event} location={location}/>
        <div className="sv-card-origin"><Status value={event.status}/>
          {source && <a href={source} target="_blank" rel="noreferrer">Original source<ArrowUpRight size={13} aria-hidden="true"/></a>}
        </div>
      </div>
    </details>
  </article>;
}

export function ClaimReview({
  event, open, saved, save,
}: {
  event: IntelEvent;
  open: (e: IntelEvent) => void;
  saved: boolean;
  save: () => void;
}) {
  const safe = sourceURL(event.url);
  const host = safe ? new URL(safe).hostname.replace(/^www\./,"") : "";
  const origin = /^(?:[^.]+\.)*reddit\.com$/.test(host) ? "Public discussion"
    : /\.gov$/.test(host) ? "Government publication" : "Publisher report";
  return <article className="claim-card sv-claim-card">
    <div className="sv-card-bar"><span className="sv-category"><BookOpen size={14} aria-hidden="true"/>{event.category}</span>
      <SaveButton saved={saved} toggle={save}/>
    </div>
    <h3><StoryLink event={event} open={open}/></h3>
    <div className="sv-meta"><Status value={event.status}/><span>{event.source}</span>
      <time dateTime={event.publishedAt} title={dateTime(event.publishedAt)}>{relative(event.publishedAt)}</time>
    </div>
    {event.summary && event.summary !== event.title && <p className="sv-card-why">{event.summary}</p>}
    <details className="assessment-details sv-expand">
      <summary><span>Evidence review</span><EvidenceCounts e={event}/><ChevronDown size={15} aria-hidden="true"/></summary>
      <div className="sv-card-body">
        <EvidenceComparison e={event}/>
        <div className="sv-source-check">
          <h4><ShieldCheck size={16} aria-hidden="true"/>Source credibility</h4>
          <p>{origin}{host && " · " + host}.{event.status === "speculation" && " Independent verification is unresolved."}</p>
          {safe && <a className="sv-origin-link" href={safe} target="_blank" rel="noreferrer">Read the originating account<ArrowUpRight size={13} aria-hidden="true"/></a>}
        </div>
      </div>
    </details>
  </article>;
}
