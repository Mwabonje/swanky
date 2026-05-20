import { createClient } from '@supabase/supabase-js';

// Safe environment variable retrieval with fallback to provided credentials
const getEnv = (key: string, viteKey: string, fallback: string) => {
  let value = fallback;
  
  // Try process.env first
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    value = process.env[key]!;
  }

  // Try import.meta.env (Vite)
  try {
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[viteKey]) {
      // @ts-ignore
      value = import.meta.env[viteKey];
    }
  } catch (e) {
    // ignore
  }

  return value;
};

// Use provided credentials as default fallback
export const supabaseUrl = getEnv('REACT_APP_SUPABASE_URL', 'VITE_SUPABASE_URL', 'https://bdaqtpyzqutelkdgcoex.supabase.co');
export const supabaseKey = getEnv('REACT_APP_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'sb_publishable_aQY9i_vVRwG-CEWB2Nz4lQ_GwtLYqib');

// Disable demo mode
export const isDemoMode = false;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export const getPublicUrl = (path: string) => {
  const { data } = supabase.storage.from('gallery-files').getPublicUrl(path);
  return data.publicUrl;
};