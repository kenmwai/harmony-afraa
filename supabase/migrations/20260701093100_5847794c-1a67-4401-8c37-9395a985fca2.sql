-- Fix: scope ANSP UPR reads to their FIR
DROP POLICY IF EXISTS "upr read" ON public.uprs;
CREATE POLICY "upr read" ON public.uprs
FOR SELECT TO authenticated
USING (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR public.is_regulator(auth.uid())
  OR (
    public.has_role(auth.uid(), 'ansp')
    AND EXISTS (
      SELECT 1 FROM public.segments s
      WHERE s.upr_id = uprs.id
        AND s.fir_code = public.user_scope(auth.uid(), 'ansp')
    )
  )
);

-- Fix: scope ANSP incidents reads to their FIR
DROP POLICY IF EXISTS "incidents read" ON public.incidents;
CREATE POLICY "incidents read" ON public.incidents
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.is_regulator(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.uprs u
    WHERE u.id = incidents.upr_id AND u.created_by = auth.uid()
  )
  OR (
    public.has_role(auth.uid(), 'ansp')
    AND EXISTS (
      SELECT 1 FROM public.segments s
      WHERE s.upr_id = incidents.upr_id
        AND s.fir_code = public.user_scope(auth.uid(), 'ansp')
    )
  )
);

-- Fix: scope storage uploads to UPRs the user is party to
DROP POLICY IF EXISTS "upr-attachments upload for approved auth" ON storage.objects;
CREATE POLICY "upr-attachments upload for approved auth" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'upr-attachments'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.uprs u
      WHERE u.id::text = (storage.foldername(name))[1]
        AND (
          u.created_by = auth.uid()
          OR (
            public.has_role(auth.uid(), 'ansp')
            AND EXISTS (
              SELECT 1 FROM public.segments s
              WHERE s.upr_id = u.id
                AND s.fir_code = public.user_scope(auth.uid(), 'ansp')
            )
          )
        )
    )
  )
);

-- Fix: scope chat inserts to UPRs the user is party to
DROP POLICY IF EXISTS "chat insert: any approved auth" ON public.chat_messages;
CREATE POLICY "chat insert: party to upr" ON public.chat_messages
FOR INSERT TO authenticated
WITH CHECK (
  author = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.uprs u
      WHERE u.id = chat_messages.upr_id
        AND (
          u.created_by = auth.uid()
          OR (
            public.has_role(auth.uid(), 'ansp')
            AND EXISTS (
              SELECT 1 FROM public.segments s
              WHERE s.upr_id = u.id
                AND s.fir_code = public.user_scope(auth.uid(), 'ansp')
            )
          )
        )
    )
  )
);
