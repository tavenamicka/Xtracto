import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync, createReadStream } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { getJob } from "@/lib/db";
import { outputDir } from "@/lib/paths";
import { contentDispositionHeader } from "@/lib/download";
import { isUuid } from "@/lib/validate";

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Identifiant de job invalide." }, { status: 400 });
  }

  const job = await getJob(id);
  if (!job || job.status !== "done") {
    return NextResponse.json({ error: "Fichier indisponible." }, { status: 404 });
  }

  const requested = req.nextUrl.searchParams.get("file");
  if (!requested || requested.includes("/") || requested.includes("\\") || requested.includes("..")) {
    return NextResponse.json({ error: "Fichier invalide." }, { status: 400 });
  }

  const jobDir = outputDir(id);
  const filePath = path.join(jobDir, requested);

  if (path.dirname(filePath) !== path.normalize(jobDir) || !existsSync(filePath)) {
    return NextResponse.json({ error: "Fichier introuvable." }, { status: 404 });
  }

  const stat = statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": contentDispositionHeader(requested),
    },
  });
}
