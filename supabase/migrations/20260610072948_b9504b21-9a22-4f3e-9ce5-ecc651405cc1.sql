
CREATE POLICY "owners or admin delete uprs" ON public.uprs
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "owners or admin delete segments" ON public.segments
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = segments.upr_id AND u.created_by = auth.uid())
  );

CREATE POLICY "author or admin delete chat" ON public.chat_messages
  FOR DELETE TO authenticated
  USING (author = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin delete broadcasts" ON public.broadcasts
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "upr-attachments owner or admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'upr-attachments' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  WITH CHECK (bucket_id = 'upr-attachments' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "upr-attachments owner or admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'upr-attachments' AND (owner = auth.uid() OR public.has_role(auth.uid(), 'admin')));

REVOKE EXECUTE ON FUNCTION public.user_scope(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
