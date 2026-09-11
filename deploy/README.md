# Déploiement Xtracto — ThinkStation

Étapes manuelles côté serveur (non exécutables depuis une session Claude Code
locale — nécessite un accès shell au ThinkStation).

## 1. Préparer les volumes

```bash
mkdir -p /mnt/media/xtracto-output /mnt/backup/xtracto-db
chown -R 1001:1001 /mnt/media/xtracto-output
```

`1001` est l'UID utilisé par les conteneurs `app` (Next.js) et `worker`
(Python) — cohérence nécessaire pour que les deux puissent lire/écrire les
mêmes fichiers de sortie.

## 2. Variables d'environnement

Créer `.env.production` à la racine du projet sur le serveur :

```bash
DATABASE_URL=postgresql://xtracto:CHANGE_ME@postgres:5432/xtracto
POSTGRES_USER=xtracto
POSTGRES_PASSWORD=CHANGE_ME
POSTGRES_DB=xtracto
AUTH_SECRET=<chaîne aléatoire longue, ex: openssl rand -hex 32>
XTRACTO_PASSWORD=<mot de passe partagé de l'appli>
```

## 3. Déployer

```bash
cd ~/xtracto && git pull && ./deploy.sh
# (ou directement : docker compose up -d --build)
```

Le schéma (`sql/schema.sql`) est appliqué automatiquement au premier
démarrage du conteneur Postgres (monté dans `/docker-entrypoint-initdb.d/`).

## 4. Nginx + HTTPS

```bash
cp deploy/nginx-xtracto.conf /etc/nginx/sites-available/xtracto
ln -s /etc/nginx/sites-available/xtracto /etc/nginx/sites-enabled/xtracto
nginx -t && systemctl reload nginx

certbot --nginx -d xtracto.tranevat.fr
```

Prérequis avant cette étape :
- DNS : enregistrement `A` (ou `CNAME`) de `xtracto.tranevat.fr` pointant vers
  l'IP publique du réseau (Freebox).
- Port-forward `80` et `443` sur la Freebox vers `192.168.1.23` (si pas déjà
  fait — Plateforme AOP a le même besoin, actuellement en attente).

## 5. Vérification

```bash
docker compose ps        # app, worker, postgres = healthy/running
curl -I https://xtracto.tranevat.fr
```

Tester un job complet depuis l'interface : login → coller une URL YouTube
courte → suivre la progression → télécharger le résultat.
