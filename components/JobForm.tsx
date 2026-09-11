"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { isValidYoutubeUrl } from "@/lib/youtube";

type Mode = "tracks" | "video";

const CUT_MODES = [
  { value: "standard", label: "Standard", description: "Coupure exacte au timestamp" },
  { value: "smart", label: "Smart (recommandé)", description: "Détection du silence + fondu 0,4 s" },
  { value: "soft", label: "Doux", description: "Détection du silence + fondu 0,8 s" },
];

export default function JobForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("tracks");
  const [cutMode, setCutMode] = useState("smart");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isValidYoutubeUrl(url)) {
      setError("Colle un lien YouTube valide (youtube.com ou youtu.be).");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, type: mode, cut_mode: mode === "tracks" ? cutMode : undefined }),
    });

    if (!res.ok) {
      setSubmitting(false);
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Une erreur est survenue.");
      return;
    }

    const { id } = await res.json();
    router.push(`/job/${id}`);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card space-y-6">
      <div>
        <label htmlFor="url" className="block text-sm font-medium mb-1">
          Lien YouTube
        </label>
        <input
          id="url"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=..."
          className="input-field"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? "url-error" : "url-hint"}
          required
        />
        <p id="url-hint" className="text-xs text-[var(--color-muted)] mt-1">
          Fonctionne avec une vidéo unique ou une compilation avec chapitres/timestamps.
        </p>
      </div>

      <fieldset>
        <legend className="block text-sm font-medium mb-2">Que veux-tu obtenir ?</legend>
        <div className="grid sm:grid-cols-2 gap-3">
          <label
            className={`card cursor-pointer !p-4 ${mode === "tracks" ? "ring-2 ring-[var(--color-brand)]" : ""}`}
          >
            <input
              type="radio"
              name="mode"
              value="tracks"
              checked={mode === "tracks"}
              onChange={() => setMode("tracks")}
              className="sr-only"
            />
            <span className="block font-medium">Découper en pistes MP3</span>
            <span className="block text-sm text-[var(--color-muted)] mt-1">
              Détecte les morceaux (chapitres/description) et génère un MP3 taggé par piste.
            </span>
          </label>

          <label
            className={`card cursor-pointer !p-4 ${mode === "video" ? "ring-2 ring-[var(--color-brand)]" : ""}`}
          >
            <input
              type="radio"
              name="mode"
              value="video"
              checked={mode === "video"}
              onChange={() => setMode("video")}
              className="sr-only"
            />
            <span className="block font-medium">Télécharger la vidéo complète</span>
            <span className="block text-sm text-[var(--color-muted)] mt-1">
              Récupère le fichier MP4 tel quel, sans découpe.
            </span>
          </label>
        </div>
      </fieldset>

      {mode === "tracks" && (
        <div>
          <label htmlFor="cutMode" className="block text-sm font-medium mb-1">
            Mode de découpe
          </label>
          <select
            id="cutMode"
            className="input-field"
            value={cutMode}
            onChange={(e) => setCutMode(e.target.value)}
          >
            {CUT_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} — {m.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={submitting || !url}>
        {submitting ? "Lancement..." : "Lancer"}
      </button>
    </form>
  );
}
