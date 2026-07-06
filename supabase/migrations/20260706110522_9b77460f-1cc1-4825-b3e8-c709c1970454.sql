
-- Fix 1: profiles self-escalation. Restrict what non-admins can update on their own profile.
DROP POLICY IF EXISTS "users update own profile or admin" ON public.profiles;

CREATE POLICY "admin update any profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "user update own profile safe fields" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND approved        IS NOT DISTINCT FROM (SELECT p.approved        FROM public.profiles p WHERE p.id = auth.uid())
    AND requested_role  IS NOT DISTINCT FROM (SELECT p.requested_role  FROM public.profiles p WHERE p.id = auth.uid())
    AND requested_scope IS NOT DISTINCT FROM (SELECT p.requested_scope FROM public.profiles p WHERE p.id = auth.uid())
    AND email           IS NOT DISTINCT FROM (SELECT p.email           FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Fix 2: identity spoofing on chat_messages / broadcasts / incidents / flight_reports.
-- Server-side triggers overwrite author, author_label, author_role, party, party_scope
-- from the authenticated user's profile + user_roles, so client-supplied values cannot spoof.

CREATE OR REPLACE FUNCTION public.enforce_author_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  full_name text;
  role_row record;
  resolved_role text;
  resolved_scope text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'must be signed in';
  END IF;

  SELECT p.full_name INTO full_name FROM public.profiles p WHERE p.id = uid;

  -- Pick the highest-privilege role for this user (admin > regulator > ansp > airline > user)
  SELECT role::text AS role, scope INTO role_row
  FROM public.user_roles
  WHERE user_id = uid
  ORDER BY CASE role::text
    WHEN 'admin' THEN 1
    WHEN 'regulator' THEN 2
    WHEN 'ansp' THEN 3
    WHEN 'airline' THEN 4
    ELSE 5 END
  LIMIT 1;

  resolved_role  := COALESCE(role_row.role, 'user');
  resolved_scope := role_row.scope;

  NEW.author := uid;

  IF TG_TABLE_NAME IN ('chat_messages','broadcasts') THEN
    NEW.author_label := COALESCE(full_name, 'User');
    NEW.author_role  := resolved_role;
  ELSIF TG_TABLE_NAME IN ('incidents','flight_reports') THEN
    NEW.author_label := COALESCE(full_name, 'User');
    NEW.party        := resolved_role;
    NEW.party_scope  := resolved_scope;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_identity_chat_messages ON public.chat_messages;
CREATE TRIGGER trg_enforce_identity_chat_messages
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS trg_enforce_identity_broadcasts ON public.broadcasts;
CREATE TRIGGER trg_enforce_identity_broadcasts
  BEFORE INSERT ON public.broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS trg_enforce_identity_incidents ON public.incidents;
CREATE TRIGGER trg_enforce_identity_incidents
  BEFORE INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS trg_enforce_identity_flight_reports ON public.flight_reports;
CREATE TRIGGER trg_enforce_identity_flight_reports
  BEFORE INSERT ON public.flight_reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();
