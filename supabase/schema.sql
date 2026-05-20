-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TABLES

-- Create galleries table
CREATE TABLE IF NOT EXISTS public.galleries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  photographer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_name text NOT NULL,
  title text,
  agreed_balance numeric DEFAULT 0,
  amount_paid numeric DEFAULT 0,
  link_enabled boolean DEFAULT true,
  selection_enabled boolean DEFAULT false,
  selection_status text DEFAULT 'pending', -- 'pending', 'submitted', 'completed'
  created_at timestamptz DEFAULT now()
);

-- Safely add new columns to existing table (for users upgrading from older versions)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='galleries' AND column_name='selection_enabled') THEN
        ALTER TABLE public.galleries ADD COLUMN selection_enabled boolean DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='galleries' AND column_name='selection_status') THEN
        ALTER TABLE public.galleries ADD COLUMN selection_status text DEFAULT 'pending';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='galleries' AND column_name='category') THEN
        ALTER TABLE public.galleries ADD COLUMN category text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='galleries' AND column_name='selection_limit') THEN
        ALTER TABLE public.galleries ADD COLUMN selection_limit integer DEFAULT 0;
    END IF;
    
    -- Add files columns for Prints
    ALTER TABLE public.files ADD COLUMN IF NOT EXISTS title text;
    ALTER TABLE public.files ADD COLUMN IF NOT EXISTS description text;
    ALTER TABLE public.files ADD COLUMN IF NOT EXISTS print_size text;
    ALTER TABLE public.files ADD COLUMN IF NOT EXISTS material text;
    ALTER TABLE public.files ADD COLUMN IF NOT EXISTS price text;
END $$;

-- Create files table
CREATE TABLE IF NOT EXISTS public.files (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gallery_id uuid REFERENCES public.galleries(id) ON DELETE CASCADE NOT NULL,
  file_url text NOT NULL,
  file_path text NOT NULL,
  file_type text CHECK (file_type IN ('image', 'video')),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  download_count integer DEFAULT 0,
  is_edited boolean DEFAULT false,
  title text,
  description text,
  print_size text,
  material text,
  price text
);

-- Create selections table (Junction table)
CREATE TABLE IF NOT EXISTS public.selections (
  gallery_id uuid REFERENCES public.galleries(id) ON DELETE CASCADE NOT NULL,
  file_id uuid REFERENCES public.files(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (gallery_id, file_id)
);

-- Create activity logs
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  gallery_id uuid REFERENCES public.galleries(id) ON DELETE CASCADE NOT NULL,
  action text NOT NULL,
  timestamp timestamptz DEFAULT now()
);

-- 2. ROW LEVEL SECURITY (RLS)

-- Enable RLS
ALTER TABLE public.galleries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- POLICIES FOR GALLERIES

-- Photographers can do everything to their own galleries
DROP POLICY IF EXISTS "Photographers can manage own galleries" ON public.galleries;
CREATE POLICY "Photographers can manage own galleries"
ON public.galleries
FOR ALL
USING (auth.uid() = photographer_id);

-- Public can VIEW galleries only if link_enabled is true
DROP POLICY IF EXISTS "Public can view active galleries" ON public.galleries;
CREATE POLICY "Public can view active galleries"
ON public.galleries
FOR SELECT
USING (link_enabled = true);

-- Remove insecure update policy
DROP POLICY IF EXISTS "Public can update status" ON public.galleries;


-- POLICIES FOR FILES

-- Photographers can manage files in their galleries
DROP POLICY IF EXISTS "Photographers can manage own files" ON public.files;
CREATE POLICY "Photographers can manage own files"
ON public.files
FOR ALL
USING (
  gallery_id IN (
    SELECT id FROM public.galleries WHERE photographer_id = auth.uid()
  )
);

-- Public can VIEW/SELECT files only if:
-- 1. Gallery is enabled
-- 2. File is NOT expired
DROP POLICY IF EXISTS "Public can view non-expired files in active galleries" ON public.files;
CREATE POLICY "Public can view non-expired files in active galleries"
ON public.files
FOR SELECT
USING (
  expires_at > now() AND
  gallery_id IN (
    SELECT id FROM public.galleries WHERE link_enabled = true
  )
);

-- POLICIES FOR SELECTIONS

-- Photographers can view selections for their galleries
DROP POLICY IF EXISTS "Photographers can view selections" ON public.selections;
CREATE POLICY "Photographers can view selections"
ON public.selections
FOR SELECT
USING (
  gallery_id IN (
    SELECT id FROM public.galleries WHERE photographer_id = auth.uid()
  )
);

-- Public can manage selections (View, Insert, Delete) if gallery is enabled
DROP POLICY IF EXISTS "Public can manage selections" ON public.selections;

