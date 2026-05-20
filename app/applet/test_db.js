import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length) {
        env[key.trim()] = values.join('=').trim().replace(/(^"|"$)/g, '');
    }
});

const supabase = createClient(env['VITE_SUPABASE_URL'], env['VITE_SUPABASE_ANON_KEY']);
async function test() {
  const { data, error } = await supabase.from('files').select('id, expires_at');
  console.log("files length:", data?.length);
  if (data?.length > 0) console.log("sample file:", data[0]);
}
test();
