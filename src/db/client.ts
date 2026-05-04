// Supabase client singleton (lazy init)

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
    }
    client = createClient(url, key, {
      auth: { persistSession: false },
      realtime: { transport: ws as any },
    });
  }
  return client;
}
