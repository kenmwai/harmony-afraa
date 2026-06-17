import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reset password · Harmony by AFRAA" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    // Supabase puts the recovery session in the URL hash and signs the user in automatically.
    const t = setTimeout(() => setReady(true), 300);
    return () => clearTimeout(t);
  }, []);

  const submit = async () => {
    setErr("");
    if (pw.length < 8) { setErr("Password must be at least 8 characters"); return; }
    if (pw !== pw2) { setErr("Passwords do not match"); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(true);
    setTimeout(() => nav({ to: "/" }), 1500);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans grid place-items-center px-6">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-500 grid place-items-center font-black text-slate-950">H</div>
          <div>
            <div className="font-semibold tracking-tight">Harmony by AFRAA</div>
            <div className="text-[11px] text-slate-400 -mt-0.5">Reset your password</div>
          </div>
        </div>
        {!ready ? (
          <div className="text-sm text-slate-400">Preparing…</div>
        ) : ok ? (
          <div className="text-emerald-300 text-sm">✓ Password updated. Redirecting…</div>
        ) : (
          <>
            <label className="block">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">New password</span>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none" />
            </label>
            <label className="block mt-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-400">Confirm new password</span>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                className="mt-0.5 w-full bg-slate-950/60 ring-1 ring-slate-800 rounded-md px-2 py-1.5 text-sm focus:ring-sky-500 outline-none" />
            </label>
            {err && <div className="mt-2 text-[11px] text-rose-400">{err}</div>}
            <button onClick={submit} disabled={busy}
              className="mt-4 w-full bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-semibold rounded-lg py-2.5 text-sm">
              {busy ? "Updating…" : "Update password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