-- Public can VIEW selections
CREATE POLICY "Public can view selections"
ON public.selections
FOR SELECT
USING (
  gallery_id IN (
    SELECT id FROM public.galleries WHERE link_enabled = true
  )
);

-- Public can INSERT selections
CREATE POLICY "Public can insert selections"
ON public.selections
FOR INSERT
WITH CHECK (
  gallery_id IN (
    SELECT id FROM public.galleries 
    WHERE link_enabled = true 
    AND selection_enabled = true
    AND selection_status = 'pending'
  )
);

-- Public can DELETE selections
CREATE POLICY "Public can delete selections"
ON public.selections
FOR DELETE
USING (
  gallery_id IN (
    SELECT id FROM public.galleries 
    WHERE link_enabled = true 
    AND selection_enabled = true
    AND selection_status = 'pending'
  )
);


-- POLICIES FOR ACTIVITY LOGS
DROP POLICY IF EXISTS "Photographers can manage logs" ON public.activity_logs;
CREATE POLICY "Photographers can manage logs"
ON public.activity_logs
FOR ALL
USING (
  gallery_id IN (
    SELECT id FROM public.galleries WHERE photographer_id = auth.uid()
  )
);

-- Public can insert logs (e.g. for selection submission)
DROP POLICY IF EXISTS "Public can insert logs" ON public.activity_logs;
CREATE POLICY "Public can insert logs"
ON public.activity_logs
FOR INSERT
WITH CHECK (
  gallery_id IN (
    SELECT id FROM public.galleries WHERE link_enabled = true
  )
);


-- 3. FUNCTIONS

