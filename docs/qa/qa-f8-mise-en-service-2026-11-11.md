# QA F8 R1 : écrans de mise en service (q165, DECISION-080/118)

Commit testé : a173822 (`feat/r1-f8-mise-en-service`). Branche QA : `qa/f8`. Date : 2026-11-11.
Environnement : PostgreSQL 16 local jetable (127.0.0.1:55442, base `grc_qa_f8`, migrations 001..082), vrai backend (tsx, identité locale, stockage de documents en mémoire du preload QA), frontend Vite en dev, Chromium Playwright. Aucun accès à Neon, staging ou prod.

Verdict QA : **PASS** (couvert : les 4 écrans, `client.ts`). Aucun BLOCKER, CRITICAL ni MAJOR sur le périmètre F8. Quatre points MINOR et deux observations. Ce PASS n'est ni un avis Security, ni Privacy, ni Compliance.

## Exécution

| Contrôle | Résultat |
| --- | --- |
| `tests/integration/qa-f8-front-playwright.mjs` (base neuve) | 72 PASS, 0 FAIL |
| `cd frontend && npm run build` (après build du design system) | OK |
| `cd backend && npm run typecheck && npm test` | typecheck OK ; 2835 passés, 752 ignorés (tests d'intégration sans base), 0 échec |

Reproduire : `bash tests/integration/qa-visibility-v1-setup.sh up grc_qa_f8`, backend avec `QA_PORT=8397 QA_DB=grc_qa_f8` et CORS `http://127.0.0.1:5497`, vite sur 5497 (`VITE_API_BASE_URL=http://127.0.0.1:8397 VITE_AUTH_PROVIDER=local`), puis `node tests/integration/qa-f8-front-playwright.mjs`. Le script n'est pas rejouable sur une base déjà utilisée (clients créés, risques importés) : refaire `up` avant.
Oracles écrits en tête du script avant exécution. Deux oracles ajustés après observation, avec justification : 2.18 (le refus 403 est expliqué par le dialogue global « Vous n'avez pas ce droit », qui ne nomme pas la permission, conforme à PermissionDeniedDialog), et 4.14 (re-sélection du même fichier : le navigateur ne déclenche pas `change`, on utilise un autre fichier).

## Ce qui tient

- Menu : `out` ne voit aucune des 4 entrées, `aud` (branding.read + config.read) voit Image de marque et Modules seulement, `adm` voit les 4.
- Modules (DECISION-058) : une ligne par module de l'API ; motif vide, aucun PATCH (champ `required`) ; motif d'espaces, PATCH `{enabled, reason:""}` refusé 400 par le serveur, message affiché dans le formulaire, état inchangé ; PATCH valide `{enabled, reason}` exactement ; audit `STATUS_CHANGE` avec le motif ; aller-retour ; double clic = un seul PATCH ; champ plafonné à 500 (le serveur refuse 501 et un module inconnu en 400). L'effet serveur (cartographie refusée quand le module est coupé) vient du serveur, rien n'est recalculé côté front.
- 403 : `aud` sans config.manage, PATCH refusé, état inchangé, dialogue global affiché, modale fermée. `aud` sur `/tenants`, `/import/*` et `POST /branding` : 403 serveur.
- Clients : liste = API ; nom d'espaces refusé par le serveur, message affiché, rien créé ; POST `{name, deploymentMode}` seulement ; PATCH sans `active` ; aucun bouton Désactiver/Supprimer ; audit présent.
- Import : aperçu (4 lignes, 2 valides, 2 refusées, chiffres du serveur) sans aucune écriture ; commit = exactement 2 risques ; bouton Importer disparu après commit ; faux xlsx, classeur vide, mauvais en-têtes : pas de bouton Importer, retour visible ; nouvelle sélection efface l'aperçu.
- Image de marque : `.txt` refusé, message serveur affiché, logo inchangé ; PNG accepté, API et écran à jour ; lien du logo https uniquement avec `rel=noopener`.
- Régression `client.ts` : tous les appels JSON portent `application/json` ; tous les multipart (preview, commit, logo) portent `multipart/form-data; boundary=...`, jamais `application/json`.
- Aucune erreur JS ni console imprévue.

## Constats

| ID | Gravité QA | Constat | Preuve / action |
| --- | --- | --- | --- |
| QA-F8-01 | MINOR | Serveur : `POST /tenants` accepte deux clients de même nom (deux 201) et un nom de 5000 caractères (`z.string().min(1)` sans max ni unicité). L'écran liste alors deux lignes indiscernables. | curl du 2026-11-11 sur `grc_qa_f8`. Dev Backend : borne max et règle d'unicité à décider (PO/Risk si l'unicité est un besoin métier). |
| QA-F8-02 | MINOR (sécurité suspectée, à voir par Security) | Un SVG contenant `<script>` est accepté comme logo (201). Le front n'affiche que le lien https vers le fichier et l'ouvre dans un nouvel onglet avec `noopener`, mais le contenu servi par le stockage dépend du type MIME/Content-Disposition. Non qualifié par QA. | curl du 2026-11-11. Transmis à Security. |
| QA-F8-03 | MINOR | Un motif d'espaces et un nom de client d'espaces donnent seulement « Requête invalide. » (message générique du serveur pour l'erreur Zod). Le message est bien affiché tel quel mais n'indique pas le champ fautif. De même, un logo > 5 Mo donne 413 « Téléversement invalide. ». | Écrans motif/Clients, captures dans `qa-shots/f8` (non versionnées). Dev Backend : message détaillé côté serveur ; le front n'a rien à corriger (pas de message inventé). |
| QA-F8-04 | MINOR (observation UX) | `aud` (config.read sans config.manage) voit les boutons « Désactiver/Activer » et ne découvre le refus qu'après saisie du motif et validation. Conforme à la règle « un contrôle affiché n'est pas une autorisation », mais l'écran ne distingue pas lecture seule et écriture. | Parcours 2.17/2.18. Décision UX à prendre (PO/Product) ; pas un défaut de sécurité. |
| QA-F8-05 | Observation | `isForbidden(err)` (tout 403) ferme la modale ; si un 403 métier sans « Missing permission » apparaissait, son message serait perdu (formError posé sur une modale fermée). Non reproductible aujourd'hui : aucune des 4 routes ne renvoie un 403 métier. | Lecture de `ModulesPage.tsx` / `ClientsPage.tsx` (`isForbidden` vs `isPermissionDenied`). À durcir si un 403 métier est ajouté. |
| QA-F8-06 | Observation | `GET /api/v1/tenants` n'est pas limité au tenant de l'acteur (liste tous les clients) : conforme à l'écran « super-administrateur » (config.manage) et à ACT-222, à valider par Security côté périmètre du droit `config.manage`. | `TenantService` en-tête. |

Hors périmètre signalé par l'équipe dev et non exposé : désactivation d'un client sans motif (`PATCH active:false`), correctement absente de l'écran. Le serveur l'accepte toujours : défaut serveur connu, à traiter par Dev Backend.

Limites : le stockage Drive est en mémoire (preload QA), donc l'URL du logo est `http://127.0.0.1/qa-evidence/...` ; l'affichage du lien https n'a pas été exercé avec une vraie URL Drive. Le responsive et l'accessibilité clavier des modales n'ont pas été testés.

## Statuts

SECURITY_REVIEW_REQUIRED : oui (QA-F8-02, QA-F8-06). PRIVACY : non. COMPLIANCE : non. RISK : non. RETEST_REQUIRED : non pour l'écran ; oui pour QA-F8-01/03 quand Dev Backend les traite.
STATUS : PASS.
