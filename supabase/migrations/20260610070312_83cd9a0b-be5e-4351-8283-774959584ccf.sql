
-- ENUMS & REFERENCE TABLES ---------------------------------------------------
CREATE TYPE public.app_role AS ENUM ('airline','ansp','admin');

CREATE TABLE public.airlines (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.airlines TO authenticated;
GRANT ALL ON public.airlines TO service_role;
ALTER TABLE public.airlines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "airlines readable by auth" ON public.airlines FOR SELECT TO authenticated USING (true);

CREATE TABLE public.firs (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.firs TO authenticated;
GRANT ALL ON public.firs TO service_role;
ALTER TABLE public.firs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "firs readable by auth" ON public.firs FOR SELECT TO authenticated USING (true);

INSERT INTO public.airlines (code, name) VALUES
  ('KQ','Kenya Airways'),('ET','Ethiopian Airlines'),('SA','South African Airways'),
  ('MS','EgyptAir'),('AT','Royal Air Maroc'),('RW','RwandAir'),('TC','Air Tanzania'),
  ('WB','RwandAir / Other'),('ZB','Air Zimbabwe'),('TM','LAM Mozambique')
ON CONFLICT DO NOTHING;

INSERT INTO public.firs (code, name) VALUES
  ('HCSM','Mogadishu'),('HKNA','Nairobi'),('HTDC','Dar es Salaam'),
  ('HAAA','Addis Ababa'),('HUEC','Entebbe'),('FACA','Cape Town'),
  ('FIMM','Mauritius'),('DGAC','Accra'),('DNKK','Kano'),('GVSC','Sal Oceanic')
ON CONFLICT DO NOTHING;

-- PROFILES & ROLES -----------------------------------------------------------
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  requested_role public.app_role,
  requested_scope TEXT,
  approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, scope)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;

CREATE OR REPLACE FUNCTION public.user_scope(_user_id uuid, _role public.app_role)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT scope FROM public.user_roles WHERE user_id=_user_id AND role=_role LIMIT 1
$$;

CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
CREATE POLICY "users update own profile or admin" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "users read own roles or admin all" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- handle new user: insert profile from raw metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, requested_role, requested_scope)
  VALUES (
    NEW.id,
    COALESCE(NEW.email,''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email,''),'@',1)),
    NULLIF(NEW.raw_user_meta_data->>'requested_role','')::public.app_role,
    NULLIF(NEW.raw_user_meta_data->>'requested_scope','')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- UPRs -----------------------------------------------------------------------
CREATE TABLE public.uprs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  callsign TEXT NOT NULL,
  flight_no TEXT NOT NULL,
  dep TEXT NOT NULL,
  arr TEXT NOT NULL,
  aircraft TEXT NOT NULL,
  airline_code TEXT NOT NULL REFERENCES public.airlines(code),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  baseline_minutes INT NOT NULL DEFAULT 0,
  optimized_minutes INT NOT NULL DEFAULT 0,
  burn_kg_per_min NUMERIC NOT NULL DEFAULT 0,
  flight_plan_path TEXT,
  flight_plan_name TEXT,
  flight_plan_size INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uprs TO authenticated;
GRANT ALL ON public.uprs TO service_role;
ALTER TABLE public.uprs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "upr read: own airline, ansp, admin" ON public.uprs FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'ansp')
  OR (public.has_role(auth.uid(),'airline') AND airline_code = public.user_scope(auth.uid(),'airline'))
);
CREATE POLICY "upr insert: airline own scope" ON public.uprs FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid()
  AND public.has_role(auth.uid(),'airline')
  AND airline_code = public.user_scope(auth.uid(),'airline')
);
CREATE POLICY "upr update: owner or admin" ON public.uprs FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'admin')
  OR (public.has_role(auth.uid(),'airline') AND airline_code = public.user_scope(auth.uid(),'airline'))
);

-- SEGMENTS -------------------------------------------------------------------
CREATE TABLE public.segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upr_id UUID NOT NULL REFERENCES public.uprs(id) ON DELETE CASCADE,
  fir_code TEXT NOT NULL REFERENCES public.firs(code),
  order_idx INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  reason TEXT,
  entry TEXT NOT NULL,
  exit TEXT NOT NULL,
  fl TEXT NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  amendment_path TEXT,
  amendment_name TEXT,
  amendment_size INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.segments TO authenticated;
GRANT ALL ON public.segments TO service_role;
ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "segment read: same rules as upr" ON public.segments FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'ansp')
  OR EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = segments.upr_id
    AND public.has_role(auth.uid(),'airline')
    AND u.airline_code = public.user_scope(auth.uid(),'airline'))
);
CREATE POLICY "segment insert: airline owner or admin" ON public.segments FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'admin')
  OR EXISTS (SELECT 1 FROM public.uprs u WHERE u.id = upr_id
    AND public.has_role(auth.uid(),'airline')
    AND u.airline_code = public.user_scope(auth.uid(),'airline')
    AND u.created_by = auth.uid())
);
CREATE POLICY "segment update: ansp own fir or admin" ON public.segments FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'admin')
  OR (public.has_role(auth.uid(),'ansp') AND fir_code = public.user_scope(auth.uid(),'ansp'))
);

-- CHAT -----------------------------------------------------------------------
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upr_id UUID NOT NULL REFERENCES public.uprs(id) ON DELETE CASCADE,
  author UUID REFERENCES auth.users(id),
  author_label TEXT NOT NULL,
  author_role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat read: any approved auth" ON public.chat_messages FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'ansp') OR public.has_role(auth.uid(),'airline')
);
CREATE POLICY "chat insert: any approved auth" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (
  author = auth.uid()
  AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'ansp') OR public.has_role(auth.uid(),'airline'))
);

-- BROADCASTS -----------------------------------------------------------------
CREATE TABLE public.broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author UUID REFERENCES auth.users(id),
  author_label TEXT NOT NULL,
  author_role TEXT NOT NULL,
  text TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.broadcasts TO authenticated;
GRANT ALL ON public.broadcasts TO service_role;
ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "broadcasts read: approved auth" ON public.broadcasts FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'ansp') OR public.has_role(auth.uid(),'airline')
);
CREATE POLICY "broadcasts insert: approved auth" ON public.broadcasts FOR INSERT TO authenticated WITH CHECK (
  author = auth.uid()
  AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'ansp') OR public.has_role(auth.uid(),'airline'))
);

-- REALTIME -------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.uprs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.segments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.broadcasts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;

-- STORAGE POLICIES (bucket created via tool) ---------------------------------
CREATE POLICY "upr-attachments read for approved auth"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'upr-attachments' AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'ansp') OR public.has_role(auth.uid(),'airline')
  ));
CREATE POLICY "upr-attachments upload for approved auth"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'upr-attachments' AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'ansp') OR public.has_role(auth.uid(),'airline')
  ));
CREATE POLICY "upr-attachments delete own or admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'upr-attachments' AND (owner = auth.uid() OR public.has_role(auth.uid(),'admin')));
