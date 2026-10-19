# Retest sécurité A10 n° 2 : lot de correctifs backend (d99e281) et lot frontend F3 (eeec6b0), 2026-10-19

- **Escalade HUMAN : aucune.** Aucun constat n'atteint CVSS 7. Le score le plus élevé est 3,1 (SEC-PNL3-01, LOW).
- Périmètre : `d99e281` (fusionné en `3d48654`) et `eeec6b0` (fusionné en `a0334f5`), HEAD `6a8eac8`. SEC-PNL2-02 est hors périmètre : il reste ouvert et attend le PO (q173). Je ne l'ai pas corrigé.
- Méthode : revue statique des deux diffs, puis PoC sur une base locale à moi, `grc_a10_rt3`. Socket `/tmp/claude-0/pgsock`, port 5531, migrations 001 à 074 appliquées avec psql, `schema_migrations` créée à la main. Les attaques SQL tournent sous `grc_app_runtime`. Les PoC utilisent les vrais services et dépôts, et le vrai middleware de notifications monté dans Express. Je n'ai touché ni `grc_qa_a08` ni Neon.
- Vérifications :
  - `tsc --noEmit` OK.
  - vitest : 2344 tests verts, 259 ignorés (les suites `-pg` sont ignorées sans base).
  - Suites `-pg` lancées sur `grc_a10_rt3` (retestLot, D079, D5, QA-panel2, PanelDbGuards) : 80 verts, 3 ignorés. Lors d'un premier passage en parallèle, le test 074 de `retestLot-pg` a échoué une fois (I-RT3-06, test instable).
  - Je n'ai pas lancé le build frontend : les `node_modules` du frontend sont incomplets dans le dépôt principal. QA le vérifie.
- **Verdict : PASS avec réserves.**
  - **Feu vert sécurité pour la PR vers staging.** Tous les correctifs demandés sont fermés, sauf une réserve sur I01 (SEC-PNL3-01).
  - Avant la production, il reste : SEC-PNL3-01, la réserve d'exploitation de SEC-PNL2-01 (I-RT3-01, à trancher par A09/HUMAN) et SEC-PNL2-02 (PO).

## Synthèse

| ID | Sévérité | CVSS 3.1 | Confiance | Titre | Porteur | Statut |
|---|---|---|---|---|---|---|
| SEC-PNL2-01 | — | — | PoC rejoué | Notifications supprimées en coupant la connexion | A06 | **RETEST_PASS, CLOSED** pour le vecteur client. Le résidu d'exploitation est suivi en I-RT3-01 |
| SEC-PNL2-03 | — | — | SQL runtime rejoué (18 cas) | 072 sans garde en base | A07/A06 | **RETEST_PASS, CLOSED** |
| I01 | — | — | PoC | `last_token_iat` en base | A06 | **RETEST_PASS sur le multi-instance**. Il reste un résidu, voir SEC-PNL3-01 |
| I02 | — | — | PoC | `\p{Cs}` refusé | A06 | **RETEST_PASS, CLOSED** |
| I05 | — | — | code | Masquage des réponses d'acceptation | A06 | **RETEST_PASS, CLOSED** |
| I06 | — | — | code | `code` structuré du 409 | A06/A05-front | **Backend fermé.** Le frontend ne lit pas encore le `code` (I-RT3-04) |
| I10 | — | — | code | `:id` validé (`z.guid()`) | A06 | **RETEST_PASS, CLOSED** |
| I11 | — | — | code | `ValidateCommitteeBody` | A06 | **CLOSED** (`governanceConfirmation` est désormais retiré par zod) |
| **SEC-PNL3-01** | LOW | 3,1 | CONFIRMED (PoC) | `IS DISTINCT FROM` n'est pas monotone : un jeton plus ancien, ou deux jetons valides en alternance, comptent chacun comme une connexion et coûtent un UPDATE par requête | A06 | REMEDIATION_REQUIRED (avant D6 et la production, non bloquant pour staging) |
| SEC-PNL3-02 | INFO | 0 | CONFIRMED (PoC sur le service) | Setters hérités de `ConfigService` avec audit après l'effet : inatteignables en production, mais du code mort dangereux | A06 | À nettoyer |
| SEC-PNL3-03 | INFO | — | PoC | `reasonText` accepte les caractères de format invisibles ou bidi (U+202E, U+FEFF, U+E00xx) et un motif fait d'un seul signe combinant | A06 | Option |
| SEC-PNL3-04 | INFO | — | code | F3 affiche comme « en vigueur » 3 réglages `configs` que le Dispositif porte désormais. « Modifier » échoue toujours | A05-front, PO | À corriger |
| I-RT3-01…06 | INFO | — | — | Voir la section INFO | divers | — |

