import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { SaveButton, Status } from "./components";
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
  event,
  open,
  saved,
  save,
  rank,
}: {
  event: IntelEvent;
  open: (e: IntelEvent) => void;
  saved: boolean;
  save: () => void;
  rank?: number;
}) {
  const assessment = event.intelligence;
  const factors = assessment?.reasons?.length
    ? assessment.reasons
    : event.rankReasons;
  return (
    <article className={"assessment-card " + (assessment?.level || "")}>
      <div className="assessment-top">
        <span className="assessment-type">
          {rank !== undefined && <b>{String(rank + 1).padStart(2, "0")}</b>}
          {assessment?.category || event.category}
        </span>
        <span className="assessment-tools">
          {assessment && (
            <span className={"level level-" + assessment.level}>
              {assessment.level}
            </span>
          )}
          <SaveButton saved={saved} toggle={save} />
        </span>
      </div>
      <h3>
        <StoryLink event={event} open={open} />
      </h3>
      <div className="assessment-meta">
        {event.location && (
          <span>
            <MapPin size={12} />
            {event.location}
          </span>
        )}
        <span>{event.source}</span>
        {rank !== undefined &&
          (event.topicClaim || event.status === "speculation") && (
            <span>
              Narrative tracking · <Status value={event.status} />
            </span>
          )}
        {!!event.bulletinCount && event.bulletinCount > 1 && (
          <span>{event.bulletinCount} area bulletins</span>
        )}
        <time dateTime={event.updatedAt} title={dateTime(event.updatedAt)}>
          {relative(event.updatedAt)}
        </time>
      </div>
      {assessment?.why && <p className="why-line">{assessment.why}</p>}
      <details className="assessment-details">
        <summary>
          Assessment &amp; sources
          <ChevronDown size={14} />
        </summary>
        <div>
          {!assessment?.why && event.summary && <p>{event.summary}</p>}
          {assessment?.monitor && (
            <p>
              <b>Monitor next</b> {assessment.monitor}
            </p>
          )}
          {!!factors?.length && (
            <ul>
              {factors.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          <div className="inline-links">
            <Status value={event.status} />
            {sourceURL(event.url) && (
              <a href={sourceURL(event.url)} target="_blank" rel="noreferrer">
                Original source
                <ArrowUpRight size={13} />
              </a>
            )}
          </div>
        </div>
      </details>
    </article>
  );
}
function ReferenceGroup({
  title,
  records,
  empty,
}: {
  title: string;
  records?: { name: string; url: string; finding: string }[];
  empty: string;
}) {
  const valid = (records || []).filter((r) => sourceURL(r.url));
  return (
    <div>
      <h4>{title}</h4>
      {valid.length ? (
        <ul>
          {valid.map((r, i) => (
            <li key={i}>
              {r.finding}{" "}
              <a href={sourceURL(r.url)} target="_blank" rel="noreferrer">
                {r.name}
                <ArrowUpRight size={12} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>{empty}</p>
      )}
    </div>
  );
}
export function ClaimReview({
  event,
  open,
  saved,
  save,
}: {
  event: IntelEvent;
  open: (e: IntelEvent) => void;
  saved: boolean;
  save: () => void;
}) {
  const safe = sourceURL(event.url);
  const host = safe ? new URL(safe).hostname.replace(/^www\./, "") : "";
  const origin = /^(?:[^.]+\.)*reddit\.com$/.test(host)
    ? "Public discussion"
    : /\.gov$/.test(host)
      ? "Government publication"
      : "Publisher report";
  return (
    <article className="claim-card">
      <div className="assessment-top">
        <span className="assessment-type">{event.category}</span>
        <SaveButton saved={saved} toggle={save} />
      </div>
      <h3>
        <StoryLink event={event} open={open} />
      </h3>
      <div className="assessment-meta">
        <Status value={event.status} />
        <span>{event.source}</span>
        <time dateTime={event.publishedAt}>{relative(event.publishedAt)}</time>
      </div>
      {event.summary !== event.title && (
        <p className="why-line">{event.summary}</p>
      )}
      <details className="assessment-details">
        <summary>
          <BookOpen size={14} />
          Evidence review
          <ChevronDown size={14} />
        </summary>
        <div className="claim-evidence">
          <ReferenceGroup
            title="Supporting evidence"
            records={event.evidence}
            empty="No supporting findings are indexed for this claim."
          />
          <ReferenceGroup
            title="Counterevidence"
            records={event.counterevidence}
            empty="No contrary findings are indexed for this claim."
          />
          <div>
            <h4>
              <ShieldCheck size={14} />
              Source credibility
            </h4>
            <p>
              {origin}
              {host ? " · " + host : ""}.{" "}
              {event.status === "speculation"
                ? "The archive documents an allegation. Independent verification is unresolved."
                : "Use the linked material to check the reported facts and attribution."}
            </p>
            {safe && (
              <a href={safe} target="_blank" rel="noreferrer">
                Read the originating account
                <ArrowUpRight size={13} />
              </a>
            )}
          </div>
        </div>
      </details>
    </article>
  );
}
