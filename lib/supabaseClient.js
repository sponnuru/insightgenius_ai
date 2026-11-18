import { createClient } from '@supabase/supabase-js';

// Browser client. These two values are safe to expose: Row Level Security
// in supabase/schema.sql ensures each member can only touch their own rows.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
