import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "UPR Coordination Platform" },
      { name: "description", content: "African User Preferred Routes coordination MVP — segment-by-segment ANSP negotiation." },
    ],
  }),
  component: UPRApp,
});

// ───────────────────────── Data ─────────────────────────
const FIRS = [
  { code: "HCSM", name: "Mogadishu" },
  { code: "HKNA", name: "Nairobi" },
  { code: "HTDC", name: "Dar es Salaam" },
  { code: "HAAA", name: "Addis Ababa" },
  { code: "HUEC", name: "Entebbe" },
  { code: "FACA", name: "Cape Town" },
  { code: "FIMM", name: "Mauritius" },
  { code: "DGAC", name: "Accra" },
  { code: "DNKK", name: "Kano" },
  { code: "GVSC", name: "Sal Oceanic" },
];
const REJECT_REASONS = [
  "Military activity / restricted airspace",
  "Severe weather / convective conflict",
  "Capacity / sector saturation",
  "Traffic conflict with crossing flow",
  "Procedural / regulatory non-compliance",
];

type SegStatus = "pending" | "approved" | "amended" | "rejected";
type Attachment = { name: string; size: number; dataUrl: string };
type Segment = {
  fir: string;
  status: SegStatus;
  note?: string;
  reason?: string;
  entry: string;
  exit: string;
  fl: string;
  revision: number;
  amendmentPdf?: Attachment;
};
type ChatMsg = { id: string; author: string; role: "airline" | "ansp" | "system"; text: string; ts: number };
type UPR = {
  id: string;
  callsign: string;
  flightNo: string;
  dep: string;
  arr: string;
  aircraft: string;
  createdAt: number;
  segments: Segment[];
  chat: ChatMsg[];
  flightPlanPdf?: Attachment;
  baselineMinutes: number;
  optimizedMinutes: number;
  burnKgPerMin: number;
  airline: string;
};
type Broadcast = { id: string; author: string; role: string; text: string; ts: number; severity: "info" | "warn" | "critical" };

// ───────────────────────── Helpers ─────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();
const fmtTime = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

const readPdf = (file: File): Promise<Attachment> =>
  new Promise((resolve, reject) => {
    if (file.type !== "application/pdf") return reject(new Error("PDF only"));
    if (file.size > 10 * 1024 * 1024) return reject(new Error("Max 10 MB"));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, size: file.size, dataUrl: String(reader.result) });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const STATUS_META: Record<SegStatus, { color: string; bg: string; ring: string; label: string; dot: string }> = {
  pending: { color: "text-slate-300", bg: "bg-slate-700/60", ring: "ring-slate-500/40", label: "Pending", dot: "bg-slate-400" },
  approved: { color: "text-emerald-50", bg: "bg-emerald-500", ring: "ring-emerald-300/50", label: "Approved", dot: "bg-emerald-400" },
  amended: { color: "text-amber-50", bg: "bg-amber-500", ring: "ring-amber-300/50", label: "Amendment", dot: "bg-amber-400" },
  rejected: { color: "text-red-50", bg: "bg-red-500", ring: "ring-red-300/50", label: "Rejected", dot: "bg-red-400" },
};

// ───────────────────────── Seed ─────────────────────────
const seedUPRs = (): UPR[] => [
  {
    id: uid(),
    callsign: "KQA310",
    flightNo: "KQ 310",
    dep: "HKJK",
    arr: "FACT",
    aircraft: "B788",
    createdAt: now() - 3600_000,
    airline: "Kenya Airways",
    segments: [
      { fir: "HKNA", status: "approved", entry: "ELGON", exit: "KOMOB", fl: "FL380", revision: 1 },
      { fir: "HTDC", status: "amended", note: "Shift exit point 20NM east of KEMBO due crossing traffic.", entry: "KOMOB", exit: "KEMBO", fl: "FL380", revision: 1 },
      { fir: "FIMM", status: "pending", entry: "KEMBO", exit: "TIVLI", fl: "FL400", revision: 1 },
    ],
    chat: [
      { id: uid(), author: "System", role: "system", text: "UPR request opened. 3 FIR segments dispatched.", ts: now() - 3500_000 },
      { id: uid(), author: "HTDC Dar es Salaam", role: "ansp", text: "We need lateral offset near KEMBO — crossing flow at FL380.", ts: now() - 1800_000 },
    ],
    baselineMinutes: 412,
    optimizedMinutes: 367,
    burnKgPerMin: 52,
  },
];

// ───────────────────────── Auth / Role gate ─────────────────────────
type Role = "airline" | "ansp" | "admin";
type Session =
  | { role: "airline"; name: string; airline: string }
  | { role: "ansp"; name: string; fir: string }
  | { role: "admin"; name: string };

function UPRApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [uprs, setUprs] = useState<UPR[]>(() => seedUPRs());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([
    { id: uid(), author: "HKNA Nairobi", role: "ANSP", text: "Nairobi FIR radar down for maintenance 1200Z–1400Z.", ts: now() - 7200_000, severity: "warn" },
  ]);

  const active = uprs.find((u) => u.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && uprs.length) setActiveId(uprs[0].id);
  }, [uprs, activeId]);

  const updateUPR = (id: string, fn: (u: UPR) => UPR) =>
    setUprs((prev) => prev.map((u) => (u.id === id ? fn(u) : u)));

  if (!session) return <SignIn onSignIn={setSession} />;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <TopBar session={session} onSignOut={() => setSession(null)} />
      <div className="mx-auto max-w-[1500px] px-6 py-6">
        {session.role === "airline" && (
          <AirlineView
            session={session}
            uprs={uprs}
            setUprs={setUprs}
            activeId={activeId}
            setActiveId={setActiveId}
            active={active}
            updateUPR={updateUPR}
            broadcasts={broadcasts}
            setBroadcasts={setBroadcasts}
          />
        )}
        {session.role === "ansp" && (
          <ANSPView
            session={session}
            uprs={uprs}
            activeId={activeId}
            setActiveId={setActiveId}
            active={active}
            updateUPR={updateUPR}
            broadcasts={broadcasts}
            setBroadcasts={setBroadcasts}
          />
        )}
        {session.role === "admin" && <AdminView uprs={uprs} />}
      </div>
    </div>
  );
}

