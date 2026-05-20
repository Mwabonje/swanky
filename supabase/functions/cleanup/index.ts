// This file is intended to be deployed to Supabase Edge Functions
// Command: supabase functions deploy cleanup
// Schedule: Use pg_cron or an external cron service to call this URL every hour.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export async function serve(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Find expired files
    const now = new Date().toISOString();
    const { data: expiredFiles, error: fetchError } = await supabaseClient
      .from('files')
      .select('id, file_path')
      .lt('expires_at', now)

    if (fetchError) throw fetchError;

    if (!expiredFiles || expiredFiles.length === 0) {
      return new Response(JSON.stringify({ message: 'No expired files found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    console.log(`Found ${expiredFiles.length} expired files. Deleting...`);

    // 2. Delete from Storage
    const pathsToRemove = expiredFiles.map(f => f.file_path);
    const { error: storageError } = await supabaseClient
      .storage
      .from('gallery-files')
      .remove(pathsToRemove);

    if (storageError) throw storageError;

    // 3. Delete from Database
    const idsToRemove = expiredFiles.map(f => f.id);
    const { error: dbError } = await supabaseClient
      .from('files')
      .delete()
      .in('id', idsToRemove);

    if (dbError) throw dbError;

    return new Response(
      JSON.stringify({ 
        success: true, 
        deleted_count: expiredFiles.length,
        files: pathsToRemove 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
}