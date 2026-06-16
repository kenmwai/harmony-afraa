import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  FIRS, TRIAL_STAGE_META,
  type AppSession, type FlightReportRow, type IncidentSeverity,
  type SegmentRow, type TrialScheduleRow, type TrialStage, type UPRRow,
} from "@/lib/upr-types";
import { uploadIncidentImage, getImageUrl } from "@/lib/upr-storage";
import { jsPDF } from "jspdf";

function computeVerdict(segs: SegmentRow[]): "PENDING" | "APPROVED" | "REJECTED" {
  if (!segs.length) return "PENDING";
  if (segs.some((s) => s.status === "rejected")) return "REJECTED";
  if (segs.every((s) => s.status === "approved")) return "APPROVED";
  return "PENDING";
}

const SEV_META: Record<IncidentSeverity, { color: string; label: string }> = {
  none: { color: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40", label: "No incident" },
  minor: { color: "bg-sky-500/20 text-sky-200 ring-sky-500/40", label: "Minor" },
  major: { color: "bg-amber-500/20 text-amber-200 ring-amber-500/40", label: "Major" },
  critical: { color: "bg-red-500/20 text-red-200 ring-red-500/40", label: "Critical" },
};

const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtD = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ─────────── Schedule progressive trial (Airline) ───────────

export function ScheduleProgressiveTrial({ upr, segs, schedules }: { upr: UPRRow; segs: SegmentRow[]; schedules: TrialScheduleRow[] }) {
  const verdict = computeVerdict(segs);
  const mine = schedules.filter((s) => s.upr_id === upr.id).sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  const flown = (st: TrialStage) => mine.some((s) => s.stage === st && new Date(s.end_at).getTime() <= Date.now());
  const nextStage: TrialStage = !flown("day1") ? "day1" : !flown("day3") ? "day3" : "day7";

  const [stage, setStage] = useState<TrialStage>(nextStage);
  const [when, setWhen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (verdict !== "APPROVED") return null;

  const save = async () => {
    setErr("");
    if (!when) { setErr("Pick a start date & time"); return; }
    setBusy(true);
    const start = new Date(when);
    const end = new Date(start.getTime() + TRIAL_STAGE_META[stage].days * 86_400_000);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("trial_schedules" as any).insert({
      upr_id: upr.id, stage, start_at: start.toISOString(), end_at: end.toISOString(),
      created_by: u.user?.id,
    } as any);
    // also mirror first trial onto uprs.trial_at for legacy UI
    if (!upr.trial_at) await supabase.from("uprs").update({ trial_at: start.toISOString() } as any).eq("id", upr.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setWhen("");
  };

  return (
    <div className="rounded-xl bg-emerald-500/5 ring-1 ring-emerald-500/30 p-4 space-y-3">
      <div>
        <div className="text-sm font-semibold text-emerald-200">Schedule progressive trial</div>
        <div className="text-[11px] text-emerald-300/70">
          Progress through 1-day → 3-day → 7-day. Next recommended: <span className="text-emerald-100">{TRIAL_STAGE_META[nextStage].label}</span>
        </div>
      </div>

      <div className="flex gap-1.5">
        {(["day1", "day3", "day7"] as TrialStage[]).map((s) => {
          const m = TRIAL_STAGE_META[s];
          const isFlown = flown(s);
          return (
            <button key={s} onClick={() => setStage(s)} className={`flex-1 text-[11px] px-2 py-1.5 rounded ring-1 ${stage === s ? `${m.bg} ${m.color} ${m.ring}` : "bg-slate-900 text-slate-400 ring-slate-800"}`}>
              {m.label} {isFlown && <span className="text-emerald-400">✓</span>}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2 items-end">
        <label className="flex-1 block">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Start date & time</span>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            className="mt-1 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-emerald-500 outline-none" />
        </label>
        <button onClick={save} disabled={busy} className="text-xs px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-emerald-950 font-semibold">
          {busy ? "…" : "Schedule"}
        </button>
      </div>
      {err && <div className="text-[11px] text-rose-400">{err}</div>}

      {mine.length > 0 && (
        <div className="pt-2 border-t border-emerald-500/20 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-emerald-300/70">Booked trials</div>
          {mine.map((s) => {
            const m = TRIAL_STAGE_META[s.stage];
            return (
              <div key={s.id} className="flex items-center justify-between text-[11px] bg-slate-950/40 rounded px-2 py-1">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 ${m.bg} ${m.color} ${m.ring}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} /> {m.label}
                </span>
                <span className="text-slate-300">{fmtDT(s.start_at)} → {fmtDT(s.end_at)}</span>
                <button onClick={async () => { await supabase.from("trial_schedules" as any).delete().eq("id", s.id); }} className="text-slate-500 hover:text-rose-400">×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────── Stage-colored Trial Calendar ───────────

export function StagedTrialCalendar({
  uprs, segments, schedules, title, filter,
}: {
  uprs: UPRRow[]; segments: SegmentRow[]; schedules: TrialScheduleRow[]; title: string;
  filter: { type: "all" } | { type: "airline"; code: string } | { type: "fir"; code: string };
}) {
  const filtered = useMemo(() => {
    return schedules.filter((s) => {
      const u = uprs.find((x) => x.id === s.upr_id);
      if (!u) return false;
      if (filter.type === "all") return true;
      if (filter.type === "airline") return u.airline_code === filter.code;
      return segments.some((seg) => seg.upr_id === u.id && seg.fir_code === filter.code);
    });
  }, [uprs, segments, schedules, filter]);

  const [cursor, setCursor] = useState<Date>(() => { const d = new Date(); d.setDate(1); return d; });
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // span schedules across days
  const dayHas = (d: number) => {
    const cellStart = new Date(year, month, d).getTime();
    const cellEnd = cellStart + 86_400_000;
    return filtered.filter((s) => {
      const a = new Date(s.start_at).getTime();
      const b = new Date(s.end_at).getTime();
      return a < cellEnd && b > cellStart;
    });
  };

  const cells: ({ day: number; trials: TrialScheduleRow[] } | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, trials: dayHas(d) });

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-slate-400">{filtered.length} scheduled trial{filtered.length === 1 ? "" : "s"}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="text-xs px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800">‹</button>
          <div className="text-sm font-medium w-32 text-center">{cursor.toLocaleString("en-GB", { month: "long", year: "numeric" })}</div>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="text-xs px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800">›</button>
        </div>
      </div>

      <div className="flex gap-3 text-[10px] mb-2">
        {(["day1", "day3", "day7"] as TrialStage[]).map((s) => {
          const m = TRIAL_STAGE_META[s];
          return <span key={s} className="inline-flex items-center gap-1 text-slate-400"><span className={`h-2 w-2 rounded-full ${m.dot}`} />{m.label}</span>;
        })}
      </div>

      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => (
          <div key={i} className={`min-h-[76px] rounded-md p-1 text-[10px] ${c ? "bg-slate-950/60 ring-1 ring-slate-800" : ""}`}>
            {c && (
              <>
                <div className="text-slate-400 mb-0.5">{c.day}</div>
                <div className="space-y-0.5">
                  {c.trials.slice(0, 3).map((s) => {
                    const u = uprs.find((x) => x.id === s.upr_id);
                    const m = TRIAL_STAGE_META[s.stage];
                    return (
                      <div key={s.id} className={`${m.bg} ${m.color} ring-1 ${m.ring} rounded px-1 py-0.5 truncate`}>
                        <span className="font-mono">{u?.callsign ?? "—"}</span> · {m.label.split("-")[0]}
                      </div>
                    );
                  })}
                  {c.trials.length > 3 && <div className="text-slate-500">+{c.trials.length - 3}</div>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────── Flight Report Form (template) ───────────

export function FlightReportForm({ upr, session, schedules }: { upr: UPRRow; session: AppSession; schedules: TrialScheduleRow[] }) {
  if (session.role !== "airline" && session.role !== "ansp") return null;
  const mine = schedules.filter((s) => s.upr_id === upr.id).sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
  if (mine.length === 0) return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4 text-[11px] text-slate-400">
      No trial scheduled yet — flight report opens after a trial is booked.
    </div>
  );

  // savings projection from request
  const projTime = Math.max(0, upr.baseline_minutes - upr.optimized_minutes);
  const projFuel = projTime * Number(upr.burn_kg_per_min);
  const projCO2 = projFuel * 3.16;

  const [stage, setStage] = useState<TrialStage>(mine[0].stage);
  const [flightDate, setFlightDate] = useState("");
  const [blockOff, setBlockOff] = useState("");
  const [takeoff, setTakeoff] = useState("");
  const [blockOn, setBlockOn] = useState("");
  const [landing, setLanding] = useState("");
  const [baseRoute, setBaseRoute] = useState("");
  const [uprRoute, setUprRoute] = useState("");
  const [realTime, setRealTime] = useState<string>(projTime.toString());
  const [realFuel, setRealFuel] = useState<string>(projFuel.toFixed(0));
  const [realCO2, setRealCO2] = useState<string>(projCO2.toFixed(0));
  const [cost, setCost] = useState("");

  const [rating, setRating] = useState(4);
  const [severity, setSeverity] = useState<IncidentSeverity>("none");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  // recompute fuel/co2 from time when realised time changes
  const onTimeChange = (v: string) => {
    setRealTime(v);
    const t = Number(v) || 0;
    const f = t * Number(upr.burn_kg_per_min);
    setRealFuel(f.toFixed(0));
    setRealCO2((f * 3.16).toFixed(0));
  };

  const submit = async () => {
    setErr("");
    if (!description.trim()) { setErr("Add observations / description"); return; }
    setBusy(true);
    try {
      const paths: string[] = [];
      for (const f of images) paths.push(await uploadIncidentImage(f, upr.id));
      const party = session.role === "airline" ? "airline" : "ansp";
      const label = session.role === "airline"
        ? `${upr.airline_code} Dispatcher`
        : `${session.scope} ${FIRS.find((f) => f.code === session.scope)?.name ?? ""}`;
      const { error } = await supabase.from("flight_reports" as any).insert({
        upr_id: upr.id,
        author: session.userId,
        author_label: label,
        party, party_scope: session.scope ?? "",
        trial_stage: stage,
        flight_date: flightDate || null,
        block_off: blockOff ? new Date(blockOff).toISOString() : null,
        takeoff: takeoff ? new Date(takeoff).toISOString() : null,
        block_on: blockOn ? new Date(blockOn).toISOString() : null,
        landing: landing ? new Date(landing).toISOString() : null,
        base_route: baseRoute.trim(),
        upr_route: uprRoute.trim(),
        projected_time_min: projTime,
        projected_fuel_kg: projFuel,
        projected_co2_kg: projCO2,
        realised_time_min: Number(realTime) || 0,
        realised_fuel_kg: Number(realFuel) || 0,
        realised_co2_kg: Number(realCO2) || 0,
        cost_savings_usd: Number(cost) || 0,
        incident_rating: rating,
        incident_severity: severity,
        incident_description: description.trim(),
        image_paths: paths,
        notes: "",
      } as any);
      if (error) throw error;
      setDone(true);
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    setBusy(false);
  };

  if (done) return (
    <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30 p-4 text-emerald-200 text-sm">
      ✓ Flight report submitted. <button className="underline" onClick={() => { setDone(false); setDescription(""); setImages([]); }}>Add another</button>
    </div>
  );

  const stageMeta = TRIAL_STAGE_META[stage];

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4 space-y-4">
      <div>
        <div className="text-sm font-semibold">Trial flight report</div>
        <div className="text-[11px] text-slate-400">Template — captures flight, savings & embedded incident.</div>
      </div>

      <div>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Trial stage</span>
        <div className="flex gap-1.5 mt-1">
          {mine.map((s) => {
            const m = TRIAL_STAGE_META[s.stage];
            return (
              <button key={s.id} onClick={() => setStage(s.stage)} className={`flex-1 text-[11px] px-2 py-1.5 rounded ring-1 ${stage === s.stage ? `${m.bg} ${m.color} ${m.ring}` : "bg-slate-900 text-slate-400 ring-slate-800"}`}>
                {m.label} <span className="opacity-60">· {fmtD(s.start_at)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Airline" value={upr.airline_code} readOnly />
        <Field label="Flight no." value={upr.flight_no} readOnly />
        <Field label="Aircraft type" value={upr.aircraft} readOnly />
        <Field label="Flight date" type="date" value={flightDate} onChange={setFlightDate} />
        <Field label="Origin" value={upr.dep} readOnly />
        <Field label="Destination" value={upr.arr} readOnly />
        <Field label="Block-off" type="datetime-local" value={blockOff} onChange={setBlockOff} />
        <Field label="Take-off" type="datetime-local" value={takeoff} onChange={setTakeoff} />
        <Field label="Block-on" type="datetime-local" value={blockOn} onChange={setBlockOn} />
        <Field label="Landing" type="datetime-local" value={landing} onChange={setLanding} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Base route (filed)" value={baseRoute} onChange={setBaseRoute} placeholder="e.g. UR982 DCT WPT…" />
        <Field label="UPR route (flown)" value={uprRoute} onChange={setUprRoute} placeholder="Direct routing waypoints" />
      </div>

      <div className="rounded-lg bg-slate-950/40 ring-1 ring-slate-800 p-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Projected savings (from request)</div>
        <div className="grid grid-cols-3 gap-3 text-[12px]">
          <Pair label="Time" value={`${projTime} min`} />
          <Pair label="Fuel" value={`${projFuel.toFixed(0)} kg`} />
          <Pair label="CO₂" value={`${projCO2.toFixed(0)} kg`} />
        </div>
      </div>

      <div className="rounded-lg bg-slate-950/40 ring-1 ring-emerald-500/30 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-emerald-300">Realised savings</div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Time saved (min)" type="number" value={realTime} onChange={onTimeChange} />
          <Field label="Fuel saved (kg)" type="number" value={realFuel} onChange={setRealFuel} />
          <Field label="CO₂ avoided (kg)" type="number" value={realCO2} onChange={setRealCO2} />
        </div>
        <Field label="Total cost savings (USD)" type="number" value={cost} onChange={setCost} placeholder="0.00" />
      </div>

      <div className="rounded-lg bg-slate-950/40 ring-1 ring-slate-800 p-3 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Incident / feedback (embedded)</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Trial rating</span>
            <div className="flex gap-1 mt-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setRating(n)} className={`flex-1 py-1.5 rounded text-sm ${rating >= n ? "bg-amber-400 text-amber-950" : "bg-slate-800 text-slate-500"}`}>★</button>
              ))}
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)} className="mt-1 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none">
              {(["none", "minor", "major", "critical"] as const).map((s) => <option key={s} value={s}>{SEV_META[s].label}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Description / observations</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="ATC handling, weather, traffic, fuel notes…" className="mt-1 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none" />
        </label>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Attach photos ({images.length})</div>
          <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-md ring-1 ring-slate-700 hover:bg-slate-800">+ Add image</button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
            const fs = Array.from(e.target.files ?? []); setImages((p) => [...p, ...fs]); e.target.value = "";
          }} />
          {images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {images.map((f, i) => (
                <div key={i} className="text-[10px] bg-slate-800 ring-1 ring-slate-700 rounded px-1.5 py-0.5 flex items-center gap-1">
                  <span className="truncate max-w-[140px]">{f.name}</span>
                  <button onClick={() => setImages((p) => p.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-rose-400">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {err && <div className="text-[11px] text-rose-400">{err}</div>}
      <button onClick={submit} disabled={busy} className={`w-full disabled:opacity-40 text-slate-950 font-semibold rounded-md py-2 text-sm ${stageMeta.bg.replace("/20", "")} hover:opacity-90`}>
        {busy ? "Submitting…" : `Submit ${stageMeta.label} report`}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", readOnly, placeholder }: {
  label: string; value: string; onChange?: (v: string) => void; type?: string; readOnly?: boolean; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      <input type={type} value={value} placeholder={placeholder} readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        className={`mt-1 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none ${readOnly ? "text-slate-400" : ""}`} />
    </label>
  );
}
function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-slate-200 font-semibold">{value}</div>
    </div>
  );
}

// ─────────── Flight reports list + PDF (per-UPR & aggregated) ───────────

export function FlightReportsList({
  uprs, reports, schedules, scopeLabel, showAggregateButton = true,
}: {
  uprs: UPRRow[]; reports: FlightReportRow[]; schedules: TrialScheduleRow[]; scopeLabel: string; showAggregateButton?: boolean;
}) {
  const byUpr = useMemo(() => {
    const m = new Map<string, FlightReportRow[]>();
    for (const r of reports) {
      const arr = m.get(r.upr_id) ?? [];
      arr.push(r); m.set(r.upr_id, arr);
    }
    return m;
  }, [reports]);

  const totals = useMemo(() => {
    return reports.reduce((acc, r) => ({
      flights: acc.flights + 1,
      time: acc.time + Number(r.realised_time_min || 0),
      fuel: acc.fuel + Number(r.realised_fuel_kg || 0),
      co2: acc.co2 + Number(r.realised_co2_kg || 0),
      usd: acc.usd + Number(r.cost_savings_usd || 0),
    }), { flights: 0, time: 0, fuel: 0, co2: 0, usd: 0 });
  }, [reports]);

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Trial flight reports ({reports.length})</div>
          <div className="text-[11px] text-slate-400">{scopeLabel}</div>
        </div>
        {showAggregateButton && reports.length > 0 && (
          <button onClick={() => exportAggregatedReport(uprs, reports, schedules, scopeLabel)} className="text-[11px] px-3 py-1.5 rounded bg-fuchsia-500 hover:bg-fuchsia-400 text-slate-950 font-semibold">
            Download aggregated PDF
          </button>
        )}
      </div>

      {reports.length > 0 && (
        <div className="grid grid-cols-5 gap-3">
          <Stat label="Flights" value={totals.flights.toString()} />
          <Stat label="Time saved" value={`${totals.time.toFixed(0)} min`} />
          <Stat label="Fuel saved" value={`${totals.fuel.toFixed(0)} kg`} />
          <Stat label="CO₂ avoided" value={`${totals.co2.toFixed(0)} kg`} />
          <Stat label="USD saved" value={`$${totals.usd.toFixed(0)}`} />
        </div>
      )}

      {reports.length === 0 ? (
        <div className="text-xs text-slate-500 py-6 text-center">No flight reports yet.</div>
      ) : (
        <div className="space-y-3">
          {[...byUpr.entries()].map(([uprId, rows]) => {
            const upr = uprs.find((u) => u.id === uprId);
            if (!upr) return null;
            return (
              <div key={uprId} className="rounded-lg bg-slate-950/40 ring-1 ring-slate-800 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm">
                    <span className="font-mono text-sky-300">{upr.callsign}</span>
                    <span className="text-slate-400"> · {upr.airline_code} · {upr.dep} → {upr.arr}</span>
                  </div>
                  <button onClick={() => exportFlightReport(upr, rows)} className="text-[11px] px-2 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold">
                    Download PDF
                  </button>
                </div>
                <div className="grid gap-2">
                  {rows.map((r) => <ReportCard key={r.id} row={r} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-950/40 ring-1 ring-slate-800 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-base font-semibold mt-0.5 bg-gradient-to-br from-emerald-300 to-sky-400 bg-clip-text text-transparent">{value}</div>
    </div>
  );
}

function ReportCard({ row }: { row: FlightReportRow }) {
  const m = TRIAL_STAGE_META[row.trial_stage];
  return (
    <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md p-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 ${m.bg} ${m.color} ${m.ring}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
          </span>
          <span className="uppercase tracking-wider font-semibold text-slate-300">{row.party}</span>
          <span className="text-slate-500">· {row.author_label}</span>
        </div>
        <div className="flex items-center gap-2">
          {row.incident_rating && <span className="text-amber-300">{"★".repeat(row.incident_rating)}<span className="text-slate-700">{"★".repeat(5 - row.incident_rating)}</span></span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${SEV_META[row.incident_severity].color}`}>{SEV_META[row.incident_severity].label}</span>
          <span className="text-slate-500">{fmtDT(row.created_at)}</span>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 mt-2 text-[11px]">
        <Mini label="Block-off" value={fmtDT(row.block_off)} />
        <Mini label="Take-off" value={fmtDT(row.takeoff)} />
        <Mini label="Block-on" value={fmtDT(row.block_on)} />
        <Mini label="Landing" value={fmtDT(row.landing)} />
      </div>
      <div className="grid grid-cols-4 gap-2 mt-1.5 text-[11px]">
        <Mini label="Time saved" value={`${Number(row.realised_time_min).toFixed(0)} / ${Number(row.projected_time_min).toFixed(0)} min`} />
        <Mini label="Fuel saved" value={`${Number(row.realised_fuel_kg).toFixed(0)} / ${Number(row.projected_fuel_kg).toFixed(0)} kg`} />
        <Mini label="CO₂ avoided" value={`${Number(row.realised_co2_kg).toFixed(0)} / ${Number(row.projected_co2_kg).toFixed(0)} kg`} />
        <Mini label="Cost saved" value={`$${Number(row.cost_savings_usd).toFixed(0)}`} />
      </div>
      {(row.base_route || row.upr_route) && (
        <div className="mt-1.5 text-[11px] text-slate-300">
          {row.base_route && <div><span className="text-slate-500">Base:</span> {row.base_route}</div>}
          {row.upr_route && <div><span className="text-slate-500">UPR:</span> {row.upr_route}</div>}
        </div>
      )}
      {row.incident_description && <div className="text-sm text-slate-200 mt-1.5 whitespace-pre-wrap">{row.incident_description}</div>}
      {row.image_paths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.image_paths.map((p) => <ReportImage key={p} path={p} />)}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-950/40 rounded px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-slate-200">{value}</div>
    </div>
  );
}

function ReportImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { getImageUrl(path).then(setUrl).catch(() => setUrl(null)); }, [path]);
  if (!url) return <div className="h-20 w-28 rounded bg-slate-800 animate-pulse" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img src={url} alt="Report attachment" className="h-20 w-28 object-cover rounded ring-1 ring-slate-700 hover:ring-sky-500/60 transition" />
    </a>
  );
}

// ─────────── PDF generators ───────────

async function exportFlightReport(upr: UPRRow, rows: FlightReportRow[]) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = 56;

  doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text("Harmony by AFRAA — Trial Flight Report", 40, y); y += 22;
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString("en-GB")}`, 40, y); y += 18;
  doc.setTextColor(0);

  doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text(`${upr.callsign}  (${upr.flight_no})`, 40, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Airline: ${upr.airline_code}    Route: ${upr.dep} → ${upr.arr}    Aircraft: ${upr.aircraft}`, 40, y); y += 14;
  doc.text(`Burn rate: ${upr.burn_kg_per_min} kg/min    Submissions: ${rows.length}`, 40, y); y += 18;

  for (const r of rows) {
    if (y > 720) { doc.addPage(); y = 56; }
    doc.setDrawColor(220); doc.line(40, y, W - 40, y); y += 12;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(`${TRIAL_STAGE_META[r.trial_stage].label} · ${r.party.toUpperCase()} · ${r.author_label}`, 40, y); y += 14;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Flight date: ${fmtD(r.flight_date)}    Submitted: ${fmtDT(r.created_at)}`, 40, y); y += 12;
    doc.text(`Block-off: ${fmtDT(r.block_off)}    Takeoff: ${fmtDT(r.takeoff)}`, 40, y); y += 12;
    doc.text(`Block-on:  ${fmtDT(r.block_on)}    Landing: ${fmtDT(r.landing)}`, 40, y); y += 12;
    if (r.base_route) { doc.text(`Base route: ${r.base_route}`, 40, y); y += 12; }
    if (r.upr_route) { doc.text(`UPR route:  ${r.upr_route}`, 40, y); y += 12; }
    doc.setFont("helvetica", "bold"); doc.text("Savings — projected → realised", 40, y); y += 12;
    doc.setFont("helvetica", "normal");
    doc.text(`Time:  ${Number(r.projected_time_min).toFixed(0)} → ${Number(r.realised_time_min).toFixed(0)} min`, 40, y); y += 11;
    doc.text(`Fuel:  ${Number(r.projected_fuel_kg).toFixed(0)} → ${Number(r.realised_fuel_kg).toFixed(0)} kg`, 40, y); y += 11;
    doc.text(`CO\u2082:   ${Number(r.projected_co2_kg).toFixed(0)} → ${Number(r.realised_co2_kg).toFixed(0)} kg`, 40, y); y += 11;
    doc.text(`Cost saved: $${Number(r.cost_savings_usd).toFixed(2)}`, 40, y); y += 14;
    doc.text(`Incident: ${r.incident_severity}   Rating: ${r.incident_rating ?? "—"}/5`, 40, y); y += 12;
    if (r.incident_description) {
      const lines = doc.splitTextToSize(r.incident_description, W - 80) as string[];
      for (const l of lines) { if (y > 770) { doc.addPage(); y = 56; } doc.text(l, 40, y); y += 11; }
    }
    if (r.image_paths.length) { doc.setTextColor(80, 80, 200); doc.text(`Attachments: ${r.image_paths.length} image(s)`, 40, y); y += 12; doc.setTextColor(0); }
    y += 8;
  }
  doc.save(`flight-report-${upr.callsign}.pdf`);
}

async function exportAggregatedReport(uprs: UPRRow[], reports: FlightReportRow[], _schedules: TrialScheduleRow[], scopeLabel: string) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = 56;

  doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text("Harmony by AFRAA — Aggregated Trial Report", 40, y); y += 22;
  doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.setTextColor(120);
  doc.text(`${scopeLabel}    Generated ${new Date().toLocaleString("en-GB")}`, 40, y); y += 18;
  doc.setTextColor(0);

  const totals = reports.reduce((a, r) => ({
    time: a.time + Number(r.realised_time_min || 0),
    fuel: a.fuel + Number(r.realised_fuel_kg || 0),
    co2: a.co2 + Number(r.realised_co2_kg || 0),
    usd: a.usd + Number(r.cost_savings_usd || 0),
  }), { time: 0, fuel: 0, co2: 0, usd: 0 });

  doc.setFontSize(12); doc.setFont("helvetica", "bold");
  doc.text("Network totals", 40, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.text(`Flights reported:  ${reports.length}`, 40, y); y += 13;
  doc.text(`Time saved:        ${totals.time.toFixed(0)} min`, 40, y); y += 13;
  doc.text(`Fuel saved:        ${totals.fuel.toFixed(0)} kg`, 40, y); y += 13;
  doc.text(`CO\u2082 avoided:       ${totals.co2.toFixed(0)} kg`, 40, y); y += 13;
  doc.text(`Cost saved:        $${totals.usd.toFixed(2)}`, 40, y); y += 20;

  // by stage
  const byStage = (["day1", "day3", "day7"] as TrialStage[]).map((s) => ({
    stage: s, count: reports.filter((r) => r.trial_stage === s).length,
    usd: reports.filter((r) => r.trial_stage === s).reduce((a, r) => a + Number(r.cost_savings_usd || 0), 0),
  }));
  doc.setFont("helvetica", "bold"); doc.text("By trial stage", 40, y); y += 14;
  doc.setFont("helvetica", "normal");
  for (const s of byStage) { doc.text(`${TRIAL_STAGE_META[s.stage].label}:  ${s.count} flights   $${s.usd.toFixed(0)} saved`, 40, y); y += 12; }
  y += 8;

  // by airline
  const airlines = Array.from(new Set(reports.map((r) => uprs.find((u) => u.id === r.upr_id)?.airline_code ?? "?")));
  doc.setFont("helvetica", "bold"); doc.text("By airline", 40, y); y += 14;
  doc.setFont("helvetica", "normal");
  for (const a of airlines) {
    const rs = reports.filter((r) => uprs.find((u) => u.id === r.upr_id)?.airline_code === a);
    const usd = rs.reduce((acc, r) => acc + Number(r.cost_savings_usd || 0), 0);
    const fuel = rs.reduce((acc, r) => acc + Number(r.realised_fuel_kg || 0), 0);
    if (y > 760) { doc.addPage(); y = 56; }
    doc.text(`${a}:  ${rs.length} flights   ${fuel.toFixed(0)} kg fuel saved   $${usd.toFixed(0)}`, 40, y); y += 12;
  }
  y += 10;

  // flight log
  if (y > 700) { doc.addPage(); y = 56; }
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("Flight log", 40, y); y += 16;
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  for (const r of reports) {
    if (y > 770) { doc.addPage(); y = 56; }
    const u = uprs.find((x) => x.id === r.upr_id);
    doc.text(`${fmtD(r.flight_date)}  ${u?.callsign ?? "—"}  ${u?.airline_code ?? ""}  ${u?.dep}→${u?.arr}  [${TRIAL_STAGE_META[r.trial_stage].label}]  ${r.party}  fuel ${Number(r.realised_fuel_kg).toFixed(0)}kg  $${Number(r.cost_savings_usd).toFixed(0)}`, 40, y); y += 11;
  }

  doc.save(`harmony-aggregated-report.pdf`);
}
