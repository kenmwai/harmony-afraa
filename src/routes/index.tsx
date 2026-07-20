import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  FIRS, REJECT_REASONS, STATUS_META, REACTION_EMOJIS,
  type AppSession, type BroadcastRow, type ChatRow, type ChatReactionRow, type SegmentRow, type SegStatus, type UPRRow,
  type TrialScheduleRow, type FlightReportRow,
  fmtBytes, fmtTime,
} from "@/lib/upr-types";
import { uploadPdf, viewPdf, downloadPdf } from "@/lib/upr-storage";
import { RegulatorView } from "@/components/TrialAndIncidents";
import { ScheduleProgressiveTrial, StagedTrialCalendar, FlightReportForm, FlightReportsList } from "@/components/FlightReports";
import { deleteUserAccount } from "@/lib/admin-users.functions";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Harmony by AFRAA" },
      { name: "description", content: "Harmony by AFRAA — African User Preferred Routes coordination platform." },
    ],
  }),
  component: Gate,
});

// ─────────── Gate: session + role → app, /auth, or pending ───────────
function Gate() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [pending, setPending] = useState<{ email: string; fullName: string; requestedRole: string | null; requestedScope: string | null } | null>(null);

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) { nav({ to: "/auth" }); return; }
    const uid = s.session.user.id;
    const [{ data: prof }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role,scope").eq("user_id", uid),
    ]);
    if (!prof) { setLoading(false); return; }
    const r = roles?.[0];
    if (!r || !prof.approved) {
      setPending({ email: prof.email, fullName: prof.full_name, requestedRole: prof.requested_role, requestedScope: prof.requested_scope });
      setSession(null);
    } else {
      setSession({ userId: uid, email: prof.email, fullName: prof.full_name, role: r.role as any, scope: r.scope });
      setPending(null);
    }
    setLoading(false);
  }, [nav]);

  useEffect(() => {
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") nav({ to: "/auth" });
      if (event === "SIGNED_IN" || event === "USER_UPDATED") load();
    });
    return () => sub.subscription.unsubscribe();
  }, [load, nav]);

  if (loading) return <div className="min-h-screen grid place-items-center bg-slate-950 text-slate-400 text-sm">Loading…</div>;
  if (pending) return <PendingScreen pending={pending} onRefresh={load} />;
  if (!session) return null;
  return <UPRApp session={session} />;
}

function PendingScreen({ pending, onRefresh }: { pending: { email: string; fullName: string; requestedRole: string | null; requestedScope: string | null }; onRefresh: () => void }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center px-6">
      <div className="max-w-md w-full rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-6">
        <div className="text-amber-300 text-xs uppercase tracking-wider mb-2">Pending administrator approval</div>
        <h1 className="text-xl font-semibold">Hi {pending.fullName}</h1>
        <p className="text-sm text-slate-400 mt-2">
          Your account ({pending.email}) is waiting for the AFRAA administrator to grant role
          <span className="text-slate-200"> {pending.requestedRole ?? "—"}</span>
          {pending.requestedScope ? <> · scope <span className="text-slate-200">{pending.requestedScope}</span></> : null}.
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={onRefresh} className="flex-1 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-md py-2 text-sm">Refresh status</button>
          <button onClick={() => supabase.auth.signOut()} className="px-3 ring-1 ring-slate-700 hover:bg-slate-800 rounded-md py-2 text-xs">Sign out</button>
        </div>
      </div>
    </div>
  );
}


// ─────────── Main app shell ───────────
function UPRApp({ session }: { session: AppSession }) {
  const [uprs, setUprs] = useState<UPRRow[]>([]);
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [chat, setChat] = useState<ChatRow[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
  const [schedules, setSchedules] = useState<TrialScheduleRow[]>([]);
  const [reports, setReports] = useState<FlightReportRow[]>([]);
  const [reactions, setReactions] = useState<ChatReactionRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Per-role scoping applied at query time on top of RLS.
  // Hard LIMITs prevent unbounded reads as the dataset grows to 1000+ users.
  const MAX_UPRS = 500;
  const MAX_SEGMENTS = 5000;
  const MAX_CHAT = 500;
  const MAX_BROADCASTS = 100;
  const MAX_SCHEDULES = 1000;
  const MAX_REPORTS = 1000;

  const refetch = useCallback(async () => {
    // uprs: airlines only see their own airline_code; admin/regulator/ansp rely on RLS.
    let uprQ = supabase.from("uprs").select("*").order("created_at", { ascending: false }).limit(MAX_UPRS);
    if (session.role === "airline" && session.scope) uprQ = uprQ.eq("airline_code", session.scope);

    const [u, s, c, b, sc, fr] = await Promise.all([
      uprQ,
      supabase.from("segments").select("*").order("order_idx").limit(MAX_SEGMENTS),
      supabase.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(MAX_CHAT),
      supabase.from("broadcasts").select("*").order("created_at", { ascending: false }).limit(MAX_BROADCASTS),
      supabase.from("trial_schedules" as any).select("*").order("start_at").limit(MAX_SCHEDULES),
      supabase.from("flight_reports" as any).select("*").order("created_at", { ascending: false }).limit(MAX_REPORTS),
    ]);
    if (u.data) setUprs(u.data as any);
    if (s.data) setSegments(s.data as any);
    // chat was fetched newest-first for the LIMIT; flip back to ascending for the UI.
    if (c.data) setChat((c.data as any[]).slice().reverse() as any);
    if (b.data) setBroadcasts(b.data as any);
    if (sc.data) setSchedules(sc.data as any);
    if (fr.data) setReports(fr.data as any);
  }, [session.role, session.scope]);

  useEffect(() => { refetch(); }, [refetch]);

  // Incremental realtime updates: patch local state instead of refetching everything.
  // This is the single biggest scalability fix — old code did 6 full-table reads per event.
  useEffect(() => {
    const applyUpsert = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, row: T, prepend = false) =>
      setter((prev) => {
        const i = prev.findIndex((r) => r.id === row.id);
        if (i === -1) return prepend ? [row, ...prev] : [...prev, row];
        const next = prev.slice(); next[i] = { ...next[i], ...row }; return next;
      });
    const applyDelete = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, id: string) =>
      setter((prev) => prev.filter((r) => r.id !== id));

    const handle = <T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<T[]>>, prepend = false) =>
      (payload: any) => {
        const evt = payload.eventType || payload.event;
        if (evt === "DELETE") { const id = payload.old?.id; if (id) applyDelete(setter, id); }
        else { const row = payload.new as T; if (row?.id) applyUpsert(setter, row, prepend); }
      };

    // Airlines only care about their own UPRs; use a server-side filter to cut fanout.
    const uprFilter = session.role === "airline" && session.scope ? `airline_code=eq.${session.scope}` : undefined;

    const ch = supabase
      .channel(`upr-live-${session.userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "uprs", filter: uprFilter }, handle(setUprs, true))
      .on("postgres_changes", { event: "*", schema: "public", table: "segments" }, handle(setSegments))
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, handle(setChat))
      .on("postgres_changes", { event: "*", schema: "public", table: "broadcasts" }, handle(setBroadcasts, true))
      .on("postgres_changes", { event: "*", schema: "public", table: "trial_schedules" }, handle(setSchedules))
      .on("postgres_changes", { event: "*", schema: "public", table: "flight_reports" }, handle(setReports, true))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session.userId, session.role, session.scope]);

  // Reactions: fetch + subscribe scoped to the active UPR to keep payload light.
  useEffect(() => {
    if (!activeId) { setReactions([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("chat_reactions" as any).select("*").eq("upr_id", activeId).limit(2000);
      if (!cancelled && data) setReactions(data as any);
    })();
    const ch = supabase
      .channel(`reactions-${activeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions", filter: `upr_id=eq.${activeId}` }, (payload: any) => {
        const evt = payload.eventType || payload.event;
        if (evt === "DELETE") {
          const id = payload.old?.id;
          if (id) setReactions((prev) => prev.filter((r) => r.id !== id));
        } else {
          const row = payload.new as ChatReactionRow;
          if (row?.id) setReactions((prev) => (prev.some((r) => r.id === row.id) ? prev : [...prev, row]));
        }
      })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [activeId]);


  const active = uprs.find((u) => u.id === activeId) ?? null;
  const activeSegments = useMemo(() => segments.filter((s) => s.upr_id === activeId).sort((a, b) => a.order_idx - b.order_idx), [segments, activeId]);
  const activeChat = useMemo(() => chat.filter((m) => m.upr_id === activeId), [chat, activeId]);


  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <TopBar session={session} />
      <div className="mx-auto max-w-[1500px] px-6 py-6">
        {session.role === "airline" && (
          <AirlineView
            session={session} uprs={uprs} segments={segments} broadcasts={broadcasts}
            schedules={schedules} reports={reports}
            activeId={activeId} setActiveId={setActiveId}
            active={active} activeSegments={activeSegments} activeChat={activeChat} reactions={reactions}
          />
        )}
        {session.role === "ansp" && (
          <ANSPView
            session={session} uprs={uprs} segments={segments} broadcasts={broadcasts}
            schedules={schedules} reports={reports}
            activeId={activeId} setActiveId={setActiveId}
            active={active} activeSegments={activeSegments} activeChat={activeChat} reactions={reactions}
          />
        )}
        {session.role === "admin" && <AdminView session={session} uprs={uprs} segments={segments} schedules={schedules} reports={reports} />}
        {session.role === "regulator" && <RegulatorView uprs={uprs} segments={segments} broadcasts={broadcasts} session={session} schedules={schedules} reports={reports} />}
      </div>
    </div>
  );
}

