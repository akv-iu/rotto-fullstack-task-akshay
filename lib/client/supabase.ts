import { createClient } from '@supabase/supabase-js';

// Browser client: the URL and the publishable key only (both public by design). Used for sign-in and the session token.
export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
