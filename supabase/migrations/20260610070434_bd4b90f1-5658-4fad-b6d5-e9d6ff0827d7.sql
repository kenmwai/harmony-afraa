
CREATE OR REPLACE FUNCTION public.claim_first_admin()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing int;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT count(*) INTO existing FROM public.user_roles WHERE role = 'admin';
  IF existing > 0 THEN RETURN false; END IF;
  INSERT INTO public.user_roles (user_id, role, scope) VALUES (auth.uid(), 'admin', NULL)
    ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET approved = true WHERE id = auth.uid();
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;

-- Admin approval helper: idempotent insert into user_roles + flip approved=true
CREATE OR REPLACE FUNCTION public.approve_user(_user_id uuid, _role public.app_role, _scope text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'only admin can approve users';
  END IF;
  INSERT INTO public.user_roles (user_id, role, scope) VALUES (_user_id, _role, _scope)
    ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET approved = true WHERE id = _user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.approve_user(uuid,public.app_role,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_user(uuid,public.app_role,text) TO authenticated;

-- Allow admin to list all profiles awaiting approval (already covered by select policy via has_role check), but admin needs SELECT on user_roles for all
CREATE POLICY "admin reads all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
