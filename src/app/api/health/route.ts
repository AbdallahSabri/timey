import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function checkSupabase(): Promise<"connected" | "unreachable"> {
  try {
    const supabase = await createClient();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const { error } = await supabase
      .from("todos")
      .select("id", { head: true, count: "exact" })
      .abortSignal(controller.signal);

    clearTimeout(timeout);
    return error ? "unreachable" : "connected";
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
