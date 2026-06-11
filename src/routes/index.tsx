import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  FIRS, REJECT_REASONS, STATUS_META,
  type AppSession, type BroadcastRow, type ChatRow, type SegmentRow, type SegStatus, type UPRRow,
  fmtBytes, fmtTime,
} from "@/lib/upr-types";
import { uploadPdf, viewPdf, downloadPdf } from "@/lib/upr-storage";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "UPR Coordination Platform" },
      { name: "description", content: "African User Preferred Routes coordination — segment-by-segment ANSP negotiation." },
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
  const [claiming, setClaiming] = useState(false);
  const [msg, setMsg] = useState("");
  const claimAdmin = async () => {
    setClaiming(true); setMsg("");
    const { data, error } = await supabase.rpc("claim_first_admin");
    setClaiming(false);
    if (error) { setMsg(error.message); return; }
    if (data) { setMsg("You are now the platform administrator."); onRefresh(); }
    else setMsg("An administrator already exists — wait for approval.");
  };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 grid place-items-center px-6">
      <div className="max-w-md w-full rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-6">
        <div className="text-amber-300 text-xs uppercase tracking-wider mb-2">Pending administrator approval</div>
        <h1 className="text-xl font-semibold">Hi {pending.fullName}</h1>
        <p className="text-sm text-slate-400 mt-2">
          Your account ({pending.email}) is waiting for an administrator to grant role
          <span className="text-slate-200"> {pending.requestedRole ?? "—"}</span>
          {pending.requestedScope ? <> · scope <span className="text-slate-200">{pending.requestedScope}</span></> : null}.
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={onRefresh} className="flex-1 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-md py-2 text-sm">Refresh status</button>
          <button onClick={() => supabase.auth.signOut()} className="px-3 ring-1 ring-slate-700 hover:bg-slate-800 rounded-md py-2 text-xs">Sign out</button>
        </div>
        <div className="mt-5 pt-4 border-t border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Platform setup</div>
          <p className="text-[11px] text-slate-500 mb-2">If no administrator exists yet, claim the role to bootstrap the platform.</p>
          <button onClick={claimAdmin} disabled={claiming} className="w-full text-xs ring-1 ring-fuchsia-500/40 hover:bg-fuchsia-500/10 text-fuchsia-300 rounded-md py-1.5">
            {claiming ? "…" : "Claim first-admin role"}
          </button>
          {msg && <div className="mt-2 text-[11px] text-slate-300">{msg}</div>}
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
  const [activeId, setActiveId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const [u, s, c, b] = await Promise.all([
      supabase.from("uprs").select("*").order("created_at", { ascending: false }),
      supabase.from("segments").select("*").order("order_idx"),
      supabase.from("chat_messages").select("*").order("created_at"),
      supabase.from("broadcasts").select("*").order("created_at", { ascending: false }),
    ]);
    if (u.data) setUprs(u.data as any);
    if (s.data) setSegments(s.data as any);
    if (c.data) setChat(c.data as any);
    if (b.data) setBroadcasts(b.data as any);
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("upr-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "uprs" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "segments" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => refetch())
      .on("postgres_changes", { event: "*", schema: "public", table: "broadcasts" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refetch]);

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
            activeId={activeId} setActiveId={setActiveId}
            active={active} activeSegments={activeSegments} activeChat={activeChat}
          />
        )}
        {session.role === "ansp" && (
          <ANSPView
            session={session} uprs={uprs} segments={segments} broadcasts={broadcasts}
            activeId={activeId} setActiveId={setActiveId}
            active={active} activeSegments={activeSegments} activeChat={activeChat}
          />
        )}
        {session.role === "admin" && <AdminView session={session} uprs={uprs} segments={segments} />}
      </div>
    </div>
  );
}

