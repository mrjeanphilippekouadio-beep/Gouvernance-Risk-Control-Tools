# QA — Panel de gouvernance, lot D6bis (q233 A seuils réglables, q234 C ALLOWED_BY_SETTING, DECISION-061 / migration 086)

Agent A08 QA, 2026-11-08. Branche `feat/r1-governance-d6bis`, tête `368937a` (base staging `d10b07f`). Pas un avis Security, Privacy ni Compliance.

**Verdict : VERT AVEC RÉSERVES (PASS_WITH_RESERVES).** Les six seuils (défauts, bornes, valeur exacte et ±1), le seuil d'échantillon de 10 risques, l'exclusion des groupes fixes, le statut ALLOWED_BY_SETTING et son périmètre, le circuit relever/abaisser et la migration 086 se comportent comme les décisions. Aucun BLOCKER ni MAJOR. 1 défaut MINOR confirmé (`it.fails`) : l'auteur du réglage du cumul est nommé par son identifiant aux lecteurs sans `audit.read`.

## 1. Exécution

| Suite | Résultat |
|---|---|
| `backend/test/QA-governance-d6bis.test.ts` (`QA_GD6B_LIVE=1`, vrai serveur + PG16 local 127.0.0.1:55442, base `grc_qa_gd6bt`, harnais `qaVisibilityHarness.ts`) | 32 tests : 31 PASS + 1 `it.fails` ; sans variable : 2 PASS (statique) |
| avec `QA-governance-d6.test.ts` (mis à jour par A06) | 77 PASS + 1 expected fail |
| `cd backend && npm run typecheck && npm test` | OK : 166 fichiers PASS + 21 skipped ; 2818 PASS |
| Mutation : `>` remplacé par `>=` sur la part RISK-01 et sur le nombre d'administrateurs | 7 tests rouges, source restaurée |

Aucun serveur laissé (le harnais arrête le sien). Base saine : Risk Manager {rm, n1}, Comité {com, raci}, Audit {aud}, 12 risques tenus par un compte hors groupes, activité récente pour tous.

## 2. Couverture (oracles écrits avant exécution)

