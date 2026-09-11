import * as archiver from "archiver";
import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { getJob, type TracksResult } from "@/lib/db";
import { outputDir } from "@/lib/paths";
import { contentDispositionHeader } from "@/lib/download";
import { sanitizeFilename } from "@/lib/sanitize";
import { isUuid } from "@/lib/validate";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Identifiant de job invalide." }, { status: 400 });
  }

  const job = await getJob(id);
  if (!job || job.status !== "done" || job.type !== "tracks") {
    return NextResponse.json({ error: "Zip indisponible." }, { status: 404 });
  }

  const result = job.result as TracksResult;
  const jobDir = outputDir(id);
  const files = (result.tracks || [])
    .map((track) => track.filename)
    .filter((filename) => existsSync(path.join(jobDir, filename)));

  if (files.length === 0) {
    return NextResponse.json({ error: "Aucun fichier à archiver." }, { status: 404 });
  }

  const archive = new archiver.ZipArchive({ zlib: { level: 6 } });
  // Sans ces écouteurs, un fichier manquant (supprimé entre le filtre
  // ci-dessus et la lecture réelle par archiver) est ignoré en silence :
  // le zip reste valide mais incomplet, sans aucune trace côté serveur.
  archive.on("warning", (err) => console.warn(`Zip job ${id} :`, err.message));
  archive.on("error", (err) => console.error(`Zip job ${id} :`, err.message));
  for (const filename of files) {
    archive.file(path.join(jobDir, filename), { name: filename });
  }
  archive.finalize();

  const stream = Readable.toWeb(archive) as ReadableStream;
  const zipName = `${sanitizeFilename(result.titre || "pistes")}.zip`;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDispositionHeader(zipName),
    },
  });
}
