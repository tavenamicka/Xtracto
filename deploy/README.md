# Déploiement Xtracto

Étapes manuelles côté serveur (accès shell requis). Remplacez `xtracto.example.com`
par votre nom de domaine.

## 1. Préparer les volumes

Depuis la racine du projet :

```bash
mkdir -p data/output db
chown -R 1001:1001 data/output
```

`1001` est l'UID utilisé par les conteneurs `app` (Next.js) et `worker`
(Python) — cohérence nécessaire pour que les deux puissent lire/écrire les
mêmes fichiers de sortie. Pensez à sauvegarder `db/` (données Postgres) et
`data/output/` si vous voulez conserver l'historique et les fichiers générés.

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
git pull && ./deploy.sh
# (ou directement : docker compose up -d --build)
```

Le schéma (`sql/schema.sql`) est appliqué automatiquement au premier
démarrage du conteneur Postgres (monté dans `/docker-entrypoint-initdb.d/`).

## 4. Nginx + HTTPS

L'app écoute sur `127.0.0.1:4100` : un reverse proxy sur l'hôte la publie.

```bash
cp deploy/nginx-xtracto.conf /etc/nginx/sites-available/xtracto
ln -s /etc/nginx/sites-available/xtracto /etc/nginx/sites-enabled/xtracto
nginx -t && systemctl reload nginx

certbot --nginx -d xtracto.example.com
```

Prérequis avant cette étape :
- DNS : enregistrement `A` (ou `CNAME`) de `xtracto.example.com` pointant vers
  l'IP publique du serveur.
- Ports `80` et `443` ouverts et redirigés vers le serveur (box, pare-feu).

## 5. Vérification

```bash
docker compose ps        # app, worker, postgres = healthy/running
curl -I https://xtracto.example.com
```

Tester un job complet depuis l'interface : login → coller une URL YouTube
courte → suivre la progression → télécharger le résultat.
