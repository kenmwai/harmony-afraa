
-- Hardcode admin to kkionero@afraa.org
-- 1) Update handle_new_user trigger to auto-grant admin to the hardcoded email
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean := lower(coalesce(NEW.email,'')) = 'kkionero@afraa.org';
BEGIN
  INSERT INTO public.profiles (id, email, full_name, requested_role, requested_scope, approved)
  VALUES (
    NEW.id,
    COALESCE(NEW.email,''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email,''),'@',1)),
    CASE WHEN is_admin THEN 'admin'::public.app_role
         ELSE NULLIF(NEW.raw_user_meta_data->>'requested_role','')::public.app_role END,
    CASE WHEN is_admin THEN 'AFRAA'
         ELSE NULLIF(NEW.raw_user_meta_data->>'requested_scope','') END,
    is_admin
  )
  ON CONFLICT (id) DO NOTHING;

  IF is_admin THEN
    INSERT INTO public.user_roles (user_id, role, scope)
    VALUES (NEW.id, 'admin'::public.app_role, 'AFRAA')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Lock claim_first_admin so only the hardcoded email can claim, and only if no admin exists
CREATE OR REPLACE FUNCTION public.claim_first_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_email text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT lower(email) INTO caller_email FROM auth.users WHERE id = auth.uid();
  IF caller_email <> 'kkionero@afraa.org' THEN RETURN false; END IF;
  INSERT INTO public.user_roles (user_id, role, scope)
  VALUES (auth.uid(), 'admin'::public.app_role, 'AFRAA')
  ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET approved = true WHERE id = auth.uid();
  RETURN true;
END;
$function$;

-- 3) Retroactively promote kkionero@afraa.org if already signed up
DO $$
DECLARE
  uid uuid;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE lower(email) = 'kkionero@afraa.org' LIMIT 1;
  IF uid IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, scope)
    VALUES (uid, 'admin'::public.app_role, 'AFRAA')
    ON CONFLICT DO NOTHING;
    UPDATE public.profiles SET approved = true WHERE id = uid;
  END IF;
END $$;

-- 4) Demote any other admins (only kkionero may be admin)
DELETE FROM public.user_roles
 WHERE role = 'admin'::public.app_role
   AND user_id NOT IN (SELECT id FROM auth.users WHERE lower(email) = 'kkionero@afraa.org');
