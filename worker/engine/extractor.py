import glob
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from threading import Lock
from typing import Callable, Optional

import numpy as np
import yt_dlp
from PIL import Image, ImageStat
from scipy.io import wavfile

ProgressFn = Callable[[str, Optional[int]], None]
AudioData = tuple[int, np.ndarray]  # (sample_rate, mono normalized samples in [-1, 1])

# Extraction de frame de pochette : tentatives successives si l'image est trop sombre.
FRAME_MAX_ATTEMPTS = 5
FRAME_BRIGHTNESS_THRESHOLD = 30
FRAME_INITIAL_OFFSET_SEC = 10
FRAME_RETRY_STEP_SEC = 15

# Détection de silence pour la découpe intelligente.
SILENCE_BLOCK_SEC = 0.05
SILENCE_SEARCH_WINDOW_SEC = 3.0
SILENCE_MAX_CORRECTION_SEC = 2.0

MP3_BITRATE = "320k"

# Nombre de découpes ffmpeg menées en parallèle par job. Volontairement bas :
# le ThinkStation cible est un petit serveur perso qui héberge d'autres
# services en même temps (Postgres, Nginx, Gitea...) — chaque ffmpeg utilise
# déjà plusieurs threads internes pour l'encodage.
MAX_PARALLEL_CUTS = 2

# Garde-fou disque : le service est exposé publiquement, une URL renvoyant
# une vidéo énorme ne doit pas pouvoir remplir le volume de sortie partagé.
# L'API Python de yt-dlp attend un nombre d'octets brut (contrairement au
# flag CLI --max-filesize, qui accepte "3G" et le convertit lui-même).
MAX_DOWNLOAD_SIZE_BYTES = 3 * 1024 ** 3


class ExtractorError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Chapter:
    index: int
    titre: str
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def _noop_progress(step: str, percent: Optional[int] = None) -> None:
    pass


def _validate_url(url: str) -> None:
    if not url or not url.strip().lower().startswith(("http://", "https://")):
        raise ExtractorError("URL invalide.")


def sanitize_filename(name: str) -> str:
    return re.sub(r'[\\/*?:"<>|]', "", name).strip()


def format_time(seconds: float) -> str:
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}" if h > 0 else f"{m:02d}:{s:02d}"


def get_brightness(image_path: str) -> float:
    # ImageStat calcule la moyenne côté C (histogramme) — construire une liste
    # Python de plusieurs millions de pixels par appel serait bien plus lent
    # et alloue inutilement pour une simple moyenne.
    try:
        with Image.open(image_path) as img:
            return ImageStat.Stat(img.convert("L")).mean[0]
    except Exception:
        return 0.0


def _run_ffmpeg(args: list[str]) -> bool:
    result = subprocess.run(["ffmpeg", "-y", *args], capture_output=True)
    return result.returncode == 0


def extract_frame_from_video(video_path: str, timestamp: float, output_dir: str,
                              track_index: int, offset: float = FRAME_INITIAL_OFFSET_SEC) -> Optional[str]:
    jpg_path = os.path.join(output_dir, f"cover_{track_index:02d}.jpg")
    current_offset = offset

    for _ in range(FRAME_MAX_ATTEMPTS):
        seek_time = timestamp + current_offset
        _run_ffmpeg(["-ss", str(seek_time), "-i", video_path, "-frames:v", "1", "-q:v", "2", jpg_path])

        if os.path.exists(jpg_path):
            if get_brightness(jpg_path) > FRAME_BRIGHTNESS_THRESHOLD:
                return jpg_path
            current_offset += FRAME_RETRY_STEP_SEC

    return jpg_path if os.path.exists(jpg_path) else None


def get_video_info(url: str) -> dict:
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise ExtractorError(f"Impossible de lire cette URL YouTube : {e}") from e
    except Exception as e:
        raise ExtractorError(f"Erreur inattendue lors de l'analyse de la vidéo : {e}") from e


def parse_chapters(info: dict) -> list[Chapter]:
    chapters = info.get("chapters") or []
    return [
        Chapter(
            index=i + 1,
            titre=ch.get("title", f"Piste {i + 1}"),
            start=ch.get("start_time", 0),
            end=ch.get("end_time", 0),
        )
        for i, ch in enumerate(chapters)
    ]