- **Défauts et bornes** (six seuils) : défauts de la base 20 / 3 / 25 / 4 / 90 / 50 ; la colonne refuse min-1 et max+1 et accepte min et max ; la route répond 400 pour min-1, max+1, décimal, chaîne et null, sans écriture.
- **Circuit** : abaisser = direct (200, valeur changée, audit avec motif) ; relever = 202 demande en attente, valeur inchangée, l'auteur ne l'approuve pas, un membre du Comité l'approuve et la valeur s'applique ; une demande mêlant relèvement et abaissement attend en bloc (rien n'est appliqué avant la décision).
- **RISK-01** : 2/10 (20 %) respecté, 3/10 (30 %) offender USER avec la part ; la part est par membre (2 + 2 sur 10 respecté) ; seuil 10 : 20 % fautif ; seuil 40 : 4/10 respecté, 5/10 fautif ; 9 risques => NOT_EVALUABLE avec raison, 10 => évalué, un risque archivé sort de l'échantillon ; sous 10 risques un groupe d'un seul membre reste NOT_RESPECTED.
- **ACC-01** : (a) 3 administrateurs actifs respecté, 4 fautif avec le décompte, suspendu non compté, seuil 4 et 2 ; (b) 25 permissions respecté, 26 fautif, 3 familles respecté, 4 fautif, seuils 15 / 3 / 5 modifiables, groupe fixe Risk Manager (plus de 25 permissions, 4 familles ou plus) jamais fautif, `rolegroup.audit.update` sur un rôle personnalisé toujours fautif ; (c) 89 jours sans activité respecté, 91 fautif (mention « 90 jours », aucune date dans la réponse), seuils 45 / 180 ±1, compte suspendu et compte ordinaire jamais signalés, activité NULL dormante seulement si le suivi a plus de 90 jours (89 / 91), administrateur et membre de groupe fixe.
- **OWN-01 (d)** : 5/10 créés et possédés par la même personne (50 %) respecté, 6/10 fautif (« 60 % ») ; le créateur est lu dans l'entrée CREATE du journal (sans entrée, sans propriétaire ou créateur différent : non compté) ; seuils 25 et 80 ±1 ; 9 risques tous créés et possédés => NOT_EVALUABLE, 10 => fautif, 9 dont un sans propriétaire => NOT_RESPECTED.
- **GOV-SOD-04** : paramètre interdit + cumulant Comité + Audit => NOT_RESPECTED « paramètre : interdit » ; paramètre autorisé => ALLOWED_BY_SETTING, cumulant listé, réglage daté et attribué (nom pour l'Audit) ; masqué sans `audit.read` : même statut, cumulant « Personne N », ni id ni nom du cumulant ; restent NOT_RESPECTED : Risk Manager + Audit autorisé ou non, cumulant ayant validé ses propres saisies (puis retour à ALLOWED_BY_SETTING quand la fenêtre est avancée), cumul autorisé à côté d'un autre cumul (administrateur + Risk Manager), administrateur + Audit ; aucun cumulant => RESPECTED (pas ALLOWED_BY_SETTING) ; ALLOWED_BY_SETTING n'est pas une acceptation (`acceptance` null) et ne déclenche pas GOV-TRC-02.
- **Migration 086** : un client dont le cumul était déjà autorisé garde `true` après aller-retour down / up (aucune ligne existante modifiée), le DEFAULT d'une nouvelle ligne devient `false`, une nouvelle ligne est `false`, un second up ne change rien, les six colonnes reviennent à leurs défauts, le down les retire et le up les rétablit avec leurs CHECK.

## 3. Constats

| ID | Sévérité QA | Constat | Repro | Statut |
|---|---|---|---|---|
| QA-D6B-01 | MINOR | Pour un lecteur sans `audit.read` (Risk Manager, Comité), l'offender USER est pseudonymisé mais son `detail` n'est pas filtré : « Comité + Audit — autorisé par le paramètre (réglage du 2026-11-08 par aaaaaaaa-…010c) » donne l'identifiant du compte qui a changé le réglage et la date. Même classe que QA-D6-01 (R-6.1 : jamais d'identifiant par personne). Cause : `GovernanceHealthService.mask()` retourne `{ ...o, id: null, label: person(o.id) }` pour un USER sans passer le `detail` par `hideUserIds` | cumulant Comité + Audit, réglage autorisé, une ligne `Config` du journal qui passe `committeeAuditCumulAllowed` de false à true ; `GET /governance-health` en `rm` : le `detail` de GOV-SOD-04 contient l'UUID de l'auteur | `it.fails` |

### Points à trancher (QA_CHALLENGE)

1. **ALLOWED_BY_SETTING et pression** : un cumul autorisé reste listé mais sort des alertes ; la date et l'auteur du réglage ne sont visibles que pour l'Audit (une fois QA-D6B-01 corrigé).
2. **Demande mixte** : relever un seuil et en abaisser un autre dans la même requête attend en bloc la seconde personne, y compris pour la partie qui aurait été directe ; comportement prudent, à confirmer.
3. **Dormance à la borne** : un compte vu exactement il y a 90 jours est dormant à la milliseconde près ; les tests utilisent ±1 jour.
4. **Non couvert** : RISK-01 sur une charge de milliers de risques (une requête d'agrégat par lecture), seuils par l'écran « Réglages de gouvernance » (navigateur), création de risque réelle par l'API (la source du créateur est le journal, simulé ici par l'entrée CREATE).

## 4. Non-régression

`QA-governance-d6.test.ts` (A06 a adapté ses oracles : RISK-01 / OWN-01 sous 10 risques, cumul par défaut) reste vert. Rejouer après correctif : `QA_GD6B_LIVE=1 npx vitest run test/QA-governance-d6bis.test.ts --no-file-parallelism` et repasser en `it` le `it.fails`.
