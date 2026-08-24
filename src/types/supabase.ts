/**
 * Placeholder — no tables yet. Once you have a real Supabase project linked
 * and have run your first migration, regenerate this file against it:
 *
 *   pnpm dlx supabase gen types typescript --project-id <project-id> \
 *     > src/types/supabase.ts
 *
 * See README.md "Swap the Supabase project" for the full workflow.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
