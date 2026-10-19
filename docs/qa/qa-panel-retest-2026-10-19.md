# Retest QA du panel de gouvernance et revue des lots suivants (q155, q157, q158, q159, DECISION-079, D5, F0/F1/F2)

- Date : 2026-10-19. Agent : A08 (QA). Base : `9a86fb8`. Périmètre : `git diff 037314d..9a86fb8 -- backend database frontend` (113 fichiers).
- Statut : **PARTIAL_PASS**. Les 3 défauts MAJOR du passage précédent (F-PNL-01, 03, 06) sont fermés et retestés. Aucun BLOCKER. Deux défauts MAJOR nouveaux (F-PNL2-01, F-PNL2-06), huit MINOR, deux INFO.
- Ce verdict n'est pas un avis Security, Privacy ni Compliance. F-PNL2-06 est une piste d'effacement de trace par un administrateur : à qualifier par A10 (je ne la confirme pas comme vulnérabilité).

## 1. Ce qui a été exécuté

| Fichier | Contenu | Résultat |
|---|---|---|
| `backend/test/QA-panel2-unit.test.ts` | 25 tests : ordre « déjà décidé avant le 409 » sur 6 services, chemins Comité (q159), jeton Google (q155), middleware de notification, notifieur, droits des groupes fixes, étiquette q142 des listes | 21 PASS + 4 `it.fails` (F-PNL2-01, 04, 05, 05b) |
| `backend/test/QA-panel2-pg.test.ts` | 47 tests sur PostgreSQL réel : circuit q158, HTTP q158, revues D5, acceptations D5, atomicité sous concurrence, notifications de bout en bout, variantes de retest (D2c, D3, D2b), NUL dans les motifs | 44 PASS + 3 `it.fails` (F-PNL2-03, 06, 06b) |
| `backend/test/QA-panel2-migrations.test.ts` | 9 tests : 4 statiques, 5 sur bases jetables (`grc_qa_panel`, `grc_qa_panel_065`) | 9 PASS |
| `tests/integration/qa-panel2-front-playwright.mjs` | Chromium (`/opt/pw-browsers/chromium`) sur API simulée : menu F1, dialogue F2 sur Constats et Plans d'action, client F0 | 31 PASS + 1 défaut connu (F-PNL2-01) |

Suite complète (commande de référence du brief) : **2508 passés, 7 échecs attendus (`it.fails`), 0 échec** (référence 2434). Avec les bases D5/D3/D2c des développeurs recréées à neuf (`D5_PGDB`, `D3_PGDB`, `QA_D2C_PGDB`) : 2519 passés, 0 échec. `npm run typecheck` OK. `npm run build` frontend OK (après `npm run build --workspace @djamo/design-system`, nécessaire : sans lui le build échoue sur `@djamo/design-system/styles.css`).

Chaque `it.fails` a été vérifié séparément en retirant `.fails` : il échoue sur l'assertion métier attendue, pas sur l'installation. Mutations jouées sur le code de production (puis restauré, `git status` propre) : auteur autorisé à approuver (M1), auteur notifié (M2), notification sur échec (M3), noms non masqués (M5), remplacement sans retrait (M6), Audit qui confirme (M7), contestation qui lève l'étiquette (M8) : chacune fait échouer au moins un de mes tests.

Environnement : la base `grc_qa_a08` a été **reconstruite à neuf** (001 à 073 appliquées fichier par fichier). L'ancienne avait 068 à 070 appliquées à 22:37, avant le durcissement en place de 22:41 : elle n'avait donc pas les gardes (voir F-PNL2-10).

## 2. Retest des findings F-PNL

