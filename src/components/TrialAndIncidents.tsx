import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  FIRS, STATUS_META,
  type AppSession, type IncidentRow, type IncidentSeverity,
  type SegmentRow, type UPRRow,
  type TrialScheduleRow, type FlightReportRow,
} from "@/lib/upr-types";
import { uploadIncidentImage, getImageUrl } from "@/lib/upr-storage";
import { jsPDF } from "jspdf";
import { StagedTrialCalendar, FlightReportsList } from "@/components/FlightReports";

// ─────────── helpers ───────────

export function computeVerdict(segs: SegmentRow[]): "PENDING" | "APPROVED" | "REJECTED" {
  if (!segs.length) return "PENDING";
  if (segs.some((s) => s.status === "rejected")) return "REJECTED";
  if (segs.every((s) => s.status === "approved")) return "APPROVED";
  return "PENDING";
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const SEV_META: Record<IncidentSeverity, { color: string; label: string }> = {
  none: { color: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40", label: "No incident" },
  minor: { color: "bg-sky-500/20 text-sky-200 ring-sky-500/40", label: "Minor" },
  major: { color: "bg-amber-500/20 text-amber-200 ring-amber-500/40", label: "Major" },
  critical: { color: "bg-red-500/20 text-red-200 ring-red-500/40", label: "Critical" },
};

// ─────────── Schedule trial button (Airline) ───────────

export function ScheduleTrialBlock({ upr, segs }: { upr: UPRRow; segs: SegmentRow[] }) {
  const verdict = computeVerdict(segs);
  const [when, setWhen] = useState<string>(upr.trial_at ? upr.trial_at.slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (verdict !== "APPROVED") return null;

  const save = async () => {
    setErr(""); setBusy(true);
    const iso = when ? new Date(when).toISOString() : null;
    const { error } = await supabase.from("uprs").update({ trial_at: iso } as any).eq("id", upr.id);
    setBusy(false);
    if (error) setErr(error.message);
  };

  return (
    <div className="rounded-xl bg-emerald-500/5 ring-1 ring-emerald-500/30 p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-emerald-200">Schedule trial flight</div>
          <div className="text-[11px] text-emerald-300/70">All FIRs have approved. Pick the trial date & time.</div>
        </div>
        {upr.trial_at && <div className="text-[11px] text-emerald-200">Scheduled: {fmtDate(upr.trial_at)}</div>}
      </div>
      <div className="flex gap-2 items-end">
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-emerald-500 outline-none"
        />
        <button onClick={save} disabled={busy} className="text-xs px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-emerald-950 font-semibold">
          {busy ? "…" : upr.trial_at ? "Update" : "Schedule"}
        </button>
      </div>
      {err && <div className="mt-1.5 text-[11px] text-rose-400">{err}</div>}
    </div>
  );
}

// ─────────── Incident form (Airline + ANSP, post-trial) ───────────

export function IncidentForm({ upr, session }: { upr: UPRRow; session: AppSession }) {
  if (session.role !== "airline" && session.role !== "ansp") return null;
  if (!upr.trial_at) return null;
  const trialPassed = new Date(upr.trial_at).getTime() <= Date.now();
  if (!trialPassed) return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4 text-[11px] text-slate-400">
      Post-trial feedback opens after the scheduled trial time ({fmtDate(upr.trial_at)}).
    </div>
  );

  const [rating, setRating] = useState(4);
  const [severity, setSeverity] = useState<IncidentSeverity>("none");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setErr("");
    if (!description.trim()) { setErr("Add a description"); return; }
    setBusy(true);
    try {
      const paths: string[] = [];
      for (const f of images) paths.push(await uploadIncidentImage(f, upr.id));
      const party = session.role === "airline" ? "airline" : "ansp";
      const label = session.role === "airline"
        ? `${upr.airline_code} Dispatcher`
        : `${session.scope} ${FIRS.find((f) => f.code === session.scope)?.name ?? ""}`;
      const { error } = await supabase.from("incidents").insert({
        upr_id: upr.id,
        author: session.userId,
        author_label: label,
        party,
        party_scope: session.scope ?? "",
        rating,
        severity,
        description: description.trim(),
        image_paths: paths,
      } as any);
      if (error) throw error;
      setDone(true); setDescription(""); setImages([]); setRating(4); setSeverity("none");
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    setBusy(false);
  };

  if (done) return (
    <div className="rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/30 p-4 text-emerald-200 text-sm">
      ✓ Feedback submitted. <button className="underline" onClick={() => setDone(false)}>Add another</button>
    </div>
  );

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="text-sm font-semibold mb-1">Post-trial feedback & incident report</div>
      <div className="text-[11px] text-slate-400 mb-3">Trial flown {fmtDate(upr.trial_at)} — share how it went.</div>

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
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Incident severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)} className="mt-1 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none">
            {(["none", "minor", "major", "critical"] as const).map((s) => <option key={s} value={s}>{SEV_META[s].label}</option>)}
          </select>
        </label>
      </div>

      <label className="block mt-3">
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Description / observations</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Fuel saved, weather, traffic, ATC handling…" className="mt-1 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none" />
      </label>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Attach photos ({images.length})</div>
        <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-md ring-1 ring-slate-700 hover:bg-slate-800">+ Add image</button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          setImages((p) => [...p, ...fs]);
          e.target.value = "";
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

      {err && <div className="mt-2 text-[11px] text-rose-400">{err}</div>}
      <button onClick={submit} disabled={busy} className="mt-3 w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-semibold rounded-md py-1.5 text-sm">
        {busy ? "Submitting…" : "Submit feedback"}
      </button>
    </div>
  );
}

