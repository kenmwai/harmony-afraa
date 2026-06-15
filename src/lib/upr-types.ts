export type Role = "airline" | "ansp" | "admin" | "regulator";
export type SegStatus = "pending" | "approved" | "amended" | "rejected";
export type IncidentSeverity = "none" | "minor" | "major" | "critical";

export type IncidentRow = {
  id: string;
  upr_id: string;
  author: string;
  author_label: string;
  party: "airline" | "ansp";
  party_scope: string;
  rating: number | null;
  severity: IncidentSeverity;
  description: string;
  image_paths: string[];
  created_at: string;
};

export type UPRRow = {
  id: string;
  callsign: string;
  flight_no: string;
  dep: string;
  arr: string;
  aircraft: string;
  airline_code: string;
  created_by: string;
  baseline_minutes: number;
  optimized_minutes: number;
  burn_kg_per_min: number;
  flight_plan_path: string | null;
  flight_plan_name: string | null;
  flight_plan_size: number | null;
  created_at: string;
};

export type SegmentRow = {
  id: string;
  upr_id: string;
  fir_code: string;
  order_idx: number;
  status: SegStatus;
  note: string | null;
  reason: string | null;
  entry: string;
  exit: string;
  fl: string;
  revision: number;
  amendment_path: string | null;
  amendment_name: string | null;
  amendment_size: number | null;
  updated_at: string;
};

export type ChatRow = {
  id: string;
  upr_id: string;
  author: string | null;
  author_label: string;
  author_role: string;
  text: string;
  created_at: string;
};

export type BroadcastRow = {
  id: string;
  author: string | null;
  author_label: string;
  author_role: string;
  text: string;
  severity: "info" | "warn" | "critical";
  created_at: string;
};

export type AppSession = {
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  scope: string | null; // airline_code or fir_code
};

export const FIRS = [
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

export const REJECT_REASONS = [
  "Military activity / restricted airspace",
  "Severe weather / convective conflict",
  "Capacity / sector saturation",
  "Traffic conflict with crossing flow",
  "Procedural / regulatory non-compliance",
];

export const STATUS_META: Record<SegStatus, { color: string; bg: string; ring: string; label: string; dot: string }> = {
  pending: { color: "text-slate-300", bg: "bg-slate-700/60", ring: "ring-slate-500/40", label: "Pending", dot: "bg-slate-400" },
  approved: { color: "text-emerald-50", bg: "bg-emerald-500", ring: "ring-emerald-300/50", label: "Approved", dot: "bg-emerald-400" },
  amended: { color: "text-amber-50", bg: "bg-amber-500", ring: "ring-amber-300/50", label: "Amendment", dot: "bg-amber-400" },
  rejected: { color: "text-red-50", bg: "bg-red-500", ring: "ring-red-300/50", label: "Rejected", dot: "bg-red-400" },
};

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
export const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`;