function SignIn({ onSignIn }: { onSignIn: (s: Session) => void }) {
  const [role, setRole] = useState<Role>("airline");
  const [name, setName] = useState("");
  const [airline, setAirline] = useState("Kenya Airways");
  const [fir, setFir] = useState("HTDC");

  const canSubmit = name.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    if (role === "airline") onSignIn({ role, name: name.trim(), airline });
    else if (role === "ansp") onSignIn({ role, name: name.trim(), fir });
    else onSignIn({ role, name: name.trim() });
  };

  const roles: { id: Role; label: string; sub: string }[] = [
    { id: "airline", label: "Airline Dispatcher", sub: "Submit UPRs · attach flight plan PDF · respond to amendments" },
    { id: "ansp", label: "ANSP / Regulator", sub: "Review FIR segment · approve / amend with PDF / reject" },
    { id: "admin", label: "Admin", sub: "Operational analytics & oversight dashboard" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans grid place-items-center px-6">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 grid place-items-center font-black text-slate-950">U</div>
          <div>
            <div className="font-semibold tracking-tight">UPR Coordination Platform</div>
            <div className="text-[11px] text-slate-400 -mt-0.5">Sign in to your role</div>
          </div>
        </div>

        <div className="space-y-1.5 mb-4">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setRole(r.id)}
              className={`w-full text-left rounded-lg px-3 py-2.5 ring-1 transition ${
                role === r.id ? "bg-slate-800 ring-sky-500/60" : "bg-slate-950/40 ring-slate-800 hover:bg-slate-800/50"
              }`}
            >
              <div className="text-sm font-medium">{r.label}</div>
              <div className="text-[11px] text-slate-400">{r.sub}</div>
            </button>
          ))}
        </div>

        <Input label="Operator name" value={name} onChange={setName} placeholder="Jane Doe" />

        {role === "airline" && (
          <label className="block mt-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">Airline</span>
            <input
              value={airline}
              onChange={(e) => setAirline(e.target.value)}
              className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none"
            />
          </label>
        )}
        {role === "ansp" && (
          <label className="block mt-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">FIR Hub</span>
            <select
              value={fir}
              onChange={(e) => setFir(e.target.value)}
              className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none"
            >
              {FIRS.map((f) => <option key={f.code} value={f.code}>{f.code} — {f.name}</option>)}
            </select>
          </label>
        )}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-5 w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-semibold rounded-lg py-2.5 text-sm transition"
        >
          Enter platform
        </button>

        <div className="text-[10px] text-slate-500 text-center mt-3">
          Strict role-based access · view is scoped to your role
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── TopBar ─────────────────────────
function TopBar({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const roleLabel =
    session.role === "airline" ? `${session.airline} · Dispatcher` :
    session.role === "ansp" ? `${session.fir} ${FIRS.find((f) => f.code === session.fir)?.name ?? ""} · Controller` :
    "Executive Analytics";
  const roleColor =
    session.role === "airline" ? "from-sky-500 to-cyan-500" :
    session.role === "ansp" ? "from-amber-500 to-orange-500" :
    "from-emerald-500 to-teal-500";

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto max-w-[1500px] px-6 py-3 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 grid place-items-center font-black text-slate-950">U</div>
          <div>
            <div className="font-semibold tracking-tight">UPR Coordination Platform</div>
            <div className="text-[11px] text-slate-400 -mt-0.5">African User Preferred Routes · MVP</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1.5 rounded-lg bg-gradient-to-r ${roleColor} text-slate-950 text-xs font-semibold`}>
            {roleLabel}
          </div>
          <div className="text-right leading-tight">
            <div className="text-sm font-medium">{session.name}</div>
            <button onClick={onSignOut} className="text-[11px] text-slate-400 hover:text-sky-300">Sign out</button>
          </div>
        </div>
      </div>
    </header>
  );
}

// ───────────────────────── PDF Attachment helpers (UI) ─────────────────────────
function PdfPicker({ label, value, onChange }: { label: string; value?: Attachment; onChange: (a: Attachment | undefined) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  const handle = async (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    try {
      const att = await readPdf(f);
      onChange(att);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to read PDF");
    }
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-slate-950/60 ring-1 ring-slate-800 px-2.5 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-red-400 text-base">📄</span>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{value.name}</div>
              <div className="text-[10px] text-slate-500">{fmtBytes(value.size)}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <a href={value.dataUrl} target="_blank" rel="noreferrer" className="text-[10px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">Open</a>
            <button onClick={() => onChange(undefined)} className="text-[10px] px-2 py-1 rounded ring-1 ring-slate-700 hover:bg-slate-800">Remove</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full rounded-md bg-slate-950/60 ring-1 ring-dashed ring-slate-700 hover:ring-sky-500/60 px-2.5 py-3 text-xs text-slate-400 hover:text-sky-300 transition"
        >
          + Attach PDF (max 10 MB)
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0])}
      />
      {err && <div className="text-[10px] text-red-400 mt-1">{err}</div>}
    </div>
  );
}

function PdfBadge({ att, label }: { att: Attachment; label: string }) {
  return (
    <a
      href={att.dataUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md bg-slate-950/60 ring-1 ring-slate-700 hover:ring-sky-500/60 px-2 py-1 text-[11px] transition"
    >
      <span className="text-red-400">📄</span>
      <span className="font-medium text-slate-200">{label}</span>
      <span className="text-slate-500 truncate max-w-[140px]">{att.name}</span>
      <span className="text-slate-500">· {fmtBytes(att.size)}</span>
    </a>
  );
}

// ───────────────────────── Airline View ─────────────────────────
function AirlineView(props: {
  session: Extract<Session, { role: "airline" }>;
  uprs: UPR[];
  setUprs: React.Dispatch<React.SetStateAction<UPR[]>>;
  activeId: string | null;
  setActiveId: (id: string) => void;
  active: UPR | null;
  updateUPR: (id: string, fn: (u: UPR) => UPR) => void;
  broadcasts: Broadcast[];
  setBroadcasts: React.Dispatch<React.SetStateAction<Broadcast[]>>;
}) {
  const { session, uprs, setUprs, activeId, setActiveId, active, updateUPR, broadcasts, setBroadcasts } = props;
  const myUprs = useMemo(() => uprs.filter((u) => u.airline === session.airline), [uprs, session.airline]);

  useEffect(() => {
    if (!myUprs.find((u) => u.id === activeId)) setActiveId(myUprs[0]?.id ?? "");
  }, [myUprs, activeId, setActiveId]);

  return (
    <div className="grid grid-cols-12 gap-5">
      <aside className="col-span-3 space-y-4">
        <NewUPRForm
          airline={session.airline}
          onCreate={(u) => { setUprs((p) => [u, ...p]); setActiveId(u.id); }}
        />
        <UPRList uprs={myUprs} activeId={activeId} setActiveId={setActiveId} />
      </aside>

      <main className="col-span-6 space-y-5">
        {active ? (
          <>
            <UPRHeader upr={active} />
            <SegmentMatrix upr={active} />
            <AirlineSegmentList upr={active} updateUPR={updateUPR} />
          </>
        ) : (
          <EmptyCard text="Create or select a UPR request to begin." />
        )}
      </main>

      <aside className="col-span-3 space-y-5">
        {active && (
          <SegmentChat
            upr={active}
            author={`${session.airline} Dispatcher`}
            role="airline"
            onSend={(text) =>
              updateUPR(active.id, (u) => ({
                ...u,
                chat: [...u.chat, { id: uid(), author: `${session.airline} Dispatcher`, role: "airline", text, ts: now() }],
              }))
            }
          />
        )}
        <BroadcastPanel broadcasts={broadcasts} setBroadcasts={setBroadcasts} author={session.name} role={`Airline · ${session.airline}`} />
      </aside>
    </div>
  );
}

function NewUPRForm({ airline, onCreate }: { airline: string; onCreate: (u: UPR) => void }) {
  const [flightNo, setFlightNo] = useState("");
  const [callsign, setCallsign] = useState("");
  const [dep, setDep] = useState("");
  const [arr, setArr] = useState("");
  const [aircraft, setAircraft] = useState("B738");
  const [firs, setFirs] = useState<string[]>(["", ""]);
  const [baseline, setBaseline] = useState(380);
  const [optimized, setOptimized] = useState(345);
  const [pdf, setPdf] = useState<Attachment | undefined>(undefined);

  const setFir = (i: number, v: string) => setFirs((p) => p.map((x, idx) => (idx === i ? v : x)));
  const addRow = () => firs.length < 5 && setFirs([...firs, ""]);
  const rmRow = (i: number) => firs.length > 1 && setFirs(firs.filter((_, idx) => idx !== i));

  const submit = () => {
    const chosen = firs.filter(Boolean);
    if (!callsign || !flightNo || chosen.length < 1) return;
    const segs: Segment[] = chosen.map((f, i) => ({
      fir: f,
      status: "pending",
      entry: `WPT${i * 2 + 1}`,
      exit: `WPT${i * 2 + 2}`,
      fl: "FL360",
      revision: 1,
    }));
    onCreate({
      id: uid(),
      callsign,
      flightNo,
      dep: dep || "----",
      arr: arr || "----",
      aircraft,
      createdAt: now(),
      airline,
      segments: segs,
      flightPlanPdf: pdf,
      chat: [{
        id: uid(), author: "System", role: "system",
        text: `UPR submitted across ${chosen.length} FIR(s)${pdf ? ` · flight plan PDF attached (${pdf.name})` : ""}.`,
        ts: now(),
      }],
      baselineMinutes: baseline,
      optimizedMinutes: optimized,
      burnKgPerMin: 48,
    });
    setFlightNo(""); setCallsign(""); setDep(""); setArr(""); setFirs(["", ""]); setPdf(undefined);
  };

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="text-sm font-semibold mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> New UPR Request
      </div>
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
              <select
                value={f}
                onChange={(e) => setFir(i, e.target.value)}
                className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none"
              >
                <option value="">Select FIR…</option>
                {FIRS.map((fr) => (
                  <option key={fr.code} value={fr.code}>{fr.code} — {fr.name}</option>
                ))}
              </select>
              <button onClick={() => rmRow(i)} className="text-slate-500 hover:text-red-400 text-sm">×</button>
            </div>
          ))}
        </div>
        <button
          onClick={addRow}
          disabled={firs.length >= 5}
          className="mt-2 text-xs text-sky-400 hover:text-sky-300 disabled:opacity-40"
        >
          + Add transit FIR ({firs.length}/5)
        </button>
      </div>

      <div className="mt-3">
        <PdfPicker label="Plotted flight plan (PDF) — visible to all FIRs" value={pdf} onChange={setPdf} />
      </div>

      <button
        onClick={submit}
        className="mt-3 w-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg py-2 text-sm transition"
      >
        Submit UPR Request
      </button>
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none"
      />
    </label>
  );
}

function UPRList({ uprs, activeId, setActiveId }: { uprs: UPR[]; activeId: string | null; setActiveId: (id: string) => void }) {
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-2">
      <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-slate-400">My UPR Requests</div>
      <div className="space-y-1">
        {uprs.map((u) => {
          const verdict = computeVerdict(u);
          return (
            <button
              key={u.id}
              onClick={() => setActiveId(u.id)}
              className={`w-full text-left px-2.5 py-2 rounded-lg transition ${
                activeId === u.id ? "bg-slate-800 ring-1 ring-slate-700" : "hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">{u.callsign}</div>
                <VerdictPill verdict={verdict} />
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span>{u.dep} → {u.arr} · {u.segments.length} FIR</span>
                {u.flightPlanPdf && <span className="text-red-400" title="Flight plan PDF attached">📄</span>}
              </div>
              <div className="mt-1.5 flex gap-1">
                {u.segments.map((s, i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-full ${STATUS_META[s.status].bg}`} />
                ))}
              </div>
            </button>
          );
        })}
        {uprs.length === 0 && <div className="px-2 py-6 text-center text-xs text-slate-500">No requests yet</div>}
      </div>
    </div>
  );
}

function computeVerdict(u: UPR): "PENDING" | "APPROVED" | "REJECTED" {
  if (u.segments.some((s) => s.status === "rejected")) return "REJECTED";
  if (u.segments.every((s) => s.status === "approved")) return "APPROVED";
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

function UPRHeader({ upr }: { upr: UPR }) {
  const verdict = computeVerdict(upr);
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="text-xl font-semibold">{upr.callsign}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-300">{upr.flightNo}</span>
            <VerdictPill verdict={verdict} />
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {upr.airline} · {upr.dep} → {upr.arr} · {upr.aircraft} · opened {fmtTime(upr.createdAt)}
          </div>
        </div>
        <div className="text-right text-xs text-slate-400">
          <div>Baseline: <span className="text-slate-200">{upr.baselineMinutes} min</span></div>
          <div>Optimized: <span className="text-emerald-300">{upr.optimizedMinutes} min</span></div>
        </div>
      </div>
      {upr.flightPlanPdf && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Plotted flight plan — shared with all FIRs</div>
          <PdfBadge att={upr.flightPlanPdf} label="Flight Plan" />
        </div>
      )}
    </div>
  );
}

function SegmentMatrix({ upr }: { upr: UPR }) {
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">Live Status Matrix</div>
      <div className="flex items-stretch gap-2">
        {upr.segments.map((s, i) => {
          const m = STATUS_META[s.status];
          return (
            <div key={i} className="flex-1 flex items-center gap-2">
              <div className={`flex-1 rounded-lg ${m.bg} ring-1 ${m.ring} px-3 py-3`}>
                <div className="flex items-center justify-between">
                  <span className={`font-mono font-semibold ${m.color}`}>{s.fir}</span>
                  <span className={`text-[10px] ${m.color} opacity-90`}>{m.label}</span>
                </div>
                <div className={`text-[10px] ${m.color} opacity-80 mt-0.5`}>{s.entry} → {s.exit} · {s.fl}</div>
              </div>
              {i < upr.segments.length - 1 && <span className="text-slate-600">›</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AirlineSegmentList({ upr, updateUPR }: { upr: UPR; updateUPR: (id: string, fn: (u: UPR) => UPR) => void }) {
  return (
    <div className="space-y-2">
      {upr.segments.map((s, idx) => (
        <AirlineSegmentRow key={idx} seg={s} idx={idx} upr={upr} updateUPR={updateUPR} />
      ))}
    </div>
  );
}

function AirlineSegmentRow({ seg, idx, upr, updateUPR }: { seg: Segment; idx: number; upr: UPR; updateUPR: (id: string, fn: (u: UPR) => UPR) => void }) {
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState(seg.entry);
  const [exit, setExit] = useState(seg.exit);
  const [fl, setFl] = useState(seg.fl);
  const m = STATUS_META[seg.status];
  const firName = FIRS.find((f) => f.code === seg.fir)?.name ?? "";

  const saveEdit = () => {
    updateUPR(upr.id, (u) => {
      const segments = u.segments.map((x, i) =>
        i === idx ? { ...x, entry, exit, fl, status: "pending" as SegStatus, revision: x.revision + 1, note: undefined, reason: undefined, amendmentPdf: undefined } : x
      );
      const chat: ChatMsg[] = [
        ...u.chat,
        { id: uid(), author: "System", role: "system", text: `Airline revised ${seg.fir} segment (rev ${seg.revision + 1}). Re-submitted for ANSP review.`, ts: now() },
      ];
      return { ...u, segments, chat };
    });
    setEditing(false);
  };

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${m.dot}`} />
          <span className="font-mono font-semibold">{seg.fir}</span>
          <span className="text-xs text-slate-400">{firName}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.bg} ${m.color}`}>{m.label}</span>
          <span className="text-[10px] text-slate-500">rev {seg.revision}</span>
        </div>
        {seg.status === "amended" && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs bg-amber-500 hover:bg-amber-400 text-amber-950 font-semibold px-2.5 py-1 rounded-md"
          >
            Edit Route Specification
          </button>
        )}
      </div>

      {seg.status === "amended" && (seg.note || seg.amendmentPdf) && (
        <div className="mt-2 text-xs bg-amber-500/10 ring-1 ring-amber-500/30 rounded-md p-2 text-amber-200 space-y-1.5">
          {seg.note && <div><span className="font-semibold">ANSP proposal:</span> {seg.note}</div>}
          {seg.amendmentPdf && <PdfBadge att={seg.amendmentPdf} label="Amendment chart" />}
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
            <button onClick={saveEdit} className="text-xs px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold">
              Submit Revision
            </button>
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

// ───────────────────────── ANSP View ─────────────────────────
function ANSPView(props: {
  session: Extract<Session, { role: "ansp" }>;
  uprs: UPR[];
  activeId: string | null;
  setActiveId: (id: string) => void;
  active: UPR | null;
  updateUPR: (id: string, fn: (u: UPR) => UPR) => void;
  broadcasts: Broadcast[];
  setBroadcasts: React.Dispatch<React.SetStateAction<Broadcast[]>>;
}) {
  const { session, uprs, activeId, setActiveId, active, updateUPR, broadcasts, setBroadcasts } = props;
  const anspFir = session.fir;
  const queue = useMemo(() => uprs.filter((u) => u.segments.some((s) => s.fir === anspFir)), [uprs, anspFir]);
  const firName = FIRS.find((f) => f.code === anspFir)?.name;

  useEffect(() => {
    if (queue.length && !queue.find((u) => u.id === activeId)) setActiveId(queue[0].id);
  }, [queue, activeId, setActiveId]);

  const mySeg = active?.segments.find((s) => s.fir === anspFir);

  return (
    <div className="grid grid-cols-12 gap-5">
      <aside className="col-span-3 space-y-4">
        <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Acting as</div>
          <div className="text-lg font-semibold">{anspFir}</div>
          <div className="text-xs text-slate-400">{firName} FIR Controller</div>
          <div className="text-[10px] text-slate-500 mt-2">Scope locked at sign-in — sign out to switch FIR.</div>
        </div>
        <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-2">
          <div className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-slate-400">Targeted Queue ({queue.length})</div>
          <div className="space-y-1">
            {queue.map((u) => {
              const seg = u.segments.find((s) => s.fir === anspFir)!;
              const m = STATUS_META[seg.status];
              return (
                <button
                  key={u.id}
                  onClick={() => setActiveId(u.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg ${
                    activeId === u.id ? "bg-slate-800 ring-1 ring-slate-700" : "hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-sm">{u.callsign}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.bg} ${m.color}`}>{m.label}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    <span>{seg.entry} → {seg.exit} · {seg.fl}</span>
                    {u.flightPlanPdf && <span className="text-red-400" title="Flight plan PDF">📄</span>}
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
            <SegmentMatrix upr={active} />
            <ANSPDecisionPanel upr={active} seg={mySeg} fir={anspFir} updateUPR={updateUPR} />
          </>
        ) : (
          <EmptyCard text={`No active request for ${anspFir}.`} />
        )}
      </main>

      <aside className="col-span-3 space-y-5">
        {active && (
          <SegmentChat
            upr={active}
            author={`${anspFir} ${firName ?? ""}`}
            role="ansp"
            onSend={(text) =>
              updateUPR(active.id, (u) => ({
                ...u,
                chat: [...u.chat, { id: uid(), author: `${anspFir} ${firName ?? ""}`, role: "ansp", text, ts: now() }],
              }))
            }
          />
        )}
        <BroadcastPanel broadcasts={broadcasts} setBroadcasts={setBroadcasts} author={`${anspFir} ${firName ?? ""}`} role="ANSP" />
      </aside>
    </div>
  );
}

