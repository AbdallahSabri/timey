/**
 * Hand-authored placeholder matching `supabase/migrations/0001_create_todos.sql`.
 *
 * Once you have a real Supabase project linked, regenerate this file against
 * it and delete this comment block:
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
    Tables: {
      todos: {
        Row: {
          id: string;
          title: string;
          is_complete: boolean;
          inserted_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          is_complete?: boolean;
          inserted_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          is_complete?: boolean;
          inserted_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