function TopBar({ session }: { session: AppSession }) {
  const label =
    session.role === "airline" ? `${session.scope} · Dispatcher` :
    session.role === "ansp" ? `${session.scope} ${FIRS.find((f) => f.code === session.scope)?.name ?? ""} · Controller` :
    "Admin · Oversight";
  const color =
    session.role === "airline" ? "from-sky-500 to-cyan-500" :
    session.role === "ansp" ? "from-amber-500 to-orange-500" :
    "from-fuchsia-500 to-pink-500";
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto max-w-[1500px] px-6 py-3 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 grid place-items-center font-black text-slate-950">U</div>
          <div>
            <div className="font-semibold tracking-tight">UPR Coordination Platform</div>
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
function AirlineView({ session, uprs, segments, broadcasts, activeId, setActiveId, active, activeSegments, activeChat }: {
  session: AppSession;
  uprs: UPRRow[]; segments: SegmentRow[]; broadcasts: BroadcastRow[];
  activeId: string | null; setActiveId: (id: string | null) => void;
  active: UPRRow | null; activeSegments: SegmentRow[]; activeChat: ChatRow[];
}) {
  const myUprs = useMemo(() => uprs.filter((u) => u.airline_code === session.scope), [uprs, session.scope]);
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
            <AirlineSegmentList upr={active} segs={activeSegments} session={session} />
          </>
        ) : <EmptyCard text="Create or select a UPR request to begin." />}
      </main>
      <aside className="col-span-3 space-y-5">
        {active && <SegmentChat upr={active} segs={activeSegments} chat={activeChat} session={session} />}
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
        <Input label="A/C" value={aircraft} onChange={setAircraft} placeholder="B788" />
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
function ANSPView({ session, uprs, segments, broadcasts, activeId, setActiveId, active, activeSegments, activeChat }: {
  session: AppSession;
  uprs: UPRRow[]; segments: SegmentRow[]; broadcasts: BroadcastRow[];
  activeId: string | null; setActiveId: (id: string | null) => void;
  active: UPRRow | null; activeSegments: SegmentRow[]; activeChat: ChatRow[];
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
          </>
        ) : <EmptyCard text={`No active request for ${fir}.`} />}
      </main>
      <aside className="col-span-3 space-y-5">
        {active && <SegmentChat upr={active} segs={activeSegments} chat={activeChat} session={session} />}
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
function SegmentChat({ upr, segs, chat, session }: { upr: UPRRow; segs: SegmentRow[]; chat: ChatRow[]; session: AppSession }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat.length]);
  const myLabel =
    session.role === "airline" ? `${session.scope} Dispatcher` :
    session.role === "ansp" ? `${session.scope} ${FIRS.find((f) => f.code === session.scope)?.name ?? ""}` :
    "Admin";
  const send = async () => {
    if (!text.trim()) return;
    await supabase.from("chat_messages").insert({
      upr_id: upr.id, author: session.userId, author_label: myLabel,
      author_role: session.role, text: text.trim(),
    });
    setText("");
  };
  const participants = [`${upr.airline_code} Dispatcher`, ...segs.map((s) => `${s.fir_code} ${FIRS.find((f) => f.code === s.fir_code)?.name ?? ""}`)];

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 flex flex-col h-[420px]">
      <div className="px-3.5 py-2.5 border-b border-slate-800">
        <div className="text-sm font-semibold flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Contextual Segment Chat</div>
        <div className="text-[10px] text-slate-500 truncate">Participants: {participants.join(", ")}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {chat.map((m) => <ChatBubble key={m.id} m={m} mineId={session.userId} />)}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-slate-800 p-2 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message as ${myLabel}…`} className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2.5 py-1.5 text-sm focus:ring-sky-500 outline-none" />
        <button className="text-xs px-3 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold">Send</button>
      </form>
    </div>
  );
}
function ChatBubble({ m, mineId }: { m: ChatRow; mineId: string }) {
  if (m.author_role === "system") return (
    <div className="text-center text-[10px] uppercase tracking-wider text-slate-500 py-1">
      {m.text} <span className="text-slate-600">· {fmtTime(m.created_at)}</span>
    </div>
  );
  const mine = m.author === mineId;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm ${mine ? "bg-sky-500/90 text-slate-950" : "bg-slate-800 text-slate-100 ring-1 ring-slate-700"}`}>
        <div className={`text-[10px] font-semibold opacity-80 ${mine ? "text-slate-900" : "text-emerald-300"}`}>{m.author_label}</div>
        <div className="leading-snug">{m.text}</div>
        <div className={`text-[9px] mt-0.5 opacity-60 ${mine ? "text-slate-900" : "text-slate-400"}`}>{fmtTime(m.created_at)}</div>
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
function AdminView({ session, uprs, segments }: { session: AppSession; uprs: UPRRow[]; segments: SegmentRow[] }) {
  type PendingRow = { id: string; email: string; full_name: string; requested_role: string | null; requested_scope: string | null; created_at: string };
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id,email,full_name,requested_role,requested_scope,created_at,approved").eq("approved", false).order("created_at");
    setPending((data ?? []) as any);
  }, []);
  useEffect(() => { load(); }, [load, session.userId]);

  const approve = async (p: PendingRow) => {
    setBusy(p.id);
    const role = (p.requested_role ?? "airline") as "airline" | "ansp" | "admin";
    const scope = p.requested_scope;
    const { error } = await supabase.rpc("approve_user", { _user_id: p.id, _role: role, _scope: scope ?? "" });
    if (error) alert(error.message);
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
                    <button disabled={busy === p.id} onClick={() => approve(p)} className="text-xs px-3 py-1 rounded bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-emerald-950 font-semibold">
                      {busy === p.id ? "…" : "Approve"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <FirManager />
      <div className="grid grid-cols-4 gap-4">


        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">{s.label}</div>
            <div className="text-3xl font-semibold mt-2 bg-gradient-to-br from-emerald-300 to-sky-400 bg-clip-text text-transparent">{s.value}</div>
            <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
        <div className="text-sm font-semibold mb-3">Recent UPR activity</div>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-slate-400">
            <tr><th className="text-left py-2">Callsign</th><th className="text-left">Airline</th><th className="text-left">Route</th><th className="text-left">FIRs</th><th className="text-right">Δ min</th><th className="text-right">CO₂ avoided</th><th className="text-right">Verdict</th></tr>
          </thead>
          <tbody>
            {uprs.map((u) => {
              const segs = segments.filter((s) => s.upr_id === u.id).sort((a, b) => a.order_idx - b.order_idx);
              const dm = Math.max(0, u.baseline_minutes - u.optimized_minutes);
              const c = dm * Number(u.burn_kg_per_min) * 3.16;
              return (
                <tr key={u.id} className="border-t border-slate-800">
                  <td className="py-2 font-mono">{u.callsign}</td>
                  <td className="text-slate-300">{u.airline_code}</td>
                  <td>{u.dep} → {u.arr}</td>
                  <td className="text-slate-400">{segs.map((s) => s.fir_code).join(" → ")}</td>
                  <td className="text-right text-emerald-300">{dm}</td>
                  <td className="text-right">{c.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</td>
                  <td className="text-right"><VerdictPill verdict={computeVerdict(segs)} /></td>
                </tr>
              );
            })}
            {uprs.length === 0 && <tr><td colSpan={7} className="text-center text-xs text-slate-500 py-6">No UPRs yet.</td></tr>}
          </tbody>
        </table>
      </div>
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


function EmptyCard({ text }: { text: string }) {
  return <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-10 text-center text-slate-400 text-sm">{text}</div>;
}