_DESC_PATTERN = re.compile(
    r"^[\[\(]?(\d{1,2}):(\d{2})(?::(\d{2}))?[\]\)]?\s*[-–—|.]?\s*(.+)$"
)
_DESC_NOISE_PATTERN = re.compile(r"\s*\(.*?(lyrics|official|video|hd|hq).*?\)", re.IGNORECASE)


def parse_description(description: str, duration: float) -> list[Chapter]:
    matches = []
    for line in description.splitlines():
        line = line.strip()
        if not line:
            continue
        m = _DESC_PATTERN.match(line)
        if not m:
            continue
        h = int(m.group(3) or 0)
        mins = int(m.group(1))
        secs = int(m.group(2))
        titre = _DESC_NOISE_PATTERN.sub("", m.group(4).strip()).strip()
        titre = re.sub(r"\s{2,}", " ", titre)
        matches.append((h * 3600 + mins * 60 + secs, titre))

    if not matches:
        return []

    unique = list(dict.fromkeys(matches))  # dédoublonne en préservant l'ordre
    unique.sort(key=lambda m: m[0])

    chapters = []
    for i, (start, titre) in enumerate(unique):
        end = unique[i + 1][0] if i + 1 < len(unique) else duration
        if end <= start:
            continue
        chapters.append(Chapter(index=i + 1, titre=titre, start=start, end=end))
    return chapters


def download_source(url: str, output_base: str) -> None:
    opts = {
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "outtmpl": output_base + ".%(ext)s",
        "merge_output_format": "mp4",
        "max_filesize": MAX_DOWNLOAD_SIZE_BYTES,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])


def find_file(base_path: str, extensions: list[str]) -> Optional[str]:
    for ext in extensions:
        path = base_path + "." + ext
        if os.path.exists(path):
            return path
    folder, base = os.path.dirname(base_path), os.path.basename(base_path)
    for f in os.listdir(folder):
        name, ext = os.path.splitext(f)
        if name.startswith(base) and ext.lstrip(".") in extensions:
            return os.path.join(folder, f)
    return None