function TopBar({ session }: { session: AppSession }) {
  const label =
    session.role === "airline" ? `${session.scope} · Dispatcher` :
    session.role === "ansp" ? `${session.scope} ${FIRS.find((f) => f.code === session.scope)?.name ?? ""} · Controller` :
    session.role === "regulator" ? `${session.scope} · Regulator` :
    "Admin · Oversight";
  const color =
    session.role === "airline" ? "from-sky-500 to-cyan-500" :
    session.role === "ansp" ? "from-amber-500 to-orange-500" :
    session.role === "regulator" ? "from-indigo-500 to-violet-500" :
    "from-fuchsia-500 to-pink-500";
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto max-w-[1500px] px-6 py-3 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 grid place-items-center font-black text-slate-950">H</div>
          <div>
            <div className="font-semibold tracking-tight">Harmony by AFRAA</div>
            <div className="text-[11px] text-slate-400 -mt-0.5">African User Preferred Routes · Production</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-lg bg-gradient-to-r ${color} text-slate-950 text-xs font-semibold`}>{label}</div>
          <div className="text-right leading-tight">
            <div className="text-sm font-medium">{session.fullName}</div>
            <button onClick={() => supabase.auth.signOut()} className="text-[11px] text-slate-400 hover:text-sky-300">Sign out</button>
          </div>
        </div>
      </div>
    </header>
  );
}

// ─────────── PDF picker + signed-URL badge ───────────
function PdfPicker({ label, onPick, attached }: { label: string; onPick: (f: File) => Promise<void>; attached?: { name: string; size: number; path: string } }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handle = async (f?: File) => {
    if (!f) return;
    setErr(null); setBusy(true);
    try { await onPick(f); } catch (e: any) { setErr(e?.message ?? "Failed"); }
    setBusy(false);
  };
  if (attached) return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      <div className="flex items-center justify-between gap-2 rounded-md bg-slate-950/60 ring-1 ring-slate-800 px-2.5 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-red-400">📄</span>
          <div className="min-w-0">
            <div className="text-xs font-medium truncate">{attached.name}</div>
            <div className="text-[10px] text-slate-500">{fmtBytes(attached.size)}</div>
          </div>
        </div>
        <SignedOpenButton path={attached.path} />
      </div>
    </div>
  );
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      <button onClick={() => ref.current?.click()} disabled={busy} className="w-full rounded-md bg-slate-950/60 ring-1 ring-dashed ring-slate-700 hover:ring-sky-500/60 px-2.5 py-3 text-xs text-slate-400 hover:text-sky-300 transition">
        {busy ? "Uploading…" : "+ Attach PDF (max 10 MB)"}
      </button>
      <input ref={ref} type="file" accept="application/pdf" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      {err && <div className="text-[10px] text-red-400 mt-1">{err}</div>}
    </div>
  );
}
function SignedOpenButton({ path, name }: { path: string; name?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = async () => {
    setBusy(true); setErr("");
    try { await viewPdf(path); } catch (e: any) { setErr(e?.message ?? "Failed"); }
    setBusy(false);
  };
  const dl = async () => {
    setBusy(true); setErr("");
    try { await downloadPdf(path, name ?? "flightplan.pdf"); } catch (e: any) { setErr(e?.message ?? "Failed"); }
    setBusy(false);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={open} disabled={busy} className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40">{busy ? "…" : "View"}</button>
      <button onClick={dl} disabled={busy} className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40">Download</button>
      {err && <span className="text-[10px] text-rose-400">{err}</span>}
    </span>
  );
}
function PdfBadge({ path, name, size, label }: { path: string; name: string; size: number; label: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const open = async () => {
    setBusy(true); setErr("");
    try { await viewPdf(path); } catch (e: any) { setErr(e?.message ?? "Failed"); }
    setBusy(false);
  };
  const dl = async () => {
    setBusy(true); setErr("");
    try { await downloadPdf(path, name); } catch (e: any) { setErr(e?.message ?? "Failed"); }
    setBusy(false);
  };
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 rounded-md bg-slate-950/60 ring-1 ring-slate-700 px-2 py-1 text-[11px]">
      <span className="text-red-400">📄</span>
      <span className="font-medium text-slate-200">{label}</span>
      <span className="text-slate-500 truncate max-w-[140px]">{name}</span>
      <span className="text-slate-500">· {fmtBytes(size)}</span>
      <button onClick={open} disabled={busy} className="ml-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[10px]">{busy ? "…" : "View"}</button>
      <button onClick={dl} disabled={busy} className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[10px]">Download</button>
      {err && <span className="text-[10px] text-rose-400 w-full">{err}</span>}
    </div>
  );
}

// ─────────── Airline view ───────────
function AirlineView({ session, uprs, segments, broadcasts, schedules, reports, activeId, setActiveId, active, activeSegments, activeChat, reactions }: {
  session: AppSession;
  uprs: UPRRow[]; segments: SegmentRow[]; broadcasts: BroadcastRow[];
  schedules: TrialScheduleRow[]; reports: FlightReportRow[];
  activeId: string | null; setActiveId: (id: string | null) => void;
  active: UPRRow | null; activeSegments: SegmentRow[]; activeChat: ChatRow[]; reactions: ChatReactionRow[];
}) {
  const myUprs = useMemo(() => uprs.filter((u) => u.airline_code === session.scope), [uprs, session.scope]);
  const myReports = useMemo(() => reports.filter((r) => myUprs.some((u) => u.id === r.upr_id)), [reports, myUprs]);
  useEffect(() => {
    if (!myUprs.length) { if (activeId) setActiveId(null); return; }
    if (!myUprs.find((u) => u.id === activeId)) setActiveId(myUprs[0].id);
  }, [myUprs, activeId, setActiveId]);

  return (
    <div className="grid grid-cols-12 gap-5">
      <aside className="col-span-3 space-y-4">
        <NewUPRForm session={session} onCreated={(id) => setActiveId(id)} />
        <UPRList uprs={myUprs} segments={segments} activeId={activeId} setActiveId={setActiveId} />
      </aside>
      <main className="col-span-6 space-y-5">
        {active ? (
          <>
            <UPRHeader upr={active} />
            <SegmentMatrix segs={activeSegments} />
            <ScheduleProgressiveTrial upr={active} segs={activeSegments} schedules={schedules} />
            <AirlineSegmentList upr={active} segs={activeSegments} session={session} />
            <FlightReportForm upr={active} session={session} schedules={schedules} />
            <StagedTrialCalendar uprs={uprs} segments={segments} schedules={schedules} title={`${session.scope} trial calendar`} filter={{ type: "airline", code: session.scope! }} />
            <FlightReportsList uprs={myUprs} reports={myReports} schedules={schedules} scopeLabel={`${session.scope} flights`} showAggregateButton={false} />
          </>
        ) : <EmptyCard text="Create or select a UPR request to begin." />}
      </main>
      <aside className="col-span-3 space-y-5">
        {active && <SegmentChat upr={active} segs={activeSegments} chat={activeChat} reactions={reactions} session={session} />}
        <BroadcastPanel broadcasts={broadcasts} session={session} />
      </aside>
    </div>
  );
}

function NewUPRForm({ session, onCreated }: { session: AppSession; onCreated: (id: string) => void }) {
  const [callsign, setCallsign] = useState("");
  const [flightNo, setFlightNo] = useState("");
  const [dep, setDep] = useState("");
  const [arr, setArr] = useState("");
  const [aircraft, setAircraft] = useState("B738");
  const [firs, setFirs] = useState<string[]>(["", ""]);
  const [baseline, setBaseline] = useState(380);
  const [optimized, setOptimized] = useState(345);
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [acTypes, setAcTypes] = useState<{ code: string; name: string; burn_kg_per_min: number }[]>([]);

  useEffect(() => {
    supabase.from("aircraft_types").select("code,name,burn_kg_per_min").order("code").then(({ data }) => {
      setAcTypes((data ?? []) as any);
    });
  }, []);

  const setFir = (i: number, v: string) => setFirs((p) => p.map((x, idx) => (idx === i ? v : x)));
  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const chosen = firs.filter(Boolean);
      if (!callsign || !flightNo || chosen.length < 1) throw new Error("Callsign, flight # and at least one FIR required");
      const acCode = aircraft.trim().toUpperCase();
      const matched = acTypes.find((a) => a.code === acCode);
      const burn = matched ? Number(matched.burn_kg_per_min) : 48;
      const { data: u, error } = await supabase.from("uprs").insert({
        callsign, flight_no: flightNo, dep: dep || "----", arr: arr || "----", aircraft: acCode,
        airline_code: session.scope!, created_by: session.userId,
        baseline_minutes: baseline, optimized_minutes: optimized, burn_kg_per_min: burn,
      }).select().single();
      if (error) throw error;

      if (pendingPdf) {
        const att = await uploadPdf(pendingPdf, "flightplan", u.id);
        await supabase.from("uprs").update({ flight_plan_path: att.path, flight_plan_name: att.name, flight_plan_size: att.size }).eq("id", u.id);
      }
      const segRows = chosen.map((f, i) => ({
        upr_id: u.id, fir_code: f, order_idx: i, status: "pending" as const,
        entry: `WPT${i * 2 + 1}`, exit: `WPT${i * 2 + 2}`, fl: "FL360", revision: 1,
      }));
      const { error: segErr } = await supabase.from("segments").insert(segRows);
      if (segErr) throw segErr;

      await supabase.from("chat_messages").insert({
        upr_id: u.id, author: session.userId, author_label: "System", author_role: "system",
        text: `UPR submitted across ${chosen.length} FIR(s)${pendingPdf ? ` · flight plan PDF attached` : ""}.`,
      });
      onCreated(u.id);
      setCallsign(""); setFlightNo(""); setDep(""); setArr(""); setFirs(["", ""]); setPendingPdf(null);
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    setBusy(false);
  };


  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="text-sm font-semibold mb-3 flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> New UPR Request</div>
      <div className="grid grid-cols-2 gap-2">
        <Input label="Callsign" value={callsign} onChange={setCallsign} placeholder="KQA310" />
        <Input label="Flight #" value={flightNo} onChange={setFlightNo} placeholder="KQ 310" />
        <Input label="Dep" value={dep} onChange={setDep} placeholder="HKJK" />
        <Input label="Arr" value={arr} onChange={setArr} placeholder="FACT" />
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">A/C</div>
          <select value={aircraft} onChange={(e) => setAircraft(e.target.value)} className="w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none">
            {acTypes.length === 0 && <option value={aircraft}>{aircraft}</option>}
            {acTypes.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name} ({a.burn_kg_per_min} kg/min)</option>)}
          </select>
        </div>

        <Input label="Baseline min" value={String(baseline)} onChange={(v) => setBaseline(+v || 0)} />
        <Input label="UPR min" value={String(optimized)} onChange={(v) => setOptimized(+v || 0)} />
      </div>
      <div className="mt-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">Transit FIRs (ordered)</div>
        <div className="space-y-1.5">
          {firs.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 w-5">{i + 1}.</span>
              <select value={f} onChange={(e) => setFir(i, e.target.value)} className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none">
                <option value="">Select FIR…</option>
                {FIRS.map((fr) => <option key={fr.code} value={fr.code}>{fr.code} — {fr.name}</option>)}
              </select>
              <button onClick={() => firs.length > 1 && setFirs(firs.filter((_, idx) => idx !== i))} className="text-slate-500 hover:text-red-400 text-sm">×</button>
            </div>
          ))}
        </div>
        <button onClick={() => setFirs([...firs, ""])} className="mt-2 text-xs text-sky-400 hover:text-sky-300">+ Add transit FIR ({firs.length})</button>
      </div>
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Plotted flight plan (PDF) — visible to all FIRs</div>
        {pendingPdf ? (
          <div className="flex items-center justify-between gap-2 rounded-md bg-slate-950/60 ring-1 ring-slate-800 px-2.5 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-red-400">📄</span>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{pendingPdf.name}</div>
                <div className="text-[10px] text-slate-500">{fmtBytes(pendingPdf.size)}</div>
              </div>
            </div>
            <button onClick={() => setPendingPdf(null)} className="text-[10px] px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800">Remove</button>
          </div>
        ) : (
          <label className="block">
            <span className="cursor-pointer w-full inline-block rounded-md bg-slate-950/60 ring-1 ring-dashed ring-slate-700 hover:ring-sky-500/60 px-2.5 py-3 text-xs text-slate-400 hover:text-sky-300 transition text-center">+ Attach PDF (max 10 MB)</span>
            <input type="file" accept="application/pdf" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]; if (!f) return;
              if (f.type !== "application/pdf") { setErr("PDF only"); return; }
              if (f.size > 10 * 1024 * 1024) { setErr("Max 10 MB"); return; }
              setErr(""); setPendingPdf(f);
            }} />
          </label>
        )}
      </div>
      {err && <div className="mt-2 text-[11px] text-rose-400">{err}</div>}
      <button onClick={submit} disabled={busy} className="mt-3 w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-semibold rounded-lg py-2 text-sm transition">
        {busy ? "Submitting…" : "Submit UPR Request"}
      </button>
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none" />
    </label>
  );
}

function UPRList({ uprs, segments, activeId, setActiveId }: { uprs: UPRRow[]; segments: SegmentRow[]; activeId: string | null; setActiveId: (id: string | null) => void }) {
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-2">
      <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-slate-400">UPR Requests</div>
      <div className="space-y-1">
        {uprs.map((u) => {
          const segs = segments.filter((s) => s.upr_id === u.id).sort((a, b) => a.order_idx - b.order_idx);
          const verdict = computeVerdict(segs);
          return (
            <button key={u.id} onClick={() => setActiveId(u.id)} className={`w-full text-left px-2.5 py-2 rounded-lg transition ${activeId === u.id ? "bg-slate-800 ring-1 ring-slate-700" : "hover:bg-slate-800/50"}`}>
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{u.callsign}</div>
                <VerdictPill verdict={verdict} />
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span>{u.dep} → {u.arr} · {segs.length} FIR</span>
                {u.flight_plan_path && <span className="text-red-400" title="Flight plan PDF attached">📄</span>}
              </div>
              <div className="mt-1.5 flex gap-1">
                {segs.map((s) => <span key={s.id} className={`h-1.5 flex-1 rounded-full ${STATUS_META[s.status].bg}`} />)}
              </div>
            </button>
          );
        })}
        {uprs.length === 0 && <div className="px-2 py-6 text-center text-xs text-slate-500">No requests yet</div>}
      </div>
    </div>
  );
}

function computeVerdict(segs: SegmentRow[]): "PENDING" | "APPROVED" | "REJECTED" {
  if (!segs.length) return "PENDING";
  if (segs.some((s) => s.status === "rejected")) return "REJECTED";
  if (segs.every((s) => s.status === "approved")) return "APPROVED";
  return "PENDING";
}
function VerdictPill({ verdict }: { verdict: string }) {
  const map: Record<string, string> = {
    PENDING: "bg-slate-700 text-slate-200",
    APPROVED: "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40",
    REJECTED: "bg-red-500/20 text-red-300 ring-1 ring-red-500/40",
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${map[verdict]}`}>{verdict}</span>;
}

