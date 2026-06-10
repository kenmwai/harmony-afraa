
CREATE OR REPLACE FUNCTION public.register_airline(_code text, _name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c text := upper(trim(_code));
  n text := trim(_name);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'must be signed in'; END IF;
  IF c = '' OR length(c) > 8 THEN RAISE EXCEPTION 'invalid airline code'; END IF;
  IF n = '' OR length(n) > 80 THEN RAISE EXCEPTION 'invalid airline name'; END IF;
  INSERT INTO public.airlines (code, name) VALUES (c, n)
    ON CONFLICT (code) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_airline(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_add_fir(_code text, _name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c text := upper(trim(_code));
  n text := trim(_name);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'only admin can add FIRs';
  END IF;
  IF c = '' OR length(c) > 8 THEN RAISE EXCEPTION 'invalid FIR code'; END IF;
  IF n = '' OR length(n) > 80 THEN RAISE EXCEPTION 'invalid FIR name'; END IF;
  INSERT INTO public.firs (code, name) VALUES (c, n)
    ON CONFLICT (code) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_add_fir(text, text) TO authenticated;
