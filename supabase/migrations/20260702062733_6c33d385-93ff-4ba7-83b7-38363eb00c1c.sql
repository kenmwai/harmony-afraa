
DROP POLICY IF EXISTS ansp_read_reports ON public.flight_reports;
CREATE POLICY ansp_read_reports ON public.flight_reports
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'ansp'::public.app_role)
  AND EXISTS (
    SELECT 1 FROM public.segments s
    WHERE s.upr_id = flight_reports.upr_id
      AND s.fir_code = public.user_scope(auth.uid(), 'ansp'::public.app_role)
  )
);

DROP POLICY IF EXISTS insert_reports ON public.flight_reports;
CREATE POLICY insert_reports ON public.flight_reports
FOR INSERT TO authenticated
WITH CHECK (
  author = auth.uid()
  AND (
    (
      party = 'airline'
      AND public.has_role(auth.uid(), 'airline'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.uprs u
        WHERE u.id = flight_reports.upr_id
          AND u.airline_code = public.user_scope(auth.uid(), 'airline'::public.app_role)
      )
    )
    OR (
      party = 'ansp'
      AND public.has_role(auth.uid(), 'ansp'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.segments s
        WHERE s.upr_id = flight_reports.upr_id
          AND s.fir_code = public.user_scope(auth.uid(), 'ansp'::public.app_role)
      )
    )
  )
);

DROP POLICY IF EXISTS admin_insert_schedules ON public.trial_schedules;
CREATE POLICY admin_insert_schedules ON public.trial_schedules
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
