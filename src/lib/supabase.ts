import { createClient } from '@supabase/supabase-js';

const DEFAULT_SUPABASE_URL = 'https://jijjtwmobfzkwzkozjyb.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imppamp0d21vYmZ6a3d6a296anliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MzI5MzUsImV4cCI6MjEwMzAwODkzNX0.uPb8rJXJVtEohNggAcwINsiB3VKLO8OKNNM4rX2UO7s';

const envUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseUrl =
  envUrl && envUrl.startsWith('http') && !envUrl.includes('your-project.supabase.co')
    ? envUrl.replace(/\/+$/, '')
    : DEFAULT_SUPABASE_URL;

export const supabaseAnonKey =
  envAnonKey && envAnonKey !== 'your-supabase-anon-key'
    ? envAnonKey
    : DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