function UPRHeader({ upr }: { upr: UPRRow }) {
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-xl font-semibold">{upr.callsign}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-300">{upr.flight_no}</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {upr.airline_code} · {upr.dep} → {upr.arr} · {upr.aircraft} · opened {fmtTime(upr.created_at)}
          </div>
        </div>
        <div className="text-right text-xs text-slate-400">
          <div>Baseline: <span className="text-slate-200">{upr.baseline_minutes} min</span></div>
          <div>Optimized: <span className="text-emerald-300">{upr.optimized_minutes} min</span></div>
        </div>
      </div>
      {upr.flight_plan_path && upr.flight_plan_name && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Plotted flight plan — shared with all FIRs</div>
          <PdfBadge path={upr.flight_plan_path} name={upr.flight_plan_name} size={upr.flight_plan_size ?? 0} label="Flight Plan" />
        </div>
      )}
    </div>
  );
}

function SegmentMatrix({ segs }: { segs: SegmentRow[] }) {
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">Live Status Matrix</div>
      <div className="flex items-stretch gap-2">
        {segs.map((s, i) => {
          const m = STATUS_META[s.status];
          return (
            <div key={s.id} className="flex-1 flex items-center gap-2">
              <div className={`flex-1 rounded-lg ${m.bg} ring-1 ${m.ring} px-3 py-3`}>
                <div className="flex items-center justify-between">
                  <span className={`font-mono font-semibold ${m.color}`}>{s.fir_code}</span>
                  <span className={`text-[10px] ${m.color} opacity-90`}>{m.label}</span>
                </div>
                <div className={`text-[10px] ${m.color} opacity-80 mt-0.5`}>{s.entry} → {s.exit} · {s.fl}</div>
              </div>
              {i < segs.length - 1 && <span className="text-slate-600">›</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AirlineSegmentList({ upr, segs, session }: { upr: UPRRow; segs: SegmentRow[]; session: AppSession }) {
  return (
    <div className="space-y-2">
      {segs.map((s) => <AirlineSegmentRow key={s.id} upr={upr} seg={s} session={session} />)}
    </div>
  );
}

function AirlineSegmentRow({ upr, seg, session }: { upr: UPRRow; seg: SegmentRow; session: AppSession }) {
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState(seg.entry);
  const [exit, setExit] = useState(seg.exit);
  const [fl, setFl] = useState(seg.fl);
  const m = STATUS_META[seg.status];
  const firName = FIRS.find((f) => f.code === seg.fir_code)?.name ?? "";

  const save = async () => {
    await supabase.from("segments").update({
      entry, exit, fl, status: "pending", revision: seg.revision + 1,
      note: null, reason: null, amendment_path: null, amendment_name: null, amendment_size: null,
      updated_at: new Date().toISOString(),
    }).eq("id", seg.id);
    await supabase.from("chat_messages").insert({
      upr_id: upr.id, author: session.userId, author_label: "System", author_role: "system",
      text: `Airline revised ${seg.fir_code} segment (rev ${seg.revision + 1}). Re-submitted for ANSP review.`,
    });
    setEditing(false);
  };

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${m.dot}`} />
          <span className="font-mono font-semibold">{seg.fir_code}</span>
          <span className="text-xs text-slate-400">{firName}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.bg} ${m.color}`}>{m.label}</span>
          <span className="text-[10px] text-slate-500">rev {seg.revision}</span>
        </div>
        {seg.status === "amended" && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs bg-amber-500 hover:bg-amber-400 text-amber-950 font-semibold px-2.5 py-1 rounded-md">Edit Route Specification</button>
        )}
      </div>
      {seg.status === "amended" && (seg.note || seg.amendment_path) && (
        <div className="mt-2 text-xs bg-amber-500/10 ring-1 ring-amber-500/30 rounded-md p-2 text-amber-200 space-y-1.5">
          {seg.note && <div><span className="font-semibold">ANSP proposal:</span> {seg.note}</div>}
          {seg.amendment_path && seg.amendment_name && <PdfBadge path={seg.amendment_path} name={seg.amendment_name} size={seg.amendment_size ?? 0} label="Amendment chart" />}
        </div>
      )}
      {seg.status === "rejected" && seg.reason && (
        <div className="mt-2 text-xs bg-red-500/10 ring-1 ring-red-500/30 rounded-md p-2 text-red-200">
          <span className="font-semibold">Rejection:</span> {seg.reason}
        </div>
      )}
      {editing ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Input label="Entry WPT" value={entry} onChange={setEntry} />
          <Input label="Exit WPT" value={exit} onChange={setExit} />
          <Input label="Flight Level" value={fl} onChange={setFl} />
          <div className="col-span-3 flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-md ring-1 ring-slate-700 hover:bg-slate-800">Cancel</button>
            <button onClick={save} className="text-xs px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold">Submit Revision</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-slate-400 grid grid-cols-3 gap-2">
          <div>Entry: <span className="text-slate-200 font-mono">{seg.entry}</span></div>
          <div>Exit: <span className="text-slate-200 font-mono">{seg.exit}</span></div>
          <div>Level: <span className="text-slate-200 font-mono">{seg.fl}</span></div>
        </div>
      )}
    </div>
  );
}

// ─────────── ANSP view ───────────
function ANSPView({ session, uprs, segments, broadcasts, schedules, reports, activeId, setActiveId, active, activeSegments, activeChat, reactions }: {
  session: AppSession;
  uprs: UPRRow[]; segments: SegmentRow[]; broadcasts: BroadcastRow[];
  schedules: TrialScheduleRow[]; reports: FlightReportRow[];
  activeId: string | null; setActiveId: (id: string | null) => void;
  active: UPRRow | null; activeSegments: SegmentRow[]; activeChat: ChatRow[]; reactions: ChatReactionRow[];
}) {
  const fir = session.scope!;
  const firName = FIRS.find((f) => f.code === fir)?.name;
  const queue = useMemo(() => uprs.filter((u) => segments.some((s) => s.upr_id === u.id && s.fir_code === fir)), [uprs, segments, fir]);
  useEffect(() => {
    if (queue.length && !queue.find((u) => u.id === activeId)) setActiveId(queue[0].id);
  }, [queue, activeId, setActiveId]);

  const mySeg = activeSegments.find((s) => s.fir_code === fir);

  return (
    <div className="grid grid-cols-12 gap-5">
      <aside className="col-span-3 space-y-4">
        <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Acting as</div>
          <div className="text-lg font-semibold">{fir}</div>
          <div className="text-xs text-slate-400">{firName} FIR Controller</div>
          <div className="text-[10px] text-slate-500 mt-2">Scope locked at sign-in.</div>
        </div>
        <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-2">
          <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-slate-400">Targeted Queue ({queue.length})</div>
          <div className="space-y-1">
            {queue.map((u) => {
              const seg = segments.find((s) => s.upr_id === u.id && s.fir_code === fir)!;
              const m = STATUS_META[seg.status];
              return (
                <button key={u.id} onClick={() => setActiveId(u.id)} className={`w-full text-left px-2.5 py-2 rounded-lg ${activeId === u.id ? "bg-slate-800 ring-1 ring-slate-700" : "hover:bg-slate-800/50"}`}>
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm">{u.callsign}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.bg} ${m.color}`}>{m.label}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span>{seg.entry} → {seg.exit} · {seg.fl}</span>
                    {u.flight_plan_path && <span className="text-red-400" title="Flight plan PDF">📄</span>}
                  </div>
                </button>
              );
            })}
            {queue.length === 0 && <div className="px-2 py-6 text-center text-xs text-slate-500">No requests in queue</div>}
          </div>
        </div>
      </aside>
      <main className="col-span-6 space-y-5">
        {active && mySeg ? (
          <>
            <UPRHeader upr={active} />
            <SegmentMatrix segs={activeSegments} />
            <ANSPDecisionPanel upr={active} seg={mySeg} fir={fir} session={session} />
            <FlightReportForm upr={active} session={session} schedules={schedules} />
            <StagedTrialCalendar uprs={uprs} segments={segments} schedules={schedules} title={`${fir} trial calendar`} filter={{ type: "fir", code: fir }} />
            <FlightReportsList uprs={uprs} reports={reports.filter((r) => segments.some((s) => s.upr_id === r.upr_id && s.fir_code === fir))} schedules={schedules} scopeLabel={`Flights touching ${fir}`} showAggregateButton={false} />
          </>
        ) : <EmptyCard text={`No active request for ${fir}.`} />}
      </main>
      <aside className="col-span-3 space-y-5">
        {active && <SegmentChat upr={active} segs={activeSegments} chat={activeChat} reactions={reactions} session={session} />}
        <BroadcastPanel broadcasts={broadcasts} session={session} />
      </aside>
    </div>
  );
}

function ANSPDecisionPanel({ upr, seg, fir, session }: { upr: UPRRow; seg: SegmentRow; fir: string; session: AppSession }) {
  const [mode, setMode] = useState<null | "amend" | "reject">(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = seg.status === "amended" || seg.status === "approved" || seg.status === "rejected";

  const log = (text: string) =>
    supabase.from("chat_messages").insert({ upr_id: upr.id, author: session.userId, author_label: "System", author_role: "system", text });

  const approve = async () => {
    setBusy(true);
    await supabase.from("segments").update({ status: "approved", note: null, reason: null, amendment_path: null, amendment_name: null, amendment_size: null, updated_at: new Date().toISOString() }).eq("id", seg.id);
    await log(`${fir} approved segment for ${upr.callsign}.`);
    setBusy(false);
  };
  const amend = async () => {
    if (!note.trim()) return;
    setBusy(true);
    let att: { path: string; name: string; size: number } | null = null;
    if (pendingPdf) att = await uploadPdf(pendingPdf, "amendment", upr.id);
    await supabase.from("segments").update({
      status: "amended", note, reason: null,
      amendment_path: att?.path ?? null, amendment_name: att?.name ?? null, amendment_size: att?.size ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", seg.id);
    await log(`${fir} proposed amendment${att ? ` (PDF: ${att.name})` : ""}: "${note}"`);
    setMode(null); setNote(""); setPendingPdf(null); setBusy(false);
  };
  const reject = async () => {
    setBusy(true);
    await supabase.from("segments").update({ status: "rejected", reason, note: null, updated_at: new Date().toISOString() }).eq("id", seg.id);
    await log(`${fir} rejected segment — ${reason}`);
    setMode(null); setBusy(false);
  };

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">Tri-Action Decision Panel</div>
          <div className="text-[11px] text-slate-400">Segment: {seg.fir_code} · {seg.entry} → {seg.exit} · {seg.fl} · rev {seg.revision}</div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded ${STATUS_META[seg.status].bg} ${STATUS_META[seg.status].color}`}>{STATUS_META[seg.status].label}</span>
      </div>
      {locked && seg.status === "amended" && (
        <div className="text-xs bg-amber-500/10 ring-1 ring-amber-500/30 text-amber-200 rounded-md p-2 mb-3 space-y-1.5">
          <div>Locked — awaiting airline revision. Your proposal: <em>{seg.note}</em></div>
          {seg.amendment_path && seg.amendment_name && <PdfBadge path={seg.amendment_path} name={seg.amendment_name} size={seg.amendment_size ?? 0} label="Amendment chart" />}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <button disabled={locked || busy} onClick={approve} className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-emerald-950 font-semibold py-2 rounded-lg text-sm">✓ Approve Route Segment</button>
        <button disabled={locked || busy} onClick={() => setMode(mode === "amend" ? null : "amend")} className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-amber-950 font-semibold py-2 rounded-lg text-sm">⚠ Propose Amendment</button>
        <button disabled={locked || busy} onClick={() => setMode(mode === "reject" ? null : "reject")} className="bg-red-500 hover:bg-red-400 disabled:opacity-40 text-red-950 font-semibold py-2 rounded-lg text-sm">✕ Reject Segment</button>
      </div>
      {mode === "amend" && (
        <div className="mt-3 space-y-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe the required amendment…" className="w-full h-24 bg-slate-950/60 ring-1 ring-slate-800 rounded-md p-2 text-sm focus:ring-amber-500 outline-none" />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">Recommended amendment chart (PDF)</div>
            {pendingPdf ? (
              <div className="flex items-center justify-between gap-2 rounded-md bg-slate-950/60 ring-1 ring-slate-800 px-2.5 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-red-400">📄</span>
                  <div className="min-w-0"><div className="text-xs font-medium truncate">{pendingPdf.name}</div><div className="text-[10px] text-slate-500">{fmtBytes(pendingPdf.size)}</div></div>
                </div>
                <button onClick={() => setPendingPdf(null)} className="text-[10px] px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800">Remove</button>
              </div>
            ) : (
              <label className="block">
                <span className="cursor-pointer w-full inline-block rounded-md bg-slate-950/60 ring-1 ring-dashed ring-slate-700 hover:ring-amber-500/60 px-2.5 py-3 text-xs text-slate-400 hover:text-amber-300 transition text-center">+ Attach PDF (max 10 MB)</span>
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  if (f.size > 10 * 1024 * 1024) return;
                  setPendingPdf(f);
                }} />
              </label>
            )}
          </div>
          <button disabled={!note.trim() || busy} onClick={amend} className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-amber-950 font-semibold py-1.5 rounded-md text-sm">Submit Amendment Request</button>
        </div>
      )}
      {mode === "reject" && (
        <div className="mt-3 space-y-2">
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-2 text-sm focus:ring-red-500 outline-none">
            {REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button onClick={reject} disabled={busy} className="w-full bg-red-500 hover:bg-red-400 disabled:opacity-40 text-red-950 font-semibold py-1.5 rounded-md text-sm">Confirm Rejection</button>
        </div>
      )}
    </div>
  );
}

// ─────────── Chat / Broadcast ───────────
function SegmentChat({ upr, segs, chat, reactions, session }: { upr: UPRRow; segs: SegmentRow[]; chat: ChatRow[]; reactions: ChatReactionRow[]; session: AppSession }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<ChatRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const confirmedIds = useMemo(() => new Set(chat.map((c) => c.id)), [chat]);
  const merged = useMemo(
    () => [...chat, ...pending.filter((p) => !confirmedIds.has(p.id))].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [chat, pending, confirmedIds]
  );
  useEffect(() => { setPending((prev) => prev.filter((p) => !confirmedIds.has(p.id))); }, [confirmedIds]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [merged.length]);

  const reactionsByMessage = useMemo(() => {
    const m = new Map<string, ChatReactionRow[]>();
    for (const r of reactions) {
      const arr = m.get(r.message_id) ?? [];
      arr.push(r); m.set(r.message_id, arr);
    }
    return m;
  }, [reactions]);

  const myLabel =
    session.role === "airline" ? `${session.scope} Dispatcher` :
    session.role === "ansp" ? `${session.scope} ${FIRS.find((f) => f.code === session.scope)?.name ?? ""}` :
    "Admin";

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const tempId = `tmp-${crypto.randomUUID()}`;
    const optimistic: ChatRow = {
      id: tempId, upr_id: upr.id, author: session.userId, author_label: myLabel,
      author_role: session.role, text: trimmed, created_at: new Date().toISOString(),
    };
    setPending((p) => [...p, optimistic]);
    setText("");
    const { data, error } = await supabase.from("chat_messages")
      .insert({ upr_id: upr.id, author: session.userId, author_label: myLabel, author_role: session.role, text: trimmed })
      .select().single();
    if (error) { setPending((p) => p.filter((m) => m.id !== tempId)); setText(trimmed); return; }
    if (data) setPending((p) => p.map((m) => (m.id === tempId ? { ...(data as any) } : m)));
  };

  const saveEdit = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setEditingId(null);
    await supabase.from("chat_messages").update({ text: trimmed }).eq("id", id);
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this message?")) return;
    await supabase.from("chat_messages").delete().eq("id", id);
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (messageId.startsWith("tmp-")) return;
    const mine = reactions.find((r) => r.message_id === messageId && r.emoji === emoji && r.user_id === session.userId);
    setPickerFor(null);
    if (mine) {
      setReactionsOptimisticRemove(mine.id);
      await supabase.from("chat_reactions" as any).delete().eq("id", mine.id);
    } else {
      await supabase.from("chat_reactions" as any).insert({
        message_id: messageId, upr_id: upr.id, user_id: session.userId, user_label: myLabel, emoji,
      });
    }
  };
  // Optimistic removal helper via a ref-less local set — realtime will reconcile.
  const setReactionsOptimisticRemove = (_id: string) => { /* handled by realtime DELETE */ };

  const participants = [`${upr.airline_code} Dispatcher`, ...segs.map((s) => `${s.fir_code} ${FIRS.find((f) => f.code === s.fir_code)?.name ?? ""}`)];

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 flex flex-col h-[420px]">
      <div className="px-3.5 py-2.5 border-b border-slate-800">
        <div className="text-sm font-semibold flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Contextual Segment Chat</div>
        <div className="text-[10px] text-slate-500 truncate">Participants: {participants.join(", ")}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {merged.map((m) => (
          <ChatBubble
            key={m.id} m={m} mineId={session.userId}
            isPending={m.id.startsWith("tmp-")}
            isEditing={editingId === m.id}
            editText={editText}
            reactions={reactionsByMessage.get(m.id) ?? []}
            pickerOpen={pickerFor === m.id}
            onTogglePicker={() => setPickerFor((cur) => (cur === m.id ? null : m.id))}
            onReact={(emoji) => toggleReaction(m.id, emoji)}
            onStartEdit={() => { setEditingId(m.id); setEditText(m.text); }}
            onCancelEdit={() => setEditingId(null)}
            onChangeEdit={setEditText}
            onSaveEdit={() => saveEdit(m.id)}
            onDelete={() => remove(m.id)}
          />
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-slate-800 p-2 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message as ${myLabel}…`} className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2.5 py-1.5 text-sm focus:ring-sky-500 outline-none" />
        <button className="text-xs px-3 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold">Send</button>
      </form>
    </div>
  );
}
function ChatBubble({
  m, mineId, isPending, isEditing, editText, reactions = [], pickerOpen,
  onStartEdit, onCancelEdit, onChangeEdit, onSaveEdit, onDelete,
  onTogglePicker, onReact,
}: {
  m: ChatRow; mineId: string; isPending?: boolean; isEditing?: boolean; editText?: string;
  reactions?: ChatReactionRow[]; pickerOpen?: boolean;
  onStartEdit?: () => void; onCancelEdit?: () => void; onChangeEdit?: (v: string) => void;
  onSaveEdit?: () => void; onDelete?: () => void;
  onTogglePicker?: () => void; onReact?: (emoji: string) => void;
}) {
  if (m.author_role === "system") return (
    <div className="text-center text-[10px] uppercase tracking-wider text-slate-500 py-1">
      {m.text} <span className="text-slate-600">· {fmtTime(m.created_at)}</span>
    </div>
  );
  const mine = m.author === mineId;

  // Group reactions by emoji
  const grouped = reactions.reduce<Record<string, { count: number; mine: boolean; labels: string[] }>>((acc, r) => {
    const g = acc[r.emoji] ?? { count: 0, mine: false, labels: [] };
    g.count += 1;
    if (r.user_id === mineId) g.mine = true;
    g.labels.push(r.user_label || "User");
    acc[r.emoji] = g;
    return acc;
  }, {});

  return (
    <div className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`relative max-w-[85%] ${isPending ? "opacity-60" : ""}`}>
        <div className={`relative rounded-lg px-2.5 py-1.5 text-sm ${mine ? "bg-sky-500/90 text-slate-950" : "bg-slate-800 text-slate-100 ring-1 ring-slate-700"}`}>
          <div className={`text-[10px] font-semibold opacity-80 ${mine ? "text-slate-900" : "text-emerald-300"}`}>{m.author_label}</div>
          {isEditing ? (
            <div className="flex flex-col gap-1 mt-0.5 min-w-[180px]">
              <textarea value={editText} onChange={(e) => onChangeEdit?.(e.target.value)} rows={2} autoFocus
                className="bg-slate-950/70 text-slate-100 ring-1 ring-slate-700 rounded px-1.5 py-1 text-xs outline-none focus:ring-sky-400" />
              <div className="flex gap-1.5 text-[10px]">
                <button onClick={onSaveEdit} className="px-2 py-0.5 rounded bg-emerald-500 text-slate-950 font-semibold">Save</button>
                <button onClick={onCancelEdit} className="px-2 py-0.5 rounded bg-slate-700 text-slate-200">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="leading-snug whitespace-pre-wrap break-words">{m.text}</div>
          )}
          <div className={`text-[9px] mt-0.5 opacity-60 ${mine ? "text-slate-900" : "text-slate-400"}`}>
            {fmtTime(m.created_at)}
            {m.edited_at ? <span className="ml-1 italic">· edited</span> : null}
            {isPending ? <span className="ml-1 italic">· sending…</span> : null}
          </div>
          {!isEditing && !isPending && (
            <div className={`absolute -top-2.5 ${mine ? "left-1" : "right-1"} hidden group-hover:flex gap-1`}>
              <button onClick={onTogglePicker} title="React" className="text-[11px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-200 ring-1 ring-slate-700 hover:bg-slate-800">😊</button>
              {mine && <button onClick={onStartEdit} title="Edit" className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-200 ring-1 ring-slate-700 hover:bg-slate-800">✎</button>}
              {mine && <button onClick={onDelete} title="Delete" className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-red-300 ring-1 ring-slate-700 hover:bg-slate-800">🗑</button>}
            </div>
          )}
          {pickerOpen && (
            <div className={`absolute z-10 ${mine ? "left-0" : "right-0"} -bottom-9 flex gap-0.5 bg-slate-950 ring-1 ring-slate-700 rounded-full px-1.5 py-1 shadow-lg`}>
              {REACTION_EMOJIS.map((e) => (
                <button key={e} onClick={() => onReact?.(e)} className="text-base leading-none hover:scale-125 transition-transform px-1">{e}</button>
              ))}
            </div>
          )}
        </div>
        {Object.keys(grouped).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 ${mine ? "justify-end" : "justify-start"}`}>
            {Object.entries(grouped).map(([emoji, g]) => (
              <button
                key={emoji}
                onClick={() => onReact?.(emoji)}
                title={g.labels.join(", ")}
                className={`text-[11px] leading-none px-1.5 py-0.5 rounded-full ring-1 flex items-center gap-1 ${g.mine ? "bg-sky-500/20 ring-sky-400/60 text-sky-100" : "bg-slate-800/80 ring-slate-700 text-slate-200 hover:bg-slate-800"}`}
              >
                <span>{emoji}</span><span className="tabular-nums">{g.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}



function BroadcastPanel({ broadcasts, session }: { broadcasts: BroadcastRow[]; session: AppSession }) {
  const [text, setText] = useState("");
  const [sev, setSev] = useState<"info" | "warn" | "critical">("info");
  const label =
    session.role === "airline" ? `Airline · ${session.scope}` :
    session.role === "ansp" ? `ANSP · ${session.scope}` :
    "Admin";
  const send = async () => {
    if (!text.trim()) return;
    await supabase.from("broadcasts").insert({
      author: session.userId, author_label: session.fullName,
      author_role: label, text: text.trim(), severity: sev,
    });
    setText("");
  };
  const sevMap = {
    info: "bg-sky-500/15 ring-sky-500/40 text-sky-200",
    warn: "bg-amber-500/15 ring-amber-500/40 text-amber-200",
    critical: "bg-red-500/15 ring-red-500/40 text-red-200",
  };
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 flex flex-col h-[340px]">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center justify-between">
        <div className="text-sm font-semibold flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" /> Stakeholder Broadcast</div>
        <span className="text-[10px] text-slate-500">Global · all entities</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {broadcasts.map((b) => (
          <div key={b.id} className={`rounded-lg p-2 ring-1 ${sevMap[b.severity]}`}>
            <div className="flex justify-between items-center text-[10px] opacity-80">
              <span className="font-semibold uppercase tracking-wider">{b.author_role} · {b.author_label}</span>
              <span>{fmtTime(b.created_at)}</span>
            </div>
            <div className="text-sm mt-0.5">{b.text}</div>
          </div>
        ))}
        {broadcasts.length === 0 && <div className="text-center text-xs text-slate-500 py-6">No broadcasts</div>}
      </div>
      <div className="border-t border-slate-800 p-2 space-y-1.5">
        <div className="flex gap-1.5">
          {(["info", "warn", "critical"] as const).map((s) => (
            <button key={s} onClick={() => setSev(s)} className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider ${sev === s ? sevMap[s] + " ring-1" : "text-slate-400 ring-1 ring-slate-800"}`}>{s}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Issue broadcast to all entities…" className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2.5 py-1.5 text-sm focus:ring-red-500 outline-none" />
          <button onClick={send} className="text-xs px-3 rounded-md bg-red-500 hover:bg-red-400 text-red-950 font-semibold">Broadcast</button>
        </div>
      </div>
    </div>
  );
}

// ─────────── Admin view: approvals + analytics ───────────
function AdminView({ session, uprs, segments, schedules, reports }: { session: AppSession; uprs: UPRRow[]; segments: SegmentRow[]; schedules: TrialScheduleRow[]; reports: FlightReportRow[] }) {
  type PendingRow = { id: string; email: string; full_name: string; requested_role: string | null; requested_scope: string | null; created_at: string };
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id,email,full_name,requested_role,requested_scope,created_at,approved,rejected")
      .eq("approved", false)
      .eq("rejected", false)
      .order("created_at");
    setPending((data ?? []) as any);
  }, []);
  useEffect(() => { load(); }, [load, session.userId]);

  const approve = async (p: PendingRow) => {
    setBusy(p.id);
    const role = (p.requested_role ?? "airline") as "airline" | "ansp" | "admin" | "regulator";
    const scope = p.requested_scope;
    const { error } = await supabase.rpc("approve_user", { _user_id: p.id, _role: role, _scope: scope ?? "" });
    if (error) alert(error.message);
    await load();
    setBusy(null);
  };

  const reject = async (p: PendingRow) => {
    if (!confirm(`Reject account request from ${p.full_name} (${p.email})? They will be removed from your pending list.`)) return;
    const reason = prompt("Optional reason for rejection:", "") ?? "";
    setBusy(p.id);
    const { error } = await supabase.rpc("reject_user", { _user_id: p.id, _reason: reason || undefined });
    if (error) alert(error.message);
    await load();
    setBusy(null);
  };

  const remove = async (p: PendingRow) => {
    if (!confirm(`Permanently delete the account for ${p.email}? This cannot be undone.`)) return;
    setBusy(p.id);
    try {
      await deleteUserAccount({ data: { userId: p.id } });
    } catch (e: any) {
      alert(e?.message ?? "Failed to delete account");
    }
    await load();
    setBusy(null);
  };

  // Analytics
  const verdictOf = (uprId: string) => computeVerdict(segments.filter((s) => s.upr_id === uprId));
  const approved = uprs.filter((u) => verdictOf(u.id) === "APPROVED");
  const minSaved = approved.reduce((s, u) => s + Math.max(0, u.baseline_minutes - u.optimized_minutes), 0);
  const fuelSaved = approved.reduce((s, u) => s + Math.max(0, u.baseline_minutes - u.optimized_minutes) * Number(u.burn_kg_per_min), 0);
  const co2 = fuelSaved * 3.16;
  const stats = [
    { label: "Approved UPR Trials", value: approved.length.toString(), sub: `of ${uprs.length} total` },
    { label: "Flight Minutes Saved", value: minSaved.toLocaleString(), sub: "minutes" },
    { label: "Jet Fuel Conserved", value: fuelSaved.toLocaleString(undefined, { maximumFractionDigits: 0 }), sub: "kg" },
    { label: "CO₂ Emissions Avoided", value: co2.toLocaleString(undefined, { maximumFractionDigits: 0 }), sub: "kg CO₂" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administrator Console</h1>
        <p className="text-sm text-slate-400">Approve new operators and review operational impact.</p>
      </div>
      <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Pending account approvals ({pending.length})</div>
          <button onClick={load} className="text-[11px] text-sky-400 hover:text-sky-300">Refresh</button>
        </div>
        {pending.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center">No pending requests.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-slate-400">
              <tr><th className="text-left py-2">Name</th><th className="text-left">Email</th><th className="text-left">Requested role</th><th className="text-left">Scope</th><th className="text-right">Action</th></tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id} className="border-t border-slate-800">
                  <td className="py-2">{p.full_name}</td>
                  <td className="text-slate-400">{p.email}</td>
                  <td><span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800">{p.requested_role ?? "—"}</span></td>
                  <td className="font-mono text-slate-300">{p.requested_scope ?? "—"}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-2">
                      <button disabled={busy === p.id} onClick={() => approve(p)} className="text-xs px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-emerald-950 font-semibold">
                        {busy === p.id ? "…" : "Approve"}
                      </button>
                      <button disabled={busy === p.id} onClick={() => reject(p)} className="text-xs px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-amber-950 font-semibold">
                        Reject
                      </button>
                      <button disabled={busy === p.id} onClick={() => remove(p)} className="text-xs px-3 py-1 rounded bg-red-500 hover:bg-red-400 disabled:opacity-40 text-red-50 font-semibold">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <FirManager />
      <AircraftManager />

      <div className="grid grid-cols-4 gap-4">


        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">{s.label}</div>
            <div className="text-3xl font-semibold mt-2 bg-gradient-to-br from-emerald-300 to-sky-400 bg-clip-text text-transparent">{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>
      <StagedTrialCalendar uprs={uprs} segments={segments} schedules={schedules} title="Aggregated trial calendar (all stages)" filter={{ type: "all" }} />
      <AdminUprActivity uprs={uprs} segments={segments} />
      <FlightReportsList uprs={uprs} reports={reports} schedules={schedules} scopeLabel="All trials across the network" />
    </div>
  );
}

// ─────────── Admin UPR activity with FIR color coding + PDFs from both parties ───────────
function AdminUprActivity({ uprs, segments }: { uprs: UPRRow[]; segments: SegmentRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
      <div className="text-sm font-semibold mb-1">UPR progress & attachments</div>
      <p className="text-[11px] text-slate-500 mb-3">FIR names are color-coded by their current segment status — click a row to view all PDFs submitted by the airline and ANSPs.</p>
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-slate-400">
          <tr><th className="text-left py-2">Callsign</th><th className="text-left">Airline</th><th className="text-left">Route</th><th className="text-left">FIRs (status)</th><th className="text-right">Δ min</th><th className="text-right">CO₂ avoided</th><th className="text-right">Verdict</th></tr>
        </thead>
        <tbody>
          {uprs.map((u) => {
            const segs = segments.filter((s) => s.upr_id === u.id).sort((a, b) => a.order_idx - b.order_idx);
            const dm = Math.max(0, u.baseline_minutes - u.optimized_minutes);
            const c = dm * Number(u.burn_kg_per_min) * 3.16;
            const isOpen = expanded === u.id;
            const amendments = segs.filter((s) => s.amendment_path && s.amendment_name);
            return (
              <Fragment key={u.id}>
                <tr className="border-t border-slate-800 cursor-pointer hover:bg-slate-800/40" onClick={() => setExpanded(isOpen ? null : u.id)}>
                  <td className="py-2 font-mono">{u.callsign}</td>
                  <td className="text-slate-300">{u.airline_code}</td>
                  <td>{u.dep} → {u.arr}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      {segs.map((s, i) => {
                        const m = STATUS_META[s.status];
                        return (
                          <Fragment key={s.id}>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ring-1 ${m.bg} ${m.color} ${m.ring}`} title={m.label}>
                              <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                              <span className="font-mono text-[11px]">{s.fir_code}</span>
                            </span>
                            {i < segs.length - 1 && <span className="text-slate-600">→</span>}
                          </Fragment>
                        );
                      })}
                      {segs.length === 0 && <span className="text-slate-500 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="text-right text-emerald-300">{dm}</td>
                  <td className="text-right">{c.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</td>
                  <td className="text-right"><VerdictPill verdict={computeVerdict(segs)} /></td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-slate-800 bg-slate-950/40">
                    <td colSpan={7} className="p-4">
                      <div className="space-y-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">Airline submission</div>
                          {u.flight_plan_path && u.flight_plan_name ? (
                            <PdfBadge path={u.flight_plan_path} name={u.flight_plan_name} size={u.flight_plan_size ?? 0} label="Flight Plan" />
                          ) : (
                            <div className="text-xs text-slate-500">No flight plan PDF attached.</div>
                          )}
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">ANSP amendments ({amendments.length})</div>
                          {amendments.length === 0 ? (
                            <div className="text-xs text-slate-500">No amendment charts uploaded.</div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {amendments.map((s) => (
                                <div key={s.id} className="flex flex-col gap-1">
                                  <div className="text-[10px] font-mono text-slate-400">{s.fir_code} · {STATUS_META[s.status].label}</div>
                                  <PdfBadge path={s.amendment_path!} name={s.amendment_name!} size={s.amendment_size ?? 0} label="Amendment" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {uprs.length === 0 && <tr><td colSpan={7} className="text-center text-xs text-slate-500 py-6">No UPRs yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FirManager() {
  const [firs, setFirs] = useState<{ code: string; name: string }[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("firs").select("code,name").order("code");
    setFirs((data ?? []) as any);
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setErr("");
    const c = code.trim().toUpperCase();
    const n = name.trim();
    if (!/^[A-Z0-9]{2,8}$/.test(c)) { setErr("FIR code must be 2–8 letters/digits (e.g. HKNA)"); return; }
    if (n.length < 2 || n.length > 80) { setErr("Enter a FIR name"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("admin_add_fir", { _code: c, _name: n });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setCode(""); setName("");
    await load();
  };

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">Flight Information Regions ({firs.length})</div>
        <button onClick={load} className="text-[11px] text-sky-400 hover:text-sky-300">Refresh</button>
      </div>
      <div className="grid grid-cols-[120px_1fr_auto] gap-2 mb-3">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HKNA" maxLength={8}
          className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm font-mono focus:ring-sky-500 outline-none" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nairobi FIR" maxLength={80}
          className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none" />
        <button onClick={add} disabled={busy} className="text-xs px-3 rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-semibold">
          {busy ? "…" : "Add FIR"}
        </button>
      </div>
      {err && <div className="text-[11px] text-rose-400 mb-2">{err}</div>}
      <div className="flex flex-wrap gap-1.5">
        {firs.map((f) => (
          <span key={f.code} className="text-[11px] px-2 py-0.5 rounded bg-slate-800 ring-1 ring-slate-700">
            <span className="font-mono text-sky-300">{f.code}</span> <span className="text-slate-400">{f.name}</span>
          </span>
        ))}
        {firs.length === 0 && <div className="text-xs text-slate-500">No FIRs yet.</div>}
      </div>
    </div>
  );
}

function AircraftManager() {
  type AC = { code: string; name: string; burn_kg_per_min: number };
  const [rows, setRows] = useState<AC[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [burn, setBurn] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase.from("aircraft_types").select("code,name,burn_kg_per_min").order("code");
    setRows((data ?? []) as any);
  }, []);
  useEffect(() => { load(); }, [load]);

  const upsert = async (c: string, n: string, b: number) => {
    setErr("");
    const cu = c.trim().toUpperCase();
    const nt = n.trim();
    if (!/^[A-Z0-9]{2,8}$/.test(cu)) { setErr("Code must be 2–8 letters/digits"); return false; }
    if (nt.length < 2) { setErr("Enter aircraft name"); return false; }
    if (!isFinite(b) || b <= 0 || b > 1000) { setErr("Burn rate must be between 0 and 1000 kg/min"); return false; }
    setBusy(true);
    const { error } = await supabase.rpc("admin_upsert_aircraft", { _code: cu, _name: nt, _burn: b });
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    await load();
    return true;
  };

  const add = async () => {
    const ok = await upsert(code, name, parseFloat(burn));
    if (ok) { setCode(""); setName(""); setBurn(""); }
  };

  const saveRow = async (r: AC) => {
    const newBurn = parseFloat(editing[r.code] ?? String(r.burn_kg_per_min));
    await upsert(r.code, r.name, newBurn);
    setEditing((e) => { const n = { ...e }; delete n[r.code]; return n; });
  };

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold">Aircraft types & burn rates ({rows.length})</div>
        <button onClick={load} className="text-[11px] text-sky-400 hover:text-sky-300">Refresh</button>
      </div>
      <div className="text-[11px] text-slate-500 mb-3">Burn rate is kg of jet fuel per minute. 1 kg fuel saved ≈ 3.16 kg CO₂ avoided.</div>
      <div className="grid grid-cols-[110px_1fr_140px_auto] gap-2 mb-3">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="B788" maxLength={8}
          className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm font-mono focus:ring-sky-500 outline-none" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Boeing 787-8" maxLength={80}
          className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none" />
        <input value={burn} onChange={(e) => setBurn(e.target.value)} placeholder="kg/min" inputMode="decimal"
          className="bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none" />
        <button onClick={add} disabled={busy} className="text-xs px-3 rounded-md bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-semibold">
          {busy ? "…" : "Add / Update"}
        </button>
      </div>
      {err && <div className="text-[11px] text-rose-400 mb-2">{err}</div>}
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-slate-400">
          <tr><th className="text-left py-2">Code</th><th className="text-left">Name</th><th className="text-right">Burn (kg/min)</th><th className="text-right">CO₂ (kg/min)</th><th className="text-right">Action</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isEditing = editing[r.code] !== undefined;
            const curVal = isEditing ? editing[r.code] : String(r.burn_kg_per_min);
            const numeric = parseFloat(curVal);
            return (
              <tr key={r.code} className="border-t border-slate-800">
                <td className="py-2 font-mono text-sky-300">{r.code}</td>
                <td className="text-slate-300">{r.name}</td>
                <td className="text-right">
                  <input value={curVal} onChange={(e) => setEditing((s) => ({ ...s, [r.code]: e.target.value }))}
                    className="w-24 text-right bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1 text-sm focus:ring-sky-500 outline-none" />
                </td>
                <td className="text-right text-emerald-300">{isFinite(numeric) ? (numeric * 3.16).toFixed(1) : "—"}</td>
                <td className="text-right">
                  <button onClick={() => saveRow(r)} disabled={busy || !isEditing}
                    className="text-[11px] px-2 py-1 rounded bg-emerald-500 hover:bg-emerald-400 disabled:opacity-30 text-emerald-950 font-semibold">Save</button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={5} className="text-center text-xs text-slate-500 py-4">No aircraft types yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}



function EmptyCard({ text }: { text: string }) {
  return <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-10 text-center text-slate-400 text-sm">{text}</div>;
}
