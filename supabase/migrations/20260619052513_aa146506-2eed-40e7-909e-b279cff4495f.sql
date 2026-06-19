DROP POLICY IF EXISTS "chat read: any approved auth" ON public.chat_messages;
CREATE POLICY "chat read: scoped"
ON public.chat_messages FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR is_regulator(auth.uid())
  OR has_role(auth.uid(), 'ansp'::app_role)
  OR (
    has_role(auth.uid(), 'airline'::app_role)
    AND EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = chat_messages.upr_id AND u.created_by = auth.uid())
  )
);

DROP POLICY IF EXISTS "insert_reports" ON public.flight_reports;
CREATE POLICY "insert_reports"
ON public.flight_reports FOR INSERT TO authenticated
WITH CHECK (
  author = auth.uid()
  AND (
    (party = 'airline' AND EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = flight_reports.upr_id AND u.created_by = auth.uid()))
    OR
    (party = 'ansp' AND EXISTS (SELECT 1 FROM public.segments s WHERE s.upr_id = flight_reports.upr_id AND s.fir_code = user_scope(auth.uid(), 'ansp'::app_role)))
  )
);

DROP POLICY IF EXISTS "read_schedules" ON public.trial_schedules;
CREATE POLICY "read_schedules"
ON public.trial_schedules FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR is_regulator(auth.uid())
  OR EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = trial_schedules.upr_id AND u.created_by = auth.uid())
  OR EXISTS (SELECT 1 FROM public.segments s WHERE s.upr_id = trial_schedules.upr_id AND s.fir_code = user_scope(auth.uid(), 'ansp'::app_role))
);

DROP POLICY IF EXISTS "upr-attachments read for approved auth" ON storage.objects;
CREATE POLICY "upr-attachments read: scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'upr-attachments'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR is_regulator(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.uprs u
      WHERE u.id::text = (storage.foldername(name))[1]
        AND (
          u.created_by = auth.uid()
          OR (
            has_role(auth.uid(), 'ansp'::app_role)
            AND EXISTS (
              SELECT 1 FROM public.segments s
              WHERE s.upr_id = u.id AND s.fir_code = user_scope(auth.uid(), 'ansp'::app_role)
            )
          )
        )
    )
  )
);

REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.approve_user(uuid, app_role, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_add_fir(text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_aircraft(text, text, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.register_airline(text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.user_scope(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_regulator(uuid) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_user(uuid, app_role, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_fir(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_aircraft(text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_airline(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_scope(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_regulator(uuid) TO authenticated;