// ─────────── Trial Calendar ───────────
// scope filter: "all" | airline_code | fir_code

export function TrialCalendar({
  uprs, segments, title, filter,
}: {
  uprs: UPRRow[]; segments: SegmentRow[]; title: string;
  filter: { type: "all" } | { type: "airline"; code: string } | { type: "fir"; code: string };
}) {
  const trials = useMemo(() => {
    return uprs
      .filter((u) => u.trial_at)
      .filter((u) => {
        if (filter.type === "all") return true;
        if (filter.type === "airline") return u.airline_code === filter.code;
        return segments.some((s) => s.upr_id === u.id && s.fir_code === filter.code);
      })
      .sort((a, b) => new Date(a.trial_at!).getTime() - new Date(b.trial_at!).getTime());
  }, [uprs, segments, filter]);

  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: ({ day: number; trials: UPRRow[] } | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dayTrials = trials.filter((u) => {
      const t = new Date(u.trial_at!);
      return t.getFullYear() === year && t.getMonth() === month && t.getDate() === d;
    });
    cells.push({ day: d, trials: dayTrials });
  }

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-[11px] text-slate-400">{trials.length} scheduled trial{trials.length === 1 ? "" : "s"}</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="text-xs px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800">‹</button>
          <div className="text-sm font-medium w-32 text-center">
            {cursor.toLocaleString("en-GB", { month: "long", year: "numeric" })}
          </div>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="text-xs px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800">›</button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => (
          <div key={i} className={`min-h-[72px] rounded-md p-1 text-[10px] ${c ? "bg-slate-950/60 ring-1 ring-slate-800" : ""}`}>
            {c && (
              <>
                <div className="text-slate-400 mb-0.5">{c.day}</div>
                <div className="space-y-0.5">
                  {c.trials.slice(0, 3).map((u) => (
                    <div key={u.id} className="bg-sky-500/20 ring-1 ring-sky-500/40 text-sky-100 rounded px-1 py-0.5 truncate">
                      <span className="font-mono">{u.callsign}</span> · {u.airline_code}
                    </div>
                  ))}
                  {c.trials.length > 3 && <div className="text-slate-500">+{c.trials.length - 3}</div>}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {trials.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Upcoming</div>
          <div className="space-y-1">
            {trials.slice(0, 6).map((u) => (
              <div key={u.id} className="flex items-center justify-between text-[11px] bg-slate-950/40 rounded px-2 py-1">
                <span className="font-mono text-sky-300">{u.callsign}</span>
                <span className="text-slate-400">{u.airline_code} · {u.dep}→{u.arr}</span>
                <span className="text-slate-300">{fmtDate(u.trial_at!)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────── Incident list + PDF report ───────────

export function IncidentList({
  uprs, incidents, scopeLabel,
}: { uprs: UPRRow[]; incidents: IncidentRow[]; scopeLabel: string }) {
  const byUpr = useMemo(() => {
    const m = new Map<string, IncidentRow[]>();
    for (const i of incidents) {
      const arr = m.get(i.upr_id) ?? [];
      arr.push(i); m.set(i.upr_id, arr);
    }
    return m;
  }, [incidents]);

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">Post-trial feedback & incidents ({incidents.length})</div>
          <div className="text-[11px] text-slate-400">{scopeLabel}</div>
        </div>
      </div>
      {incidents.length === 0 ? (
        <div className="text-xs text-slate-500 py-6 text-center">No reports yet.</div>
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
                    {upr.trial_at && <span className="text-slate-500 text-[11px]"> · trial {fmtDate(upr.trial_at)}</span>}
                  </div>
                  <button onClick={() => exportIncidentReport(upr, rows)} className="text-[11px] px-2 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold">
                    Download PDF report
                  </button>
                </div>
                <div className="grid gap-2">
                  {rows.map((r) => <IncidentCard key={r.id} row={r} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IncidentCard({ row }: { row: IncidentRow }) {
  return (
    <div className="bg-slate-900/60 ring-1 ring-slate-800 rounded-md p-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wider font-semibold text-slate-300">{row.party}</span>
          <span className="text-slate-500">· {row.author_label}</span>
          {row.party === "ansp" && <span className="text-slate-500">· {row.party_scope}</span>}
        </div>
        <div className="flex items-center gap-2">
          {row.rating && <span className="text-amber-300">{"★".repeat(row.rating)}<span className="text-slate-700">{"★".repeat(5 - row.rating)}</span></span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${SEV_META[row.severity].color}`}>{SEV_META[row.severity].label}</span>
          <span className="text-slate-500">{fmtDate(row.created_at)}</span>
        </div>
      </div>
      <div className="text-sm text-slate-200 mt-1.5 whitespace-pre-wrap">{row.description}</div>
      {row.image_paths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {row.image_paths.map((p) => <IncidentImage key={p} path={p} />)}
        </div>
      )}
    </div>
  );
}

function IncidentImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { getImageUrl(path).then(setUrl).catch(() => setUrl(null)); }, [path]);
  if (!url) return <div className="h-20 w-28 rounded bg-slate-800 animate-pulse" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img src={url} alt="Incident attachment" className="h-20 w-28 object-cover rounded ring-1 ring-slate-700 hover:ring-sky-500/60 transition" />
    </a>
  );
}

async function exportIncidentReport(upr: UPRRow, rows: IncidentRow[]) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = 56;

  doc.setFontSize(18); doc.setFont("helvetica", "bold");
  doc.text("Harmony by AFRAA — Trial Flight Report", 40, y); y += 24;
  doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text(`Flight: ${upr.callsign} (${upr.flight_no})`, 40, y); y += 16;
  doc.text(`Airline: ${upr.airline_code}    Route: ${upr.dep} → ${upr.arr}    A/C: ${upr.aircraft}`, 40, y); y += 16;
  if (upr.trial_at) { doc.text(`Trial: ${fmtDate(upr.trial_at)}`, 40, y); y += 16; }
  const dm = Math.max(0, upr.baseline_minutes - upr.optimized_minutes);
  const fuel = dm * Number(upr.burn_kg_per_min);
  const co2 = fuel * 3.16;
  doc.text(`Time saved: ${dm} min   Fuel saved: ${fuel.toFixed(0)} kg   CO\u2082 avoided: ${co2.toFixed(0)} kg`, 40, y); y += 22;

  doc.setDrawColor(200); doc.line(40, y, W - 40, y); y += 18;
  doc.setFontSize(13); doc.setFont("helvetica", "bold");
  doc.text(`Submissions (${rows.length})`, 40, y); y += 18;
  doc.setFontSize(10); doc.setFont("helvetica", "normal");

  for (const r of rows) {
    if (y > 740) { doc.addPage(); y = 56; }
    doc.setFont("helvetica", "bold");
    doc.text(`${r.party.toUpperCase()} · ${r.author_label}${r.party === "ansp" ? ` (${r.party_scope})` : ""}`, 40, y); y += 14;
    doc.setFont("helvetica", "normal");
    doc.text(`Severity: ${SEV_META[r.severity].label}    Rating: ${r.rating ?? "—"}/5    Submitted: ${fmtDate(r.created_at)}`, 40, y); y += 14;
    const lines = doc.splitTextToSize(r.description, W - 80) as string[];
    for (const l of lines) {
      if (y > 760) { doc.addPage(); y = 56; }
      doc.text(l, 40, y); y += 13;
    }
    if (r.image_paths.length > 0) {
      doc.setTextColor(80, 80, 200);
      doc.text(`Attachments: ${r.image_paths.length} image(s)`, 40, y); y += 14;
      doc.setTextColor(0);
    }
    y += 8;
  }

  doc.save(`trial-report-${upr.callsign}.pdf`);
}

// ─────────── Regulator / Observer view (read-only) ───────────

export function RegulatorView({
  uprs, segments, incidents, broadcasts, session, schedules, reports,
}: {
  uprs: UPRRow[]; segments: SegmentRow[]; incidents: IncidentRow[];
  broadcasts: any[]; session: AppSession;
  schedules: TrialScheduleRow[]; reports: FlightReportRow[];
}) {
  const [text, setText] = useState("");
  const [sev, setSev] = useState<"info" | "warn" | "critical">("info");

  const sendBroadcast = async () => {
    if (!text.trim()) return;
    await supabase.from("broadcasts").insert({
      author: session.userId, author_label: session.fullName,
      author_role: `Regulator · ${session.scope}`, text: text.trim(), severity: sev,
    });
    setText("");
  };

  const verdictOf = (id: string) => computeVerdict(segments.filter((s) => s.upr_id === id));
  const approved = uprs.filter((u) => verdictOf(u.id) === "APPROVED");
  const scheduled = uprs.filter((u) => u.trial_at).length;
  const flown = uprs.filter((u) => u.trial_at && new Date(u.trial_at).getTime() <= Date.now()).length;

  const stats = [
    { label: "UPR Requests", value: uprs.length.toString(), sub: "all-time" },
    { label: "Approved Routes", value: approved.length.toString(), sub: "ready or flown" },
    { label: "Trials Scheduled", value: scheduled.toString(), sub: "on calendar" },
    { label: "Trials Flown", value: flown.toString(), sub: "feedback eligible" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Regulator / Observer Console</h1>
        <p className="text-sm text-slate-400">Read-only oversight across all airlines and FIRs · {session.scope}</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">{s.label}</div>
            <div className="text-3xl font-semibold mt-2 bg-gradient-to-br from-emerald-300 to-sky-400 bg-clip-text text-transparent">{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>

      <TrialCalendar uprs={uprs} segments={segments} title="Aggregated trial calendar (all airlines & FIRs)" filter={{ type: "all" }} />

      <ReadonlyUprActivity uprs={uprs} segments={segments} />

      <IncidentList uprs={uprs} incidents={incidents} scopeLabel="All trials across the network" />

      <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
        <div className="text-sm font-semibold mb-2">Issue broadcast notice</div>
        <div className="flex gap-1.5 mb-2">
          {(["info", "warn", "critical"] as const).map((s) => (
            <button key={s} onClick={() => setSev(s)} className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider ring-1 ${sev === s ? "ring-sky-500/60 bg-slate-800" : "ring-slate-800 text-slate-400"}`}>{s}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Broadcast as regulator…" className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2.5 py-1.5 text-sm focus:ring-sky-500 outline-none" />
          <button onClick={sendBroadcast} className="text-xs px-3 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold">Broadcast</button>
        </div>
      </div>
    </div>
  );
}

function ReadonlyUprActivity({ uprs, segments }: { uprs: UPRRow[]; segments: SegmentRow[] }) {
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
      <div className="text-sm font-semibold mb-1">UPR activity (read-only)</div>
      <p className="text-[11px] text-slate-500 mb-3">FIR badges are color-coded by current segment status.</p>
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-slate-400">
          <tr><th className="text-left py-2">Callsign</th><th className="text-left">Airline</th><th className="text-left">Route</th><th className="text-left">FIRs</th><th className="text-left">Trial</th><th className="text-right">Verdict</th></tr>
        </thead>
        <tbody>
          {uprs.map((u) => {
            const segs = segments.filter((s) => s.upr_id === u.id).sort((a, b) => a.order_idx - b.order_idx);
            return (
              <tr key={u.id} className="border-t border-slate-800">
                <td className="py-2 font-mono">{u.callsign}</td>
                <td className="text-slate-300">{u.airline_code}</td>
                <td>{u.dep} → {u.arr}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-1">
                    {segs.map((s) => {
                      const m = STATUS_META[s.status];
                      return (
                        <span key={s.id} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 ${m.bg} ${m.color} ${m.ring}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                          <span className="font-mono text-[11px]">{s.fir_code}</span>
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="text-[11px] text-slate-300">{u.trial_at ? fmtDate(u.trial_at) : <span className="text-slate-600">—</span>}</td>
                <td className="text-right">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${computeVerdict(segs) === "APPROVED" ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40" : computeVerdict(segs) === "REJECTED" ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40" : "bg-slate-700 text-slate-200"}`}>
                    {computeVerdict(segs)}
                  </span>
                </td>
              </tr>
            );
          })}
          {uprs.length === 0 && <tr><td colSpan={6} className="text-center text-xs text-slate-500 py-6">No UPRs yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
