# QA — Visibilité des ressources, lot V4 (DECISION-103 : q197 A3 / A1, q202, q174 ; q215)

Agent A08 QA, 2026-11-03. Branche `feat/r1-visibility-v4`, tête `a1bcbe6` (base `origin/staging`). Pas un avis Security, Privacy ni Compliance.

**Verdict : ORANGE (PARTIAL_PASS).** Le circuit `resource.readall` (demande, confirmation par un tiers, effet, badge, fin) fonctionne sur PostgreSQL 16 réel et dans le navigateur, A1 est tenu, la non-régression q200 est verte. 1 défaut MAJOR (le droit renaît quand un rôle d'administration est dépouillé puis rétabli) et 2 MINOR confirmés.

## 1. Exécution

| Suite | Résultat |
|---|---|
| `backend/test/QA-visibility-v4.test.ts` (`QA_VIS4_LIVE=1`, vrai serveur + PG16 local 127.0.0.1:55442, base `grc_qa_vv4t` reconstruite à chaque run) | 52 tests : 49 PASS + 3 `it.fails` ; sans variable : 4 PASS + 1 `it.fails` (statique), 47 skipped |
| Suites live V1 + V2 + V2bis ensemble puis V3 + V4, `--no-file-parallelism` | 252 PASS ; 95 PASS + 3 expected fail |
| `tests/integration/qa-visibility-v4-playwright.mjs` (Chromium, backend 8091 + vite 5199, base `grc_qa_vv4p`) | 18 PASS, 0 FAIL, 1 OBSERVE (QA-V4-03), 0 erreur JS, 0 erreur console imprévue |
| `cd backend && npm run typecheck && npm test` | OK : 161 fichiers PASS + 21 skipped ; 2766 PASS + 1 expected fail, 652 skipped |
| `cd frontend && npm run build` (design-system construit avant) | OK |
| Mutation rapide : retrait de la règle q202 (un administrateur ne confirme pas) dans `decideSensitiveView` | 6 tests rouges, source restaurée |

Harnais réutilisé : `qaVisibilityHarness.ts`, `qa-visibility-v2-{setup,server}.sh`, `qa-helpers.mjs` (aucune duplication). Jeu : les 12 comptes V1/V2 ; `out`, `n1`, `raci`, `own` rendus administrateurs PAR RÔLE (la règle SQL `visibility_is_administrator` ne lit que `user_roles`), `adm` administrateur par droits directs. Sonde universelle : `GET /controls/c03` (NOMINATIF, liste `named`).

## 2. Couverture (oracles écrits avant exécution)

- **A1** : 401 anonyme, 403 non-administrateur ; administrateur (droits directs ou par rôle) = 200 avec exactement `type, id, visibility, accessCount, updatedAt` (ni `label`, ni `lastChange`, ni CANARY) ; mêmes ressources et même ordre que la liste du Risk Manager ; pagination et 400 sur bornes invalides ; 404 sur le détail de chaque ressource restreinte (hors les trois que `out` lit légitimement : a01/a09 responsable, d08 niveau propre ignoré) et absence de fuite dans les cinq listes ; comptage « non visibles » numérique.
- **Demande** : 401/403 (non-administrateur, RM, Comité, Audit) ; corps strict (kind inconnu, motif absent/vide/blanc/501/null/nombre, userId non GUID, champs `requestedBy`/`status` en trop) => 400 sans écriture ; bénéficiaire : soi 403, non-administrateur 400, RM/Comité/Audit 400, inconnu 404, administrateur par droits directs seuls 400, administrateur membre d'un groupe fixe 400 ; candidats (administrateurs par rôle hors groupes fixes, jamais l'appelant, kind invalide 400) ; demande valide : 201 PENDING, auteur = appelant, `SUBMIT` audité avec motif, Comité et Audit notifiés sans le motif, bénéficiaire non notifié ; PENDING n'ouvre rien ; doublon 409 et course de deux demandes = un 201 + un 409 + une trace ; panne d'audit => 5xx et aucune ligne.
- **Confirmation (q202, q174)** : auteur, bénéficiaire, RM, utilisateur simple, membre Comité/Audit qui est aussi administrateur (approbation et refus) => 403, reste PENDING ; refus sans motif 400, id inconnu et non-GUID refusés ; bénéficiaire devenu membre d'un groupe fixe entre-temps => 400 ; panne d'audit => la décision est annulée ; demande échue : approbation 409, remplacée par une nouvelle (ancienne REVOKED, tracée) ; deux confirmeurs simultanés = un 200 + un 409 + une ligne `APPROVE` ; re-décision 409 ; garde PostgreSQL : `kind`, `user_id` immuables, DELETE et retour en PENDING refusés.
- **Effet** : badge `GRANT` dans `permission-sources` et `/permissions`, absent chez les autres, aucun rôle ne porte `resource.readall` ; les cinq listes égales à celles du RM (NOMINATIF compris), chaque élément s'ouvre (200) ; comptage `null` ; liste complète rendue (libellés, `lastChange`) avec les mêmes lignes que le RM ; auteur du dernier changement masqué pour ce lecteur (PRIV-V3-05) ; droit de lecture seul (pas de changement de visibilité, pas d'audit-log) ; les autres administrateurs ne sont pas touchés ; listes par kind ; le bénéficiaire peut demander pour d'autres mais ne confirme jamais.
- **Fin du droit** : révocation avec motif (400 sinon), 403 non-administrateur, effet immédiat, `UNASSIGN` audité avec motif, seconde révocation 409, confirmation tardive 409 ; panne d'audit => droit conservé ; refus (`REJECT` audité) sans effet puis nouvelle demande possible ; suspension => REVOKED + audit, la réactivation ne le rend pas ; perte du DERNIER rôle d'administrateur => REVOKED, perte d'un seul des deux => droit conservé, ré-attribution du rôle => rien ne revient ; rôle dépouillé de ses droits d'administration => aucun effet immédiat (règle SQL).
- **Jamais sur un rôle** : `POST /roles` et `PATCH /roles/:id` avec `resource.readall` (et `role.read.sensitive`) => 400, groupe Audit refusé, aucune ligne en base.
- **Non-régression q200** : kind par défaut = ROLE_READ_SENSITIVE, badge `role.read.sensitive` sur le membre RM, pas d'effet `resource.readall`, listes séparées, bénéficiaires disjoints, un RM ne peut pas être bénéficiaire de RESOURCE_READALL ; cas limite d'un compte à la fois RESOURCE_READALL vivant et RM : 409, pas de 5xx.
- **q215** : 139 et 140 caractères conservés tels quels, 141 et 500 coupés à 140 caractères (`…` en dernier), l'audit garde le texte complet, même aperçu pour RM, Comité, Audit et bénéficiaire du droit ; `offset` hors liste = `[]`.
- **Navigateur** : voir oracles en tête du script. adm et out voient l'écran « Ressources restreintes » sans libellé (« Contenu non consultable ») ; adm demande depuis « Matrice des droits » > carte « Lecture de tous les contenus », le Comité (sans `role.read`, écran déjà sur le bon onglet) confirme ; out lit alors les libellés, plus aucune mention « non visibles », comptage `null`, c03 lisible ; le badge s'affiche ; retrait avec motif => « Retirée », out revient aux métadonnées et la mention réapparaît.

