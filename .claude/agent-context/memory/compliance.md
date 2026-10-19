# Mémoire — @compliance (A14)

Mémoire persistante du rôle Compliance sur GRC Tools. À lire **en
premier** par tout agent Compliance dispatché sur ce dépôt, avant
`SHARED_LOG.md` (`grep @compliance`). Tenue par l'orchestrateur après
chaque intervention. Les arbitrages du PO (N0) priment ; une
recommandation non arbitrée est marquée comme telle.

## Principes retenus (formulés par l'agent Compliance, 2026-10-08)

1. Distinguer anonyme et confidentiel, et refuser tout libellé qui promet
   un anonymat que le système (logs, authentification) ne tient pas.
2. Ne jamais citer un article ni un texte sans l'avoir sous les yeux :
   dire « à faire vérifier par un juriste ».
3. Qualifier d'abord l'applicabilité (agrément de Djamo, statut du
   référentiel) avant d'appeler une chose « obligation ».
4. Un signalement de fraude ou de blanchiment peut déclencher une
   déclaration CENTIF : cette décision revient à la conformité, jamais au
   triage Risk.
5. La levée d'une identité est une opération sensible : permission dédiée,
   motif obligatoire, trace d'audit, maker-checker.
6. Garder la cohérence avec CLAUDE.md : attribution forcée côté serveur,
   `audit_log` append-only, soft delete, `tenant_id`.
7. Chaque décision « en attente de validation juriste ou PO » devient une
   ligne d'`ACTION_ITEMS.md` avec owner (règle 7bis).
8. ISO, COSO et Bâle sont des benchmarks : ne pas les présenter comme des
   obligations.

## Avis DECISION-012 — modalité du signalement « anonyme » (2026-10-08)

Statut : **recommandation, en attente d'arbitrage PO et de validation
juriste.** Aucun texte source consulté ; références de principe.

- **Recommandation** : modalité (b) confidentialité, implémentée avec un
  code de suivi (variante c) : identité stockée, visible seulement du rôle
  conformité ; libellé « confidentiel » et non « anonyme » ; le choix
  « nominatif » reste proposé. Anonymat réel (a) non retenu en V1 :
  incompatible avec `contributed_by` NOT NULL, l'attribution forcée et
  l'audit d'acteur ; promesse intenable (logs, horodatage) ; perte
  d'exploitabilité (précisions, déclaration CENTIF) ; abus non imputable.
  À rouvrir seulement si un juriste constate une obligation ou si le PO
  veut un canal externe séparé (ligne externe, boîte tierce).
