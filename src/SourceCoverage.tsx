import { useState } from "react";
import { Activity, CircleAlert, CircleCheck, CircleDashed, CircleSlash } from "lucide-react";
import { dateTime, relative, type SourceHealth } from "./types";

const states = [
  { key: "ok", label: "Healthy", Icon: CircleCheck },
  { key: "error", label: "Unavailable", Icon: CircleAlert },
  { key: "pending", label: "Pending", Icon: CircleDashed },
  { key: "disabled", label: "Disabled", Icon: CircleSlash },
] as const;
type Filter = SourceHealth["status"] | "all";

export default function SourceCoverage({ sources }: { sources: SourceHealth[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const groups = states.map(state => ({ ...state, count: sources.filter(row => row.status === state.key).length }));
  const healthy = groups[0].count;
  const enabled = sources.filter(row => row.status !== "disabled").length;
  const visible = filter === "all" ? sources : sources.filter(row => row.status === filter);
  return (
    <section className="coverage-console" aria-label="Source coverage">
      <div className="coverage-overview">
        <div><h2>Reporting coverage</h2>
          <p><strong>{healthy}<span> / {enabled}</span></strong> enabled sources healthy</p>
        </div>
        <div className="coverage-distribution">
          <div className="coverage-scale" aria-hidden="true">
            {groups.flatMap(({key,count}) => Array.from({length:count},(_,i) =>
              <i key={key+i} className={"coverage-segment state-"+key} />))}
          </div>
          <div className="coverage-filters" role="group" aria-label="Filter providers by status">
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <b>{sources.length}</b></button>
            {groups.filter(group => group.count || group.key === filter).map(({key,label,count,Icon}) =>
              <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                <Icon size={13} className={"state-"+key} aria-hidden="true"/>{label} <b>{count}</b>
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="source-index">
        <div className="source-index-heading"><Activity size={18}/><h2>Provider status</h2>
          <span aria-live="polite">{visible.length} {visible.length === 1 ? "source" : "sources"}</span>
        </div>
        <ul>
          {visible.map(row => {
            const state = states.find(item => item.key === row.status) || states[2];
            return <li key={row.id} className={"source-line state-"+state.key}>
              <span className="source-badge"><state.Icon size={17}/>{state.label}</span>
              <div className="source-name"><h3>{row.name}</h3>{row.detail && <p>{row.detail}</p>}</div>
              <div className="source-clock">
                <span>{row.lastSuccess ? "Last success" : "Last successful check"}</span>
                {row.lastSuccess
                  ? <time dateTime={row.lastSuccess} title={dateTime(row.lastSuccess)}>{relative(row.lastSuccess)}</time>
                  : <strong>None recorded</strong>}
                {row.intervalMinutes && <small>Checks every {row.intervalMinutes} min</small>}
              </div>
            </li>;
          })}
        </ul>
        {!visible.length && <p className="source-empty">No providers have this status in the latest collection.</p>}
      </div>
    </section>
  );
}
