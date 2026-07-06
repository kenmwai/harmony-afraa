
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rejected boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rejected_reason text;

CREATE OR REPLACE FUNCTION public.reject_user(_user_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'only admin can reject users';
  END IF;
  UPDATE public.profiles
     SET rejected = true,
         rejected_at = now(),
         rejected_reason = _reason,
         approved = false
   WHERE id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_user(uuid, text) TO authenticated;
