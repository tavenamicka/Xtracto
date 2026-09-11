FROM python:3.12-slim

# Sans ça, stdout est bufferisé par bloc (pas de TTY dans le conteneur) : les
# print()/logs n'apparaissent dans `docker logs` que par rafales décalées de
# plusieurs minutes par rapport au moment réel — gênant pour diagnostiquer un
# incident en prod (observé sur les logs xtracto-worker : plusieurs jobs
# "démarré"/"terminé" horodatés à la même microseconde après un redémarrage).
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# yt-dlp est volontairement hors de requirements.txt : YouTube change son
# player toutes les quelques semaines et une version figée finit par renvoyer
# "HTTP Error 403: Forbidden" au moment de tirer les flux (l'extraction des
# métadonnées, elle, continue de marcher — d'où un job qui échoue seulement à
# l'étape téléchargement). Avec un `yt-dlp>=...` dans requirements.txt, la
# couche pip restait en cache indéfiniment et `docker compose build` ne
# ramenait jamais de version plus récente. Ici, bumper YTDLP_RELEASE invalide
# cette couche-ci uniquement — les grosses deps (numpy/scipy) restent en cache.
ARG YTDLP_RELEASE=2026.8.19
RUN pip install --no-cache-dir "yt-dlp==${YTDLP_RELEASE}"

# Runtime JS utilisé par yt-dlp pour résoudre les challenges du player
# YouTube. Sans lui il retombe sur des clients de secours (android_vr) dont
# les formats sont incomplets, et l'extraction sans runtime est officiellement
# dépréciée. Binaire statique unique, repris de l'image officielle deno.
COPY --from=denoland/deno:bin-2.9.5 /deno /usr/local/bin/deno

COPY engine/ ./engine/
COPY worker.py .

RUN useradd -u 1001 -m worker
USER 1001

CMD ["python", "worker.py"]