| Finding | Verdict | Preuve |
|---|---|---|
| F-PNL-01 MAJOR (intérimaire non receveur bloque la sortie confirmée) | **Fermé** | Test d'origine passé de `it.fails` à `it` (oracle inchangé ; seule la mise en place change, car 070 rend `valid_until` immuable : l'expiration est forgée en désactivant le trigger). Variantes ajoutées : cumul avec Audit et intérimaire suspendu, sans `confirmEmptyGroup` = erreur de domaine et le Risk Manager reste ; avec = départ, marqueur de vacance, désignation non consommée. |
| F-PNL-02 MINOR (non-membre) | **Fermé** | 404 avec ou sans intérimaire, avec ou sans confirmation ; rien consommé, personne retiré. |
| F-PNL-03 MAJOR (baisse de taille et lecture périmée) | **Fermé** | `expectedActiveId` revalidé sous verrou. Test d'origine (dépôt suspendu entre lecture et insertion) vert ; cinq tours de hausse et de baisse simultanées : jamais de baisse ACTIVE sans confirmation, au plus un PENDING, uniquement des `ConflictError`. |
| F-PNL-04 et 05 MINOR (passerelle avant les contrôles d'état et de seuil) | **Fermé pour les cas signalés**, famille résiduelle | Contrôle d'état avant passerelle vérifié sur 6 services (exécution, efficacité, constat, cycle, plan d'action, demande de mode, évaluation). Résidu : F-PNL2-05 et 05b. |
| F-PNL-06 et 06b MAJOR (id en MAJUSCULES) | **Fermé** | Propriétaire, champion et suppléant : son propre id en minuscules ou MAJUSCULES refusé ; l'id en MAJUSCULES d'un autre est stocké en forme canonique ; renommer le titulaire courant dans l'autre casse n'écrit rien. |
| F-PNL-07 MINOR (070 sans REVOKE) | **Fermé** | Empreinte du schéma identique bout à bout (trigger de garde et REVOKE présents) ; `PanelDbGuards-pg` rejoué. |
| F-PNL-08 MINOR (version en attente sans issue) | **Ouvert, inchangé** | Test épinglé toujours vert. q157 resserre l'ensemble des approbateurs (Risk Manager et Comité seulement) : le risque d'impasse n'est pas réduit. |
| F-PNL-09, 10, 12 INFO | Ouverts, inchangés | Tests épinglés toujours verts. |
| F-PNL-11 INFO (caractère invisible) | **Fermé** pour les routes de gouvernance | `reasonText`. La classe subsiste ailleurs : F-PNL2-06. |
| F-PNL-13 INFO (étiquette q142 partielle) | **Partiel** | Les 8 routeurs d'objet décorent lectures et actions ; le Plans d'action lit une liste qui ne décore pas : F-PNL2-01 (MAJOR). |
| F-PNL-14 INFO (exploitation) | Partiel | Suivi de migrations complet sur la base reconstruite. README toujours à `psql -1` pour les downs : sans conséquence (rejoué, avertissements seulement, le down se valide). `runMigrations.ts` toujours TLS seul. |

## 3. Les trois points à confirmer du lot arbitrages PO

1. **Renouvellement du jeton Google compté comme connexion : confirmé, tel que décrit, MINOR (F-PNL2-02).** Un jeton renouvelé (`iat` nouveau) appelle l'enregistreur ; six renouvellements horaires d'une session sans personne devant l'écran font six écritures de `last_seen_at`. Deux appareils aux jetons alternés rappellent à chaque requête (limité à une écriture par heure par l'enregistreur). Une session ouverte garde donc le compte « récemment connecté » : c'est précisément la lecture que q155 voulait supprimer (un compte dormant qui paraît actif). Le plafond d'une heure ne change pas la nature du signal. Piste : écrire sur un appel explicite d'ouverture de session par le frontend, pas à la vérification du jeton. Décision PO.
2. **Demande d'assouplissement sans expiration : confirmé, MINOR (F-PNL2-02b).** Le circuit lui-même tient (voir §4). Mais une demande vieille de 400 jours, dont l'auteur a été suspendu depuis, est encore approuvable et applique la politique, écrite au nom d'un compte suspendu. Elle n'est pas une impasse : si les approbateurs disparaissent, le prochain appel de l'administrateur la retire et applique la politique seul, avec le marqueur. Piste : expiration (ou revalidation du droit de l'auteur à l'approbation) et avertissement quand l'auteur ou le dernier approbateur disparaît. Décision PO.
3. **Gestion du 202 `pendingRequest` côté écran : aucun écran ne l'utilise encore, piège pour D7 (F-PNL2-09, MINOR).** `apiRequestFull` conserve le statut et `pendingRequest` (vérifié au navigateur). Mais `apiRequest`, chemin de tous les écrans existants, renvoie `data` seul : pour un 202, c'est la configuration **inchangée**, sans aucun signal d'attente. Un écran de réglage qui l'appellerait afficherait « appliqué » alors que rien ne l'est. Piste : exporter `setSelfValidationPolicy` dans une fonction dédiée qui utilise `apiRequestFull`, ou faire échouer `apiRequest` sur un 202.

## 4. Cas limites inter-modules du nouveau code

### Circuit q158 (assouplissement à deux personnes) : tient
- L'auteur, même avec les deux droits, ne peut ni approuver ni rejeter sa demande (service, et contrainte de base : un `UPDATE` direct est refusé par `svpr_maker_checker_check`). Un approbateur applique la politique ; `updated_by` est l'auteur de la demande, la ligne d'audit `APPROVE` porte l'approbateur et l'id de la demande, sans marqueur (un assouplissement confirmé n'est pas une exception). La passerelle voit ensuite `DOUBLE_CONFIRMATION`.
- Droits : Audit, un utilisateur sans droit, l'approbateur d'un autre tenant, un id inconnu : refusés ou 404, rien ne change. Lecture de la demande : administrateur et approbateurs seulement.
- Remplacement : la nouvelle demande retire la précédente (`WITHDRAWN`, motif « Replaced », lignes d'audit `CLOSE` et `SUBMIT`) ; l'ancienne n'est plus approuvable ni rejetable. Rétablir `REFUSE` pendant une demande la retire aussi.
- Concurrence, entrelacements forcés par une barrière entre lecture et écriture : deux administrateurs qui n'ont vu aucune demande et soumettent ensemble = une seule PENDING, l'autre `ConflictError`, aucune ligne d'audit parasite ; deux remplacements de la même demande = un seul, l'autre annulé en bloc ; approbation contre remplacement, approbation contre rejet : un seul gagnant, état final cohérent, jamais une demande PENDING à côté d'une politique déjà appliquée.
- Approbateur disparu : la demande reste PENDING ; l'appel suivant de l'administrateur passe par le chemin « seul », marqué, et la ferme. Un approbateur suspendu ne compte pas, un approbateur dormant compte. Sans les ports du circuit, le service refuse d'assouplir (échec fermé).
- Motifs : vide, espaces, NUL, espace de largeur nulle refusés au dépôt et au rejet, sans écriture.
- Défaut : F-PNL2-03 (id mal formé = 500).

### Atomicité (DECISION-079) : tient sur le périmètre
- Rejoué en plus des 13 tests de A06 : deux validateurs sur la même exécution (quatre tours) = un succès, un « déjà validée », **une seule** ligne d'audit ; une auto-validation confirmée envoyée deux fois (double clic) = un succès portant le marqueur, un refus, une seule ligne, aucune ligne sans marqueur ; panne d'audit sur revue, acceptation (création, rejet, fin) et demande de politique : rien d'appliqué, le même appel passe ensuite.
- Hors périmètre déclaré (audit encore après l'effet) : rejets et chemins Comité, créations et mises à jour. Je ne les ai pas retestés un par un ; leur sensibilité à un NUL est montrée avec F-PNL2-06.

### D5 : tient, sauf points notés
- Revue : l'auteur de l'action ne la revoit jamais (service, id en MAJUSCULES, et garde de base derrière) ; un tiers `REVIEWED` fait passer l'objet à `REVIEWED_BY_THIRD_PARTY`, une `CONTESTED` ne change pas l'étiquette ; entrée non marquée, inconnue, d'un autre tenant : 404 identiques ; une soumission qui baisse la taille est contestable ; une revue par personne et par entrée (409 propre, jamais d'erreur SQL) ; commentaires vides, NUL, largeur nulle, 501 caractères refusés, 500 accepté ; append-only pour le rôle d'exécution (`SET ROLE grc_app_runtime` : `UPDATE`, `DELETE`, `TRUNCATE` refusés).
- Acceptations : avec un confirmateur possible = PENDING, que ni l'acceptant, ni l'Audit, ni un utilisateur sans droit ne peuvent confirmer ; sans tiers (confirmateurs suspendus) = ACTIVE, régime `ALONE`, marqueur `principle.acceptance.alone` ; rejet, fin anticipée par l'acceptant ou l'Audit, doublon refusé, une acceptation échue ne se confirme plus et est fermée (« Expired; replaced », ligne `CLOSE`) quand on accepte de nouveau ; confirmation contre rejet et deux acceptations simultanées = un seul résultat ; entrées mal formées refusées sans écriture ; une date très lointaine est acceptée (aucune durée maximale n'existe, rien d'inventé).
- Masquage : sans `audit.read`, la liste des acceptations ne porte aucun identifiant (seulement `mine`) et le texte des notifications ne nomme personne ; `governancehealth.read` est exigé ; un autre tenant ne voit rien.
- Notifications, de bout en bout (vraies routes, vrai middleware, vrai notifieur, vraie base) : émises après les statuts 200, 201, 202 (et 204) des requêtes qui écrivent ; jamais sur 3xx, 4xx, 5xx, ni sur GET ni sans utilisateur ; aucune notification après un 403, un 400 ou un 409. Public : acceptation en attente = confirmateurs possibles hors auteur (ni Audit, ni suspendu, ni autre tenant) ; action appliquée seul = titulaires du droit de revue et gérant désigné, jamais l'auteur ; demande d'assouplissement = approbateurs possibles seulement, de nouveau notifiés au remplacement, et l'exception annoncée à l'Audit quand elle est appliquée seul ; contestation = Risk Manager, Comité, gérant, pas l'Audit contestataire, rien pour une simple revue ; départ d'un membre = les membres restants des trois groupes, sans le partant ; arrivée en Audit = le nombre d'actions non revues. Les huit types sont obligatoires.
- Points : F-PNL2-04 (un échec stoppe les autres destinataires), F-PNL2-07 et 08 (INFO).

### q155 (dernière connexion à l'identification) : tient, hors le point 1
Un nouveau jeton rappelle l'enregistreur, le même jeton jamais ; e-mail non vérifié, membre inconnu ou vérification en échec : aucun appel ; un rappel qui lève n'arrête pas la requête ; le fournisseur local n'écrit qu'à la connexion (test de A06 relu).

### q157, q159, reasonText
- q157 : un Audit ne confirme ni baisse de taille, ni demande de politique, ni acceptation ; il est prévenu de chaque baisse et peut la contester ; avec seulement des membres d'Audit autour, la baisse s'applique seule, marquée ; avec un Risk Manager, elle attend et l'Audit ne peut ni l'approuver ni la rejeter. Les droits des groupes fixes sont épinglés (aucune permission décisionnelle pour l'Audit).
- q159 : les deux validations du Comité refusent l'auto-validation (403) avec ou sans `governanceConfirmation` ; la validation ordinaire garde l'invite 409 puis le marqueur.
- `reasonText` : voir F-PNL2-06 pour ce qu'il ne couvre pas.

## 5. Migrations 066 à 073

- Série 066 à 073 continue (vérifiée numériquement), un up et un down chacun ; 072 et 073 sans `DELETE FROM`, `TRUNCATE` ni `DROP TABLE/COLUMN` dans l'up ; les 4 fonctions de 073 épinglent `search_path = pg_catalog, public, pg_temp`.
- **Up, down, up sur empreinte complète du schéma** (colonnes, contraintes, index, triggers, corps de fonctions avec leurs réglages, droits du rôle d'exécution, tables, permissions des rôles, lignes du suivi) : après `down 073..066`, le schéma est **identique** à celui d'une base construite avec 001..065 seulement, suivi compris ; `up 066..073` redonne exactement le schéma complet ; rejouer tous les up, rejouer les down sur un schéma déjà descendu, deux cycles : inchangé ; 073 puis 072 descendus et remontés seuls : inchangé.
- Rattrapages des droits rejoués quatre fois : aucun doublon de permission ; l'Audit ne reçoit jamais `config.selfvalidation.approve`, `acceptance.confirm`, `accept`, ni `orgprofile.approve` ; le Comité confirme sans accepter.
- Down 072 et 073 sur une base portant des demandes et des revues : passent, les lignes d'`audit_log` restent, seules les tables disparaissent (perte documentée).
- Réserve : F-PNL2-10 (durcissement en place de migrations déjà appliquées). Le doublon de numéro 044 (`044_audit_log_escalate`, `044_risk_idempotency`) est antérieur et sans down pour la seconde : INFO, hors périmètre.

## 6. Frontend

`npm run build` vert ; `tsc -b` vert. Parcours Chromium sur API simulée, 32 vérifications :
- **Menu F1** : sept groupes dans l'ordre ; « Risques » ouvert au départ ; un seul groupe ouvert à la fois ; Administration porte les intertitres Méthodologie, Référentiels, Plateforme (non cliquables), Dispositif de risque, grilles et appétence sous Méthodologie ; un item « À venir » est `aria-disabled` et ne change pas d'écran ; clavier (Entrée ouvre un groupe) ; rail replié (25 items atteignables) ; mobile (menu caché, ouvert par le bouton, refermé au choix d'un item) ; aucune exception JavaScript.
- **Dialogue F2 sur Constats** (écran que le développeur n'a pas rejoué) : le premier appel part sans confirmation ; le 409 ouvre le dialogue, **au-dessus** de la fenêtre « Clôturer le constat » (la zone de saisie reçoit les clics) ; bouton inactif sans motif ou avec des espaces ; un 400 du serveur reste dans le dialogue ; le renvoi porte `{ rule: "noSelfValidation", reason }` et le même commentaire ; un double clic n'envoie qu'un renvoi ; après succès, le badge « Appliqué sans validation indépendante » s'affiche ; Annuler n'envoie rien et l'écran le dit.
- **Dialogue F2 sur Plans d'action** : même résultat, le renvoi garde l'`evidenceId`. **F-PNL2-01** : après rechargement de la liste, le badge n'apparaît pas.
- **Client F0** : `apiRequestFull` conserve le 202 et `pendingRequest` ; `apiRequest` les perd (F-PNL2-09).
- Non couvert au navigateur : écran Évaluation (même hook, mêmes branches), fiche risque à onglets, conditions de 401/session expirée dans le dialogue. Captures dans le répertoire de travail du passage (non versionnées).

## 7. Findings

Sévérité = impact qualité/fonction (échelle QA), indépendante de la criticité Security ou Risk. Les tests portent le numéro.

### F-PNL2-01 : MAJOR : l'étiquette q142 n'apparaît jamais sur l'écran Plans d'action
- Chemin : clôturer un plan d'action sous `DOUBLE_CONFIRMATION` sans autre validateur, puis recharger l'écran.
- Attendu (q142, F2 « badge câblé dans ActionPlans ») : le plan clos reste affiché « Appliqué sans validation indépendante ». Observé : `ActionPlansPage` ne lit que `GET /api/v1/dashboard/actions` ; `actionPlanDashboardRouter(actionPlanService)` ne reçoit pas le port d'étiquette et ne renvoie jamais `validationIndependence`. Seules les lectures de `GET /actions` et la réponse de la clôture le portent, et l'écran jette cette réponse en rechargeant la liste. Le badge est du code mort.
- Impact : un acte sans validation indépendante apparaît comme un acte ordinaire à l'endroit où l'on suit les plans ; la garantie de visibilité de q142 est absente sur cet écran.
- Preuves : `QA-panel2-unit.test.ts` (« F-PNL2-01 », `it.fails`, plus un contrôle statique : les 8 autres routeurs acceptent le port, le tableau de bord non) ; Playwright (`KNOWN-DEFECT(F-PNL2-01)`).
- Correctif : passer le port à `actionPlanDashboardRouter` et décorer comme `GET /actions` ; ou faire lire `GET /actions` à l'écran.

### F-PNL2-06 : MAJOR, sécurité suspectée : un NUL dans le motif d'un réglage de gouvernance modifie le réglage sans laisser de trace
- Chemin : `PUT /config/committee-enforcement` (ou `/committee-audit-cumul`) avec `reason: "motif\u0000piégé"`, par un détenteur de `config.committeeenforcement.set` (ou `config.cumul.set`).
- Attendu : refus 400 avant tout effet (même règle que `reasonText`, SEC-PNL-01). Observé : le corps est accepté (`z.string().min(1)`), le service écrit la configuration **puis** enregistre l'audit ; PostgreSQL refuse le NUL (22P05) ; l'appel se termine en erreur 500 mais **l'obligation de validation par le Comité est désactivée et aucune ligne d'audit n'existe**. Confirmé sur PostgreSQL réel (état après l'appel, nombre de lignes d'audit).
- Portée : la correction SEC-PNL-01 (`reasonText`) ne couvre que les routes de gouvernance du panel. Les corps `reason`/`comment` de config (4 setters), contrôles, départements, KPI, KRI, processus, grilles, appétence, risques, évaluations (`comment`), cycles, plans d'action, exécutions, efficacité restent `z.string()` nus. Là où l'audit est dans la transaction (DECISION-079) le résultat est un 500 sans effet ; là où il suit l'effet (réglages, rejets, chemins Comité, créations, mises à jour), c'est une modification non tracée.
- Tests : `QA-panel2-pg.test.ts` « F-PNL2-06 » et « 06b » (`it.fails`) ; un test épingle le 500 de la route.
- Correctif : `reasonText()` sur tous les corps de motif et de commentaire (helper partagé, test de garde statique sur le modèle de `boundedArray`) ; hors transaction, l'audit ne peut pas être vérifié avant l'effet : la validation d'entrée est donc la seule garde, et l'écriture de l'effet et de l'audit dans une même transaction (DECISION-079) reste le filet. À transmettre à A10 et à Compliance (CMP-PNL-01 reste vrai hors périmètre).

### F-PNL2-02 : MINOR : un renouvellement silencieux du jeton Google compte comme une connexion (point à confirmer n°1)
Voir §3. Tests : `QA-panel2-unit.test.ts` U3. Décision PO.

### F-PNL2-02b : MINOR : une demande d'assouplissement n'expire pas (point à confirmer n°2)
Voir §3. Test : `QA-panel2-pg.test.ts` « no expiry ». Décision PO.

### F-PNL2-03 : MINOR : un id mal formé sur approuver/rejeter une demande de politique donne un 500
`POST /config/self-validation-policy/requests/:id/approve|reject` passe `req.params["id"]` sans `z.guid()` ; PostgreSQL répond 22P05/22P02, l'erreur n'est pas une erreur de domaine : 500. Les autres routeurs D5 valident l'id (400). Test : « F-PNL2-03 » (`it.fails`). Correctif : `IdParam = z.guid()`.

### F-PNL2-04 : MINOR : un échec d'émission pour un destinataire arrête les notifications des suivants
Dans `GovernanceNotifier.send`, l'exception de `emit` sort de la boucle : les autres destinataires de la même ligne, et les autres blocs de la ligne, ne sont pas notifiés (une notification obligatoire est perdue en silence, l'erreur est seulement journalisée). Un destinataire supprimé entre la recherche et l'émission suffit. Test : « F-PNL2-04 » (`it.fails`). Correctif : `try/catch` par destinataire.

### F-PNL2-05 et 05b : MINOR : la passerelle précède encore deux contrôles de précondition
- `ActionPlanService.close` : l'existence de la preuve est contrôlée **après** la passerelle. L'auto-valideur seul est invité à confirmer (409), puis, une fois confirmé, reçoit « Evidence … does not exist » (400). Même famille que F-PNL-04. Test : « F-PNL2-05 » (`it.fails`) et son contrôle.
- `ProcessEvaluationModeRequestService.validate` : le niveau du processus est contrôlé après la passerelle. Test : « F-PNL2-05b » (`it.fails`).
- Correctif : passerelle en dernier dans les deux services.

### F-PNL2-07 : INFO : l'étiquette ne montre pas qu'une action a été contestée
Une action contestée par l'Audit, puis relue par un tiers, affiche « revue par un tiers » : une contestation n'est visible que dans l'historique des revues. Voulu par la conception (« une contestation est une objection, pas une revue ») mais à signaler au design de D6/D7. Épinglé.

### F-PNL2-08 : INFO : `X-Request-Id` fourni par le client et émission multi-instances
`requestIdMiddleware` reprend l'en-tête du client. Un acteur qui rejoue un même identifiant n'obtient pas de doublon dans un processus (mémoire des lignes traitées), mais une seconde instance lisant les mêmes lignes émet de nouveau ; seule `skipIfUnread` limite le bruit. Aucun impact d'autorisation : lignes filtrées par tenant, acteur et 10 minutes. Épinglé.

### F-PNL2-09 : MINOR : `apiRequest` perd le 202 `pendingRequest`
Voir §3. Test navigateur. À traiter avant D7.

### F-PNL2-10 : MINOR : durcissement en place de migrations déjà appliquées
068 à 071 ont été modifiées en place (`0ea4150`). Le runner suit les migrations par nom de fichier : tout environnement qui avait appliqué les versions précédentes ne rejouera pas le durcissement (gardes, clés étrangères composites, REVOKE) **ni le retrait d'`orgprofile.approve` aux rôles Audit existants** (q157 : 071 ne le retire pas, elle ne fait que ne plus l'ajouter). Ma propre base de test était dans ce cas jusqu'à reconstruction. À vérifier, environnement par environnement, que 066 à 071 n'y ont pas été appliquées avant `0ea4150` ; sinon, migration corrective (retrait d'`orgprofile.approve` aux rôles `AUDIT`, gardes). Le brief ne dit pas si un environnement partagé est concerné.

### F-PNL2-11 : INFO : hygiène
Le test `QA-panel-migrations.test.ts` (le mien, du passage précédent) laisse le suivi de migrations vide pour 066 et suivantes ; mon nouveau test le restaure. Doublon de numéro 044 antérieur, sans down pour `044_risk_idempotency`. Les notes de `README` des migrations sur `psql -1` pour les downs restent inexactes mais sans effet.

## 8. Ce qui n'est pas testé

- Sécurité du jeton Google (signature, audience) : Security. Je n'ai testé que la logique de comptage.
- Rejets, chemins Comité, créations et mises à jour sous panne d'audit : hors périmètre déclaré de DECISION-079, non rejoués un par un.
- Écran Évaluation et fiche risque au navigateur ; 401 en cours de dialogue.
- Neon : aucun test n'a touché Neon.

## 9. Revues à transmettre

- **Security (A10)** : F-PNL2-06 (effacement de trace par un administrateur autorisé, à qualifier), F-PNL2-10 (droits Audit sur les bases anciennes), F-PNL2-02 (signal de présence).
- **Compliance (A14)** : F-PNL2-06 et F-PNL2-01 (visibilité de q142), CMP-PNL-01 hors périmètre.
- **Privacy (A15)** : F-PNL2-02 (la « dernière connexion » reste un signal de présence), masquage D5 rejoué sans écart.
- **Risk Manager (A13)** : aucun comportement nouveau à qualifier ; F-PNL2-02b est une décision de seuil pour le PO.
- **Release** : retest après correction de F-PNL2-01 et F-PNL2-06 ; passer les 7 `it.fails` en `it`.

STATUS : PARTIAL_PASS ; RETEST_REQUIRED pour F-PNL2-01 et F-PNL2-06.
