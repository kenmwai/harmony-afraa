
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'regulator';

CREATE OR REPLACE FUNCTION public.is_regulator(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role::text='regulator')
$$;

ALTER TABLE public.uprs ADD COLUMN IF NOT EXISTS trial_at timestamptz;

-- Expand read access on uprs / segments / broadcasts to regulators
DROP POLICY IF EXISTS "upr read: own airline, ansp, admin" ON public.uprs;
CREATE POLICY "upr read: airline ansp admin regulator" ON public.uprs FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'ansp')
  OR public.is_regulator(auth.uid())
  OR (public.has_role(auth.uid(),'airline') AND airline_code = public.user_scope(auth.uid(),'airline'))
);

DROP POLICY IF EXISTS "segment read: same rules as upr" ON public.segments;
CREATE POLICY "segment read: airline ansp admin regulator" ON public.segments FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'ansp')
  OR public.is_regulator(auth.uid())
  OR (EXISTS (SELECT 1 FROM public.uprs u WHERE u.id=segments.upr_id AND public.has_role(auth.uid(),'airline') AND u.airline_code=public.user_scope(auth.uid(),'airline')))
);

DROP POLICY IF EXISTS "broadcasts read: approved auth" ON public.broadcasts;
CREATE POLICY "broadcasts read: approved auth" ON public.broadcasts FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'ansp')
  OR public.has_role(auth.uid(),'airline')
  OR public.is_regulator(auth.uid())
);

DROP POLICY IF EXISTS "broadcasts insert: approved auth" ON public.broadcasts;
CREATE POLICY "broadcasts insert: approved auth" ON public.broadcasts FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'ansp')
  OR public.has_role(auth.uid(),'airline')
  OR public.is_regulator(auth.uid())
);

-- Storage: regulators can read attachments
DROP POLICY IF EXISTS "upr-attachments read for approved auth" ON storage.objects;
CREATE POLICY "upr-attachments read for approved auth" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='upr-attachments' AND (
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'ansp')
    OR public.has_role(auth.uid(),'airline')
    OR public.is_regulator(auth.uid())
  )
);

-- Incidents / post-trial feedback
CREATE TABLE IF NOT EXISTS public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upr_id uuid NOT NULL REFERENCES public.uprs(id) ON DELETE CASCADE,
  author uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_label text NOT NULL,
  party text NOT NULL CHECK (party IN ('airline','ansp')),
  party_scope text NOT NULL,
  rating int CHECK (rating BETWEEN 1 AND 5),
  severity text NOT NULL CHECK (severity IN ('none','minor','major','critical')),
  description text NOT NULL,
  image_paths text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.incidents TO authenticated;
GRANT ALL ON public.incidents TO service_role;

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incidents read" ON public.incidents FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.is_regulator(auth.uid())
  OR public.has_role(auth.uid(),'ansp')
  OR (public.has_role(auth.uid(),'airline') AND EXISTS (
        SELECT 1 FROM public.uprs u WHERE u.id=incidents.upr_id AND u.airline_code=public.user_scope(auth.uid(),'airline')))
);

CREATE POLICY "incidents insert by airline owner" ON public.incidents FOR INSERT TO authenticated
WITH CHECK (
  author = auth.uid() AND party='airline'
  AND public.has_role(auth.uid(),'airline')
  AND EXISTS (SELECT 1 FROM public.uprs u WHERE u.id=incidents.upr_id AND u.airline_code=public.user_scope(auth.uid(),'airline'))
);

CREATE POLICY "incidents insert by ansp on their fir" ON public.incidents FOR INSERT TO authenticated
WITH CHECK (
  author = auth.uid() AND party='ansp'
  AND public.has_role(auth.uid(),'ansp')
  AND EXISTS (SELECT 1 FROM public.segments s WHERE s.upr_id=incidents.upr_id AND s.fir_code=public.user_scope(auth.uid(),'ansp'))
);

CREATE POLICY "incidents delete by admin" ON public.incidents FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin'));