function ANSPDecisionPanel({ upr, seg, fir, updateUPR }: { upr: UPR; seg: Segment; fir: string; updateUPR: (id: string, fn: (u: UPR) => UPR) => void }) {
  const [mode, setMode] = useState<null | "amend" | "reject">(null);
  const [note, setNote] = useState("");
  const [amendPdf, setAmendPdf] = useState<Attachment | undefined>(undefined);
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const locked = seg.status === "amended" || seg.status === "approved" || seg.status === "rejected";

  const setStatus = (status: SegStatus, extra: Partial<Segment> = {}, log?: string) => {
    updateUPR(upr.id, (u) => ({
      ...u,
      segments: u.segments.map((s) => (s.fir === fir ? { ...s, status, ...extra } : s)),
      chat: log ? [...u.chat, { id: uid(), author: "System", role: "system", text: log, ts: now() }] : u.chat,
    }));
    setMode(null); setNote(""); setAmendPdf(undefined);
  };

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm font-semibold">Tri-Action Decision Panel</div>
          <div className="text-[11px] text-slate-400">Segment: {seg.fir} · {seg.entry} → {seg.exit} · {seg.fl} · rev {seg.revision}</div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded ${STATUS_META[seg.status].bg} ${STATUS_META[seg.status].color}`}>
          {STATUS_META[seg.status].label}
        </span>
      </div>

      {locked && seg.status === "amended" && (
        <div className="text-xs bg-amber-500/10 ring-1 ring-amber-500/30 text-amber-200 rounded-md p-2 mb-3 space-y-1.5">
          <div>Locked — awaiting airline revision. Your proposal: <em>{seg.note}</em></div>
          {seg.amendmentPdf && <PdfBadge att={seg.amendmentPdf} label="Amendment chart" />}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <button
          disabled={locked}
          onClick={() => setStatus("approved", { note: undefined, reason: undefined, amendmentPdf: undefined }, `${fir} approved segment for ${upr.callsign}.`)}
          className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-950 font-semibold py-2 rounded-lg text-sm"
        >
          ✓ Approve Route Segment
        </button>
        <button
          disabled={locked}
          onClick={() => setMode(mode === "amend" ? null : "amend")}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-amber-950 font-semibold py-2 rounded-lg text-sm"
        >
          ⚠ Propose Amendment
        </button>
        <button
          disabled={locked}
          onClick={() => setMode(mode === "reject" ? null : "reject")}
          className="bg-red-500 hover:bg-red-400 disabled:opacity-40 text-red-950 font-semibold py-2 rounded-lg text-sm"
        >
          ✕ Reject Segment
        </button>
      </div>

      {mode === "amend" && (
        <div className="mt-3 space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Describe the required amendment (waypoints, flight level, entry/exit point changes)…"
            className="w-full h-24 bg-slate-950/60 ring-1 ring-slate-800 rounded-md p-2 text-sm focus:ring-amber-500 outline-none"
          />
          <PdfPicker label="Recommended amendment chart (PDF)" value={amendPdf} onChange={setAmendPdf} />
          <button
            disabled={!note.trim()}
            onClick={() => setStatus(
              "amended",
              { note, amendmentPdf: amendPdf },
              `${fir} proposed amendment${amendPdf ? ` (PDF attached: ${amendPdf.name})` : ""}: "${note}"`,
            )}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-amber-950 font-semibold py-1.5 rounded-md text-sm"
          >
            Submit Amendment Request
          </button>
        </div>
      )}

      {mode === "reject" && (
        <div className="mt-3 space-y-2">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-2 text-sm focus:ring-red-500 outline-none"
          >
            {REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button
            onClick={() => setStatus("rejected", { reason }, `${fir} rejected segment — ${reason}`)}
            className="w-full bg-red-500 hover:bg-red-400 text-red-950 font-semibold py-1.5 rounded-md text-sm"
          >
            Confirm Rejection
          </button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Executive View ─────────────────────────
function ExecView({ uprs }: { uprs: UPR[] }) {
  const approved = uprs.filter((u) => computeVerdict(u) === "APPROVED");
  const minSaved = approved.reduce((s, u) => s + Math.max(0, u.baselineMinutes - u.optimizedMinutes), 0);
  const fuelSaved = approved.reduce((s, u) => s + Math.max(0, u.baselineMinutes - u.optimizedMinutes) * u.burnKgPerMin, 0);
  const co2 = fuelSaved * 3.16;

  const stats = [
    { label: "Approved UPR Trials", value: approved.length, sub: `of ${uprs.length} total` },
    { label: "Flight Minutes Saved", value: minSaved.toLocaleString(), sub: "minutes" },
    { label: "Jet Fuel Conserved", value: fuelSaved.toLocaleString(undefined, { maximumFractionDigits: 0 }), sub: "kg" },
    { label: "CO₂ Emissions Avoided", value: co2.toLocaleString(undefined, { maximumFractionDigits: 0 }), sub: "kg CO₂" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Executive Analytics Hub</h1>
        <p className="text-sm text-slate-400">Read-only operational impact across all approved UPR trial paths.</p>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">{s.label}</div>
            <div className="text-3xl font-semibold mt-2 bg-gradient-to-br from-emerald-300 to-sky-400 bg-clip-text text-transparent">
              {s.value}
            </div>
            <div className="text-xs text-slate-500 mt-1">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-5">
        <div className="text-sm font-semibold mb-3">Recent UPR Activity</div>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-slate-400">
            <tr><th className="text-left py-2">Callsign</th><th className="text-left">Airline</th><th className="text-left">Route</th><th className="text-left">FIRs</th><th className="text-right">Δ min</th><th className="text-right">CO₂ avoided</th><th className="text-right">Verdict</th></tr>
          </thead>
          <tbody>
            {uprs.map((u) => {
              const dm = Math.max(0, u.baselineMinutes - u.optimizedMinutes);
              const c = dm * u.burnKgPerMin * 3.16;
              return (
                <tr key={u.id} className="border-t border-slate-800">
                  <td className="py-2 font-mono">{u.callsign}</td>
                  <td className="text-slate-300">{u.airline}</td>
                  <td>{u.dep} → {u.arr}</td>
                  <td className="text-slate-400">{u.segments.map((s) => s.fir).join(" → ")}</td>
                  <td className="text-right text-emerald-300">{dm}</td>
                  <td className="text-right">{c.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</td>
                  <td className="text-right"><VerdictPill verdict={computeVerdict(u)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────── Chat / Broadcast ─────────────────────────
function SegmentChat({ upr, author, role, onSend }: { upr: UPR; author: string; role: "airline" | "ansp"; onSend: (t: string) => void }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [upr.chat.length]);

  const participants = [`${upr.airline} Dispatcher`, ...upr.segments.map((s) => `${s.fir} ${FIRS.find((f) => f.code === s.fir)?.name ?? ""}`)];

  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 flex flex-col h-[420px]">
      <div className="px-3.5 py-2.5 border-b border-slate-800">
        <div className="text-sm font-semibold flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400" /> Contextual Segment Chat
        </div>
        <div className="text-[10px] text-slate-500 truncate">Participants: {participants.join(", ")}</div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {upr.chat.map((m) => <ChatBubble key={m.id} msg={m} />)}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSend(text.trim()); setText(""); } }}
        className="border-t border-slate-800 p-2 flex gap-2"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message as ${author}…`}
          className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2.5 py-1.5 text-sm focus:ring-sky-500 outline-none"
        />
        <button className="text-xs px-3 rounded-md bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold">Send</button>
      </form>
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === "system") {
    return (
      <div className="text-center text-[10px] uppercase tracking-wider text-slate-500 py-1">
        {msg.text} <span className="text-slate-600">· {fmtTime(msg.ts)}</span>
      </div>
    );
  }
  const isAirline = msg.role === "airline";
  return (
    <div className={`flex ${isAirline ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm ${
        isAirline ? "bg-sky-500/90 text-slate-950" : "bg-slate-800 text-slate-100 ring-1 ring-slate-700"
      }`}>
        <div className={`text-[10px] font-semibold opacity-80 ${isAirline ? "text-slate-900" : "text-emerald-300"}`}>
          {msg.author}
        </div>
        <div className="leading-snug">{msg.text}</div>
        <div className={`text-[9px] mt-0.5 opacity-60 ${isAirline ? "text-slate-900" : "text-slate-400"}`}>{fmtTime(msg.ts)}</div>
      </div>
    </div>
  );
}

