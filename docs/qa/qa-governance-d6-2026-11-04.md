# QA — Panel de gouvernance, lot D6 (DECISION-113/114 : panneau santé, R3 conservation, R5 « Vos données »)

Agent A08 QA, 2026-11-04. Branche `feat/r1-governance-d6`, tête `e8e1ef9` (base staging `513d1cc`, migration 085). Pas un avis Security, Privacy ni Compliance.

**Verdict : ORANGE (PARTIAL_PASS).** Les 16 détecteurs évalués se comportent comme la spec sur PostgreSQL 16 réel (un cas positif et un négatif chacun), ACCEPTED partiel/total, le masquage par `audit.read`, l'isolation par client, les bornes de la purge R3 et le texte R5 sont conformes. Aucun BLOCKER ni MAJOR. 3 défauts MINOR confirmés (`it.fails`), dont une fuite d'identifiant de personne vers les lecteurs sans `audit.read`.

## 1. Exécution

| Suite | Résultat |
|---|---|
| `backend/test/QA-governance-d6.test.ts` (`QA_GD6_LIVE=1`, vrai serveur + PG16 local 127.0.0.1:55442, base `grc_qa_gd6t` reconstruite à chaque run, harnais `qaVisibilityHarness.ts`) | 46 tests : 43 PASS + 3 `it.fails` ; sans variable : 5 PASS + 1 `it.fails` (statique), le reste ignoré |
| `tests/integration/qa-governance-d6-playwright.mjs` (Chromium, backend 8098 + vite 5198, base `grc_qa_gd6p`, `qa-helpers.mjs`) | 22 PASS, 0 FAIL, 0 erreur JS ou console imprévue |
| `cd backend && npm run typecheck && npm test` | OK : 164 fichiers PASS + 21 skipped ; 2797 PASS + 1 expected fail, 695 skipped |

Serveurs et vite arrêtés en fin de passage. Jeu : 12 comptes V1/V2 ; base saine construite en SQL (Risk Manager {rm, n1}, Comité {com, raci}, Audit {aud}, réglages posés, processus tous pourvus), puis une altération par scénario. Lecteur nommé = `aud` (`audit.read`) ; lecteurs masqués = `rm`, `com`, `adm` ; sans droit = `out`, `dept`, `own`. Le début du suivi (`trackedSince`) est avancé entre les scénarios pour isoler les lignes de journal (le journal est en ajout seul).

## 2. Couverture (oracles écrits avant exécution, depuis la spec et le catalogue A13)

- **Forme** : 401 anonyme ; 403 sans `governancehealth.read` ; 200 pour RM, Comité, Audit et un administrateur titulaire du droit ; aucun paramètre ne change la réponse, POST/PUT/PATCH/DELETE refusés, aucune ligne d'audit écrite par la lecture (I-P3) ; 19 principes dont 3 NOT_EVALUABLE avec raison (SOD-05, COM-02, OWN-03) et jamais RESPECTED à tort ; base saine = 16 RESPECTED ; `trackedSince` = colonne 085 ; aucune taille d'organisation devinée sans profil.
- **Détecteurs** (positif puis négatif) : SOD-01 (acte marqué, validation par l'auteur sans marqueur ; validation par un autre compte, type d'entité hors liste, ligne antérieure au suivi, autre règle : aucun) ; SOD-02 (décision de repli en attente de ratification, 3 jours, puis ratifiée) ; SOD-03 (auto-attribution active ; compte suspendu ou attribution révoquée : aucun) ; SOD-04 (admin+RM, RM+Audit, RM+Comité, Comité+Audit annoté « autorisé par le paramètre » ; retour au vert) ; RISK-01/02 (1 membre, 0 = vacance, intérimaire lève RISK-02 seulement, Comité à 1, vacance au-delà du maximum déclaré) ; AUD-01/02 (droit hors lecture sur le rôle Audit, membre Audit + RM, aucun Audit) ; COM-01 (réglage de passage désactivé, seuil absent, Comité à 1, aucune configuration => NOT_EVALUABLE) ; APP-01 ; OWN-01 (sans propriétaire, propriétaire suspendu ; archivé et supprimé ignorés) ; OWN-02 (sans champion ; inactif ignoré) ; ACC-01 ; TRC-01 (compte et âge, relu => levé, trace de vacance exclue) ; TRC-02 (principe grave non respecté sans gérant => offender, gérant désigné => levé) ; REG-01 (régime déclaré avec plusieurs personnes ; levé).
- **ACCEPTED** : l'acceptation D5 mémorise les clés `{kind, id}` des objets en cause (aucun libellé) ; en attente = pas accepté ; l'auteur ne confirme pas ; confirmée par le Comité => ACCEPTED ; un nouvel objet en cause => NOT_RESPECTED (partiel) ; retour à l'ensemble accepté => ACCEPTED ; échue => NOT_RESPECTED ; plus aucun objet => RESPECTED (pas ACCEPTED) ; `acceptedBy`/`confirmedBy` null sans `audit.read`.
- **Exceptions** : total, non revues, âge, retard q168/q180 (trace de vacance jamais en retard, relue jamais en retard, sans délai jamais en retard) ; auteur, libellé et identifiant null sans `audit.read`, `mine` conservé.
- **Masquage R-6.1** : « Personne 1/2 » distincts, sans identifiant ni nom ni UUID dans toute la réponse ; aucune date de dernière activité pour personne ; libellé d'un risque PERIMETRE/NOMINATIF jamais renvoyé (id et décompte restent) ; autre client sans effet.
- **R3** : défaut 1826 ; la colonne refuse 0, -1, 3651 ; la route des délais borne 1..3650 entier, motif obligatoire ; raccourcir s'applique (audité), allonger ou passer à NULL = demande 202 en attente d'une seconde personne, valeur inchangée ; purge : 401, 403 sans `user.update` (out, dept, rm, com) ; compte terminé depuis 1826 j + 12 h effacé (date et jeton), 1825,5 j non, compte actif non, autre client non, compte jamais supprimé en base (mise à NULL seulement) ; audit : une ligne UPDATE par compte, par l'appelant, motif avec la durée, `old_value` null, aucune date effacée dans le journal ; deuxième passage sans effet ni audit ; rétention 1000 j puis 1 j atteint plus de comptes (terminé il y a 12 h épargné à 1 j) ; NULL = rien effacé ; sans ligne de configuration => 1826 ; aucun paramètre de requête ne cible un autre client ; plafond par utilisateur => 429.
- **R5** : `GET /privacy/notice` 401 anonyme, ouvert à tout compte connecté, durée du client, `dpoContact` null ; navigateur : l'écran « Vos données » s'ouvre depuis le menu de session pour `rm` et pour `out` (aucun droit), six paragraphes, aucune variable restante, 5 ans / 1000 jours / 2 ans / 1 jour / « sans limite fixée par votre organisation », DPO « à renseigner par l'administrateur », durée de l'écran = durée de l'API.

