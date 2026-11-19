import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { geoDistance, geoGraticule, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries from "world-atlas/countries-110m.json";
import { ArrowUpRight, MapPin } from "lucide-react";
import { OpsPanel, StoryLink } from "./Operations";
import {
  dateTime,
  relative,
  type IntelEvent,
  type Intelligence,
  type Scope,
} from "./types";
import "./briefing-visuals.css";

export type RegionRecord = Intelligence["regions"][number];
type Area = RegionRecord["scope"];
const names: Record<Area, string> = {
  local: "Local",
  us: "United States",
  global: "Global",
};
const inks: Record<Area, string> = {
  local: "#85d9cb",
  us: "#8db3e0",
  global: "#c2b4df",
};
const world = countries as unknown as Topology<{ land: GeometryCollection }>;
const coast = feature(world, world.objects.land);
const grid = geoGraticule().step([30, 30])();
const scopes: Scope[] = ["all", "local", "us", "global"];

function AtlasRose() {
  return (
    <svg
      className="atlas-rose"
      aria-hidden="true"
      viewBox="0 0 30 30"
      fill="none"
    >
      <circle cx="15" cy="15" r="10.5" stroke="currentColor" strokeWidth=".8" />
      <path
        d="M15 1v5m0 18v5M1 15h5m18 0h5m-3.5-10.5-3 3m-15 15-3 3"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path d="m20.6 7.2-3.1 10.3-8.1 5.3 3.2-10.4z" fill="#8bd8c9" />
      <path d="m15 15 5.6-7.8-3.1 10.3z" fill="#496b71" />
      <circle cx="15" cy="15" r="1.4" fill="#17232d" />
    </svg>
  );
}
function useScanMotion(
  stamp: string | null | undefined,
  location: string,
  stale: boolean,
) {
  const previous = useRef<{ time: number; location: string } | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const at = Date.parse(stamp || "");
    const prev = previous.current;
    previous.current = Number.isFinite(at) ? { time: at, location } : null;
    const received =
      !!prev &&
      prev.location === location &&
      Number.isFinite(at) &&
      at > prev.time &&
      !stale;
    setChanged(received);
    if (received) {
      const timer = window.setTimeout(() => setChanged(false), 1100);
      return () => window.clearTimeout(timer);
    }
  }, [stamp, location, stale]);
  return changed;
}
function LocatorGlobe({
  scope,
  where,
  event,
}: {
  scope: Area;
  where: string;
  event?: IntelEvent;
}) {
  const id = useId();
  const hasPoint = Number.isFinite(event?.lon) && Number.isFinite(event?.lat);
  const maui =
    scope === "local" &&
    /^maui(?:,?\s+(?:county|hawaii|hi))*$/i.test(where.trim());
  const lon = hasPoint
    ? event!.lon!
    : maui
      ? -156.33
      : scope === "us"
        ? -98
        : -18;
  const lat = hasPoint ? event!.lat! : maui ? 20.8 : scope === "us" ? 38 : 19;
  const label = hasPoint
    ? "Reported area"
    : maui
      ? "Maui reference point"
      : scope === "us"
        ? "U.S. reference point"
        : "World reference";
  const marked = hasPoint || maui || scope === "us";
  const [bearing, setBearing] = useState<[number, number]>([lon, lat]);
  const position = useRef<[number, number]>([lon, lat]);
  const relocating = bearing[0] !== lon || bearing[1] !== lat;
  useEffect(() => {
    const start = position.current;
    if (start[0] === lon && start[1] === lat) return;
    const target: [number, number] = [lon, lat];
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => {
      position.current = target;
      setBearing(target);
    };
    if (preference.matches) {
      finish();
      return;
    }
    const interpolate = geoInterpolate(start, target);
    const duration = Math.min(490, 260 + geoDistance(start, target) * 100);
    const began = performance.now();
    let lastDraw = 0;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      if (t >= 1 || preference.matches) {
        finish();
        return;
      }
      // A short great-circle turn preserves geographic continuity without redrawing coastlines every frame.
      if (now - lastDraw >= 38) {
        const next = interpolate(t * t * (3 - 2 * t));
        position.current = next;
        setBearing(next);
        lastDraw = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lon, lat]);
  const globe = useMemo(() => {
    const p = geoOrthographic()
      .rotate([-bearing[0], -bearing[1]])
      .translate([60, 50])
      .scale(40)
      .precision(0.5);
    const draw = geoPath(p);
    return { land: draw(coast) || "", grid: draw(grid) || "" };
  }, [bearing]);
  return (
    <figure
      className={"atlas-locator" + (relocating ? " atlas-relocating" : "")}
    >
      <svg viewBox="0 0 120 99" role="img" aria-labelledby={id}>
        <title id={id}>
          {label}
          {hasPoint && event?.location ? " · " + event.location : ""}
        </title>
        <defs>
          <radialGradient id={id + "-light"} cx=".29" cy=".22" r=".9">
            <stop stopColor="#24485a" />
            <stop offset=".72" stopColor="#112c3d" />
            <stop offset="1" stopColor="#0a1c2a" />
          </radialGradient>
        </defs>
        <circle
          cx="60"
          cy="50"
          r="45"
          fill="none"
          stroke="#365264"
          strokeWidth=".6"
          strokeDasharray="1.2 4"
        />
        <circle
          cx="60"
          cy="50"
          r="40"
          fill={"url(#" + id + "-light)"}
          stroke="#6b96a2"
          strokeWidth=".8"
        />
        <path
          d={globe.land}
          fill="#41636b"
          stroke="#7c9d9a"
          strokeWidth=".55"
        />
        <path
          d={globe.grid}
          fill="none"
          stroke="#75a4a8"
          strokeWidth=".5"
          opacity=".67"
        />
        <path
          d="M60 2v8m0 80v7M12 50h8m80 0h8"
          fill="none"
          stroke="#92aeb4"
          strokeWidth=".7"
        />
        {marked && !relocating && (
          <g fill="none" stroke="#c0f4e8">
            <circle cx="60" cy="50" r="4" strokeWidth="1.1" />
            <path d="M51 50h4m10 0h4m-9-9v4m0 10v4" strokeWidth=".7" />
          </g>
        )}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
export function CoverageProfile({
  regions,
  all,
  stale,
}: {
  regions: RegionRecord[];
  all: number | undefined;
  stale: boolean;
}) {
  const id = useId();
  const complete =
    !stale &&
    all !== undefined &&
    all >= 0 &&
    regions.every((r) => Number.isFinite(r.count)) &&
    regions.reduce((n, r) => n + (r.count || 0), 0) === all;
  let offset = 0;
  const spans =
    complete && all
      ? regions.map((r) => {
          const x = offset;
          const length = (100 * (r.count || 0)) / all;
          offset += length;
          return { scope: r.scope, x, length };
        })
      : [];
  return (
    <figure className="atlas-profile">
      <figcaption>
        <strong>Regional distribution</strong>
        <span>
          {!complete
            ? "Current distribution unavailable"
            : all
              ? all + " priority " + (all === 1 ? "signal" : "signals")
              : "No qualifying signals"}
        </span>
      </figcaption>
      <svg
        viewBox="0 0 100 4"
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>
          {complete
            ? regions.map((r) => names[r.scope] + " " + r.count).join(", ")
            : "Current regional counts unavailable"}
        </title>
        <rect width="100" height="2.75" y=".2" fill="#2a4051" />
        {spans.map((s) => (
          <rect
            className="atlas-segment"
            key={s.scope}
            x="0"
            width="100"
            y=".2"
            height="2.75"
            fill={inks[s.scope]}
            style={{
              transform:
                "translateX(" + s.x + "%) scaleX(" + s.length / 100 + ")",
            }}
          />
        ))}
        {spans
          .slice(1)
          .filter((s) => s.length > 0 && s.x > 0)
          .map((s) => (
            <path
              key={s.scope}
              d={"M" + s.x + " 0v3.1"}
              stroke="#0b1926"
              strokeWidth=".4"
            />
          ))}
        {[0, 25, 50, 75, 100].map((x) => (
          <path
            key={x}
            d={"M" + x + " 3.35v.65"}
            stroke="#607786"
            strokeWidth=".2"
          />
        ))}
      </svg>
    </figure>
  );
}
type AtlasProps = {
  scope: Scope;
  where: string;
  regions: RegionRecord[];
  lead?: IntelEvent;
  wider?: IntelEvent;
  last?: string | null;
  pending: boolean;
  stale: boolean;
  choose: (scope: Scope) => void;
  open: (event: IntelEvent) => void;
  map: ReactNode;
  telemetry: ReactNode;
};
export function SituationAtlas({
  scope,
  where,
  regions,
  lead,
  wider,
  last,
  pending,
  stale,
  choose,
  open,
  map,
  telemetry,
}: AtlasProps) {
  const area = scope === "all" ? "local" : scope;
  const region = regions.find((r) => r.scope === area);
  const level = region?.level || "unknown";
  const place = area === "local" ? where : names[area];
  const motion = useScanMotion(last, where, stale);
  const quiet = level === "quiet";
  const unknown = level === "unknown";
  const headline = unknown
    ? stale
      ? "Assessment out of date"
      : "Awaiting an assessment"
    : quiet
      ? "No qualifying signals"
      : lead?.intelligence?.why || lead?.title || "Priority activity detected";
  const supporting = unknown
    ? region?.reason || "Waiting for a successful scan."
    : quiet
      ? "The latest scan found no reports meeting the significance criteria for this area."
      : lead?.intelligence?.monitor || region?.reason;
  return (
    <OpsPanel
      title="Situation overview"
      icon={<AtlasRose />}
      className={"atlas-sheet" + (motion ? " atlas-scan-received" : "")}
      action={
        <div
          className="atlas-switches"
          role="group"
          aria-label="Situation overview focus"
        >
          {scopes.map((s) => (
            <button
              type="button"
              key={s}
              aria-pressed={s === scope}
              data-focus={s}
              onClick={() => choose(s)}
            >
              {s === "all" ? "Overview" : s === "us" ? "U.S." : names[s]}
            </button>
          ))}
        </div>
      }
    >
      <div className="atlas-stage">
        <article
          className={"atlas-dispatch atlas-level-" + level}
          aria-label={place + " assessment"}
        >
          <div className="atlas-location-head">
            <div>
              <span className="atlas-caption">
                <MapPin size={13} />
                {area === "local" ? "Local assessment" : "Regional assessment"}
              </span>
              <h3>{place}</h3>
              <span className={"atlas-state atlas-state-" + level}>
                {level}
              </span>
            </div>
            <LocatorGlobe scope={area} where={where} event={lead} />
          </div>
          <p className="atlas-takeaway">{headline}</p>
          {supporting && <p className="atlas-support">{supporting}</p>}
          {lead && !unknown && !quiet && (
            <p className="atlas-source-line">
              <StoryLink event={lead} open={open}>
                Inspect source report <ArrowUpRight size={13} />
              </StoryLink>
              <span>{lead.source}</span>
            </p>
          )}
          <div className="atlas-secondary">
            {wider ? (
              <>
                <span className="atlas-caption">
                  <i /> {stale ? "Last known " : ""}
                  {wider.scope === "local"
                    ? "Local signal"
                    : "Wider signal"} · {names[wider.scope]}
                </span>
                <h4>
                  <StoryLink event={wider} open={open} />
                </h4>
                <div className="atlas-publisher">
                  <span>{wider.source}</span>
                  <time
                    dateTime={wider.updatedAt}
                    title={dateTime(wider.updatedAt)}
                  >
                    {relative(wider.updatedAt)}
                  </time>
                </div>
              </>
            ) : (
              <div className="atlas-extent-note">
                <span className="atlas-caption">Wider coverage</span>
                <p>
                  {pending
                    ? "Reading regional reports…"
                    : stale
                      ? "Check source health for the next successful scan."
                      : regions.every(
                            (r) => r.scope === area || r.level === "quiet",
                          )
                        ? "No additional region has a qualifying signal in this scan."
                        : "Regional source material is available in the threat scanner."}
                </p>
              </div>
            )}
          </div>
        </article>
        <div className="atlas-mapframe">{map}</div>
      </div>
      {telemetry}
    </OpsPanel>
  );
}
