
CREATE TABLE public.chat_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  upr_id uuid NOT NULL REFERENCES public.uprs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_label text NOT NULL DEFAULT '',
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

GRANT SELECT, INSERT, DELETE ON public.chat_reactions TO authenticated;
GRANT ALL ON public.chat_reactions TO service_role;

CREATE INDEX chat_reactions_message_idx ON public.chat_reactions(message_id);
CREATE INDEX chat_reactions_upr_idx ON public.chat_reactions(upr_id);

ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reactions REPLICA IDENTITY FULL;

-- Read: same audience as the underlying chat_message (owner UPR / matching ANSP FIR / admin / regulator)
CREATE POLICY "read reactions if party to UPR"
ON public.chat_reactions FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.is_regulator(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.uprs u
    WHERE u.id = chat_reactions.upr_id
      AND (
        u.created_by = auth.uid()
        OR u.airline_code = public.user_scope(auth.uid(), 'airline')
        OR EXISTS (
          SELECT 1 FROM public.segments s
          WHERE s.upr_id = u.id
            AND s.fir_code = public.user_scope(auth.uid(), 'ansp')
        )
      )
  )
);

-- Insert own reactions, only for UPRs the user can see
CREATE POLICY "insert own reactions"
ON public.chat_reactions FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.uprs u
      WHERE u.id = chat_reactions.upr_id
        AND (
          u.created_by = auth.uid()
          OR u.airline_code = public.user_scope(auth.uid(), 'airline')
          OR EXISTS (
            SELECT 1 FROM public.segments s
            WHERE s.upr_id = u.id
              AND s.fir_code = public.user_scope(auth.uid(), 'ansp')
          )
        )
    )
  )
);

-- Delete own reactions (or admin)
CREATE POLICY "delete own reactions"
ON public.chat_reactions FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reactions;
