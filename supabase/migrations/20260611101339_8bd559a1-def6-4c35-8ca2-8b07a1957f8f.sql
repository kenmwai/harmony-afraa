-- Restore EXECUTE on user_scope; RLS policies invoke it as the authenticated user.
-- Make it SECURITY DEFINER so it bypasses RLS on user_roles when called from policies.
CREATE OR REPLACE FUNCTION public.user_scope(_user_id uuid, _role app_role)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT scope FROM public.user_roles WHERE user_id=_user_id AND role=_role LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.user_scope(uuid, public.app_role) TO authenticated;