-- Helper to increment download count safely (Hardened)
CREATE OR REPLACE FUNCTION increment_download(row_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.files
  SET download_count = download_count + 1
  WHERE id = row_id
  AND EXISTS (
    SELECT 1 FROM public.galleries g
    WHERE g.id = files.gallery_id
    AND g.link_enabled = true
  );
END;
$$;

-- 1. SECURE ACTIVITY LOGS
-- Revoke direct insert permission from anon (public)
REVOKE INSERT ON public.activity_logs FROM anon;

-- Drop the public insert policy
DROP POLICY IF EXISTS "Public can insert logs" ON public.activity_logs;

-- 2. UPDATE SUBMIT_SELECTION RPC
CREATE OR REPLACE FUNCTION submit_selection(gallery_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  gallery_record public.galleries%ROWTYPE;
BEGIN
  -- Fetch gallery and lock row
  SELECT * INTO gallery_record
  FROM public.galleries
  WHERE id = gallery_id
  FOR UPDATE;

  -- Validation checks
  IF gallery_record.id IS NULL THEN
    RAISE EXCEPTION 'Gallery not found';
  END IF;

  IF gallery_record.link_enabled = false THEN
    RAISE EXCEPTION 'Gallery is disabled';
  END IF;

  IF gallery_record.selection_enabled = false THEN
    RAISE EXCEPTION 'Selection mode is disabled';
  END IF;

  IF gallery_record.selection_status != 'pending' THEN
    RAISE EXCEPTION 'Selection already submitted';
  END IF;

  -- Update status
  UPDATE public.galleries
  SET selection_status = 'submitted',
      link_enabled = false
  WHERE id = gallery_id;

  -- Insert log entry (Securely on server side)
  INSERT INTO public.activity_logs (gallery_id, action)
  VALUES (gallery_id, 'Client submitted selection');

END;
$$;

-- UPDATE UNSUBMIT_SELECTION RPC
CREATE OR REPLACE FUNCTION unsubmit_selection(gallery_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  gallery_record public.galleries%ROWTYPE;
BEGIN
  -- Fetch gallery and lock row
  SELECT * INTO gallery_record
  FROM public.galleries
  WHERE id = gallery_id
  FOR UPDATE;

  -- Validation checks
  IF gallery_record.id IS NULL THEN
    RAISE EXCEPTION 'Gallery not found';
  END IF;

  IF gallery_record.link_enabled = false THEN
    RAISE EXCEPTION 'Gallery is disabled';
  END IF;

  IF gallery_record.selection_enabled = false THEN
    RAISE EXCEPTION 'Selection mode is disabled';
  END IF;

  IF gallery_record.selection_status != 'submitted' THEN
    RAISE EXCEPTION 'Selection is not submitted';
  END IF;

  -- Update status
  UPDATE public.galleries
  SET selection_status = 'pending'
  WHERE id = gallery_id;

  -- Insert log entry
  INSERT INTO public.activity_logs (gallery_id, action)
  VALUES (gallery_id, 'Client re-opened selection for editing');

END;
$$;

-- Drop the problematic function that orphans files
DROP FUNCTION IF EXISTS delete_expired_files();

-- 3. SECURE SELECTIONS INSERT (Prevent Cross-Gallery Pollution)
DROP POLICY IF EXISTS "Public can insert selections" ON public.selections;
CREATE POLICY "Public can insert selections"
ON public.selections
FOR INSERT
WITH CHECK (
  -- 1. Gallery must be open and in correct state
  gallery_id IN (
    SELECT id FROM public.galleries 
    WHERE link_enabled = true 
    AND selection_enabled = true
    AND selection_status = 'pending'
  )
  AND
  -- 2. File must belong to the gallery (Prevent IDOR/Pollution)
  gallery_id = (SELECT gallery_id FROM public.files WHERE id = file_id)
);

-- 4. SECURE STORAGE ACCESS (Respect Gallery Status & Ownership)
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'gallery-files' 
  AND (
    -- Allow if user is the owner (photographer)
    owner = auth.uid()
    OR
    -- Allow if file belongs to an active gallery (Public view)
    EXISTS (
        SELECT 1 FROM public.files f
        JOIN public.galleries g ON f.gallery_id = g.id
        WHERE f.file_path = storage.objects.name
        AND g.link_enabled = true
    )
  )
);

DROP POLICY IF EXISTS "Auth Upload" ON storage.objects;
CREATE POLICY "Auth Upload"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'gallery-files' AND auth.role() = 'authenticated' );

DROP POLICY IF EXISTS "Auth Delete" ON storage.objects;
CREATE POLICY "Auth Delete"
ON storage.objects FOR DELETE
USING ( 
  bucket_id = 'gallery-files' 
  AND owner = auth.uid() -- STRICT OWNERSHIP CHECK
);

-- Grant permissions
GRANT EXECUTE ON FUNCTION submit_selection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_selection(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION submit_selection(uuid) TO anon;
GRANT EXECUTE ON FUNCTION unsubmit_selection(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION unsubmit_selection(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION unsubmit_selection(uuid) TO anon;
GRANT EXECUTE ON FUNCTION delete_expired_files() TO authenticated;
GRANT EXECUTE ON FUNCTION delete_expired_files() TO service_role;

-- 5. ACCOUNT MANAGEMENT

-- Drop old functions to avoid confusion
DROP FUNCTION IF EXISTS public.delete_own_account();
DROP FUNCTION IF EXISTS public.delete_user_account();

-- New robust V2 function with fully qualified names
CREATE OR REPLACE FUNCTION public.delete_account_v2()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  current_user_id := auth.uid();
  
  -- Check if user exists/authenticated
  IF current_user_id IS NULL THEN
    RETURN json_build_object('status', 'error', 'message', 'Not authenticated');
  END IF;

  -- 1. Delete all storage objects owned by the user
  -- Using fully qualified 'storage.objects' to avoid search_path issues
  DELETE FROM storage.objects 
  WHERE owner = current_user_id;

  -- 2. Delete the user
  -- Using fully qualified 'auth.users'
  DELETE FROM auth.users WHERE id = current_user_id;
  
  RETURN json_build_object('status', 'success');
EXCEPTION WHEN OTHERS THEN
  -- Catch any other errors and return them
  RETURN json_build_object('status', 'error', 'message', SQLERRM);
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.delete_account_v2() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_v2() TO service_role;

-- 4. STORAGE SETUP

-- Insert bucket if not exists, OR UPDATE if it exists to ensure file_size_limit is high enough
-- We set the limit to 1GB (1073741824 bytes) to comfortably accommodate the 250MB requirement
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('gallery-files', 'gallery-files', true, 1073741824)
ON CONFLICT (id) DO UPDATE SET
file_size_limit = 1073741824;

-- FORCE CACHE RELOAD
NOTIFY pgrst, 'reload schema';

-- GRANT PERMISSIONS TO ANON ROLE
GRANT SELECT ON public.galleries TO anon;
GRANT SELECT ON public.files TO anon;
GRANT SELECT, INSERT, DELETE ON public.selections TO anon;
GRANT INSERT ON public.activity_logs TO anon;

-- GRANT PERMISSIONS TO AUTHENTICATED ROLE
GRANT ALL ON public.galleries TO authenticated;
GRANT ALL ON public.files TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.selections TO authenticated;
GRANT INSERT, SELECT ON public.activity_logs TO authenticated;

-- 6. TRIGGERS
-- Enforce maximum of 2 galleries per user
CREATE OR REPLACE FUNCTION check_gallery_limit()
RETURNS TRIGGER AS $$
DECLARE
  gallery_count INT;
BEGIN
  SELECT COUNT(*) INTO gallery_count FROM public.galleries WHERE photographer_id = NEW.photographer_id;
  IF gallery_count >= 2 THEN
    RAISE EXCEPTION 'Maximum limit of 2 galleries reached. Please delete an existing gallery first.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_gallery_limit ON public.galleries;
CREATE TRIGGER enforce_gallery_limit
BEFORE INSERT ON public.galleries
FOR EACH ROW EXECUTE FUNCTION check_gallery_limit();