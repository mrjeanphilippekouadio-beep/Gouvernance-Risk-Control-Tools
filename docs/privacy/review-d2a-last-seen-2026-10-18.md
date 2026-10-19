# Revue Privacy : lot D2a, `users.last_seen_at`

- Identifiant : PRIV-REV-D2A-001
- Date : 2026-10-18
- Assesseur : @privacy (A24)
- Relecteur : à désigner (Compliance A15 pour la partie séparation des fonctions et données personnelles, selon le plan RM-V1 ligne 595)
- Périmètre : lot D2a (commit f99cec1, HEAD 21b6fc6). Fichiers : `database/postgresql/migrations/067_users_last_seen_at.sql`, `backend/src/infrastructure/identity/lastSeen.ts`, câblage `backend/src/server.ts` (l. 7, 461, 465, 470).
- Décisions de référence : DECISION-074 (q140, q143, q144), DECISION-075 (q146 à q153, dont q152 : aucune autre donnée, pas d'appareil, pas d'IP).
- Usage prévu : panel « Principes de gouvernance » (lot D6), donnée « dernière connexion », pour repérer les comptes à privilèges inactifs (GOV-ACC-01, moindre privilège).

## Verdict

**OK AVEC RÉSERVES.**

Le lot D2a, tel que codé, ne crée pas de collecte excessive : une seule valeur par compte, écrasée à chaque mise à jour, jamais reconstituée, non exposée par l'API actuelle, tenant-scopée. Le verdict n'est pas bloquant pour le lot D2a lui-même.

En revanche, trois réserves doivent être levées **avant l'activation du panel (lot D6)** : R1 (sémantique de la donnée), R2 (visibilité des dates par personne), R3 (durée de conservation). R5 (information des personnes) doit être traitée au plus tard au déploiement de 067 en production. R4 (journal applicatif) est une correction de code très courte à faire avant la mise en production de D2a.

## Faits vérifiés