## 3. Constats

| ID | Sévérité QA | Constat | Repro | Statut |
|---|---|---|---|---|
| QA-V4-01 | MAJOR | Le droit confirmé n'est éteint ni quand un rôle d'administration est dépouillé de ses droits (`PATCH /roles/:id`), ni quand le rôle est rétabli : l'attribution reste APPROVED en base et la règle SQL la fait revivre dès que la personne est de nouveau administrateur, sans nouvelle demande ni nouvelle confirmation. Seuls `revokeFromUser` et la suspension terminent l'attribution (`RoleService.ts` ~l.787-796, `UserService.ts:324`). Un administrateur avec `role.update` (qui ne détient pas le rôle) peut ainsi réactiver n'importe quand une confirmation ancienne. Contraire à « fin au retrait du dernier rôle d'administrateur » | `out`/`n1` administrateur par rôle, `grant` APPROVED ; `PATCH /roles/<rôle> {permissions:["risk.read"]}` (sonde c03 = 404) puis `PATCH` avec `role.assign` rétabli : c03 = 200, grant toujours APPROVED | `it.fails` |
| QA-V4-02 | MINOR | L'aperçu de 140 caractères coupe en unités UTF-16 (`reason.slice(0, 139)`, `resourceVisibility.ts` `reasonPreview`) : un caractère hors plan de base à la coupure laisse un demi-caractère (affiché « � ») dans la liste | `PUT /controls/c01/visibility` avec motif `"é"×138 + "😀" + "x"×50` ; `GET /restricted-resources` : `lastChange.reason` se termine par un substitut isolé avant `…` | `it.fails` |
| QA-V4-03 | MINOR | La consigne « Ne nommez pas la personne concernée » n'est qu'une infobulle (`title=`) sur le champ « Motif de l'attribution du rôle » de « IAM · Rôles » (`RolesAdmin.tsx:179`), donc invisible au clavier et au tactile ; les quatre autres écrans (RACI, visibilité, désignation, responsable de processus) l'affichent en texte d'aide | Ouvrir « IAM · Rôles » : le texte « Ne nommez pas » n'est pas dans la page (parcours navigateur, 5.1 OBSERVE) | `it.fails` (statique) |

