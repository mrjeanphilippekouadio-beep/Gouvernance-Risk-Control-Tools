# QA — Visibilité des ressources, lot V5 (DECISION-112 : q225 A, migration 087)

Agent A08 QA, passage du 2026-11-08. Branche `qa/visibility-v5` créée depuis `origin/feat/r1-visibility-v5`, code `4d3f2b6` (tête `02196c6`, mémoire du développeur). Pas un avis Security, Privacy ni Compliance.

**Verdict : ORANGE (PARTIAL_PASS).** Le cœur du lot tient : l'accès nominatif tombe à l'échéance et à la clôture (cinq types, accès hérités compris), le renouvellement est borné, audité et atomique, la migration est rejouable et réversible. Un défaut MAJOR : un dossier repassé de « personnes nommées » à PERIMETRE garde l'échéance de ses personnes, qui perdent silencieusement l'accès à la date, sans renouvellement possible (QA-V5-01). Trois constats mineurs ou triviaux. Aucun blocker.

## 1. Exécution

| Suite | Résultat |
|---|---|
| `backend/test/QA-visibility-v5.test.ts` (nouveau ; `QA_VIS5_LIVE=1`, vrai serveur port 8097 + PG16 local, base `grc_qa_v5`, harnais `qaVisibilityHarness.ts` ; migration sur base `grc_qa_v5mig`) | 60 tests : 56 PASS + 4 `it.fails` (défauts confirmés) ; sans variable : 3 PASS (statique), le reste ignoré |
| Suites live V0 à V5 (QA et développeur, 15 fichiers : `QA-visibility-v0` à `v5`, `visibility-v0` à `v5`), `--no-file-parallelism`, base propre `grc_qa_v5swp` pour `QA_SWP_*` | 15 fichiers PASS ; 576 PASS + 4 `it.fails` (580), rien d'ignoré |
| `cd backend && npm run typecheck && npm test` | OK : 168 fichiers PASS + 21 ignorés ; 2836 PASS, 815 ignorés (parties live) |

Cluster local `127.0.0.1:55442` seulement, jamais Neon. Serveur arrêté par pid (port 8097 fermé ensuite).

## 2. Couverture (oracles écrits avant exécution)