## 3. Constats

| ID | Sévérité QA | Constat | Repro | Statut |
|---|---|---|---|---|
| QA-D6-01 | MINOR | Le bloc `exceptions.items` rend `entityType` et `entityId` bruts. Pour une trace `riskManager.vacancy` (entité `User`), `entityId` est l'identifiant du compte concerné : un lecteur sans `audit.read` (Risk Manager, Comité, administrateur) reçoit l'identifiant d'une personne, contre R-6.1 (« jamais de nom ni d'identifiant par personne ») | insérer une ligne `governance_exception = 'riskManager.vacancy'`, `entity_type = 'User'`, `entity_id` = un compte ; `GET /governance-health` en `rm` : l'UUID figure dans la réponse | `it.fails` |
| QA-D6-02 | MINOR | Les listes sont coupées à 50 (`HEALTH_LIST_LIMIT`) sans le dire : 55 risques sans propriétaire donnent 50 objets en cause et aucun total (les totaux exacts n'existent que pour les exceptions). Le panel sous-estime l'écart | 55 risques CLIENT sans propriétaire ; `GOV-OWN-01.offenders.length` = 50, aucun `count` | `it.fails` |
| QA-D6-03 | MINOR | Texte R5 : avec une durée NULL (jamais effacée) l'écran dit « conservée sans limite fixée par votre organisation après la fin de votre compte (…), puis effacée » : la dernière proposition est fausse et la phrase bancale (`privacyNotice.ts`, `fillPrivacyNotice`) | durée NULL, ouvrir « Vos données » (parcours navigateur) | `it.fails` (statique) |

### Points à trancher (QA_CHALLENGE)

1. **SOD-04 et `committeeAuditCumulAllowed`** : la règle A13 dit « selon `config.committeeAuditCumulAllowed` » ; le détecteur signale le cumul Comité + Audit même quand le réglage l'autorise (avec l'annotation « autorisé par le paramètre »). Cohérent avec la spec §3.2 (« en signalant »), mais le principe reste NOT_RESPECTED pour un cumul permis : à confirmer par A13.
2. **Retard et vacance** : la trace `riskManager.vacancy` compte dans le total mais jamais dans les non revues ni en retard (conforme à D5) ; l'écran doit l'expliquer.
3. **Troncature de SOD-01** : les validations par l'auteur sans marqueur sont aussi coupées à 50 (même cause que QA-D6-02).
4. **Désactiver l'effacement** : `lastSeenRetentionDays = NULL` passe par le circuit des délais (202, seconde personne) quand un tiers existe ; seul, un administrateur l'applique (régime ALONE, marqué). Comportement correct mais à garder en tête pour Privacy.
5. **Non couvert** : GOV-REG-01 cas (b) (régime non déclaré, une seule personne), `organizationSize` et `profileGaps` avec un profil actif (niveau 1 seulement), charge du chargement des faits (11 requêtes par lecture, sans cache), purge à grande échelle, scheduler (aucun dans l'application, un appel externe est requis).

## 4. Non-régression

`npm test` complet vert. Les tests de référence mis à jour par A06 (migrations 085, `QA-visibility-v2bis/v3`) restent légitimes. Rejouer après correctif : `QA_GD6_LIVE=1 npx vitest run test/QA-governance-d6.test.ts --no-file-parallelism` et repasser en `it` les 3 `it.fails`.
