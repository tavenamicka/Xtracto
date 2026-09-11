import { Pool } from "pg";

declare global {
  var _xtractoPool: Pool | undefined;
}

export const pool =
  global._xtractoPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

// node-postgres émet un event "error" (asynchrone, hors de toute requête en
// cours) quand une connexion inactive du pool est coupée (redémarrage
// Postgres, coupure réseau...). Sans handler, Node traite ça comme une
// uncaughtException et tue tout le process — confirmé en le reproduisant :
// un simple redémarrage de la base suffit à faire planter toute l'appli.
pool.on("error", (err) => {
  console.error("Erreur pool Postgres (connexion inactive) :", err.message);
});

if (process.env.NODE_ENV !== "production") {
  global._xtractoPool = pool;
}

export type JobType = "tracks" | "video";
export type JobStatus = "pending" | "processing" | "done" | "error";

export interface TracksResult {
  titre: string;
  uploader: string;
  tracks: { index: number; titre: string; filename: string; duree?: string }[];
}

export interface VideoResult {
  titre: string;
  filename: string;
  taille_octets: number;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  step_label: string | null;
  params: { url: string; cut_mode?: string };
  result: TracksResult | VideoResult | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export async function createJob(type: JobType, params: Job["params"]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (type, params) VALUES ($1, $2) RETURNING id`,
    [type, params]
  );
  return rows[0].id;
}

export async function getJob(id: string): Promise<Job | null> {
  const { rows } = await pool.query<Job>(`SELECT * FROM jobs WHERE id = $1`, [id]);
  return rows[0] ?? null;
}
