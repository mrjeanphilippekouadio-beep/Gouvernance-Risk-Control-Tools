# Mémoire — @privacy (A24)

Mémoire persistante du rôle Privacy / protection des données sur GRC
Tools. À lire **en premier** par tout agent Privacy dispatché sur ce
dépôt, avant `SHARED_LOG.md` (`grep @privacy`, dont PRIV-CH-DASH-001).
Tenue par l'orchestrateur après chaque intervention. Les arbitrages du PO
(N0) priment ; une recommandation non arbitrée est marquée comme telle.

## Principes retenus (formulés par l'agent Privacy, 2026-10-08)

1. Ne jamais promettre un anonymat qu'un canal authentifié ne peut pas
   tenir : vérifier IdP, `audit_log` et logs HTTP avant de valider un
   libellé.
2. Un journal append-only ne doit jamais recevoir une donnée d'identité
   qu'on pourrait devoir retirer : décider la dissociation avant
   l'écriture, pas après.
3. Distinguer le libellé utilisateur (anonyme, confidentiel, nominatif) de
   ce que le système garantit, et l'afficher honnêtement avant envoi.
4. Minimiser qui voit l'identité : rôle nommé, levée tracée sans contenu
   d'identité, jamais le Risk Owner concerné ni les auditeurs génériques.
5. Traiter la conservation comme un arbitrage (preuve, prescription,
   effacement), pas comme une durée arbitraire ; inclure sauvegardes et
   PITR dans toute promesse de suppression.
6. Attribution forcée côté serveur : la valeur peut être un pseudonyme
   serveur, mais jamais un choix client ; signaler toute dérogation à
   Architecte et Security.
7. Chaque cadre juridique cité reste à vérifier par un juriste tant que le
   texte n'a pas été consulté ; ne pas citer d'article de mémoire.

## Avis DECISION-012 — modalité du signalement « anonyme » (2026-10-08)

Statut : **recommandation, en attente d'arbitrage PO et de validation
juriste/DPO.** Statut global UNDER_ASSESSMENT.

