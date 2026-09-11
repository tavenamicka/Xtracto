import logging
import os
import time
import traceback
from threading import Lock

import psycopg
from psycopg.rows import dict_row

from engine.extractor import ExtractorError, download_full_video, extract_tracks

DATABASE_URL = os.environ["DATABASE_URL"]
OUTPUT_ROOT = os.environ.get("OUTPUT_ROOT", "./output")
POLL_INTERVAL_SEC = 3
RECONNECT_MAX_BACKOFF_SEC = 60
ORPHAN_MESSAGE = "Interrompu par un redémarrage du service — relance le job."

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("xtracto-worker")

JOB_HANDLERS = {
    "tracks": lambda url, out_dir, params, progress: extract_tracks(
        url, out_dir, cut_mode=params.get("cut_mode", "smart"), progress=progress
    ),
    "video": lambda url, out_dir, params, progress: download_full_video(url, out_dir, progress=progress),
}


def _update_job(conn, lock: Lock, job_id, **fields) -> None:
    # `fields` ne doit contenir que des noms de colonnes littéraux fixés par
    # les appelants ci-dessous (jamais une clé venant de l'extérieur) : la
    # construction de SET ci-dessous n'est donc pas une surface d'injection.
    set_clause = ", ".join(f"{column} = %s" for column in fields)
    values = [*fields.values(), job_id]
    with lock, conn.cursor() as cur:
        cur.execute(f"UPDATE jobs SET {set_clause}, updated_at = now() WHERE id = %s", values)
        conn.commit()


def fetch_next_job(conn):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            UPDATE jobs SET status = 'processing', updated_at = now()
            WHERE id = (
                SELECT id FROM jobs
                WHERE status = 'pending'
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id, type, params
            """
        )
        job = cur.fetchone()
        conn.commit()
        return job


def recover_orphaned_jobs(conn) -> None:
    """À exécuter une fois au démarrage : un job resté 'processing' signifie
    que le worker précédent a été tué en cours de traitement (redéploiement,
    crash). Il ne sera plus jamais repris (fetch_next_job ne prend que les
    'pending') donc son statut resterait bloqué indéfiniment côté UI sans ça.
    """
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE jobs SET status = 'error', error = %s, updated_at = now() WHERE status = 'processing'",
            (ORPHAN_MESSAGE,),
        )
        recovered = cur.rowcount
        conn.commit()
    if recovered:
        log.warning("%d job(s) orphelin(s) marqué(s) en erreur au démarrage", recovered)


def make_progress_fn(conn, lock: Lock, job_id):
    def progress(step: str, percent: int | None = None) -> None:
        _update_job(conn, lock, job_id, step_label=step, progress=percent)

    return progress


def run_job(conn, job) -> None:
    job_id, job_type, params = job["id"], job["type"], job["params"]
    out_dir = os.path.join(OUTPUT_ROOT, str(job_id))
    # Un job peut découper ses pistes en parallèle (voir extractor.py) : la
    # connexion psycopg n'est pas thread-safe, ce verrou sérialise tous les
    # accès DB faits par les threads de traitement de CE job.
    db_lock = Lock()
    progress = make_progress_fn(conn, db_lock, job_id)

    handler = JOB_HANDLERS.get(job_type)
    if handler is None:
        _update_job(conn, db_lock, job_id, status="error", error=f"Type de job inconnu : {job_type}")
        return

    try:
        result = handler(params["url"], out_dir, params, progress)
        _update_job(conn, db_lock, job_id, status="done", progress=100, result=psycopg.types.json.Json(result))
    except ExtractorError as e:
        conn.rollback()  # remet la transaction dans un état propre si l'échec vient d'une requête DB
        _update_job(conn, db_lock, job_id, status="error", error=str(e))
    except Exception:
        conn.rollback()
        _update_job(conn, db_lock, job_id, status="error", error="Erreur interne inattendue.")
        traceback.print_exc()


def poll_loop(conn) -> None:
    recover_orphaned_jobs(conn)
    while True:
        job = fetch_next_job(conn)
        if job is None:
            time.sleep(POLL_INTERVAL_SEC)
            continue
        log.info("job %s (%s) démarré", job["id"], job["type"])
        run_job(conn, job)
        log.info("job %s terminé", job["id"])


def main() -> None:
    os.makedirs(OUTPUT_ROOT, exist_ok=True)
    log.info("Xtracto worker démarré, en attente de jobs...")

    backoff = 1
    while True:
        try:
            with psycopg.connect(DATABASE_URL, autocommit=False) as conn:
                backoff = 1
                poll_loop(conn)
        except psycopg.OperationalError:
            log.exception("Connexion à la base perdue, nouvelle tentative dans %ss", backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, RECONNECT_MAX_BACKOFF_SEC)


if __name__ == "__main__":
    main()
