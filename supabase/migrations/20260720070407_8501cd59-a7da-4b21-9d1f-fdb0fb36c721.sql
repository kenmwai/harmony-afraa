
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

-- Realtime needs full old-row data to reliably deliver UPDATE/DELETE payloads for patching UI state.
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

-- Allow authors to edit their own messages (admins too). The enforce_author_identity trigger
-- already runs on UPDATE and prevents identity spoofing.
DROP POLICY IF EXISTS "author or admin update chat" ON public.chat_messages;
CREATE POLICY "author or admin update chat"
ON public.chat_messages
FOR UPDATE
TO authenticated
USING (author = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (author = auth.uid() OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- Set edited_at automatically when text changes.
CREATE OR REPLACE FUNCTION public.mark_chat_edited()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.text IS DISTINCT FROM OLD.text THEN
    NEW.edited_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_chat_edited ON public.chat_messages;
CREATE TRIGGER trg_mark_chat_edited
BEFORE UPDATE ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.mark_chat_edited();