- **Cadre** : BCEAO contrôle interne (obligatoire selon l'agrément, à
  confirmer ; ne prescrit pas, à sa connaissance, de canal anonyme) ;
  LBC/FT UEMOA, CENTIF, GAFI/GIABA (déclaration de soupçon portée par
  l'entité assujettie, confidentialité du déclarant, interdiction
  d'informer la personne visée — détail à vérifier) ; ISO 37002:2021 et
  COSO ERM en bonnes pratiques. À vérifier par un juriste : protection
  légale des lanceurs d'alerte en Côte d'Ivoire, dénonciation calomnieuse,
  protection contre les représailles.
- **Qui traite** : le triage Risk (2e ligne) voit le contenu, le code et
  le statut, jamais l'identité ; seul le rôle conformité lève l'identité
  (permission dédiée, nom à fixer par l'Architecte, ex. `riskreport.reveal`,
  motif obligatoire, audit de chaque levée) ; fraude, inconduite et LBC/FT
  orientés d'emblée vers la conformité, qui décide de la déclaration
  CENTIF ; l'audit interne contrôle le dispositif après coup sur
  échantillon ; voie de contournement (direction générale ou comité
  d'audit) si la conformité ou la fonction Risk est visée.
- **Technique** : `contributed_by` conservé et forcé côté serveur ; flag
  « confidentiel / nominatif » sur la contribution ; identité masquée côté
  service, jamais seulement côté frontend.
- **KRI** : part de signalements confidentiels, délais d'accusé de
  réception et de traitement, taux de rejet au triage, nombre de levées
  d'identité.
- **Points à valider par un juriste ou le responsable conformité de
  Djamo** (bloquants pour B-4 sauf le dernier) : (1) agrément exact et
  textes BCEAO applicables ; (2) obligation éventuelle d'un canal d'alerte
  et position sur l'anonymat ; (3) protection des lanceurs d'alerte,
  représailles, dénonciation calomnieuse ; (4) déclarant CENTIF, délais,
  confidentialité, interdiction d'informer ; (5) désignation du rôle qui
  lève l'identité et de sa suppléance, voie de contournement ; (6) durée
  de conservation et information du dénoncé (avec Privacy) ; (7) texte
  d'information du signalant ; (8) politique interne d'alerte et de
  non-représailles (bloquant pour la mise en production, pas pour le
  code).
- **COMPLIANCE_BLOCK** annoncé si B-4 part en production sans les points
  1 à 4 et 6 validés, ou si le libellé « anonyme » est affiché alors que
  l'identité est stockée.

## Arbitrage PO (2026-10-08)

Le PO a retenu le **« signalement confidentiel »** (à côté du nominatif), conformément à l'avis Compliance ; le libellé « anonyme » n'est pas utilisé. La validation juridique est confiée aux **juristes internes de Djamo**. Les exigences techniques et points juridiques listés ci-dessus restent les conditions du lot B-4.

## Avis sur la position du PO relative aux modes de cotation (2026-10-08)

Détail consolidé : `docs/architecture/RM-V1-Modes-cotation-objections.md`.
Objections bloquantes avant amendement du contrat : (B-1) responsable de la
cotation indéterminé (qui est le Risk Owner) ; (B-2) saisie L1 sans
validation par un tiers ; (B-3) Classique sans validateur distinct ; (B-4)
choix du mode non tracé ni gouverné. Non bloquantes : justification du
« Résiduel toujours à la 2e ligne », Maîtrise à deux acteurs, comparabilité
dans les rapports, KRI, tests de sensibilité, charge de la 2e ligne. Aucun
COMPLIANCE_BLOCK (pas de code).

9. Une saisie de la 1re ligne est une contribution ou une auto-évaluation
   soumise à retenue, jamais une cotation qui fait foi sans challenge ; le
   mode de cotation et son changement sont des événements tracés,
   approuvés et révisés.

## Avis sur le workflow RO / DEL / EXEC du PO (2026-10-08)

Détail : `docs/architecture/RM-V1-Modes-cotation-objections.md` §6.
Statut : **recommandation, en attente des réponses du PO.**

- B-1 levée pour l'essentiel (RO = responsable de département) ; B-2 et B-3
  ouvertes ; B-4 atténuée (le mode est fixé avant le risque).
- **Objection n° 5 : cumul des rôles non gouverné.** Config 5 acceptable si
  le DEL ne valide pas sa propre exécution ; configs 1 et 4 seulement avec
  compensation (Maîtrise revue par la 2e ligne, cumul marqué, justifié,
  approuvé par une autorité distincte, revu à chaque cycle, KRI,
  échantillonnage par l'audit interne) ; config 1 déconseillée par défaut,
  réservée aux risques faibles.
- Règles minimales à ajouter à la règle d'or : validateur hors de tous les
  auteurs ; ni RO ni DEL ne valide ce qu'il a exécuté ; désignations
  permissionnées, motivées, auditées, jamais auto-attribuées ; périmètre du
  DEL écrit ; absence de DEL visible et justifiée.
- COMPLIANCE_BLOCK annoncé en production si : cumul sans marquage ni
  validation tierce ; cotation qui fait foi sans validateur distinct ;
  désignations non tracées ou auto-attribuables ; mode changé sans motif ni
  approbateur.

10. Un cumul exécution + responsabilité (RO + EXEC, DEL + EXEC) est une
    exception déclarée, marquée, compensée et revue, jamais une
    configuration par défaut ; « pas RO + DEL » ne suffit pas comme seule
    règle de séparation.
11. Les désignations de rôles (RO, DEL, EXEC) et leurs changements sont des
    événements sensibles : permission dédiée, motif, approbateur distinct,
    audit append-only.

## Passage Compliance EVD-1 (2026-10-11, branche evd-1)

Verdict : OK pour PR, sans bloquant. Statut : recommandation, durée légale
de 10 ans citée uniquement via DECISION-018 (EVD §33 n° 5) ; fondement
légal « à confirmer par les juristes ».
- SHA-256/taille/type = intégrité technique, pas valeur probante complète :
  pas d'immuabilité Drive, pas de horodatage de confiance, hash non relu au
  téléchargement (prévu EVD-2).
- DOWNLOAD audité avant libération de l'URL (bon), mais trace la remise
  du lien, pas l'accès Drive réel.
- Suppression : `delete()` écrit `reason: null`, pas de `deleted_at`/
  `deleted_by` sur `evidences`, `evidence.delete` pas limitée au groupe Risk
  Manager : écart avec DECISION-018 n° 9, à traiter avant la mise en prod
  de la suppression sur demande (lot suivant).
- Historique sans hash : rattrapage conseillé, jamais de hash inventé.
## Passage Compliance B-8 groupes fixes (2026-10-11, branche feat/b8-groups, efefbb1)

Détail : `docs/security/compliance-B8.md`. Verdict : conforme avec réserves, aucun bloquant de merge. Statut : recommandation, en attente du PO (6 questions).
- Cumul Risk Manager + Audit : non interdit par le contrat, aucune garde dans le code ; je recommande de l'interdire (2e vs 3e ligne), cumul avec Committee à arbitrer.
- « Risk Manager jamais vide » : atomique au retrait, mais contourné par `UserService.suspend` (user_roles non révoqués, comptage sans statut utilisateur). À corriger avant B-9.
- Audit des affectations : ROLE_CHANGE présent, `grantedBy` forcé, mais `reason: null` et audit hors transaction (invariant 7).
- Groupes à zéro permission : conforme (moindre privilège) ; ne pas accorder de droits avant arbitrage PO.
- Processus.department_id nullable : acceptable seulement avec rattrapage tracké (ACTION_ITEMS), puis NOT NULL.
13. Un groupe de la 3e ligne (Audit) ne doit pas être administrable ni peuplé par la seule 2e ligne sans motif et tiers ; un invariant « jamais vide » se compte sur des membres actifs, pas sur des lignes de table.

## Revue DECISION-040 (2026-10-11)

Détail : `docs/security/compliance-DECISION-040.md`. Verdict : conforme avec réserves, aucun bloquant. Statut : recommandation, en attente du PO (q58 à q61). Pas de texte BCEAO consulté.
- Gitar a raison sur un seul point : Audit (3e ligne) décideur en repli ; garde-fous : marquage, indicateur, ratification a posteriori par le Comité.
- « Aucun quorum » doit viser la décision de repli, pas le vote du Comité (DECISION-026 : « jamais un seul membre » est fixe).
- Réglages de cumul, quorum et circuit : événements sensibles (permission, motif, trace). Administrateur = RM : cumul marqué, tiers notifié.
- Fenêtre « droits perdus » : nom d'affichage seul, déclenchée par action refusée, audit, avis Privacy.
14. La souplesse voulue par le PO se garde par des paramètres à défaut sûr, des alertes et des indicateurs, pas par des interdictions ; ce qu'on ne règle pas : auto-validation, silence valant accord.
15. La 3e ligne ne décide pas en gestion du risque sans marquage et ratification ; un groupe « vide » se compte en membres actifs.

## Passage Compliance B-6a Dispositif versionné (2026-10-12, commit 0a465fa)

Détail : `docs/compliance/B6a-compliance-review.md`. Verdict : conforme avec réserves, aucun bloquant. Statut : recommandation, en attente du PO (q81-q83, q86-q92). Pas de texte BCEAO consulté.
- Conforme : maker-checker à 3 niveaux, immuabilité (trigger + REVOKE), aucune suppression, repli marqué, fail-closed.
- Audit hors transaction (q90) : accepter pour staging seulement ; l'exception lève avant les notifications (Audit non prévenu) et le contrôle « auteur » dépend du journal. Condition de production : audit de l'activation dans la transaction.
- Verrouillage : un approbateur de type vote activé avant B-12 gèle la méthodologie ; recommandé de n'accepter que `RISK_MANAGER` jusqu'à B-12.
- « Audit et Comité » avec un seul groupe : acceptable comme repli seulement si marqué dégradé ; la ratification ne peut pas s'écrire sur la ligne de demande (CHECK + trigger append-only) : prévoir une table dédiée en B-12.
- q89 : recommander la règle la plus exigeante des deux Dispositifs ; q81-83 : amorçage inutile si 2 RM, sinon valeurs par défaut du contrat, extinction automatique, ratification avec délai.
16. Un contrôle fail-closed ne doit pas pouvoir être configuré de manière à se verrouiller lui-même (approbateur indisponible) ; refuser l'option tant que le mécanisme n'existe pas.
17. Une dégradation d'un double contrôle (un seul groupe sur deux) est un repli : marquée, notifiée, ratifiée, jamais écrite comme régime normal.

## Passage Compliance B-6b branchement du Dispositif (2026-10-12, commit 45cbd86, tête e25820f)

Détail : `docs/compliance/A14-review-B6b.md`. Verdict : conforme avec réserves, aucun bloquant de merge ni de staging. Statut : recommandation, en attente du PO (Q-A14-B6b-1 à 3). Pas de texte BCEAO consulté ; tests non relus.
- Instantané correct (version, échelle, 3 seuils figés à la création, FK vers version immuable). Faiblesse : le rattrapage (copie de `configs` à la date de migration, ou repli floor) n'est marqué que par `version_id NULL` ; origines indiscernables, valeur de reprise et non preuve. Comptage HUMAN avant prod, colonne de provenance si compte > 0.
- Fermeture des écrivains et instantané dépendent d'un paramètre de constructeur optionnel : exiger un test de câblage `server.ts`.
- Conditions de production : B-6d avant ou avec B-6b ; B-6b-01 fermé ou compensé ; B-6b-02 bloque seulement B-6c ; B-6b-03 non bloquant.
- À vérifier : marquage « indépendance réduite » pour `FIRST_LINE` (A13 R4 ii) ; B-5 doit traiter `low_criticality_threshold` NULL en fail-closed.
18. Une valeur rattrapée par migration doit rester distinguable d'une preuve d'origine, par sa provenance et non seulement par l'absence d'une clé ; on ne l'affiche jamais comme application d'une méthodologie.
19. Un contrôle qui dépend d'une dépendance optionnelle de constructeur n'est preuve que si un test garantit son câblage en production.

## Passage Compliance B-6d amorçage et repli q100 (2026-10-18, commit 9f53463)

Détail : `docs/compliance/A14-review-B6d.md`. Verdict : conforme avec réserves, aucun bloquant de merge ni de staging. Statut : recommandation, en attente du PO (q113 et Q-A14-B6d-2). Pas de texte BCEAO consulté ; tests non exécutés (titres lus).
- COMPLIANCE_BLOCK de B-6b : levé pour le code, maintenu comme règle de livraison (B-6b jamais sans B-6d, migrations 059 à 062 ensemble).
- Conforme : marquage BOOTSTRAP (CHECK, audit, route de consultation), motif structuré, valeurs libres figées côté serveur (I-D8), repli q100 jamais NORMAL, séparation des tâches, périmètre fermé sous verrou.
- Réserves : cause de fin d'amorçage non mémorisée (date de reprise = date de migration, chemins system_group/rôle réactivé non couverts) ; vue « décisions prises en votre absence » non livrée (lot F) ; administrateur cité non prévenu, notice sans motif ; ratification q100 impossible avant B-12 ; spec I-D9 pas alignée ; 062 jamais appliquée hors PG16 local, CHECK NOT VALID.
- q113 : A14 soutient l'interdiction de l'auto-désignation (vigilance : la sortie « l'administrateur-RM crée son second RM » est moins traçable que l'amorçage) ; préférer un second administrateur réel.
- Conditions de production : livraison conjointe, requête n° 10 = 0, comptage DECISION-047, revérification B-6b-01 (q108), plan Djamo si administrateur unique = RM unique (q93), essai de 062 sur copie de staging.
20. Une fin d'exception se prouve par le marqueur ET sa cause (affectation, utilisateur) ; une date posée par reprise de migration est signalée comme telle.
21. Une information promise à la 3e ligne (notice, vue) n'est démontrable que par une trace de prise de connaissance, distincte d'une ratification ; une notification au mieux n'est pas une preuve.
22. Une déclaration invérifiable (administrateur sollicité) doit au moins être contestable : le tiers cité est prévenu.

12. Un hash calculé à l'upload prouve l'identité du contenu depuis ce
    moment, pas son authenticité d'origine ni sa non-altération sur Drive
    tant qu'il n'est pas recontrôlé.

## Passage Compliance panel de gouvernance D1 à D4 (2026-10-18, base 037314d)

Détail : `docs/compliance/review-panel-d1-d4-2026-10-18.md` (constats CMP-PNL-01 à 17). Statut : **recommandation, en attente d'arbitrage PO** (CMP-PNL-03, 04, 08, 11). Pas de texte BCEAO consulté ; tests non exécutés ; revue faite depuis le checkout principal (le worktree dispatché n'était pas à 037314d).
- Aucun bloquant de merge. **COMPLIANCE_BLOCK conditionnel de production** : `DOUBLE_CONFIRMATION` activé sur un tenant de production sans trace atomique de l'acte (CMP-PNL-01) ni revue par un tiers et notifications (D5, CMP-PNL-02).
- Q1 : la double confirmation est un contrôle de remplacement acceptable en TPE/PME seulement comme exception consciente, motivée, tracée atomiquement et revue après coup ; ce n'est pas une séparation. Politique modifiable par l'administrateur seul : acceptable sans tiers, avec tiers le code s'écarte de la règle hybride DECISION-072 (arbitrage PO).
- Q2 : périmètre (rejets, RoleService, Dispositif, décision de traitement hors porte) cohérent ; le risque inverse est que les chemins Comité soient dans la porte (CMP-PNL-04, tension avec DECISION-026).
- Q3 : traçabilité de la vacance du dernier RM suffisante ; alerte, délai (60 j proposé, D18) et notification manquent ; l'intérimaire garde le rôle après `valid_until` (CMP-PNL-08, 09).
- Q4 : l'Audit ne doit pas approuver une baisse de taille (il fixerait l'étalon qu'il contrôle) ; au mieux repli marqué et ratifié, ou informé et contestataire ; l'ensemble « tiers » doit égaler l'ensemble des approbateurs (CMP-PNL-11).
- Q5 : `audit_log` conforme ; écarts autour : audit hors transaction, `governance_designations` modifiable, régime une personne sans entrée d'audit, rattrapage de droits par migration trop large (CMP-PNL-14).
23. Une compensation de séparation des tâches n'existe que si sa trace est écrite dans la même transaction que l'acte ; sinon le contrôle échoue en ouverture et l'acte s'affiche « indépendant ».
24. Une dérogation conditionnée à un état modifiable (« personne d'autre ne peut valider ») appelle un contrôle détectif de la manipulation de cet état.
25. La 3e ligne ne fixe pas l'étalon qu'elle contrôle : elle est informée et peut contester, elle n'approuve pas (sauf repli marqué et ratifié) ; l'ensemble « tiers requis » doit égaler l'ensemble des approbateurs.
26. Une règle de livraison vaut blocage en production : une option de gouvernance assouplie (auto-validation) n'est activable qu'avec ses contrôles détectifs livrés.
27. Un rattrapage de droits par migration se vérifie par une liste nominative des rôles et comptes bénéficiaires, confirmée par HUMAN, avant application hors dev.

## Passage Compliance panel de gouvernance D5 et correctifs DECISION-077/078/079 (2026-10-19, tête 9a86fb8)

Détail : `docs/compliance/review-panel-d5-2026-10-19.md` (constats CMP-PNL2-01 à 13, blocage CMP-BLK-D5-01). Statut : **recommandation, en attente d'arbitrage PO** (délai de revue, plafond de durée d'acceptation, révocation par l'Audit, consignation de q160, activation de la production avant D6). Pas de texte BCEAO consulté ; tests non exécutés ; migrations non appliquées ; tête non vérifiée (pas de Bash), lecture dans le checkout principal.
- Suivi CMP-PNL-01 à 17 : fermés 01 (atomicité, périmètre DECISION-079), 03 (q158 construit), 04 (q159), 11 (q157) ; partiels 02, 10 ; clos par arbitrage PO avec risque accepté 08, 09 (q160/q161) ; ouverts 05, 06, 07, 12 à 17 (14 aggravé par 073).
- **COMPLIANCE_BLOCK** : levé pour le code, la recette et le staging. Maintenu pour la production sous une condition unique (CMP-BLK-D5-01) : aucune route ne liste les exceptions à revoir (seul `POST /governance-exceptions/:auditLogId/reviews`), le relecteur dépend d'une notification ; livrer D6 ou un `GET` minimal avant d'activer `DOUBLE_CONFIRMATION` ou l'acceptation `alone` en production.
- Revue par un tiers + contestation : conforme avec réserve (contrôle détectif de remplacement, pas une séparation) ; manques : délai et relance, substance (un commentaire suffit, un seul relecteur), suite à la contestation, notification sans preuve de lecture.
- Acceptation `alone` sans durée maximale : arbitrage PO requis (renouvelable sans fin, la durée est choisie par le bénéficiaire) ; le service n'invente aucun plafond, bien.
- Audit : `acceptance.revoke` sans `confirm` : conforme avec réserve (veto restrictif), notifier l'acceptant.
- q160 pris acte, non rouvert : consigner comme risque accepté par le PO (la vacance du RM est exclue des notifications et du compte des non-revues ; renforce les voies « sans tiers »).
- q158 : répond à CMP-PNL-03 ; demande sans expiration acceptable (n'a aucun effet tant qu'elle est en attente) ; table 072 sans trigger de garde ni retrait de `reopen()` (Moyenne).
- Append-only : `audit_log` conforme, un seul INSERT, aucun UPDATE ni DELETE ; écarts autour listés dans le rapport (repli silencieux de `writeAudited` si `auditsInTransaction` oublié).
28. Un contrôle détectif n'existe que si le relecteur peut retrouver ce qu'il doit relire sans dépendre d'une notification : une voie de consultation (liste, âge) est une condition de la compensation, pas un confort d'interface.
29. Une dérogation que le bénéficiaire peut renouveler seul, avec une durée qu'il choisit, est une dérogation sans terme ; tant que le PO n'a pas fixé de plafond, elle reste visible et marquée.
30. Un second regard sans motif propre (approbation qui reprend le motif de l'auteur, confirmation à `reason: null`) ne prouve pas la relecture.
31. Une table de décision qui n'est pas la piste d'audit mais en porte l'état (demandes, désignations) reçoit la même garde d'immuabilité que les autres (trigger, `search_path` épinglé, REVOKE) ; une méthode de réouverture d'un état terminal ne vit pas dans le dépôt de production.
