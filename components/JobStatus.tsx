"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Job, TracksResult, VideoResult } from "@/lib/db";
import { formatBytes } from "@/lib/format";

const POLL_INTERVAL_MS = 2500;

const STATUS_LABEL: Record<Job["status"], string> = {
  pending: "En attente",
  processing: "En cours",
  done: "Terminé",
  error: "Erreur",
};

export default function JobStatus({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data: Job = await res.json();
        if (cancelled) return;
        setJob(data);
        setFetchError(null);
        if (data.status === "pending" || data.status === "processing") {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) setFetchError("Impossible de récupérer le statut du job.");
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  if (fetchError) {
    return (
      <p role="alert" className="text-sm text-[var(--color-danger)]">
        {fetchError}
      </p>
    );
  }

  if (!job) {
    return <p className="text-sm text-[var(--color-muted)]">Chargement...</p>;
  }

  return (
    <div className="card space-y-5">
      <div className="flex items-center justify-between">
        <span className={`badge badge-${job.status}`}>{STATUS_LABEL[job.status]}</span>
        <span className="text-sm text-[var(--color-muted)]">{job.progress}%</span>
      </div>

      <div aria-live="polite" aria-atomic="true">
        <p className="text-sm font-medium mb-2">{job.step_label || "Initialisation..."}</p>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${job.progress}%` }} />
        </div>
      </div>

      {job.status === "error" && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {job.error || "Une erreur est survenue pendant le traitement."}
        </p>
      )}

      {job.status === "done" && job.type === "tracks" && (
        <TracksResultView jobId={jobId} result={job.result as TracksResult} />
      )}

      {job.status === "done" && job.type === "video" && (
        <VideoResultView jobId={jobId} result={job.result as VideoResult} />
      )}

      <Link href="/" className="btn-secondary inline-flex">
        Lancer un autre job
      </Link>
    </div>
  );
}

function TracksResultView({ jobId, result }: { jobId: string; result: TracksResult }) {
  if (!result?.tracks?.length) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-medium">
          {result.tracks.length} piste{result.tracks.length > 1 ? "s" : ""} — {result.titre}
        </h2>
        {result.tracks.length > 1 && (
          <a
            href={`/api/jobs/${jobId}/download-all`}
            className="btn-secondary text-sm !py-1.5 !px-3"
          >
            Tout télécharger (.zip)
          </a>
        )}
      </div>
      <ul className="divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-[var(--r-md)] overflow-hidden">
        {result.tracks.map((track) => (
          <li key={track.index} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm">
              {String(track.index).padStart(2, "0")}. {track.titre}
              {track.duree ? <span className="text-[var(--color-muted)]"> — {track.duree}</span> : null}
            </span>
            <a
              href={`/api/jobs/${jobId}/download?file=${encodeURIComponent(track.filename)}`}
              className="text-sm font-medium text-[var(--color-brand)] hover:underline"
            >
              Télécharger
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VideoResultView({ jobId, result }: { jobId: string; result: VideoResult }) {
  if (!result?.filename) return null;
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="font-medium">{result.titre}</p>
        <p className="text-sm text-[var(--color-muted)]">{formatBytes(result.taille_octets)}</p>
      </div>
      <a
        href={`/api/jobs/${jobId}/download?file=${encodeURIComponent(result.filename)}`}
        className="btn-primary"
      >
        Télécharger
      </a>
    </div>
  );
}