Aucun BLOCKER. QA-V4-01 est à transmettre à Security (maker-checker contournable par deux opérations d'administration) ; sa gravité de sécurité n'est pas fixée ici.

### Points à trancher (QA_CHALLENGE)

1. **`GET /users/me/permissions` ne contient pas `resource.readall`** (ni `role.read.sensitive`) : seul `/roles/users/:id/permissions` et `permission-sources` portent les attributions individuelles. Cohérent avec q200, mais aucun écran ne peut savoir par ce biais que l'utilisateur lit tout ; l'écran « Ressources restreintes » s'appuie sur la réponse serveur, donc sans conséquence aujourd'hui.
2. **Libellé du badge** : la source `GRANT` s'affiche « Vue élargie confirmée » pour les deux kinds ; pour `resource.readall` « Lecture de tous les contenus confirmée » serait plus clair.
3. **Atomicité de la fin automatique** : `revokeFromUser` retire d'abord le rôle, puis termine l'attribution dans une autre transaction (même motif que l'écart RM de q200) ; non testé par injection de panne (la règle SQL éteint de toute façon l'effet sans attendre).
4. **Administrateur par droits directs seuls** (cas `adm`) : reçoit la liste en métadonnées (A1 lit `actor.roles`) mais ne peut pas être bénéficiaire (la règle SQL ne lit que les rôles) ; le comportement est cohérent avec le texte de l'écran mais à confirmer côté produit.
5. **d08** (niveau propre NOMINATIF, risque CLIENT) figure dans la liste des ressources restreintes alors que son contenu est lisible de tous : écart V2 préexistant, visible aussi dans la liste de métadonnées A1.

## 4. Non-régression

V1, V2, V2bis (252 PASS) et V3 (46 tests) restent verts avec 084 ; les mises à jour de tests faites par A06 (« 083 n'est plus la dernière migration », `adm` = métadonnées au lieu de 403) sont légitimes et n'affaiblissent rien. Le test d'idempotence 082/083 rejoue ces migrations sur la base partagée : mon test live n'en dépend pas (084 est appliquée par `qa-visibility-v1-setup.sh`).

## 5. Limites et suites

- Rejouer après correctif : `QA_VIS4_LIVE=1 npx vitest run test/QA-visibility-v4.test.ts --no-file-parallelism` ; repasser en `it` les 3 `it.fails` (QA-V4-01/02/03).
- Non couvert : durée d'expiration réelle issue de `policyRequestExpiryDays` (échéance forcée en base), charge de `visibility_sees_everything` appelée par ressource dans les listes, création d'une ressource restreinte par un administrateur titulaire du droit (`ControlService`/`KpiService` calculent `seesEverything` depuis les groupes fixes seuls, `VisibilityResolver` : à vérifier avec Security), évidences/exécutions rattachées à un contrôle NOMINATIF.
- Captures : `/tmp/claude-0/-home-user-Gouvernance-Risk-Control-Tools/8ad96fa7-1a3e-54fe-b0db-c63b5dc23437/scratchpad/shots-v4/`.
