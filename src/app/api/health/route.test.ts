import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

describe("GET /api/health", () => {
  const originalUrl = process.env[URL_VAR];
  const originalKey = process.env[KEY_VAR];

  beforeEach(() => {
    process.env[URL_VAR] = "https://project.supabase.co";
    process.env[KEY_VAR] = "anon-key";
  });

  afterEach(() => {
    process.env[URL_VAR] = originalUrl;
    process.env[KEY_VAR] = originalKey;
    vi.unstubAllGlobals();
  });

  // The container health check must never flap on a Supabase outage — the
  // `supabase` field is diagnostic, the 200 is the liveness signal.
  it("returns 200 even when Supabase is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      supabase: "unreachable",
    });
  });

  it("reports connected when Supabase answers ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      supabase: "connected",
    });
  });

  it("reports unreachable when Supabase answers non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      supabase: "unreachable",
    });
  });

  // A freshly forked template has no Supabase project yet; the route must
  // answer without attempting a request to `undefined`.
  it("reports unreachable without calling fetch when env vars are missing", async () => {
    delete process.env[URL_VAR];
    delete process.env[KEY_VAR];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      supabase: "unreachable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the anon key as the apikey header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await GET();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/health",
      expect.objectContaining({ headers: { apikey: "anon-key" } }),
    );
  });
});