---

## 1. Lot de correctifs backend

### SEC-PNL2-01 : notifications déclenchées par `res.end`. **Le choix tient pour le vecteur client.**

PoC `A` (scratchpad `poc_rt3.mts`) : vrai `governanceNotificationsMiddleware` dans Express, avec un gestionnaire qui « committe » à 80 ms.

```
committed = [normal, aborted, post-commit-500]
notified  = [normal, aborted]
```

- **Client qui coupe la socket à 20 ms : la notification est émise.** Le gestionnaire va jusqu'au bout et appelle `res.json` → `res.end`, même sur une socket détruite. Le vecteur de SEC-PNL2-01, contrôlé par l'auteur, est fermé.
- Coupure avant que le corps soit lu (1 ms) : rien n'est committé, et donc rien n'est notifié. C'est correct.
- **Résidu confirmé : une erreur levée après le COMMIT.** Le gestionnaire passe alors par `next(err)` et répond 500, si bien qu'aucune notification n'est émise alors que l'effet est committé. Un client ne peut pas provoquer ce cas : les services répondent après le COMMIT, et la mise en forme JSON ne dépend pas d'une entrée qui pourrait la faire échouer. Ce cas rejoint le résidu « crash entre COMMIT et `res.end` » qu'A06 a accepté.
- `triggered` empêche un double déclenchement. Les méthodes GET, HEAD et OPTIONS sont exclues. La lecture des lignes reste filtrée par tenant, `request_id`, acteur et une fenêtre de 10 minutes. Un `X-Request-Id` réutilisé ne fait rien perdre, parce que la déduplication porte sur l'id de la ligne d'audit (`handled`), pas sur l'id de requête.
- Un échec d'émission est désormais isolé par destinataire (F-PNL2-04), ce qui est un progrès.
- **Réserve d'exploitation, ma position : I-RT3-01.** `processRequest` reste du travail en arrière-plan, après la réponse et sans `await`. Sur Cloud Run, si le CPU n'est alloué que pendant les requêtes (le réglage par défaut), ce travail peut être ralenti ou perdu quand l'instance est mise au repos ou arrêtée. De plus, `server.ts` n'a aucun gestionnaire `SIGTERM` pour vider les requêtes en cours. Aucun attaquant ne contrôle ce cas, mais la compensation retenue par le PO (q157, R-6.4, SEC-PNL-04) n'est alors pas garantie. Avant la production, A09/HUMAN doivent choisir l'une de ces options :
  - CPU toujours alloué et arrêt propre sur `SIGTERM` ;
  - un balayage de rattrapage (lignes d'audit marquées sans notification), ce qui reste ma recommandation n° 2 de SEC-PNL2-01.
  
  Ce point ne bloque pas staging.

### SEC-PNL2-03 : garde de 072 durcie en place. **Fermé.**

SQL sous `grc_app_runtime` (scratchpad `poc072.sql`) :

| Tentative | Résultat |
|---|---|
| INSERT d'une demande APPLIED, ou PENDING avec `decision_reason` | 42501 |
| Réécriture de `reason`, `requested_by`, `requested_policy` ou `tenant_id` sur une demande PENDING | 42501 « content … immutable » |
| Auto-approbation (auteur = décideur) | CHECK `svpr_maker_checker_check` |
| Décideur d'un autre tenant | FK `svpr_decided_by_tenant_fk` |
| PENDING → APPLIED par B | accepté (transition légitime) |
| APPLIED → PENDING (réouverture), APPLIED → REJECTED, réécriture de `decision_reason` ou `decided_by` après décision, UPDATE sans changement | 42501 « decided once » |
| DELETE, TRUNCATE | permission refusée (REVOKE), plus les triggers |
| Table temporaire homonyme puis réouverture | 42501 : `search_path = pg_catalog, public, pg_temp` est fixé sur les 2 fonctions, sans SECURITY DEFINER |
| DISABLE TRIGGER, `session_replication_role` | refusés (pas propriétaire, pas superutilisateur) |

- `reopen()` est retiré du dépôt PostgreSQL. Le chemin non transactionnel ne l'appelle plus qu'en option (`reopen?.`), pour les faux des tests. `.down` supprime bien les deux fonctions.
- Résidus INFO (I-RT3-05) :
  - la base ne contraint pas `decided_at`, qu'un accès SQL runtime pourrait antidater lors de la transition ;
  - la base n'exige pas `decision_reason` sur REJECTED (le service l'exige).
  
  Ce ne sont pas des réécritures après coup. La modification en place de 072 suppose qu'elle n'a jamais été appliquée sur une base partagée : c'est la même hypothèse que pour I07, à confirmer par A09/HUMAN (déjà suivi).

