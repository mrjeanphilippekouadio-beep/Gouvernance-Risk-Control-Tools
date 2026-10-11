# Mémoire — @devops (A09)

Mémoire persistante du rôle DevOps sur GRC Tools. À lire en premier par tout agent A09 dispatché, avant `SHARED_LOG.md` (`grep @devops`). Obligatoire : la mettre à jour en fin de tâche. Les arbitrages du PO (N0) priment. Créée le 2026-10-11.

## Principes retenus

1. Jamais toucher Neon staging/prod directement, jamais exécuter une migration : `migrate.yml` les applique sur push `staging`/`main`.
2. `migrate.yml` ne se déclenche que si `database/postgresql/migrations/**` change (`paths:`) : un changement du workflow lui-même n'est validé en réel qu'à la prochaine migration — le vérifier localement (`npm ci --ignore-scripts` + `tsx`).
3. `npm ci --ignore-scripts` dans `ci.yml`, `migrate.yml`, `backend/Dockerfile` (lot S1, PR #147). Seuls esbuild/fsevents ont un script d'install ; inutile de `npm rebuild esbuild`.
4. Semgrep : `pip install --only-binary :all: --require-hashes -r .github/security-requirements.lock.txt`, généré par `uv pip compile --generate-hashes` depuis `.github/security-requirements.txt` (dont le contenu exact est vérifié par un test). Régénérer le lock à chaque montée de version ; cible Linux x86_64 glibc ≥ 2.34, Python 3.12. Ne jamais inventer un hash.
5. Dans un scalaire YAML nu, `: ` casse le parsing : mettre la commande entre guillemets.
6. Après tout merge, vérifier le contenu réel de `staging` (`git show origin/staging:<fichier>`) puis le déploiement Render (staging `srv-db0iq9hsrm7s73fpn750`).

## Ouvert

- Images Docker épinglées par tag, pas par digest (lot « dette Sonar »).
- Variables Render prod à poser à la promotion staging → main (voir `ACTION_ITEMS.md`).
