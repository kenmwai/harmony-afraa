
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;

CREATE OR REPLACE FUNCTION public.user_scope(_user_id uuid, _role public.app_role)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT scope FROM public.user_roles WHERE user_id=_user_id AND role=_role LIMIT 1
$$;

-- user_roles needs a policy letting auth see other users' role checks? No — has_role uses _user_id = auth.uid() in policies. SELECT-own policy already covers it.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