| Fait | Source |
|---|---|
| Colonne nullable, sans valeur par défaut, sans remplissage rétroactif | migration 067, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS last_seen_at timestamptz` (aucun UPDATE) |
| Une seule valeur par utilisateur, écrasée (pas d'historique) | `lastSeen.ts` l. 24 : `UPDATE users SET last_seen_at = now()` |
| Écriture tenant-scopée, compte non supprimé uniquement | `lastSeen.ts` l. 25 : `WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL` |
| Au plus une écriture par heure et par utilisateur (filtre mémoire + condition SQL) | `lastSeen.ts` l. 19 et 26 |
| Échec : journal Pino `warn` avec `tenantId`, `userId`, type d'erreur ; requête non bloquée | `lastSeen.ts` l. 30 à 33 |
| Le déclencheur n'est pas la connexion mais toute requête authentifiée : `authMiddleware` appelle `identity.verifyToken` à chaque requête ; `LocalIdentityProvider.verifyToken` (l. 122) et `GoogleIdentityProvider.verifyToken` passent par le résolveur `lookupMembershipSeen` | `backend/src/api/middleware/auth.ts` l. 24 ; `LocalIdentityProvider.ts` l. 90 et 122 ; `server.ts` l. 461 à 471 |
| Aucune exposition API à ce stade : le mappeur `toDomain` de `PostgresUserRepository` est explicite et ne reprend pas `last_seen_at` (le `SELECT *` ramène la colonne, le mappeur la écarte) | `PostgresUserRepository.ts` l. 7 à 18 ; `users.routes.ts` |
| Aucune entrée `audit_log` pour cette écriture (télémétrie) | `lastSeen.ts` ; plan RM-V1 ligne 369 |
| Lecture de la liste des utilisateurs : `user.read` (administrateur) | `permissions.ts` l. 274 ; `users.routes.ts` commentaire ACT-105 |
| Le middleware de logs HTTP masque `authorization` et `cookie`, mais journalise `remoteAddress`, `user-agent`, en-têtes d'IP (constat staging du 2026-10-08, memory `privacy.md`) | `httpLogger.ts` ; memory `privacy.md` section DECISION-012 |
| Test unitaire : une écriture par heure et par utilisateur, scopée tenant ; pas de rejet en cas d'échec | `backend/test/lastSeen.test.ts` |

## Cadre applicable

- **RGPD** : `GDPR_APPLICABILITY = NOT_ESTABLISHED`. Aucun établissement UE, ni ciblage de personnes dans l'UE, n'est établi dans le dépôt. À reconfirmer par le juriste si cela change.
- **Droit local** : loi n° 2013-450 relative à la protection des données à caractère personnel, et ARTCI. Je ne cite aucun article : je n'ai pas consulté le texte et je ne suis pas sûr des références précises. Le juriste de Djamo doit confirmer le régime applicable (formalités, base légale).
- **BCEAO** : exigences de contrôle interne et de gestion des habilitations applicables à l'établissement. Référence exacte non citée ici, à fournir par Compliance (A15).
- **Droit du travail ivoirien** : la donnée concerne des collaborateurs (hypothèse à confirmer : les comptes sont ceux de salariés ou de prestataires). Une mesure de l'activité de salariés exige information préalable et proportionnalité. Points à faire valider par le juriste, sans référence d'article.
- **Benchmark seulement** : ISO/IEC 27001 (contrôles d'accès aux droits, journalisation). ISO 27001 n'est pas une loi de protection des données.

## Analyse par point demandé

### 1. Finalité et minimisation

- Finalité déclarée : repérer les comptes à privilèges inactifs (moindre privilège). Cette finalité est légitime et exige seulement une date par compte. La forme retenue (une valeur, écrasée, sans IP ni appareil) est proportionnée **à condition que la donnée soit bien ce qu'on annonce** (voir R1).
- Écart : le libellé est « dernière connexion » (q152, plan D13 « dernière authentification réussie »), mais le déclencheur est toute requête authentifiée. Un onglet ouvert ou un appel répété maintient la date à jour. La donnée est donc à la fois plus fréquente que la finalité et moins fiable pour le contrôle visé (un compte dormant peut paraître actif).

### 2. Base légale plausible

- Hypothèse de travail : intérêt légitime de sécurité et de gestion des habilitations, ou obligation de contrôle interne si Compliance le confirme. Test de proportionnalité à documenter.
- Le consentement n'est pas adapté dans une relation de travail (lien de subordination). À ne pas retenir.
- Base légale et formalités ARTCI : à confirmer par le juriste (R6).

### 3. Durée de conservation

- Aucune durée n'est définie aujourd'hui. La valeur est écrasée, donc l'historique est nul, mais la date reste sur la ligne `users` tant que le compte existe, et après suppression logique (`deleted_at`). Les sauvegardes et le PITR Neon conservent les valeurs anciennes (principe 5, memory `privacy.md`).
- Il faut une règle : par exemple, effacement ou mise à NULL à la suspension, ou purge à l'échéance de la conservation du compte. La durée est un arbitrage PO et juriste ; je ne l'impose pas (R3).

### 4. Qui peut lire

- Côté API : aujourd'hui, personne ne lit la colonne (mappeur explicite). Bon état, à protéger par un test de non-régression (R2).
- Côté panel (D6) : administrateur, Risk Manager, Audit, Comité (q140). Les noms ne sont visibles qu'avec `audit.read`, mais le plan R-6.1 ne couvre pas les **dates** attachées à un pseudonyme « Personne 1 ». Dans une petite structure, une date plus un libellé identifie la personne (R-6.1, dernier alinéa, reconnaît le problème pour les comptages, pas pour les dates). Voir R2.

### 5. Information des utilisateurs

- Aucun texte d'information n'existe dans le dépôt pour cette donnée. Les personnes concernées doivent savoir : ce qui est enregistré (date de la dernière activité authentifiée), pourquoi, qui peut la voir, combien de temps, leurs droits, le contact DPO (R5).

### 6. Journaux applicatifs

- `lastSeen.ts` journalise `tenantId` et `userId` en cas d'échec d'écriture. Le `userId` est l'identifiant d'une personne physique ; il n'est pas nécessaire au diagnostic (le type d'erreur suffit). Correction simple (R4).
- Journaux HTTP (hors D2a, pré-existant) : IP et user-agent par requête. D2a n'ajoute pas d'IP en base, mais l'association de ces journaux et des dates d'activité permettrait de reconstituer l'activité. Ce point est traité en R7.

## Réserves

**R1. Sémantique de la donnée : « connexion » ou « activité » ? (BLOQUANT POUR D6)**
- Constat : le libellé du panel et de q152 dit « dernière connexion ». Le code enregistre la dernière requête authentifiée (`authMiddleware` → `verifyToken`). Le plan D13 dit « dernière authentification réussie ». Les trois ne coïncident pas.
- Conséquence : indicateur de moindre privilège peu fiable (un compte réellement dormant peut paraître actif) ; information des personnes inexacte si elle parle de connexion.
- Action, au choix du PO :
  - (a) garder le déclencheur actuel, renommer la donnée « dernière activité authentifiée » dans le panel et dans l'information (R5), et documenter la limite du contrôle ;
  - (b) limiter l'écriture aux authentifications réelles. Pour l'authentification locale, le point d'appel est `LocalIdentityProvider.authenticate` (l. 90). Pour Google, il n'existe pas d'événement de connexion explicite côté serveur : l'Architecte doit proposer le point d'écriture.
- Qui décide : **PO** (libellé et option a/b) ; **Architecte** (point d'écriture) ; **dev-backend** (mise en œuvre).

**R2. Visibilité des dates par personne (BLOQUANT POUR D6)**
- Constat : sans `audit.read`, le masquage du plan (R-6.1) remplace les noms par « Personne 1, 2… ». Il ne dit rien des dates de dernière activité rattachées à ces pseudonymes.
- Action :
  - sans `audit.read`, n'afficher que des **comptages** (par exemple « N comptes sans activité depuis plus de X jours ») ;
  - les dates par personne restent réservées à `audit.read`, ou sont supprimées avant sérialisation ;
  - test de non-régression : aucune réponse sans `audit.read` ne contient une date `last_seen_at` par personne ni un `userId` ;
  - test de non-régression sur l'API `users` : `last_seen_at` n'apparaît pas dans les réponses de `/users` et `/users/me` (à ajouter à la suite de tests).
- Qui décide : **PO** (extension de q140) ; **A13 et A05** (spécification du panel) ; **dev-backend** (masquage et tests).

**R3. Durée de conservation non définie (BLOQUANT POUR LA MISE EN PRODUCTION DU PANEL)**
- Action : le PO et le juriste définissent la règle. Options à arbitrer : mise à NULL à la suspension ; effacement à l'échéance de la conservation du compte ; date de référence de la purge. Toute promesse d'effacement doit inclure les sauvegardes et le PITR (principe 5).
- Qui décide : **PO** (durée) ; **juriste Djamo / DPO** (validation) ; **dev-db** (purge si retenue).

**R4. Identifiant de personne dans le journal applicatif (CORRECTION AVANT PRODUCTION DE D2A)**
- Action : retirer `userId` du `log.warn` de `lastSeen.ts` (garder `errorType`). `tenantId` peut rester pour le diagnostic si l'équipe le juge utile. Ajouter un test vérifiant l'absence de `userId` dans l'appel au logger.
- Qui décide : **équipe** (dev-backend met en œuvre ; A24 vérifie).

**R5. Information des personnes concernées (À TRAITER AU DÉPLOIEMENT DE 067 EN PRODUCTION, AU PLUS TARD AVANT D6)**
- Action : rédiger un texte d'information (contenu de la donnée, finalité, base légale, lecteurs, durée, droits, contact DPO), affiché sur la page de profil (`/users/me`) ou à l'onboarding. Le texte doit refléter le choix retenu en R1.
- Qui décide : **PO** (contenu et canal) ; **juriste Djamo** (validation) ; **A24** (relecture finale).

**R6. Base légale et formalités ARTCI (À CONFIRMER AVANT D6)**
- Action : le juriste confirme la base légale, dit si le traitement des comptes internes est couvert par une formalité existante ou à déclarer, et valide le test de proportionnalité.
- Qui décide : **juriste Djamo / DPO** ; **PO** pour la décision de déclarer ; **Compliance A15** pour la référence BCEAO.

**R7. Journaux HTTP pré-existants : IP et user-agent (HORS D2A, À SUIVRE)**
- Constat : le journal HTTP contient déjà l'adresse IP et le user-agent par requête (constat staging du 2026-10-08). Le fait que D2a ne stocke ni IP ni appareil est exact pour la base, mais ne signifie pas que l'IP n'est pas traitée dans le système.
- Action : inscrire ce point dans l'item existant sur les journaux de la voie B-4 (durée courte, accès restreint, ou hachage). Ne pas le présenter comme une propriété de D2a.
- Qui décide : **Security (A10)** pour la technique ; **PO** pour la durée.

**R8. Libellé « pas de connexion depuis le <trackedSince> » (FAIBLE, QUALITÉ DE DONNÉE)**
- Constat : `NULL` signifie « aucune authentification enregistrée depuis la mise en service de la colonne 067 ». `trackedSince` (plan R-6.2) est posé plus tard, par la migration de D6. Le libellé du plan peut donc affirmer une absence que la donnée ne prouve pas pour la période entre 067 et `trackedSince`.
- Action : libeller « aucune activité enregistrée depuis le <date de déploiement de 067> », et ne pas utiliser `trackedSince` pour cette phrase.
- Qui décide : **A13 et A05** (libellé) ; **PO** (validation).

## Points de suivi (déclencheurs de nouvelle revue)

- Détection automatisée de deux comptes appartenant à une même personne (plan, liste des données volontairement non créées) : nouvelle revue Privacy obligatoire avant toute automatisation.
- Tout usage de `last_seen_at` pour une décision sur une personne (blocage automatique de compte, notation, alerte nominative) : nouvelle revue Privacy.
- Tout export ou tout rapport contenant cette date : revue Privacy.

## Ce qui est conforme pour le périmètre évalué

- Donnée unique, écrasée, sans historique : OK.
- Pas de remplissage rétroactif : OK.
- Pas d'IP, pas d'appareil, pas de user-agent dans la donnée : OK (pour la table ; voir R7).
- Écriture tenant-scopée et limitée aux comptes non supprimés : OK.
- Pas d'entrée `audit_log` pour la télémétrie : OK.
- Échec non bloquant, sans valeur de donnée dans le journal (hors R4) : OK.
- Pas d'exposition API actuelle : OK, à protéger par test (R2).

## Niveau de confiance

- Faits techniques (écriture, déclencheur, mappeur, journaux) : **CONFIRMED** (lecture du code, 2026-10-18).
- Sémantique « connexion » contre « activité » : **CONFIRMED** pour le déclencheur ; l'impact sur l'usage des utilisateurs (session ouverte, rafraîchissement) est **PROBABLE**, à vérifier en exploitation.
- Cadre juridique : **OPEN** (aucun article cité, à confirmer par le juriste).

## Limites

- Revue du code et des documents du dépôt uniquement. Pas de test en environnement, pas de vérification de la base de production.
- Je n'ai pas vérifié le comportement du frontend (rafraîchissement de token, polling) qui détermine la fréquence réelle des écritures (R1).
- Le périmètre des « utilisateurs » (salariés, prestataires, administrateurs) est une hypothèse.
- Aucun avis juridique. Les références de loi ne sont pas vérifiées.

## Conclusion

Verdict : **OK AVEC RÉSERVES** pour le lot D2a. Statut du périmètre : **COMPLIANT_FOR_ASSESSED_SCOPE** sur la conception technique de la colonne, avec réserves ouvertes (R1 à R8) ; **REVALIDATION_REQUIRED** avant D6 ; **UNDER_REVIEW** pour l'ensemble du panel tant que R1, R2, R3, R5 et R6 ne sont pas closes.

## Revalidation demandée

Après correction, A24 revalide sur :
- R1 : décision PO écrite, déclencheur conforme au libellé ;
- R2 : tests de non-régression (API sans `last_seen_at`, panel sans dates par personne sans `audit.read`) ;
- R3 : règle de durée validée par le PO et le juriste, appliquée ;
- R4 : `userId` retiré du journal, test présent ;
- R5 : texte d'information validé ;
- R6 : avis juridique écrit.

Statut : **OPEN**.
