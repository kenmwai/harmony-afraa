
-- Attach identity enforcement triggers
DROP TRIGGER IF EXISTS enforce_author_identity_chat ON public.chat_messages;
CREATE TRIGGER enforce_author_identity_chat
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS enforce_author_identity_broadcasts ON public.broadcasts;
CREATE TRIGGER enforce_author_identity_broadcasts
  BEFORE INSERT ON public.broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS enforce_author_identity_incidents ON public.incidents;
CREATE TRIGGER enforce_author_identity_incidents
  BEFORE INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

DROP TRIGGER IF EXISTS enforce_author_identity_flight_reports ON public.flight_reports;
CREATE TRIGGER enforce_author_identity_flight_reports
  BEFORE INSERT ON public.flight_reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_author_identity();

-- Attach edited_at trigger for chat messages
DROP TRIGGER IF EXISTS mark_chat_edited_trg ON public.chat_messages;
CREATE TRIGGER mark_chat_edited_trg
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.mark_chat_edited();

-- Attach self-escalation prevention on profiles
DROP TRIGGER IF EXISTS prevent_profile_self_escalation_trg ON public.profiles;
CREATE TRIGGER prevent_profile_self_escalation_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_self_escalation();
