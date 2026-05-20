import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// read .env file directly since dotenv is not installed
const envFile = fs.readFileSync('.env', 'utf8');
const env: Record<string, string> = {};
for (const line of envFile.split('\n')) {
  if (line.includes('=')) {
    const [k, ...v] = line.split('=');
    env[k.trim()] = v.join('=').trim();
  }
}

const supabaseUrl = env['VITE_SUPABASE_URL'] || '';
const supabaseKey = env['VITE_SUPABASE_ANON_KEY'] || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function addColumns() {
  console.log("Checking if columns exist...");
  
  // We can't do direct DDL with anon key in Supabase typically.
  // Unless we have a function or we just do a quick insert test.
  const { data, error } = await supabase.from('files').select('title,description,print_size,material,price').limit(1);
  
  if (error) {
    console.error("Columns might not exist!", error.message);
  } else {
    console.log("Columns exist!");
  }
}

addColumns();