### I01 : `users.last_token_iat` (074). **Le multi-instance est fermé. Un résidu reste ouvert : SEC-PNL3-01.**

PoC `B` (deux enregistreurs, comme deux instances, base réelle). Les nombres sont les `rowCount` des UPDATE :

```
inst1 iat=1000 → 1 ; inst2 iat=1000 → 0                       (multi-instance : OK)
inst1 et inst2 voient iat=2000 en même temps → 1, 0           (atomique : OK)
alternance 3000,4000,3000,4000,3000,4000 → 1,1,1,1,1,1        (chaque bascule compte)
rejeu d'un jeton plus ancien (iat=1000 après 4000) → 1, last_token_iat revient à 1000
```

→ SEC-PNL3-01, détaillé plus bas. q175 reste une question PO : un renouvellement silencieux compte comme une connexion.

### I02, I05, I10, I11 : **fermés.**

- **I02.** `isAcceptableReason` refuse `\p{Cc}` et `\p{Cs}`. PoC `C` : `a\ud800` est refusé par `reasonText`, en mono-ligne comme en multiligne, et par `optionalComment`.
- **I05.** `view()` est appliquée à la liste et aux réponses de `accept`, `confirm`, `reject` et `revoke`. `acceptedBy`, `confirmedBy` et `endedBy` sont nuls sans `audit.read`.
- **I10.** `IdParam = z.guid()` est appliqué à approve et reject. La comparaison maker-checker relit `requested_by` en base et la compare à `actor.userId` : pas de classe SEC-ID-01.
- **I11.** `ValidateCommitteeBody = { comment: optionalComment }`, non strict, donc `governanceConfirmation` est retiré.

### Nouvelle surface : `reasonText` généralisé et `multiline`

- Aucun `reason`, `comment`, `justification` ou `outcome` n'est encore en `z.string()` nu dans `api/v1` (vérifié par grep). Les champs de texte libre passent par `reasonText(…, true)` ou `optionalComment`.
- Caractères acceptés (PoC `C`, mono-ligne / multiligne / `optionalComment`) :

| Entrée | mono | multi | optComment | Commentaire |
|---|---|---|---|---|
| `\n`, `\t`, `\r\n` | n | Y | Y | voulu ; aucun effet en text ou en jsonb |
| NUL, C1 `\u0085`, surrogate isolé | n | n | n | SEC-PNL-01 et I02 tiennent |
| `\u000b` en fin de chaîne | Y | Y | Y | retiré par `trim()` avant la vérification ; refusé au milieu du texte |
| emoji, U+2028, U+FFFF | Y | Y | Y | acceptés par PostgreSQL (vérifié en text et en jsonb) |
| **U+202E (RLO), U+FEFF, U+E0041 (tag)** | **Y** | **Y** | **Y** | SEC-PNL3-03 (INFO) |
| **U+0301 seul (signe combinant)** | **Y** | **Y** | **Y** | compté comme « visible » via `\p{M}` (INFO) |
| ZWSP seul, usage privé seul | n | n | n | OK |
| NBSP seul, espace idéographique seul | n | n | Y | `trim()` donne `""`, une valeur vide acceptée par conception |

- Aucun caractère accepté ne fait échouer l'audit, en text comme en jsonb : PostgreSQL ne refuse que NUL et les surrogates isolés, et les deux sont filtrés. La classe SEC-PNL-01 (un motif qui fait échouer l'audit) n'est donc plus atteignable par ces champs.

### Nouvelle surface : `ConfigRepository.upsert(…, audit?)` et les autres setters de `ConfigService`. **Pas exploitable comme SEC-PNL-01.**

