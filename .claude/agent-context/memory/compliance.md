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
