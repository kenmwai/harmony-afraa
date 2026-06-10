import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FIRS, type Role } from "@/lib/upr-types";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in · UPR Coordination Platform" }] }),
  component: AuthPage,
});

type Mode = "signin" | "signup";

const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, label: "8+ characters" },
  { test: (p: string) => /[A-Z]/.test(p), label: "Uppercase" },
  { test: (p: string) => /[a-z]/.test(p), label: "Lowercase" },
  { test: (p: string) => /\d/.test(p), label: "Digit" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "Symbol" },
];

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<Exclude<Role, "admin">>("airline");
  const [airlines, setAirlines] = useState<{ code: string; name: string }[]>([]);
  const [airline, setAirline] = useState("");
  const [fir, setFir] = useState(FIRS[0].code);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/" });
    });
    supabase.from("airlines").select("code,name").order("name").then(({ data }) => {
      if (data) {
        setAirlines(data);
        if (data[0]) setAirline(data[0].code);
      }
    });
  }, [nav]);

  const checks = PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.test(password) }));
  const strongOk = checks.every((c) => c.ok);

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!fullName.trim()) throw new Error("Full name is required");
        if (!strongOk) throw new Error("Password does not meet policy");
        const scope = role === "airline" ? airline : fir;
        if (!scope) throw new Error("Pick your organization");
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              full_name: fullName.trim(),
              requested_role: role,
              requested_scope: scope,
            },
          },
        });
        if (error) throw error;
        nav({ to: "/" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        nav({ to: "/" });
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans grid place-items-center px-6 py-10">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 grid place-items-center font-black text-slate-950">U</div>
          <div>
            <div className="font-semibold tracking-tight">UPR Coordination Platform</div>
            <div className="text-[11px] text-slate-400 -mt-0.5">African User Preferred Routes</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 mb-4 p-1 bg-slate-950/60 ring-1 ring-slate-800 rounded-lg">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setErr(""); }}
              className={`text-xs py-1.5 rounded-md transition ${mode === m ? "bg-sky-500 text-slate-950 font-semibold" : "text-slate-400 hover:text-slate-200"}`}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        {mode === "signup" && (
          <>
            <Field label="Full name" value={fullName} onChange={setFullName} placeholder="Jane Doe" />
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              {(["airline", "ansp"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`text-xs py-1.5 rounded-md ring-1 transition ${role === r ? "bg-slate-800 ring-sky-500/60" : "bg-slate-950/40 ring-slate-800 text-slate-400 hover:text-slate-200"}`}
                >
                  {r === "airline" ? "Airline Dispatcher" : "ANSP / Regulator"}
                </button>
              ))}
            </div>
            {role === "airline" ? (
              <label className="block mt-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Airline</span>
                <select value={airline} onChange={(e) => setAirline(e.target.value)} className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none">
                  {airlines.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
                </select>
              </label>
            ) : (
              <label className="block mt-2">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">FIR Hub</span>
                <select value={fir} onChange={(e) => setFir(e.target.value)} className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none">
                  {FIRS.map((f) => <option key={f.code} value={f.code}>{f.code} — {f.name}</option>)}
                </select>
              </label>
            )}
          </>
        )}

        <Field label="Email" value={email} onChange={setEmail} placeholder="you@airline.com" type="email" />
        <Field label="Password" value={password} onChange={setPassword} type="password" />
        {mode === "signup" && (
          <ul className="mt-2 grid grid-cols-3 gap-x-2 gap-y-0.5">
            {checks.map((c) => (
              <li key={c.label} className={`text-[10px] flex items-center gap-1 ${c.ok ? "text-emerald-400" : "text-slate-500"}`}>
                <span className={`h-1 w-1 rounded-full ${c.ok ? "bg-emerald-400" : "bg-slate-600"}`} />{c.label}
              </li>
            ))}
          </ul>
        )}

        {err && <div className="mt-2 text-[11px] text-rose-400">{err}</div>}

        <button onClick={submit} disabled={busy} className="mt-4 w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-semibold rounded-lg py-2.5 text-sm transition">
          {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        {mode === "signup" && (
          <div className="text-[10px] text-slate-500 text-center mt-3">
            New accounts are <span className="text-amber-300">pending admin approval</span>. You'll see a holding screen until your role is granted.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block mt-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none"
      />
    </label>
  );
}
