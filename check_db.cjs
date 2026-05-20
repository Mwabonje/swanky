const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
  console.log("Checking DB...");
  const { data: galleries, error } = await supabase.from('galleries').select('*').not('category', 'is', null);
  if (error) { console.log(error); return; }
  
  for (const g of galleries) {
    const { count } = await supabase.from('files').select('*', { count: 'exact', head: true }).eq('gallery_id', g.id);
    console.log(`Gallery: ${g.client_name}, Files: ${count}`);
  }
}

check();