function BroadcastPanel({
  broadcasts, setBroadcasts, author, role,
}: {
  broadcasts: Broadcast[];
  setBroadcasts: React.Dispatch<React.SetStateAction<Broadcast[]>>;
  author: string;
  role: string;
}) {
  const [text, setText] = useState("");
  const [sev, setSev] = useState<"info" | "warn" | "critical">("info");

  const send = () => {
    if (!text.trim()) return;
    setBroadcasts((p) => [{ id: uid(), author, role, text: text.trim(), ts: now(), severity: sev }, ...p]);
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
        <div className="text-sm font-semibold flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" /> Stakeholder Broadcast
        </div>
        <span className="text-[10px] text-slate-500">Global · all entities</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {broadcasts.map((b) => (
          <div key={b.id} className={`rounded-lg p-2 ring-1 ${sevMap[b.severity]}`}>
            <div className="flex justify-between items-center text-[10px] opacity-80">
              <span className="font-semibold uppercase tracking-wider">{b.role} · {b.author}</span>
              <span>{fmtTime(b.ts)}</span>
            </div>
            <div className="text-sm mt-0.5">{b.text}</div>
          </div>
        ))}
        {broadcasts.length === 0 && <div className="text-center text-xs text-slate-500 py-6">No broadcasts</div>}
      </div>
      <div className="border-t border-slate-800 p-2 space-y-1.5">
        <div className="flex gap-1.5">
          {(["info", "warn", "critical"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSev(s)}
              className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider ${
                sev === s ? sevMap[s] + " ring-1" : "text-slate-400 ring-1 ring-slate-800"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Issue broadcast to all entities…"
            className="flex-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2.5 py-1.5 text-sm focus:ring-red-500 outline-none"
          />
          <button onClick={send} className="text-xs px-3 rounded-md bg-red-500 hover:bg-red-400 text-red-950 font-semibold">Broadcast</button>
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-slate-900/70 ring-1 ring-slate-800 p-10 text-center text-slate-400 text-sm">{text}</div>
  );
}
