
-- flight_reports: post-trial detailed operational report
CREATE TABLE public.flight_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upr_id uuid NOT NULL REFERENCES public.uprs(id) ON DELETE CASCADE,
  author uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  author_label text NOT NULL,
  party text NOT NULL CHECK (party IN ('airline','ansp')),
  party_scope text NOT NULL DEFAULT '',
  trial_stage text NOT NULL DEFAULT 'day1' CHECK (trial_stage IN ('day1','day3','day7')),
  flight_date date,
  block_off timestamptz,
  takeoff timestamptz,
  block_on timestamptz,
  landing timestamptz,
  base_route text NOT NULL DEFAULT '',
  upr_route text NOT NULL DEFAULT '',
  projected_time_min numeric NOT NULL DEFAULT 0,
  projected_fuel_kg numeric NOT NULL DEFAULT 0,
  projected_co2_kg numeric NOT NULL DEFAULT 0,
  realised_time_min numeric NOT NULL DEFAULT 0,
  realised_fuel_kg numeric NOT NULL DEFAULT 0,
  realised_co2_kg numeric NOT NULL DEFAULT 0,
  cost_savings_usd numeric NOT NULL DEFAULT 0,
  incident_rating integer CHECK (incident_rating BETWEEN 1 AND 5),
  incident_severity text NOT NULL DEFAULT 'none' CHECK (incident_severity IN ('none','minor','major','critical')),
  incident_description text NOT NULL DEFAULT '',
  image_paths text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.flight_reports TO authenticated;
GRANT ALL ON public.flight_reports TO service_role;

ALTER TABLE public.flight_reports ENABLE ROW LEVEL SECURITY;

-- Admin & regulator can see all
CREATE POLICY "admin_regulator_read_reports" ON public.flight_reports
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.is_regulator(auth.uid()));

-- Airline owner of UPR can read their own UPR reports
CREATE POLICY "airline_owner_read_reports" ON public.flight_reports
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = upr_id AND u.created_by = auth.uid()));

-- ANSP can read reports on UPRs that cross their FIR
CREATE POLICY "ansp_read_reports" ON public.flight_reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.segments s
      WHERE s.upr_id = flight_reports.upr_id
        AND s.fir_code = public.user_scope(auth.uid(),'ansp')
    )
  );

-- Airline who owns UPR inserts as airline; ANSP on FIR inserts as ansp
CREATE POLICY "insert_reports" ON public.flight_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    author = auth.uid()
    AND (
      (party = 'airline' AND EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = upr_id AND u.created_by = auth.uid()))
      OR
      (party = 'ansp' AND EXISTS (SELECT 1 FROM public.segments s WHERE s.upr_id = upr_id AND s.fir_code = public.user_scope(auth.uid(),'ansp')))
    )
  );

CREATE POLICY "admin_delete_reports" ON public.flight_reports
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- trial_schedules: progressive trial scheduling (day1/day3/day7)
CREATE TABLE public.trial_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upr_id uuid NOT NULL REFERENCES public.uprs(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('day1','day3','day7')),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trial_schedules TO authenticated;
GRANT ALL ON public.trial_schedules TO service_role;

ALTER TABLE public.trial_schedules ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can read schedules (admins/regulators/airline owners/ANSPs/all participants)
-- Restricting to participants:
CREATE POLICY "read_schedules" ON public.trial_schedules
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR public.is_regulator(auth.uid())
    OR EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = upr_id AND u.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.segments s WHERE s.upr_id = upr_id AND s.fir_code = public.user_scope(auth.uid(),'ansp'))
  );

-- Airline owner of UPR can schedule trials
CREATE POLICY "airline_insert_schedules" ON public.trial_schedules
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = upr_id AND u.created_by = auth.uid())
  );

CREATE POLICY "airline_update_schedules" ON public.trial_schedules
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = upr_id AND u.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = upr_id AND u.created_by = auth.uid()));

CREATE POLICY "airline_delete_schedules" ON public.trial_schedules
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = upr_id AND u.created_by = auth.uid())
  );