def extract_wav_from_video(video_path: str, wav_path: str) -> bool:
    return _run_ffmpeg(["-i", video_path, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", wav_path])


def _load_normalized_audio(wav_path: str) -> Optional[AudioData]:
    try:
        sr, audio = wavfile.read(wav_path)
        if audio.ndim == 2:
            audio = audio.mean(axis=1)
        audio = audio.astype(np.float32)
        max_val = np.abs(audio).max()
        if max_val > 0:
            audio = audio / max_val
        return sr, audio
    except Exception:
        return None


def find_best_cut_point(audio_data: AudioData, target_sec: float,
                         search_window: float = SILENCE_SEARCH_WINDOW_SEC) -> float:
    sr, audio = audio_data
    center = int(target_sec * sr)
    half_window = int(search_window * sr)
    start_idx = max(0, center - half_window)
    end_idx = min(len(audio), center + half_window)
    segment = audio[start_idx:end_idx]

    block_size = int(sr * SILENCE_BLOCK_SEC)
    n_blocks = len(segment) // block_size
    if n_blocks == 0:
        return target_sec

    # RMS par bloc de 50ms, vectorisé (reshape + moyenne numpy) au lieu d'une
    # boucle Python — sensible sur une fenêtre de recherche de plusieurs
    # secondes appelée deux fois par piste.
    blocks = segment[: n_blocks * block_size].reshape(n_blocks, block_size)
    rms = np.sqrt(np.mean(blocks ** 2, axis=1))
    quietest_idx = int(np.argmin(rms)) * block_size

    best_cut = (start_idx + quietest_idx) / sr
    return target_sec if abs(best_cut - target_sec) > SILENCE_MAX_CORRECTION_SEC else best_cut


def apply_crossfade(mp3_path: str, fade_duration: float = 0.4) -> None:
    tmp_path = mp3_path + ".fade.mp3"
    ok = _run_ffmpeg([
        "-i", mp3_path,
        "-af", f"afade=t=in:st=0:d={fade_duration},afade=t=out:st=-{fade_duration}:d={fade_duration}",
        "-codec:a", "libmp3lame", "-b:a", MP3_BITRATE, "-id3v2_version", "3",
        tmp_path,
    ])
    if ok and os.path.exists(tmp_path):
        os.replace(tmp_path, mp3_path)
    elif os.path.exists(tmp_path):
        os.remove(tmp_path)


def cut_track(video_path: str, chapter: Chapter, output_dir: str, cover_jpg: Optional[str],
              uploader: str, album: str, audio_data: Optional[AudioData] = None,
              use_smart_cut: bool = True, fade_duration: float = 0.4) -> Optional[str]:
    titre_safe = sanitize_filename(chapter.titre)
    mp3_path = os.path.join(output_dir, f"{chapter.index:02d} - {titre_safe}.mp3")

    start, end = chapter.start, chapter.end
    if use_smart_cut and audio_data is not None:
        # Le tout premier morceau ne corrige pas son point de départ (il n'y a
        # rien avant à respecter).
        if chapter.index > 1:
            start = find_best_cut_point(audio_data, chapter.start)
        end = find_best_cut_point(audio_data, chapter.end)
    duration = end - start

    # subprocess reçoit une liste d'arguments (pas shell=True) : aucun risque
    # d'injection même si le titre vient de la description YouTube.
    encoded = _run_ffmpeg([
        "-i", video_path,
        "-ss", str(start), "-t", str(duration),
        "-vn",
        "-codec:a", "libmp3lame", "-b:a", MP3_BITRATE,
        "-metadata", f"title={chapter.titre}",
        "-metadata", f"track={chapter.index}",
        "-metadata", f"artist={uploader}",
        "-metadata", f"album={album}",
        "-id3v2_version", "3",
        mp3_path,
    ])
    if not encoded:
        if os.path.exists(mp3_path):
            os.remove(mp3_path)
        return None

    if fade_duration > 0:
        apply_crossfade(mp3_path, fade_duration=fade_duration)

    if cover_jpg and os.path.exists(cover_jpg):
        mp3_tmp = mp3_path + ".tmp.mp3"
        ok = _run_ffmpeg([
            "-i", mp3_path, "-i", cover_jpg,
            "-map", "0:0", "-map", "1:0",
            "-codec", "copy", "-id3v2_version", "3",
            "-metadata:s:v", "title=Album cover",
            "-metadata:s:v", "comment=Cover (front)",
            mp3_tmp,
        ])
        if ok and os.path.exists(mp3_tmp):
            os.replace(mp3_tmp, mp3_path)
        elif os.path.exists(mp3_tmp):
            os.remove(mp3_tmp)

    return mp3_path


def download_single_mp3(url: str, output_dir: str) -> Optional[str]:
    os.makedirs(output_dir, exist_ok=True)
    opts = {
        "format": "bestaudio/best",
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"},
            {"key": "FFmpegMetadata", "add_metadata": True},
            {"key": "EmbedThumbnail"},
        ],
        "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
        "writethumbnail": True,
        "ignoreerrors": True,
        "sleep_interval": 2,
        "max_filesize": MAX_DOWNLOAD_SIZE_BYTES,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    matches = glob.glob(os.path.join(output_dir, "*.mp3"))
    return matches[0] if matches else None


CUT_MODES = {
    "standard": {"use_smart": False, "fade_duration": 0.0},
    "smart": {"use_smart": True, "fade_duration": 0.4},
    "soft": {"use_smart": True, "fade_duration": 0.8},
}


def _process_chapter(video_path: str, chapter: Chapter, output_dir: str, uploader: str,
                      titre_video: str, audio_data: Optional[AudioData],
                      use_smart: bool, fade_duration: float) -> Optional[dict]:
    cover = extract_frame_from_video(video_path, chapter.start, output_dir, chapter.index)
    mp3_path = cut_track(
        video_path, chapter, output_dir, cover, uploader, titre_video,
        audio_data=audio_data, use_smart_cut=use_smart, fade_duration=fade_duration,
    )
    if cover and os.path.exists(cover):
        os.remove(cover)
    if not mp3_path:
        return None
    return {
        "index": chapter.index,
        "titre": chapter.titre,
        "filename": os.path.basename(mp3_path),
        "duree": format_time(chapter.duration),
    }


def extract_tracks(url: str, output_dir: str, cut_mode: str = "smart",
                    progress: ProgressFn = _noop_progress) -> dict:
    """Point d'entrée worker : YouTube -> pistes MP3 taggées. Retourne les métadonnées du job."""
    _validate_url(url)
    mode = CUT_MODES.get(cut_mode, CUT_MODES["smart"])
    os.makedirs(output_dir, exist_ok=True)

    progress("Analyse de la vidéo", 5)
    info = get_video_info(url)
    titre_video = info.get("title", "Compilation")
    uploader = info.get("uploader", "Artiste inconnu")
    duration = info.get("duration", 0)
    description = info.get("description", "")

    progress("Détection des morceaux", 10)
    chapters = parse_chapters(info) or parse_description(description, duration)

    if not chapters:
        progress("Aucun découpage détecté — téléchargement en MP3 unique", 30)
        mp3_path = download_single_mp3(url, output_dir)
        if not mp3_path:
            raise ExtractorError("Le téléchargement audio a échoué.")
        progress("Terminé", 100)
        return {
            "titre": titre_video,
            "uploader": uploader,
            "tracks": [{"index": 1, "titre": titre_video, "filename": os.path.basename(mp3_path)}],
        }

    progress("Téléchargement de la vidéo source", 20)
    source_base = os.path.join(output_dir, "video_source")
    download_source(url, source_base)
    video_path = find_file(source_base, ["mp4", "mkv", "webm"])
    if not video_path:
        raise ExtractorError("Le fichier vidéo source est introuvable après téléchargement.")

    try:
        audio_data: Optional[AudioData] = None
        use_smart = mode["use_smart"]
        if use_smart:
            progress("Analyse des silences pour une découpe précise", 35)
            wav_path = os.path.join(output_dir, "audio_source.wav")
            if extract_wav_from_video(video_path, wav_path):
                # Le WAV n'est qu'une étape intermédiaire : on le charge une
                # seule fois en mémoire (au lieu de le relire du disque à
                # chaque piste comme avant) puis on le supprime aussitôt.
                audio_data = _load_normalized_audio(wav_path)
                os.remove(wav_path)
            use_smart = audio_data is not None

        total = len(chapters)
        completed = 0
        progress_lock = Lock()
        results: dict[int, dict] = {}

        with ThreadPoolExecutor(max_workers=min(MAX_PARALLEL_CUTS, total)) as executor:
            futures = {
                executor.submit(
                    _process_chapter, video_path, chapter, output_dir, uploader, titre_video,
                    audio_data, use_smart, mode["fade_duration"],
                ): chapter
                for chapter in chapters
            }
            for future in as_completed(futures):
                chapter = futures[future]
                track = future.result()
                if track:
                    results[chapter.index] = track
                with progress_lock:
                    completed += 1
                    pct = 40 + int(55 * completed / total)
                    progress(f"Découpe {completed:02d}/{total} — {chapter.titre}", pct)

        tracks = [results[i] for i in sorted(results)]
    finally:
        if os.path.exists(video_path):
            os.remove(video_path)

    progress("Terminé", 100)
    return {"titre": titre_video, "uploader": uploader, "tracks": tracks}


def download_full_video(url: str, output_dir: str,
                         progress: ProgressFn = _noop_progress) -> dict:
    """Point d'entrée worker : téléchargement simple de la vidéo complète (mp4), sans traitement."""
    _validate_url(url)
    os.makedirs(output_dir, exist_ok=True)

    progress("Analyse de la vidéo", 10)
    info = get_video_info(url)
    titre_video = info.get("title", "video")

    progress("Téléchargement de la vidéo", 30)
    base = os.path.join(output_dir, sanitize_filename(titre_video))
    opts = {
        "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "outtmpl": base + ".%(ext)s",
        "merge_output_format": "mp4",
        "max_filesize": MAX_DOWNLOAD_SIZE_BYTES,
        "quiet": True,
        "no_warnings": True,
    }

    def _hook(d):
        if d["status"] == "downloading" and d.get("total_bytes"):
            pct = 30 + int(65 * d["downloaded_bytes"] / d["total_bytes"])
            progress("Téléchargement de la vidéo", pct)

    opts["progress_hooks"] = [_hook]

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
    except yt_dlp.utils.DownloadError as e:
        raise ExtractorError(f"Le téléchargement a échoué : {e}") from e

    video_path = find_file(base, ["mp4", "mkv", "webm"])
    if not video_path:
        raise ExtractorError("Le fichier vidéo est introuvable après téléchargement.")

    progress("Terminé", 100)
    return {
        "titre": titre_video,
        "filename": os.path.basename(video_path),
        "taille_octets": os.path.getsize(video_path),
    }