- **Lecture, cinq types** (RISK, CONTROL, KPI, ANOMALY, ACTION_PLAN) : accès vivant lit ; échu => même réponse (404) qu'un inconnu ; la ligne reste (ni supprimée ni révoquée) ; le Risk Manager et le propriétaire lisent toujours ; renouvellement rend la lecture avec une échéance entre 29,9 et 30 jours. Clôture (risque et contrôle ARCHIVED, KPI supprimé, anomalie CLOSED, plan TERMINEE) : l'accès tombe ; renouveler un dossier clos est refusé sans trace d'audit (400 ; 404 pour un KPI, car clos = supprimé).
- **Accès hérité** (anomalie et plan qui suivent un risque ou un contrôle restreint, 4 cas) : lisible par l'accès du parent, absent des listes et illisible à l'échéance du parent, lisible de nouveau au renouvellement, illisible à la clôture du parent ; clore l'enfant seul ne coupe rien ; renouveler un enfant directement => 400.
- **Renouvellement** (`POST /:id/visibility/renew`) : 401 anonyme ; refus d'un lecteur sans droit et d'un inconnu (même statut, pas d'oracle d'existence) ; 16 corps invalides (vide, absent, 0 personne, 51 personnes, types, non-UUID, motif vide/blanc/501/null/5) => 400 sans écriture ; 200 000 éléments `{}` refusés en moins de 5 s ; **50 personnes acceptées et toutes renouvelées, 51 refusées et aucune touchée** ; doublons (casse comprise) fusionnés, une seule trace ; une personne sans accès fait échouer toute la demande (400) et rien ne bouge (atomique) ; pas d'auto-renouvellement ; compte inconnu ou suspendu refusé ; seul NOMINATIF (PERIMETRE et CLIENT => 400 sur les cinq types, aucune échéance inventée) ; audit : une ligne `PERMISSION_CHANGE`, auteur = appelant (champs `grantedBy`/`userId` du corps ignorés), motif conservé, échéances avant/après, `widening` vrai si l'accès échu revient, faux s'il était vivant ; deux renouvellements successifs => deux 200, jamais au-delà de 30 jours ; propriétaire d'un risque renouvelle et le groupe Risk Manager est notifié, pas quand c'est le Risk Manager.
- **Pose de l'échéance** : `PUT NOMINATIF` + ajout pose now + 30 j sur les gardés et les ajoutés, pour les cinq types ; ajouter à un dossier déjà NOMINATIF ne prolonge pas les autres ; risque créé NOMINATIF avec liste (`POST /risks`) ; `GET /visibility` expose `expiresAt` ISO pour les cinq types ; une personne révoquée n'est pas ressuscitée ; un accès échu peut être retiré à la main.
- **Garde SQL** : insertion et mise à jour au-delà de 30 jours refusées (31 j, et now + 30 j + 1 s), retrait de l'échéance refusé, échéance passée acceptée, suppression refusée, révocation ne peut pas bouger l'échéance, contenu immuable, une ligne révoquée ne se touche plus.
- **Courses** : échéance vs renouvellement à 1,5 s (renouvelé avant ou après l'échéance, lit dans les deux cas) ; 8 renouvellements parallèles (pas de 5xx, une ligne vivante, une trace par succès) ; renouvellement || clôture ×10 (200 ou 400, jamais 5xx, jamais de lecture sur dossier clos) ; renouvellement || retrait ×10 (aucun état à moitié vivant, pas de résurrection) ; renouvellement || passage à PERIMETRE ×6 (pas de 5xx).
- **Compteur `listRestricted`** : 3 accès => 3 ; un échu => 2 ; renouvelé => 3.
- **Migration 087** (base propre 001..086, données plantées) : pose now + 30 j (arrondi 30 j) sur les accès NOMINATIF vivants (risque, contrôle, dossier archivé compris) ; PERIMETRE et révoqué intacts ; aucune ligne perdue ; **rejeu ×2 idempotent** (mêmes définitions de fonctions par empreinte, aucune échéance bougée, un accès échu n'est pas prolongé) ; **`.down` rétablit exactement les définitions d'avant 087** (empreintes identiques à la base 086), retire la colonne et l'assistant, ne supprime rien, retire la ligne `schema_migrations`, rejouable ; ré-application identique ; `search_path` fixé avec `pg_temp` en dernier sur les quatre fonctions ; déclencheur présent.

## 3. Constats

| Id | Gravité QA | Constat |
|---|---|---|
| QA-V5-01 | **MAJOR** | **Échéance résiduelle après retour à PERIMETRE.** `PUT /visibility` NOMINATIF => PERIMETRE conserve la liste et ses échéances (posées par `stampNamedExpiry`, jamais retirées). La liste d'un dossier PERIMETRE devait rester sans échéance (en-tête de 087 : « NULL = pas d'échéance (liste d'un dossier PERIMETRE : hors q225) »). À la date, la personne nommée perd la lecture d'un dossier PERIMETRE sans aucun signal. `GET /visibility` la liste encore (échéance passée) ; `POST /renew` => 400 « Only the access to a named-people dossier… » ; `PUT PERIMETRE` avec `addUserIds:[elle]` => 200 sans effet, sans accès ; seul contournement : la retirer puis la rajouter. Le garde SQL interdit de retirer une échéance posée, donc la correction passe par `visibility_granted` (n'appliquer l'échéance qu'à un dossier au niveau effectif NOMINATIF) ou par la révocation/ré-inscription au changement de niveau. Reproduction : `QA-visibility-v5.test.ts`, deux `it.fails` « [QA-V5-01] ». |
| QA-V5-02 | MINOR | **Compteur `accessCount` d'un dossier clos.** `GET /restricted-resources` ne compte que les accès non échus, mais pas la clôture : un contrôle ARCHIVED avec 2 personnes nommées affiche 2 alors que plus personne ne le lit. Le dossier clos reste listé. Reproduction : `it.fails` « [QA-V5-02] ». À trancher : afficher 0, ou lister les clos à part. |
| QA-V5-03 | TRIVIAL | Renouveler un dossier clos donne 400 pour risque, contrôle, anomalie et plan, mais 404 pour un KPI (clos = supprimé logiquement). Les deux refusent sans écriture ; le message diffère. Par ailleurs `GET /visibility` continue de lister une personne dont l'accès est échu ou clos, avec son `expiresAt` passé : voulu pour le renouvellement, mais l'écran devra afficher « échu » et non « a accès ». |
| QA-V5-04 | MINOR (hérité) | Un corps JSON qui n'est pas un objet (ex. la chaîne `"x"`) donne 500 « Internal server error » au lieu de 400, sur `POST /renew` comme sur le `PUT /visibility` préexistant (analyseur de corps en mode strict, erreur non mappée). Non introduit par V5 ; noté ici car la nouvelle route le reprend. Reproduction : `it.fails` « [QA-V5-04] ». |

Observations (pas des défauts) : (i) la migration horodate aussi les accès d'un dossier NOMINATIF déjà clos (sans effet, il est clos) ; (ii) `.down` rend permanents les accès qui avaient une échéance (écrit dans l'en-tête du `.down`) ; (iii) le lot ne touche pas au frontend : `expiresAt` est exposé mais ni l'échéance ni un bouton Renouveler n'existent à l'écran, non couvert par ce passage ; (iv) un contrôle ou un KPI n'a pas de propriétaire : seul le groupe Risk Manager renouvelle (cohérent avec l'ajout).

## 4. À transmettre

- Dev Backend : QA-V5-01 (MAJOR) et QA-V5-02, QA-V5-04. Retest : les quatre `it.fails` à transformer en `it`.
- Security : revue à faire par A10 sur la route de renouvellement et la garde SQL (le passage QA n'en tient pas lieu). Privacy : l'expiration de l'accès nominatif est l'objet de DECISION-112, recommandation Privacy ; les preuves de comportement ci-dessus sont à leur disposition. Compliance et Risk : rien de nouveau.
- Retest requis après correction de QA-V5-01 : suites live V0 à V5 et `npm test`.

## 5. Limites

Pas de test navigateur (aucun changement frontend). Le temps est simulé en avançant les échéances par SQL (le garde autorise une échéance passée) et par une échéance à 1,5 s ; aucun test ne laisse passer 30 jours réels. Un seul tenant de test pour les lectures ; l'isolation inter-tenant des nouvelles requêtes (filtre `tenant_id` dans `namedAccess.ts`) a été relue, pas testée en live.

## 6. Retest (2026-11-10, `origin/feat/r1-visibility-v5` à `50be6f8`, 087 modifiée en place)

**Verdict : VERT avec une réserve en attente de la décision PO q253.** Pas un avis Security (retest A10 distinct : VERT, `0ed308b`).

| Constat | État |
|---|---|
| QA-V5-02 `accessCount` d'un dossier clos | **Clos** : le test passe de `it.fails` à `it` (0 pour un dossier clos ou échu). |
| QA-V5-04 corps JSON non objet | **Clos** : 400 au lieu de 500, test passé en `it`. |
| QA-V5-01 échéance résiduelle après retour à PERIMETRE | **Partiellement clos.** Désormais : renouvellement autorisé dès qu'un accès porte une échéance, quel que soit le niveau (200) ; ré-ajout d'une personne échue = renouvellement (une seule ligne, rien de révoqué) ; dossier clos => 400 et le ré-ajout ne rend pas l'accès. Plus de perte sans moyen de rétablir : deux tests « [QA-V5-01 retest] ». **Reste ouvert** : une liste PERIMETRE garde son échéance et s'éteint à la date (règle de fond que le PO tranche avec q253) ; un `it.fails` « EN ATTENTE DE q253 » le documente (à passer en `it` ou à réécrire selon la décision). |
| QA-V5-03 KPI clos => 404 | **Accepté** (validation de l'orchestrateur : 400 révélerait l'existence d'un KPI supprimé). |

Exécution : `QA-visibility-v5.test.ts` 61 tests = 60 PASS + 1 `it.fails` (q253) ; suites live V0 à V5 (15 fichiers, `--no-file-parallelism`, base propre `grc_qa_v5swp` reconstruite avec la 087 modifiée) : 585 PASS + 1 `it.fails`, rien d'ignoré ; `npm run typecheck && npm test` : OK, 168 fichiers PASS (21 ignorés), 2837 PASS. Rejeu de 087 et `.down` toujours verts.

Statut : RETEST_PASS sous réserve de q253 (item HUMAN à suivre par l'orchestrateur).
