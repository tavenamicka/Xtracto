import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/db";
import { isUuid } from "@/lib/validate";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Identifiant de job invalide." }, { status: 400 });
  }

  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job introuvable." }, { status: 404 });
  }

  return NextResponse.json(job);
}
