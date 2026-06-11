
CREATE TABLE public.aircraft_types (
  code text PRIMARY KEY,
  name text NOT NULL,
  burn_kg_per_min numeric NOT NULL CHECK (burn_kg_per_min > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.aircraft_types TO authenticated;
GRANT ALL ON public.aircraft_types TO service_role;

ALTER TABLE public.aircraft_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read aircraft_types"
  ON public.aircraft_types FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.admin_upsert_aircraft(_code text, _name text, _burn numeric)
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
    RAISE EXCEPTION 'only admin can manage aircraft types';
  END IF;
  IF c = '' OR length(c) > 8 THEN RAISE EXCEPTION 'invalid aircraft code'; END IF;
  IF n = '' OR length(n) > 80 THEN RAISE EXCEPTION 'invalid aircraft name'; END IF;
  IF _burn IS NULL OR _burn <= 0 OR _burn > 1000 THEN RAISE EXCEPTION 'invalid burn rate'; END IF;
  INSERT INTO public.aircraft_types (code, name, burn_kg_per_min)
  VALUES (c, n, _burn)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, burn_kg_per_min = EXCLUDED.burn_kg_per_min, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_aircraft(text, text, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_aircraft_types_updated_at
BEFORE UPDATE ON public.aircraft_types
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.aircraft_types (code, name, burn_kg_per_min) VALUES
  ('B738', 'Boeing 737-800', 45),
  ('B788', 'Boeing 787-8', 90),
  ('B789', 'Boeing 787-9', 95),
  ('B77W', 'Boeing 777-300ER', 115),
  ('A320', 'Airbus A320', 42),
  ('A321', 'Airbus A321', 48),
  ('A333', 'Airbus A330-300', 95),
  ('A359', 'Airbus A350-900', 90),
  ('E190', 'Embraer 190', 35),
  ('CRJ9', 'Bombardier CRJ-900', 28)
ON CONFLICT (code) DO NOTHING;
