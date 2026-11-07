# PRIV-governance-d6 — Revalidation Privacy du lot D6

ASSESSMENT_ID: PRIV-GOV-D6-2026-11-04
DATE: 2026-11-04
ASSESSOR: A15 (Privacy / Data Protection)
BRANCHE REVUE: feat/r1-governance-d6 (e8e1ef9), telle que décrite par le coordinateur

## 0. Limite de vérification

La branche n'est pas checkoutée dans le worktree de A15 et aucun outil Bash n'est disponible. Une recherche dans le worktree ne trouve ni `last_seen_retention_days`, ni `last-seen-purge`, ni `last_token_iat`. Les conclusions ci-dessous portent sur le résumé de conception reçu, non sur le code. Aucune conclusion « CONFIRMED » n'est donc possible ; elles sont au niveau PROBABLE. Une vérification de code (migration, route, test d'idempotence, journal d'audit) est requise avant revalidation de production.

## 1. Avis par point

### R1 — libellé « dernière activité » : LEVÉ EN CONCEPTION
Le libellé correspond à la date mise à jour à chaque activité, telle que décrite dans le texte R5 et la note D6. Condition : le libellé de l'API et de l'interface doit être identique.

### R2 — panneau D6 sans `audit.read` (« Personne N » + comptages) : LEVÉ EN CONCEPTION
Pas de date par personne sans droit d'audit (q156). Condition de production : test prouvant qu'une réponse sans `audit.read` ne contient aucune date par personne, y compris dans les index et exports.

### R3 — `configs.last_seen_retention_days` : LEVÉ EN CONCEPTION, avec réserves
- Défaut 1826 jours (5 ans) : cohérent avec le texte R5.
- Plage 1 à 3650 : acceptable ; le plafond de 10 ans doit être justifié par le client.
- Changement journalisé via le circuit des délais de gouvernance : acceptable.
- Réserve A : le champ ne couvre que la date de dernière activité. Le texte R5 et la note D6 ne fixent pas de durée pour le nom affiché ni pour les rôles et droits après la fin du compte. Ce point est ouvert (voir §2).

### R3 bis — `users.deleted_at` comme point de départ : ACCEPTABLE SOUS CONDITIONS
- Acceptable si `deleted_at` n'est posé qu'à la clôture définitive du compte. Une suspension temporaire qui poserait `deleted_at` ferait courir le délai trop tôt et effacerait la dernière activité d'un compte encore en instruction (contrôle interne, fraude).
- Condition : preuve (test) qu'une suspension temporaire ne pose pas `deleted_at`, et que la réactivation le remet à NULL en journalisant l'événement.
- Recommandation (non bloquante) : colonne distincte `closed_at` ou `terminated_at`, à prévoir au plus tard lors du prochain lot.

### R3 ter — route `POST /api/v1/privacy/last-seen-purge` : CONDITION DE PRODUCTION
- Mise à NULL de `last_seen_at` et `last_token_iat` : minimisation correcte. Le compte, le nom et les rôles restent : point ouvert (§2).
- Idempotence : acceptable.
- Une ligne d'audit par compte, sans recopier la date effacée : acceptable.
- Droit `user.update` : insuffisant. L'effacement est irréversible ; il doit avoir sa propre permission (ex. `privacy.purge`), conformément à la règle du dépôt sur les actions terminales. Condition de production. Avis Security à demander.
- Pas de planificateur : tant que le job nocturne (q231, DevOps) n'est pas en place et prouvé par ses journaux, la rétention n'est pas appliquée. Condition de production.

### R5 — page « Vos données » : LEVÉ EN CONCEPTION
- Phrase durée corrigée : « la date de dernière activité est conservée 5 ans » et durée lue de la configuration client : acceptable.
- Contact DPO « à renseigner par l'administrateur » : acceptable en conception. Condition : champ de réglages client, et interdiction d'afficher un placeholder en production.
- Validation du texte par le DPO : condition de production (cf. texte-information-R5-2026-11-04.md, statut projet).

### D5 — acceptations avec instantané des clés d'objets, sans nom : ACCEPTABLE
Condition : les clés d'objets ne doivent pas contenir de donnée personnelle (identifiant nominatif, nom de dossier nommé). Vérification requise.

### R4 — non décrit dans le résumé : NON ÉVALUÉ

### R6 — formalité ARTCI : NON PRÉCISÉE — CONDITION DE PRODUCTION
La formalité éventuelle auprès de l'ARTCI (déclaration ou autorisation) n'est pas qualifiée. Qualification à faire par Compliance et le DPO. Aucune affirmation n'est faite ici sur la nature de la formalité.

### Point de départ `users.deleted_at` : voir R3 bis.

## 2. Points ouverts

| Point | Constat | Statut |
| --- | --- | --- |
| Nom affiché et rôles après 5 ans | Le purge ne traite que deux colonnes. Le texte R5 dit « puis effacées » pour l'ensemble de la phrase initiale ; la version corrigée ne le dit plus. Après 5 ans, le compte, son nom et ses rôles subsistent sans limite. | OPEN — à trancher : durée propre au nom et aux rôles, ou effacement / anonymisation de la ligne compte. |
| Identifiants dans `audit_logs` | Les lignes d'audit (append-only) référencent l'identifiant du compte ; elles survivent à la purge. Durée de conservation de ces lignes non définie. | OPEN — tension avec l'effacement ; à arbitrer par Compliance et DPO. |
| Preuve du job nocturne | Non démontrée. | CONDITION DE PRODUCTION |
| Permission dédiée à la purge | `user.update` actuel. | CONDITION DE PRODUCTION |
| Contact DPO | Champ de réglages à créer. | CONDITION DE PRODUCTION |

## 3. Conclusion

- R1, R2, R3 (avec réserves), R5 : levés en conception.
- R3 bis : `users.deleted_at` acceptable comme point de départ, sous réserve que la suspension temporaire ne le pose pas.
- R3 ter, R6, validation DPO du texte, job nocturne : conditions de production non remplies.
- Les points ouverts (nom et rôles après 5 ans ; identifiants dans les audits) empêchent de conclure que la durée de conservation est complète pour l'ensemble des données.

STATUS: CONDITIONAL — conception revue sur résumé ; production non revalidée ; ESCALATED vers PO (durée nom et rôles, q231), Compliance (R6, audit_logs), A10 (permission de purge).
