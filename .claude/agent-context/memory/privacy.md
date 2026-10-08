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
