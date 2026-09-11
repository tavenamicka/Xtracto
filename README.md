# Xtracto

Interface web qui extrait des pistes audio MP3 depuis une vidéo YouTube (découpées automatiquement par chapitre) ou télécharge la vidéo complète — colle un lien, choisis ce que tu veux récupérer.

## Fonctionnalités

- **Découpage en pistes MP3** : détecte les morceaux d'une vidéo/compilation via ses chapitres ou sa description, encode chaque piste en MP3 320k taggé (titre, pochette extraite automatiquement de la vidéo).
- **Vidéo complète** : télécharge le MP4 tel quel, sans découpe.
- **3 modes de découpe** : coupure exacte au timestamp, ou détection de silence avec fondu (court ou long) pour éviter de couper en plein son.
- **Suivi de progression en temps réel** via une file d'attente de jobs en base.
- **Accès protégé** par mot de passe partagé (pensé pour un usage personnel/petit groupe, pas de comptes multi-utilisateurs).

## Stack

| Composant | Techno |
|---|---|
| Frontend / API | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS |
| Traitement | Worker Python — [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg, numpy/scipy pour la détection de silence, Pillow pour la pochette |
| Base de données | PostgreSQL (file d'attente de jobs) |
| Déploiement | Docker Compose + Nginx en reverse proxy |

## Architecture

L'app Next.js crée un job (`tracks` ou `video`) dans la table `jobs` de Postgres. Le worker Python poll cette table, traite le job (téléchargement yt-dlp puis découpe ffmpeg), écrit les fichiers sur un volume de sortie partagé et met à jour la progression en base au fil de l'eau. L'app sert ensuite le téléchargement une fois le job `done`.

## Démarrage rapide (dev local)

Prérequis : Node 22+, Python 3.12+, ffmpeg, une base PostgreSQL accessible.

```bash
# Installation
npm install
cp .env.example .env.local   # renseigne DATABASE_URL, AUTH_SECRET, XTRACTO_PASSWORD

# Schéma de base
psql "$DATABASE_URL" -f sql/schema.sql

# Frontend + API
npm run dev

# Worker (dans un autre terminal)
cd worker
pip install -r requirements.txt "yt-dlp>=2026.8.19"
DATABASE_URL=... OUTPUT_ROOT=./output python worker.py
```

L'app est servie sur [http://localhost:3000](http://localhost:3000).

## Variables d'environnement

| Variable | Description |
|---|---|
| `DATABASE_URL` | URL de connexion PostgreSQL |
| `AUTH_SECRET` | Clé HMAC pour signer les cookies de session (`openssl rand -hex 32`) |
| `XTRACTO_PASSWORD` | Mot de passe unique protégeant l'accès à l'app |
| `OUTPUT_ROOT` | Dossier où le worker écrit les fichiers de sortie |

Voir [.env.example](.env.example).

## Déploiement en production

Le projet est pensé pour tourner via Docker Compose (voir [docker-compose.yml](docker-compose.yml)) derrière un reverse proxy Nginx avec HTTPS. Étapes détaillées : [deploy/README.md](deploy/README.md).

## Limites connues

- yt-dlp doit être mis à jour régulièrement : YouTube change son player suffisamment souvent pour qu'une version figée finisse par échouer au téléchargement (voir le commentaire dans [worker/Dockerfile](worker/Dockerfile)).
- Taille de téléchargement plafonnée à 3 Go par job (garde-fou disque, ajustable dans [worker/engine/extractor.py](worker/engine/extractor.py)).
- Pensé pour un usage personnel : pas de gestion multi-utilisateurs, un seul mot de passe partagé.

## Licence

[MIT](LICENSE)

## Auteur

### Mickaël Tavenart

**Administrateur réseau & systèmes**
**Consultant coach‑numérique**
**Développeur full‑stack & créateur d'applications assistées par IA**

> *"L'IA comme moteur, l'humain comme destination."*