PoC `D` (scratchpad `poc_rt3_config.mts`) : `ConfigService` câblé **comme dans `server.ts`**, avec les dépôts PostgreSQL réels et `riskFrameworkRepository` passé.

```
updateCommitteeThresholds / updateEvaluationMode / setCommitteeEnforcement → ValidationError « Ce réglage est porté par le Dispositif »
setCommitteeAuditCumul("motif\u0000") / ("motif\ud800")                     → ValidationError (isAcceptableReason au service)
setCommitteeAuditCumul(false) avec un trigger temporaire qui fait échouer l'audit Config → P0001, réglage inchangé (true), 0 ligne d'audit
setCommitteeAuditCumul(true) normal                                         → appliqué + 1 ligne d'audit dans la même transaction
```

- **Setters restés « audit après effet » :**
  - `updateEvaluationMode`, `updateCommitteeThresholds` et `setCommitteeEnforcement` lèvent `assertNotOwnedByFramework()` **avant** toute écriture dès que `frameworks` est câblé, ce qui est toujours le cas dans `server.ts`. Ils sont donc inatteignables en production.
  - `updateMethodology` et `updateAppetiteMode` n'ont aucun appelant : les routes répondent 410.
  - Même s'ils étaient atteignables, les entrées HTTP passent par `reasonText`, et `before`/`after` sont relus en base.
  - → Aucun motif client ne peut faire échouer l'audit. **Pas de SEC-PNL-01 bis.**
- En revanche, appelés directement, `updateMethodology("motif\u0000")` et `updateAppetiteMode` **écrivent l'effet puis échouent à l'audit (22021)**. PoC : `configs.score_formula = WEIGHTED_SUM`, `appetite_mode = MANUEL`, 0 ligne d'audit. C'est du code mort dangereux : SEC-PNL3-02 (INFO).

---

## 2. Lot frontend F3 (eeec6b0) : **PASS sécurité**

- **Secrets** : aucun. Pas de nouvelle `VITE_*`, pas de stockage navigateur, pas de `console`, pas de `dangerouslySetInnerHTML`, `innerHTML` ou `href` dynamique. Le jeton est passé en prop, comme ailleurs.
- **Règles métier** : aucune n'est recalculée.
  - Le 202 est lu sur le statut HTTP, et le texte affiché reprend `res.data.selfValidationPolicy` (la politique inchangée renvoyée par le serveur).
  - La double confirmation passe par `useGovernanceConfirm`, qui ne s'ouvre que sur le 409 du serveur et renvoie la même requête.
  - `WithoutReviewBadge` affiche la valeur `validationIndependence` du serveur.
- **Autorisation** : aucune décision n'est prise par l'écran seul. Les boutons Modifier, Approuver, Rejeter, Valider et Proposer sont visibles et le serveur tranche (403/409/404, puis rafraîchissement). L'auteur voit le bouton « Approuver » sur sa propre demande et le serveur la refuse ; le texte le dit. `GET …/request` en 403 masque simplement la demande.
- **Injection** : les données du serveur (`reason`, `rejectionReason`, `requestedBy`, noms de processus) sont rendues comme texte React, donc échappées. Les ids sont passés par `encodeURIComponent`.
- **Constats non sécurité, à transmettre à QA et à dev-frontend** (le front échoue fermé, sans contournement) :
  1. `approvePolicyRequest` envoie `{}`. Depuis `d99e281`, la route exige `reason` (`ApproveSelfValidationPolicyBody`), donc **Approuver renvoie toujours 400**. Ce lot frontend a été écrit avant le lot backend.
  2. Les motifs saisis dans un `<textarea>` sont envoyés tels quels. Les motifs de `config` et le rejet de mode d'évaluation sont en `reasonText` **mono-ligne**, donc un retour à la ligne donne 400.
  3. `PolicyRequestStatus` déclare `APPROVED`, alors que le backend renvoie `APPLIED`.
  4. Trois cartes sur cinq ne peuvent jamais être modifiées : voir SEC-PNL3-04.

---

## Constats détaillés

### SEC-PNL3-01 : « dernière connexion » Google, la comparaison `IS DISTINCT FROM` n'est pas monotone

