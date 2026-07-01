
CREATE INDEX IF NOT EXISTS uprs_created_by_idx     ON public.uprs (created_by);
CREATE INDEX IF NOT EXISTS uprs_airline_code_idx   ON public.uprs (airline_code);
CREATE INDEX IF NOT EXISTS uprs_created_at_desc_idx ON public.uprs (created_at DESC);

CREATE INDEX IF NOT EXISTS segments_upr_id_idx    ON public.segments (upr_id);
CREATE INDEX IF NOT EXISTS segments_fir_code_idx  ON public.segments (fir_code);
CREATE INDEX IF NOT EXISTS segments_upr_order_idx ON public.segments (upr_id, order_idx);

CREATE INDEX IF NOT EXISTS chat_messages_upr_created_idx ON public.chat_messages (upr_id, created_at);

CREATE INDEX IF NOT EXISTS flight_reports_upr_id_idx       ON public.flight_reports (upr_id);
CREATE INDEX IF NOT EXISTS flight_reports_created_desc_idx ON public.flight_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS trial_schedules_upr_id_idx   ON public.trial_schedules (upr_id);
CREATE INDEX IF NOT EXISTS trial_schedules_start_at_idx ON public.trial_schedules (start_at);

CREATE INDEX IF NOT EXISTS incidents_upr_id_idx ON public.incidents (upr_id);

CREATE INDEX IF NOT EXISTS user_roles_user_id_idx    ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_scope_idx ON public.user_roles (role, scope);

CREATE INDEX IF NOT EXISTS broadcasts_created_desc_idx ON public.broadcasts (created_at DESC);

CREATE INDEX IF NOT EXISTS profiles_pending_idx ON public.profiles (created_at) WHERE approved = false;

ANALYZE public.uprs;
ANALYZE public.segments;
ANALYZE public.chat_messages;
ANALYZE public.flight_reports;
ANALYZE public.trial_schedules;
ANALYZE public.incidents;
ANALYZE public.user_roles;
ANALYZE public.broadcasts;
ANALYZE public.profiles;
