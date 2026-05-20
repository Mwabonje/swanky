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
  console.log("Checking schema...");
  const { data, error } = await supabase.from('files').select('id').limit(1);
  console.log("Error:", error);
}
test();
