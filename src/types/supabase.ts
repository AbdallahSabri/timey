export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      clients: {
        Row: {
          archived_at: string | null;
          company_id: string;
          id: string;
          name: string;
        };
        Insert: {
          archived_at?: string | null;
          company_id?: string;
          id?: string;
          name: string;
        };
        Update: {
          archived_at?: string | null;
          company_id?: string;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          created_at: string;
          id: string;
          max_timer_hours: number;
          name: string;
          timezone: string;
          week_starts_on: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          max_timer_hours?: number;
          name: string;
          timezone: string;
          week_starts_on?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          max_timer_hours?: number;
          name?: string;
          timezone?: string;
          week_starts_on?: number;
        };
        Relationships: [];
      };
      correction_requests: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["correction_kind"];
          proposed_ended_at: string | null;
          proposed_note: string | null;
          proposed_project_id: string | null;
          proposed_started_at: string | null;
          proposed_task_id: string | null;
          reason: string;
          requested_by: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["correction_status"];
          time_entry_id: string | null;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["correction_kind"];
          proposed_ended_at?: string | null;
          proposed_note?: string | null;
          proposed_project_id?: string | null;
          proposed_started_at?: string | null;
          proposed_task_id?: string | null;
          reason: string;
          requested_by?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["correction_status"];
          time_entry_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["correction_kind"];
          proposed_ended_at?: string | null;
          proposed_note?: string | null;
          proposed_project_id?: string | null;
          proposed_started_at?: string | null;
          proposed_task_id?: string | null;
          reason?: string;
          requested_by?: string;
          review_note?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: Database["public"]["Enums"]["correction_status"];
          time_entry_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "correction_requests_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "correction_requests_requested_by_company_id_fkey";
            columns: ["requested_by", "company_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "correction_requests_reviewed_by_company_id_fkey";
            columns: ["reviewed_by", "company_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          company_id: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string;
          role: Database["public"]["Enums"]["user_role"];
          token_hash: string;
        };
        Insert: {
          accepted_at?: string | null;
          company_id: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by: string;
          role?: Database["public"]["Enums"]["user_role"];
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          company_id?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string;
          role?: Database["public"]["Enums"]["user_role"];
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          company_id: string | null;
          created_at: string;
          full_name: string;
          id: string;
          role: Database["public"]["Enums"]["user_role"];
          status: Database["public"]["Enums"]["member_status"];
        };
        Insert: {
          company_id?: string | null;
          created_at?: string;
          full_name: string;
          id: string;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["member_status"];
        };
        Update: {
          company_id?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["member_status"];
        };
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          added_at: string;
          company_id: string;
          expected_daily_seconds: number;
          project_id: string;
          user_id: string;
          working_days: number[];
        };
        Insert: {
          added_at?: string;
          company_id?: string;
          expected_daily_seconds?: number;
          project_id: string;
          user_id: string;
          working_days?: number[];
        };
        Update: {
          added_at?: string;
          company_id?: string;
          expected_daily_seconds?: number;
          project_id?: string;
          user_id?: string;
          working_days?: number[];
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_company_id_fkey";
            columns: ["project_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "project_members_user_id_company_id_fkey";
            columns: ["user_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      projects: {
        Row: {
          archived_at: string | null;
          client_id: string | null;
          company_id: string;
          description: string | null;
          id: string;
          name: string;
        };
        Insert: {
          archived_at?: string | null;
          client_id?: string | null;
          company_id?: string;
          description?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          archived_at?: string | null;
          client_id?: string | null;
          company_id?: string;
          description?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projects_client_id_company_id_fkey";
            columns: ["client_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "projects_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          archived_at: string | null;
          company_id: string;
          id: string;
          name: string;
          project_id: string;
        };
        Insert: {
          archived_at?: string | null;
          company_id?: string;
          id?: string;
          name: string;
          project_id: string;
        };
        Update: {
          archived_at?: string | null;
          company_id?: string;
          id?: string;
          name?: string;
          project_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_project_id_company_id_fkey";
            columns: ["project_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      time_entries: {
        Row: {
          company_id: string;
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          note: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at: string;
          task_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          note?: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at?: string;
          task_id: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          note?: string | null;
          project_id?: string;
          source?: Database["public"]["Enums"]["entry_source"];
          started_at?: string;
          task_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_entries_project_id_company_id_fkey";
            columns: ["project_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "time_entries_task_id_project_id_fkey";
            columns: ["task_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id", "project_id"];
          },
          {
            foreignKeyName: "time_entries_user_id_company_id_fkey";
            columns: ["user_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      time_entry_revisions: {
        Row: {
          changed_at: string;
          changed_by: string;
          company_id: string;
          correction_request_id: string | null;
          id: string;
          prior_ended_at: string | null;
          prior_note: string | null;
          prior_project_id: string | null;
          prior_started_at: string | null;
          prior_task_id: string | null;
          time_entry_id: string;
        };
        Insert: {
          changed_at?: string;
          changed_by: string;
          company_id: string;
          correction_request_id?: string | null;
          id?: string;
          prior_ended_at?: string | null;
          prior_note?: string | null;
          prior_project_id?: string | null;
          prior_started_at?: string | null;
          prior_task_id?: string | null;
          time_entry_id: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string;
          company_id?: string;
          correction_request_id?: string | null;
          id?: string;
          prior_ended_at?: string | null;
          prior_note?: string | null;
          prior_project_id?: string | null;
          prior_started_at?: string | null;
          prior_task_id?: string | null;
          time_entry_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_entry_revisions_changed_by_company_id_fkey";
            columns: ["changed_by", "company_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "time_entry_revisions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entry_revisions_request_id_company_id_fkey";
            columns: ["correction_request_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "correction_requests";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string };
      admin_create_entry: {
        Args: {
          p_ended_at: string;
          p_note?: string;
          p_project_id: string;
          p_started_at: string;
          p_task_id: string;
          p_user_id: string;
        };
        Returns: {
          company_id: string;
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          note: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at: string;
          task_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "time_entries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      admin_delete_entry: {
        Args: { p_entry_id: string };
        Returns: {
          company_id: string;
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          note: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at: string;
          task_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "time_entries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      admin_edit_entry: {
        Args: {
          p_ended_at?: string;
          p_entry_id: string;
          p_note?: string;
          p_project_id?: string;
          p_started_at?: string;
          p_task_id?: string;
        };
        Returns: {
          company_id: string;
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          note: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at: string;
          task_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "time_entries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_entry_change: {
        Args: {
          p_changed_by: string;
          p_ended_at: string;
          p_entry_id: string;
          p_note: string;
          p_project_id: string;
          p_request_id: string;
          p_started_at: string;
          p_task_id: string;
        };
        Returns: {
          company_id: string;
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          note: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at: string;
          task_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "time_entries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_entry_create: {
        Args: {
          p_changed_by: string;
          p_ended_at: string;
          p_note: string;
          p_project_id: string;
          p_request_id: string;
          p_started_at: string;
          p_task_id: string;
          p_user_id: string;
        };
        Returns: {
          company_id: string;
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          note: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at: string;
          task_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "time_entries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      apply_entry_delete: {
        Args: {
          p_changed_by: string;
          p_entry_id: string;
          p_request_id: string;
        };
        Returns: {
          company_id: string;
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          note: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at: string;
          task_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "time_entries";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      approve_correction: {
        Args: { p_request_id: string };
        Returns: {
          company_id: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["correction_kind"];
          proposed_ended_at: string | null;
          proposed_note: string | null;
          proposed_project_id: string | null;
          proposed_started_at: string | null;
          proposed_task_id: string | null;
          reason: string;
          requested_by: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["correction_status"];
          time_entry_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "correction_requests";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      assert_entry_window_valid: {
        Args: {
          p_ended_at: string;
          p_exclude_entry_id: string;
          p_started_at: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      assert_project_membership: {
        Args: { p_project_id: string; p_user_id: string };
        Returns: undefined;
      };
      create_company: {
        Args: {
          p_max_timer_hours?: number;
          p_name: string;
          p_timezone?: string;
          p_week_starts_on?: number;
        };
        Returns: string;
      };
      current_company_id: { Args: never; Returns: string };
      email_is_company_member: { Args: { p_email: string }; Returns: boolean };
      hash_invitation_token: { Args: { p_token: string }; Returns: string };
      invitation_preview: {
        Args: { p_token: string };
        Returns: {
          accepted: boolean;
          company_name: string;
          email: string;
          expired: boolean;
          expires_at: string;
          role: Database["public"]["Enums"]["user_role"];
        }[];
      };
      is_admin: { Args: never; Returns: boolean };
      is_project_member: { Args: { p_project_id: string }; Returns: boolean };
      pending_invitation_for_me: {
        Args: never;
        Returns: {
          company_name: string;
          expires_at: string;
          role: Database["public"]["Enums"]["user_role"];
        }[];
      };
      record_entry_revision: {
        Args: {
          p_changed_by: string;
          p_company_id: string;
          p_prior_ended_at: string;
          p_prior_note: string;
          p_prior_project_id: string;
          p_prior_started_at: string;
          p_prior_task_id: string;
          p_request_id: string;
          p_time_entry_id: string;
        };
        Returns: undefined;
      };
      reject_correction: {
        Args: { p_request_id: string; p_review_note: string };
        Returns: {
          company_id: string;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["correction_kind"];
          proposed_ended_at: string | null;
          proposed_note: string | null;
          proposed_project_id: string | null;
          proposed_started_at: string | null;
          proposed_task_id: string | null;
          reason: string;
          requested_by: string;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: Database["public"]["Enums"]["correction_status"];
          time_entry_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "correction_requests";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      report_by_client: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_task_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          client_id: string;
          client_name: string;
          entry_count: number;
          total_seconds: number;
        }[];
      };
      report_by_day: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_task_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          day: string;
          entry_count: number;
          total_seconds: number;
        }[];
      };
      report_by_project: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_task_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          client_id: string;
          client_name: string;
          entry_count: number;
          project_id: string;
          project_name: string;
          total_seconds: number;
        }[];
      };
      report_by_task: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_task_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          entry_count: number;
          project_id: string;
          project_name: string;
          task_id: string;
          task_name: string;
          total_seconds: number;
        }[];
      };
      report_by_user: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_task_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          entry_count: number;
          total_seconds: number;
          user_id: string;
          user_name: string;
        }[];
      };
      report_by_user_project: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_task_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          client_id: string;
          client_name: string;
          entry_count: number;
          project_id: string;
          project_name: string;
          total_seconds: number;
          user_id: string;
          user_name: string;
        }[];
      };
      report_entries: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_limit?: number;
          p_offset?: number;
          p_project_id?: string;
          p_task_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          client_id: string;
          client_name: string;
          day: string;
          duration_seconds: number;
          entry_id: string;
          local_ended_at: string;
          local_started_at: string;
          note: string;
          project_id: string;
          project_name: string;
          source: Database["public"]["Enums"]["entry_source"];
          task_id: string;
          task_name: string;
          total_count: number;
          user_id: string;
          user_name: string;
        }[];
      };
      report_expected_by_user: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          expected_seconds: number;
          user_id: string;
          user_name: string;
        }[];
      };
      report_expected_by_user_project: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          client_id: string;
          client_name: string;
          expected_seconds: number;
          project_id: string;
          project_name: string;
          user_id: string;
          user_name: string;
        }[];
      };
      report_summary: {
        Args: {
          p_client_id?: string;
          p_from: string;
          p_project_id?: string;
          p_task_id?: string;
          p_to: string;
          p_user_id?: string;
        };
        Returns: {
          entry_count: number;
          running_count: number;
          total_seconds: number;
        }[];
      };
      stop_timer: {
        Args: { p_id: string };
        Returns: {
          company_id: string;
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          note: string | null;
          project_id: string;
          source: Database["public"]["Enums"]["entry_source"];
          started_at: string;
          task_id: string;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "time_entries";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
    };
    Enums: {
      correction_kind: "create" | "amend" | "delete";
      correction_status: "pending" | "approved" | "rejected" | "withdrawn";
      entry_source: "timer" | "manual";
      member_status: "active" | "inactive";
      user_role: "admin" | "employee";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      correction_kind: ["create", "amend", "delete"],
      correction_status: ["pending", "approved", "rejected", "withdrawn"],
      entry_source: ["timer", "manual"],
      member_status: ["active", "inactive"],
      user_role: ["admin", "employee"],
    },
  },
} as const;