- **Faits techniques vérifiés** : `audit_log.user_id` NOT NULL et FK users
  (004) ; `audit_log` append-only par trigger (038) et REVOKE au rôle
  runtime (043) ; `AuditLogService.search` renvoie `userId` sous
  `audit.read` (donc tout rôle Auditeur verrait l'auteur d'une ligne
  d'audit) ; `contributed_by` NOT NULL dans le cadrage C.1 ; `pino-http`
  ne masque que `authorization`/`cookie`. **Confirmé par l'orchestrateur
  sur les logs Render staging (2026-10-08)** : les logs HTTP contiennent
  `remoteAddress`, `user-agent`, `x-forwarded-for`, `cf-connecting-ip` et
  `true-client-ip`, donc l'adresse IP réelle du client.
- **Cadre** : RGPD non établi (hébergement Neon US / Render UE ne suffit
  pas ; à réexaminer si établissement ou ciblage dans l'UE) ; loi
  ivoirienne n° 2013-450 et ARTCI applicables au signalement nominatif ;
  à vérifier : formalités ARTCI (régime probablement plus strict pour des
  allégations d'infraction), transferts hors zone (Neon US), Acte
  additionnel CEDEAO 2010, régime d'alerte et confidentialité LBC/FT.
  Benchmarks seulement : directive UE 2019/1937, RGPD.
- **(a) anonymat réel** : impossible dans le canal authentifié (IdP,
  `audit_log`, logs) ; possible seulement via un canal séparé non
  authentifié (taille L, revue Security, perte du rattachement tenant et
  du rate limiting). Risque de ré-identification élevé (contenu libre,
  petite population). Non recommandé en V1.
- **Recommandation** : (b)/(c) « confidentiel pseudonymisé » à côté du
  « nominatif » ; jamais le libellé « anonyme » sans canal séparé.
- **Exigences avant le lot B-4** :
  1. Jamais d'identité du signalant dans `audit_log` ni aucun journal
     append-only ; l'audit porte le triageur et l'action.
  2. Pour un SIGNALEMENT, `contributed_by` n'est pas l'identifiant
     utilisateur brut : pseudonyme serveur, ou NULL avec table d'identité
     séparée — dérogation à la lettre de la convention d'attribution, à
     arbitrer avec Architecte et Security.
  3. Routes de signalement : retirer IP et en-têtes des logs applicatifs
     (ou hacher avec un sel renouvelé) ; journal réseau séparé, durée
     courte, accès Security seul.
  4. Table d'identité dédiée, colonnes chiffrées (clé hors base), lisible
     seulement via un service de levée ; prendre en compte sauvegardes et
     PITR Neon ; suppression cryptographique à évaluer par Security.
  5. Code de suivi aléatoire, affiché une fois, haché en base, sans
     énumération possible.
  6. Chaque levée de pseudonymat tracée (acteur, date, motif) sans
     l'identité.
  7. Analyse de transfert du contenu hors zone (Neon US).
  8. Avertissement de minimisation sur le champ libre.
  Texte d'information du signalant avant envoi : modalité et garanties
  réelles, qui voit l'identité et quand elle peut être divulguée, risque
  d'identification par le contenu, traces techniques et leur durée,
  droits et code de suivi, information possible de la personne visée,
  contact DPO.
- **Avant tout code de B-4** : PRIVACY_ASSESSMENT complet et décision
  DPIA selon le cadre ARTCI (EVIDENCE_REQUIRED) ; KRI uniquement en
  agrégats au-dessus d'un seuil de population.
- **Points juriste/DPO** : régime loi 2013-450 pour un dispositif
  d'alerte (formalités, base légale — le consentement seul n'est pas
  adapté —, durée, droits de la personne visée, transferts) ; statut
  BCEAO et loi anticorruption ; articulation LBC/FT ; effacement face à
  l'append-only et à la conservation de preuve ; durées par catégorie ;
  applicabilité réelle du RGPD ; texte d'information.

## Arbitrage PO (2026-10-08)

Le PO a retenu le **« signalement confidentiel »** (à côté du nominatif), conformément à l'avis Privacy ; le libellé « anonyme » n'est pas utilisé. La validation juridique est confiée aux **juristes internes de Djamo**. Les exigences techniques et points juridiques listés ci-dessus restent les conditions du lot B-4.

## Avis EVD — données personnelles et fichiers confidentiels (2026-10-08)

Statut : **proposition, en attente PO** (décisions §33 n° 10 et 14 du
cahier `docs/specs/CDC-module-evidences-excel.md`). Déclaration « données
personnelles oui / non / ne sait pas » (ne sait pas = oui) ; colonne
persistée / ignorée / masquée, valeurs ignorées jamais copiées (ni en
JSONB ni dans les erreurs) ; dataset `confidential` à lecture restreinte ;
masquage en liste ; journal de lecture sans valeurs. Le fichier original
est la preuve : jamais anonymisé (SHA-256) ; les lignes dérivées peuvent
être purgées ou pseudonymisées à échéance. Le soft delete masque sans
effacer (base, sauvegardes, PITR, corbeille Drive). Protections requises
dès EVD-1 (le fichier est une donnée personnelle dès l'upload). À faire
qualifier : localisation Neon US / Drive ou GCS. Conflit à trancher avant
tout Bucket Lock GCS : rétention verrouillée de 10 ans vs effacement.

8. Un plancher de protection (lecture confidentielle toujours journalisée,
   aucune valeur personnelle dans les logs ou l'audit) n'est jamais
   paramétrable à la baisse ; la classification se relève librement et ne
   s'abaisse que par la fonction risque, tracée.

## Avis D2a — `users.last_seen_at` (2026-10-18, PRIV-REV-D2A-001)

Statut : **OK AVEC RÉSERVES** (non bloquant pour D2a). Document :
`docs/privacy/review-d2a-last-seen-2026-10-18.md`. Statut global
UNDER_REVIEW ; REVALIDATION_REQUIRED avant D6.

- **Faits vérifiés** : une valeur par compte, écrasée, sans historique ;
  pas de remplissage rétroactif ; écriture tenant-scopée, comptes non
  supprimés ; pas d'`audit_log` ; mappeur `toDomain` explicite (pas
  d'exposition API) ; `userId` journalisé en cas d'échec (`lastSeen.ts`).
- **Écart de sémantique (R1, bloquant D6)** : le libellé est « dernière
  connexion » (q152, D13), mais le déclencheur est `authMiddleware` →
  `verifyToken` à chaque requête authentifiée. Une session ouverte rend un
  compte dormant « actif » : contrôle GOV-ACC-01 affaibli. Choix PO :
  renommer en « dernière activité authentifiée » ou limiter l'écriture aux
  authentifications (Architecte pour le point d'écriture côté Google).
- **Visibilité (R2, bloquant D6)** : le masquage R-6.1 couvre les noms, pas
  les dates par pseudonyme « Personne N ». Sans `audit.read`, comptages
  seuls. Test : `last_seen_at` absent de `/users` et `/users/me`.
- **Durée (R3, bloquant mise en prod D6)** : aucune définie. Sauvegardes et
  PITR inclus dans toute promesse. Décision PO + juriste, pas de durée
  imposée par A24.
- **Journal (R4)** : retirer `userId` du `log.warn` de `lastSeen.ts`.
- **Information (R5)** : aucun texte ; à traiter au déploiement de 067 en
  production, au plus tard avant D6.
- **Cadre (R6)** : RGPD NOT_ESTABLISHED ; loi 2013-450 et ARTCI à confirmer
  par le juriste de Djamo ; aucun article cité (non vérifié). Hypothèse :
  données de salariés ou prestataires (à confirmer).
- **Pré-existant (R7)** : journaux HTTP avec IP et user-agent par requête
  (staging 2026-10-08). « Pas d'IP » (q152) vaut pour la base, pas pour le
  système. Suivi via l'item journaux B-4, Security (A10).
- **Libellé (R8, faible)** : `NULL` = pas d'authentification enregistrée
  depuis 067, pas « pas de connexion depuis trackedSince ».

Principes ajoutés :
9. Le libellé d'une donnée doit correspondre à son déclencheur réel :
   vérifier le point d'appel (middleware, résolveur) avant de valider une
   finalité ou une information aux personnes.
10. Une date par personne reste une donnée personnelle même si le nom est
    masqué : sans droit de voir l'identité, n'exposer que des comptages.

## Avis suites 2 — q183 annuaire, q178 vacance RM (2026-10-27, PRIV-REV-SUITES2-001)

Statut : **OK AVEC RÉSERVES** sur les deux points (non bloquant). Document :
`docs/privacy/review-suites2-q183-2026-10-27.md`.

- q183 : `directory` (id + nom, actifs, tenant, 500) proportionné ; l'ouverture à
  `audit.mission.create` élargit les lecteurs, pas les données. Recommandation :
  pas de journal de consultation (annuaire non confidentiel ; rouvrir si un champ
  s'ajoute) ; troncature à 500 à signaler (risque d'exactitude) et ordre
  limite-puis-filtre à vérifier ; information : une phrase dans le texte R5.
- q178 : date de vacance + notification sans nom : pas de surexposition ; à vérifier
  que le lien (`entityId` = ligne d'audit, qui porte l'identité du retiré) ne
  l'expose pas à un destinataire sans `audit.read`.

Principe ajouté :
11. Un annuaire d'identité minimal (id + nom) n'appelle pas de journal de
    consultation tant qu'aucun champ confidentiel ne s'y ajoute ; en revanche,
    une troncature silencieuse est un défaut d'exactitude à signaler.

Points ouverts à inscrire dans ACTION_ITEMS (non fait par A24) : R1 (PO),
R2 (PO), R3 (PO + juriste), R6 (juriste). Relecture A15 (Compliance)
demandée par le plan RM-V1 ligne 595.

## Avis F7-S3 — annuaire ouvert à `role.read` (2026-10-28, PRIV-REV-F7S3-001)

Statut : **OK AVEC RÉSERVES** (non bloquant). Document :
`docs/privacy/review-f7s3-directory-2026-10-28.md`.

- Annuaire inchangé (id + nom) ; la vraie nouveauté est la lecture des droits
  effectifs d'un compte (`role.read`) par Audit et Risk Manager, en plus de
  l'administration. Finalité (revue des habilitations) proportionnée.
- Pas de journal de consultation (cohérent avec q183) ; à rouvrir si champ
  ajouté, export, ou lecteur hors Audit/RM/administration.
- R5 : ajouter que rôles et droits sont consultables par administration, Audit,
  Risk Manager. Troncature à 500 plus grave pour un contrôle d'habilitations ;
  comptes suspendus absents de l'annuaire. Lecture croisée RM sur membres Audit
  à confirmer par Compliance/PO (séparation F-B8b-05).

Principe ajouté :
12. Un droit de lecture donné à un nouveau rôle sur des données d'habilitation
    est une revue Privacy même si le champ de l'annuaire ne change pas : la
    sensibilité vient de ce que l'écran en aval révèle (fonction, position dans
    le dispositif de contrôle), pas du seul contrat d'API.

## Avis q205 — annuaire ouvert à `risk.create` / `risk.update` (2026-11-01, PRIV-REV-Q205-001)

Statut : **OK AVEC RÉSERVES** (non bloquant). Document :
`docs/privacy/review-q205-directory-risk-creators-2026-11-01.md`. DECISION-105.

- Données inchangées (id + nom) ; la population de lecteurs devient la
  première ligne. Finalité (choisir des personnes nommées d'un risque
  restreint) légitime ; liste complète plus large que le besoin.
- Recommandation : recherche par nom (min 2-3 caractères, plafond 20-25,
  filtre en base avant limite, débit limité) pour ces nouveaux appelants ;
  nommés validés côté serveur. Non imposée si le PO garde la liste.
- Pas de journal de consultation (cohérent q183, F7-S3) ; audit à l'écriture
  de la désignation. R5 : phrase proposée dans le document.
- Troncature 500 (q183 R1) toujours ouverte.

Principe ajouté :
13. Quand un annuaire s'ouvre à une large population (première ligne), le
    contenu peut rester identique mais l'échelle change : préférer une
    recherche (minimum de caractères, plafond bas) à la liste complète, sans
    l'imposer si les champs restent id + nom.


## Revue V4 (2026-11-03) — ajout de la session A15 (worktree sans la mémoire précédente)

# Mémoire — A15 Privacy / Data Protection

Créée le 2026-11-03 (fichier absent jusqu'ici dans le worktree ; à fusionner avec la mémoire existante si elle est retrouvée).

## Positions tenues

- Visibilité A1 par défaut (métadonnées sans titre ni motif) : acceptable en conception.
- `resource.readall` (DECISION-103) : bloqué en portée tant que les dossiers « personnes nommées » (fraude, RH) y sont inclus sans confirmation distincte, sans durée maximale et sans journalisation par ressource ouverte (PRIV-BLK-V4-001, revue `docs/privacy/PRIV-visibility-v4-2026-11-03.md`).
- Recommandations chiffrées : durée 90 jours non automatiquement prolongeable ; recertification trimestrielle ; dossiers nommés expirés à la clôture (au plus 30 jours renouvelables).
- Journalisation au grain de la ressource ouverte, sans contenu ni titre ; une consultation de liste = un événement avec comptage.
- `updatedAt` : acceptable au jour seulement, identifiants opaques vérifiés ; exclu pour les dossiers nommés.
- Motif d'octroi : liste codifiée de préférence, pas de texte libre.

## Points ouverts

- Q1, Q3, Q4 : arbitrage PO (HUMAN) requis.
- Qualification BCEAO / confidentialité des déclarations liées à la LBC-FT et des dossiers fraude : Compliance.
- Modèle v3 (`docs/privacy/PRIV-visibility-v3-2026-11-01.md`) et mémoire antérieure absents du worktree : à recaler.

## Règles de travail retenues

- Ne pas trancher à la place du PO ; formuler en question avec recommandation.
- Distinguer condition de production et recommandation non bloquante.
- Ne pas confondre sécurité (A10) et privacy : les correctifs A10 ne couvrent pas la nécessité ni la minimisation.
- RGPD : NOT_ESTABLISHED par défaut ; ne pas le citer comme applicable sans établissement UE ou personnes UE.


## Revalidation V4 (2026-11-03)


- PRIV-BLK-V4-001 levé en conception pour `readall` ; production non revalidée tant que les preuves ne sont pas fournies.
- Décisions retenues : q219 exclusion des dossiers nommés ; q220 audit par ressource et par liste, avant réponse, échec = refus ; q221 90 jours réglables sans prolongation automatique ; q223 date seule et UUID opaques.
- Limites : agrégats acceptables avec seuil minimal de cellule (recommandation 5) ; lectures enfants (preuves, exécutions, mesures) non acceptables en l'état si données personnelles.
- Points ouverts : chemin nominatif (motif, confirmation, journalisation, expiration non documentés dans DECISION-111) ; recertification trimestrielle non confirmée ; motif codifié ; seuil de cellule.

## Points ouverts

- Q1, Q3, Q4 : arbitrage PO (HUMAN) requis.
- Qualification BCEAO / confidentialité des déclarations liées à la LBC-FT et des dossiers fraude : Compliance.
- Modèle v3 (`docs/privacy/PRIV-visibility-v3-2026-11-01.md`) et mémoire antérieure absents du worktree : à recaler.

## Règles de travail retenues

- Ne pas trancher à la place du PO ; formuler en question avec recommandation.
- Distinguer condition de production et recommandation non bloquante.
- Ne pas confondre sécurité (A10) et privacy : les correctifs A10 ne couvrent pas la nécessité ni la minimisation.
- RGPD : NOT_ESTABLISHED par défaut ; ne pas le citer comme applicable sans établissement UE ou personnes UE.

## Entrée 2026-11-08 — challenge q217 / q237 (PRIVACY_CHALLENGE, cadrage A05 section 6)

Document : `docs/privacy/privacy-q217-q237-cadrage-2026-11-08.md`. Statut global GAP_IDENTIFIED.

- Verdicts : équivalence (1), périmètre (2), historique (4), identité (5), e-mail (6), exports (8) : À CORRIGER ; point de départ fin d'effet (3) : OK avec réserve ; autres textes libres (7) : ouvrir un point séparé.
- **Constat nouveau, bloquant pour toute promesse d'effacement du nom et de l'e-mail** : `UserService` écrit l'objet utilisateur complet (email, displayName) dans `audit_log.new_value` (création l. 161-171, updates et suspensions l. 279-368). Pseudonymiser `users` ne retire pas ces copies. Le motif de rôle (`input.reason`, l. 159) reste aussi dans le journal, sans durée.
- Règle retenue : pseudonymisation n'est pas anonymisation ; rôles + dates + actions d'un pseudonyme restent personnels, réidentifiables en petite structure.
- Périmètre motifs : les demandes `resource.readall` entrent dans la durée d'un an par défaut (exception seulement si Compliance documente une obligation de preuve).
- Plancher et réduction : la seconde personne vaut dans les deux sens (allongement compris).
- H1 : non vérifiable par A15 ; à prouver par requête de lecture versée en preuve avant tout motif en production. H3 : staging à confirmer sans données réelles.
- Compliance (CMP-q217-q237, 2026-11-08) : le plancher de 10 ans est une hypothèse du dépôt (Instruction BCEAO 017-12-2010, applicabilité à Djamo non établie) ; le dépôt ne dit pas si DECISION-038 n° 8 vise le journal. Position A15 : ne pas accepter ce plancher comme acquis ; le nom et l'e-mail doivent sortir du journal (Q-F) avant d'en faire une durée longue. Aucune purge avant avis juriste et DPO.
- Texte R5 : e-mail absent, copies dans le journal non mentionnées. Correction C1 à faire, phrase soumise au DPO (accord global déjà donné). Statut « projet » de l'en-tête à mettre à jour.
- Principe ajouté : 14. Une donnée d'identité écrite dans un journal append-only reste personnelle tant que le journal existe : la dissociation se décide à l'écriture (rappel principe 2), et une durée longue de journal n'est pas une raison de garder le nom.

## Revue V5 — expiration des accès nommés (2026-11-08, PRIV-REV-V5-2026-11-08)

Statut : **SOUS CONDITIONS** (périmètre dossiers « personnes nommées »). Document : `docs/privacy/privacy-visibility-v5-2026-11-08.md`. Statut global GAP_IDENTIFIED.

- Constats : PRIV-V5-01 `expiresAt` visible de tout lecteur du dossier (à réserver aux gestionnaires et au propriétaire, condition) ; PRIV-V5-02 listes PERIMETRE nominatives sans échéance (Q1, PO) ; PRIV-V5-03 réouverture qui fait revivre l'accès sans renouvellement, écart avec le texte de q225 (Q3, PO) ; PRIV-V5-04 la base n'impose pas l'échéance d'un accès NOMINATIF (défense en profondeur, non bloquant) ; PRIV-V5-05 motif de renouvellement en texte libre dans le journal append-only (lié à q246, reco : liste codifiée) ; PRIV-V5-06 tests manquants (exposition, réouverture, PostgreSQL réel).
- Q2 (échéances conservées si repassage en PERIMETRE) et Q4 (pas d'audit ni notification à l'échéance) : aucune décision PO nécessaire pour Privacy ; conditions de vérification (QA ; Audit accepte la table comme preuve).
- Principe ajouté :
15. Une échéance d'accès est une information sur la personne (depuis quand, jusqu'à quand elle lit) : elle suit les mêmes règles de visibilité que son identité, et une réouverture ne vaut pas renouvellement tant que le texte de la décision n'autorise pas la reprise.
