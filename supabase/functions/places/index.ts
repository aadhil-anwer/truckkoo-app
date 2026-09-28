/**
 * Entry point. Everything is in core.ts; this only reads the environment.
 * `GOOGLE_PLACES_KEY` is a Supabase secret. SUPABASE_URL and SUPABASE_ANON_KEY
 * are provided by the platform. There is deliberately no service-role key.
 */
import { handle } from './core.ts';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

Deno.serve((req) =>
  handle(req, {
    key: Deno.env.get('GOOGLE_PLACES_KEY') ?? '',
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    fetch,
  }),
);