- **COMPONENT** : `backend/src/infrastructure/identity/lastSeen.ts` (requête avec `tokenIat`) et le filtre mémoire `lastIat` (dans `lastSeen.ts` et dans `GoogleIdentityProvider`).
- **PRECONDITION** : un utilisateur authentifié qui détient deux jetons Google valides. C'est le cas ordinaire de deux onglets, ou d'un renouvellement GIS pendant que l'ancien jeton n'a pas encore expiré (moins d'une heure).
- **OBSERVED** (PoC `B`, base réelle) : chaque changement d'`iat` déclenche un UPDATE effectif, y compris vers un `iat` **plus ancien**. `last_token_iat` recule alors (4000 → 1000). Les filtres mémoire ne gardent que le dernier `iat` vu : avec deux jetons en alternance, chaque requête produit donc un UPDATE sur `users`.
- **IMPACT** :
  - la « dernière connexion » (q155, et le futur contrôle de comptes dormants D6) est gonflée à volonté par le titulaire du compte : un compte reste « actif » tant qu'un onglet tourne ;
  - amplification d'écriture bornée : un UPDATE de plus par requête authentifiée, sur une ligne `users`.
  
  Aucun gain d'accès, et le compte doit être le sien.
- **CVSS 3.1** : AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:L/A:N = **3,1 LOW**.
- **RECOMMANDATION** (la plus simple) :
  - en SQL : `AND (last_token_iat IS NULL OR last_token_iat < $3)` ;
  - en mémoire : ignorer un `iat` inférieur ou égal au dernier vu (`<=` au lieu de `===`).
  
  q175 (le renouvellement silencieux compte comme une connexion) reste une question PO distincte.
- **REGRESSION_TEST** : séquence 4000 → 1000 → 4000 → 3000, avec un seul UPDATE effectif après le premier, et `last_token_iat` qui ne recule jamais.
- **STATUS** : REMEDIATION_REQUIRED (A06), avant D6 et la production. Non bloquant pour staging.

### SEC-PNL3-02 : setters hérités de `ConfigService` avec audit hors transaction (code mort)

- `updateMethodology` et `updateAppetiteMode` n'ont aucun appelant : les routes répondent 410. `updateEvaluationMode`, `updateCommitteeThresholds` et `setCommitteeEnforcement` sont bloqués en production par `assertNotOwnedByFramework`.
- Tous écrivent l'effet **puis** l'audit, hors transaction, et ne vérifient que `reason.trim()`. PoC `D` : appelés directement avec `"motif\u0000"`, l'effet est committé sans aucune trace (22021).
- **IMPACT** : nul aujourd'hui. Le danger est qu'une future route (ou un retrait de `frameworks` du câblage) rouvrirait SEC-PNL-01 telle quelle.
- **RECOMMANDATION** (ponytail) : supprimer `updateMethodology` et `updateAppetiteMode`. Pour les trois autres, soit les supprimer s'ils ne servent plus qu'à répondre « porté par le Dispositif », soit les passer par `writeAudited` avec `isAcceptableReason` au service, comme `setCommitteeAuditCumul`.
- **STATUS** : INFO (A06), à traiter avec le prochain nettoyage.

### SEC-PNL3-03 : caractères de format invisibles ou bidirectionnels acceptés dans les motifs

- `isAcceptableReason` refuse `\p{Cc}` et `\p{Cs}`, mais pas `\p{Cf}` : U+202E (RLO), U+2066–2069, U+FEFF et les caractères d'étiquette U+E0000–E007F passent. Elle accepte aussi un motif composé d'un seul signe combinant (`\p{M}`).
- **IMPACT** : il n'y a ni échec d'audit ni injection, puisque React échappe le texte. Un motif peut en revanche **s'afficher autrement qu'il n'est stocké** (RLO), ou porter du texte invisible (étiquettes Unicode) face à l'approbateur de q158 ou à un relecteur d'exception. C'est une usurpation d'affichage mineure.
- **RECOMMANDATION** (option) : ajouter à la classe refusée les contrôles bidi (`‪-‮⁦-⁩`) et les étiquettes (`\u{E0000}-\u{E007F}`) ; exiger au moins un caractère `\p{L}\p{N}\p{P}\p{S}` (sans `\p{M}` seul).
- **STATUS** : INFO (A06).

### SEC-PNL3-04 : F3 affiche des réglages `configs` que le Dispositif porte désormais

- Les cartes « Mode d'évaluation par défaut », « Seuils de passage au Comité » et « Passage obligatoire par le Comité » lisent `GET /config`. Depuis B-6b, ce point d'accès n'est plus qu'un **historique obsolète** pour ces valeurs : les évaluations lisent la copie de leur version de Dispositif (`committeeSettingsOf`), et l'écriture répond toujours « Ce réglage est porté par le Dispositif ».
- **IMPACT** : un écran de gouvernance présente comme « en vigueur » un état de contrôle qui ne l'est pas. Par exemple, il peut afficher « Non obligatoire » alors que le Dispositif rend le passage obligatoire, ou l'inverse. Il n'y a aucun contournement, puisque l'écriture échoue fermée. C'est la même leçon que pour DECISION-055 : un réglage ne doit jamais afficher un contrôle qui n'existe pas.
- **RECOMMANDATION** : retirer ces trois cartes, ou les remplacer par un renvoi à la version active du Dispositif (A05-front, arbitrage PO sur le contenu de l'écran).
- **STATUS** : INFO, à corriger avant la production (dev-frontend).

---

## INFO

- **I-RT3-01 : notifications après la réponse, sur Cloud Run.** Le travail de notification n'est pas attendu et `server.ts` n'a pas de gestionnaire `SIGTERM`. Avec un CPU alloué seulement pendant les requêtes, ou lors d'un arrêt d'instance, la notification peut être perdue. Résidu du même ordre qu'une erreur après COMMIT (PoC `post-commit-500`). Avant la production (A09/HUMAN), choisir : CPU toujours alloué et arrêt propre, ou balayage de rattrapage.
- **I-RT3-02 : `reasonText` multiligne.** Il remplace `\n`, `\r` et `\t` par une espace avant le contrôle, mais stocke le texte d'origine. C'est correct.
- **I-RT3-03 : les motifs ont des longueurs hétérogènes** (500, 1000, 2000). Les CHECK en base de 072 (500) et le `reasonText()` d'approbation (500) sont cohérents. Rien à corriger.
- **I-RT3-04 : I06 côté frontend.** `ApiError` lit `payload.error.code`, alors que le backend envoie `code` à la racine du JSON. Le repli sur le préfixe du message fonctionne encore. À aligner (dev-frontend), sans impact sécurité (le 409 n'ouvre qu'un dialogue).
- **I-RT3-05 : garde 072.** La base ne contraint ni `decided_at` à la décision, ni `decision_reason` obligatoire sur REJECTED. Ces deux points relèvent du service. Le durcissement en place suppose que 072 n'a jamais été appliquée sur une base partagée (même hypothèse que I07).
- **I-RT3-06 : test instable.** `retestLot-pg` (cas 074) dépend d'attentes de 150 ms : il a échoué une fois sous charge parallèle, puis il est passé en isolé et au second passage (QA).

## Ce qui bloque

| Cible | Bloquant | Non bloquant |
|---|---|---|
| **PR vers staging** | rien côté sécurité | SEC-PNL3-01..04, I-RT3-xx ; fonctionnel F3 (Approuver en 400, retours à la ligne, `APPROVED`/`APPLIED`) à faire valider par QA |
| **Production** | SEC-PNL2-02 (décision PO q173, puis A06) ; SEC-PNL3-01 (avant D6) ; I-RT3-01 (choix d'exploitation A09/HUMAN) ; SEC-PNL3-04 (écran trompeur) ; SEC-PNL-04 résiduel ; I07 / I-RT3-05 (confirmer que 068–072 n'ont jamais été appliquées sur Neon) | SEC-PNL3-02, SEC-PNL3-03 |

## Reproduction

- Base : `grc_a10_rt3` (socket `/tmp/claude-0/pgsock`, port 5531), reconstruite par `mkdb.sh` (psql, 001→074, `schema_migrations` créée à la main). Les suites `-pg` se lancent avec `QA_SWP_PGHOST=/tmp/claude-0/pgsock QA_SWP_PGPORT=5531 QA_SWP_PGDB=grc_a10_rt3 QA_D2C_PGDB=grc_a10_rt3 D3_PGDB=grc_a10_rt3 D5_PGDB=grc_a10_rt3`.
- PoC (scratchpad de session, non commités) : `poc072.sql` (SQL runtime), `poc_rt3.mts` (A : notifications, B : `last_token_iat`, C : caractères), `poc_rt3_config.mts` (D : `ConfigService` câblé comme en production), lancés par `npx tsx` depuis `backend/`.
- Aucun code de production n'a été modifié.
