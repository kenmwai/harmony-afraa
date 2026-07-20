export type Role = "airline" | "ansp" | "admin" | "regulator";
export type SegStatus = "pending" | "approved" | "amended" | "rejected";
export type IncidentSeverity = "none" | "minor" | "major" | "critical";
export type TrialStage = "day1" | "day3" | "day7";

export const TRIAL_STAGE_META: Record<TrialStage, { label: string; days: number; color: string; bg: string; ring: string; dot: string; hex: string }> = {
  day1: { label: "1-day trial", days: 1, color: "text-sky-100", bg: "bg-sky-500/20", ring: "ring-sky-500/40", dot: "bg-sky-400", hex: "#38bdf8" },
  day3: { label: "3-day trial", days: 3, color: "text-amber-100", bg: "bg-amber-500/20", ring: "ring-amber-500/40", dot: "bg-amber-400", hex: "#f59e0b" },
  day7: { label: "7-day trial", days: 7, color: "text-emerald-100", bg: "bg-emerald-500/20", ring: "ring-emerald-500/40", dot: "bg-emerald-400", hex: "#10b981" },
};

export type TrialScheduleRow = {
  id: string;
  upr_id: string;
  stage: TrialStage;
  start_at: string;
  end_at: string;
  notes: string;
  created_by: string | null;
  created_at: string;
};

export type FlightReportRow = {
  id: string;
  upr_id: string;
  author: string | null;
  author_label: string;
  party: "airline" | "ansp";
  party_scope: string;
  trial_stage: TrialStage;
  flight_date: string | null;
  block_off: string | null;
  takeoff: string | null;
  block_on: string | null;
  landing: string | null;
  base_route: string;
  upr_route: string;
  projected_time_min: number;
  projected_fuel_kg: number;
  projected_co2_kg: number;
  realised_time_min: number;
  realised_fuel_kg: number;
  realised_co2_kg: number;
  cost_savings_usd: number;
  incident_rating: number | null;
  incident_severity: IncidentSeverity;
  incident_description: string;
  image_paths: string[];
  notes: string;
  created_at: string;
};

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
  trial_at: string | null;
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
  edited_at?: string | null;
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
