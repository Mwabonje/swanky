const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

const check = async () => {
  const { data } = await supabase.from('galleries').select('*');
  console.log('Galleries:', data);
  const { data: files } = await supabase.from('files').select('*');
  console.log('Files:', files);
}
check();
