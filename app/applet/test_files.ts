import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

let envPath = path.resolve(process.cwd(), '.env');
const envFile = fs.readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values.length) {
        env[key.trim()] = values.join('=').trim().replace(/(^"|"$)/g, '');
    }
});

const supabase = createClient(env['VITE_SUPABASE_URL']!, env['VITE_SUPABASE_ANON_KEY']!);

async function test() {
  const { data, error } = await supabase.from('files').select('id, file_path').limit(10);
  console.log('Error:', error);
  console.log('Files:', data?.length);
  
  const { data: gData } = await supabase.from('galleries').select('id, client_name').limit(2);
  console.log('Galleries:', gData);
}
test();
