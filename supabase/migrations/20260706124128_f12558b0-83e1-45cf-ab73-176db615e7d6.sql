
-- 1) Attach identity-enforcement trigger to the four tables
DROP TRIGGER IF EXISTS enforce_author_identity_chat_messages ON public.chat_messages;
CREATE TRIGGER enforce_author_identity_chat_messages
BEFORE INSERT OR UPDATE ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS enforce_author_identity_broadcasts ON public.broadcasts;
CREATE TRIGGER enforce_author_identity_broadcasts
BEFORE INSERT OR UPDATE ON public.broadcasts
FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS enforce_author_identity_incidents ON public.incidents;
CREATE TRIGGER enforce_author_identity_incidents
BEFORE INSERT OR UPDATE ON public.incidents
FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS enforce_author_identity_flight_reports ON public.flight_reports;
CREATE TRIGGER enforce_author_identity_flight_reports
BEFORE INSERT OR UPDATE ON public.flight_reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

-- 2) Defense-in-depth trigger against self-escalation on profiles
CREATE OR REPLACE FUNCTION public.prevent_profile_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admins can change anything
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Only the owner can reach here via RLS. Block sensitive field changes.
  IF NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.requested_role IS DISTINCT FROM OLD.requested_role
     OR NEW.requested_scope IS DISTINCT FROM OLD.requested_scope
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.rejected IS DISTINCT FROM OLD.rejected
     OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
     OR NEW.rejected_reason IS DISTINCT FROM OLD.rejected_reason
     OR NEW.id IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION 'not allowed to modify protected profile fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_profile_self_escalation ON public.profiles;
CREATE TRIGGER prevent_profile_self_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_self_escalation();

-- 3) Revoke public/anon EXECUTE on SECURITY DEFINER functions; grant only to appropriate roles
REVOKE EXECUTE ON FUNCTION public.approve_user(uuid, public.app_role, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_user(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_first_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_add_fir(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_aircraft(text, text, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.register_airline(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_scope(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_regulator(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_author_identity() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_self_escalation() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_user(uuid, public.app_role, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_first_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_fir(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_aircraft(text, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_airline(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_scope(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_regulator(uuid) TO authenticated;
