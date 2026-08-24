import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function checkSupabase(): Promise<"connected" | "unreachable"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return "unreachable";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    // Supabase's built-in GoTrue health endpoint — schema-agnostic, so it
    // works before any tables exist.
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok ? "connected" : "unreachable";
  } catch {
    return "unreachable";
  }
}

// Always returns 200 so Coolify's container health check doesn't flap on a
// transient Supabase outage — the `supabase` field is diagnostic, not a
// liveness signal.
export async function GET() {
  const supabase = await checkSupabase();

  return NextResponse.json({
    status: "ok",
    supabase,
    timestamp: new Date().toISOString(),
  });
}
