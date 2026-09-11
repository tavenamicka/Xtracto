import { NextRequest, NextResponse } from "next/server";
import { createJob } from "@/lib/db";
import { isValidYoutubeUrl } from "@/lib/youtube";

const VALID_TYPES = new Set(["tracks", "video"]);
const VALID_CUT_MODES = new Set(["standard", "smart", "soft"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body.url !== "string" || !isValidYoutubeUrl(body.url)) {
    return NextResponse.json({ error: "URL YouTube invalide." }, { status: 400 });
  }
  if (!VALID_TYPES.has(body.type)) {
    return NextResponse.json({ error: "Type de job invalide." }, { status: 400 });
  }
  if (body.type === "tracks" && body.cut_mode && !VALID_CUT_MODES.has(body.cut_mode)) {
    return NextResponse.json({ error: "Mode de découpe invalide." }, { status: 400 });
  }

  const params: { url: string; cut_mode?: string } = { url: body.url.trim() };
  if (body.type === "tracks") {
    params.cut_mode = body.cut_mode || "smart";
  }

  const id = await createJob(body.type, params);
  return NextResponse.json({ id }, { status: 201 });
}
