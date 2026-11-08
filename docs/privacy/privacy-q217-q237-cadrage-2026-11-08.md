# Privacy : challenge du cadrage q217 / q237 (conservation des motifs et de l'identité)

- Date : 2026-11-08
- Auteur : A15 (Privacy / Data Protection)
- Cadrage challengé : `docs/architecture/q217-q237-conservation-cadrage-2026-11-08.md` (A05), section 6
- Statut : GAP_IDENTIFIED. Aucune décision prise à la place du PO ni du DPO.
- Périmètre : conservation des motifs de visibilité, du nom, de l'e-mail et des rôles d'un compte. Hors périmètre : durée du journal lui-même (q245, Compliance).

## Sources et limites

- Lu : cadrage A05 ; texte R5 (copie du worktree `agent-a71ac3282954a2783`, absente de la copie suivi) ; `PRIV-governance-d6-2026-11-04.md` ; `PrivacyService.ts` (085) ; `UserService.ts`.
- Non vérifié : H1 (aucun motif réel en production). A15 n'a pas accès à la production ni à la base. Lecture seule, pas de Bash.
- Code lu : CONFIRMED pour `UserService` (lignes 158-171, 279-280, 317, 367). Le reste est PROBABLE.
- Aucune durée n'est proposée. Les valeurs (D, plancher, durée du journal) restent à fixer avec le DPO.
- Le RGPD reste NOT_ESTABLISHED. Le cadre applicable est la loi 2013-450 et l'ARTCI, à confirmer par le juriste.

## 1. Verdicts sur les 8 points de la section 6

**1. Équivalence (ligne d'audit gardant auteur, date et référence d'un motif effacé) : À CORRIGER.**
Le principe tient : le texte est effacé, la trace (qui, quand, quelle action) reste. Corrections :
- R5 et le cockpit ne disent pas « motif conservé un an ». Ils disent : « le texte du motif est effacé au bout d'un an ; la trace de l'action reste dans le journal ».
- La promesse vaut pour les sauvegardes et le PITR seulement à leur rotation (même règle que R3).
- La purge doit aussi viser la copie déjà présente dans `audit_log.reason` pour les lignes historiques (voir point 4). Sinon l'équivalence est fausse pour l'historique.

**2. Périmètre (motifs `resource.readall`, `sensitive_view_grants`) : À CORRIGER.**
Un motif de demande de lecture nomme une personne visée (fraude, RH, dossier nommé). Sa sensibilité est au moins égale à celle d'un motif de visibilité. Recommandation : l'inclure dans la durée d'un an par défaut. Une conservation plus longue n'est admissible que si Compliance documente une obligation de preuve de la décision, avec une durée distincte fixée par le DPO. « Conservés avec le journal dans les deux cas » ne doit pas être la règle par défaut.

**3. Point de départ (fin d'effet, reco B) : OK avec réserve.**
La fin d'effet (retrait, remplacement, révocation, retour à « tout le client ») est le bon point de départ : une restriction active garde sa justification lisible. Réserves :
- Une restriction active sans fin ne doit pas avoir un motif sans limite : revue périodique de tout motif encore actif (recertification, cf. avis V4).
- Stocker la date de début et la date de fin d'effet (`effect_ended_at` est prévu, à confirmer).

**4. Historique (exception B aux lignes anciennes ou conservation en l'état) : À CORRIGER, décision HUMAN.**
Si H1 est faux, la conservation en l'état jusqu'à la durée du journal (sans limite selon ACT-072 C) est incompatible avec la décision d'un an. Privacy préfère une exception B étroite à cette conservation, à trois conditions :
- Le critère d'éligibilité est exact. « PERMISSION_CHANGE + une liste d'entity_type » est fragile, car `RoleService` utilise la même action. Il faut prouver, sur les lignes existantes, qu'on n'efface que les motifs de visibilité.
- L'exception ne touche que la colonne du motif : jamais `user_id`, ni les valeurs avant/après, ni les lignes de rôle.
- Revues A23 et A10, et décision HUMAN tracée. Privacy ne tranche pas cette exception.

**5. Identité (pseudonymisation du nom, de l'e-mail et des rôles) : BLOQUANT pour toute promesse d'effacement du nom et de l'e-mail. Le principe reste acceptable.**
Constat confirmé dans `UserService.ts` : l'objet utilisateur complet, avec `email` et `displayName`, est écrit dans `audit_log.new_value` à la création (l. 161-171). Les mises à jour, suspensions et réactivations écrivent aussi `before`/`after` (l. 279-280, 317, 367). Pseudonymiser la ligne `users` ne retire donc pas le nom ni l'e-mail du journal. Il faut :
- Inventorier les lignes d'audit qui portent une identité (requête de lecture, sur staging puis production).
- Ne plus écrire l'identité dans les valeurs du journal pour les nouvelles lignes. C'est de la minimisation, à faire sans attendre D.
- Traiter l'historique selon le point 4.
Rôles : un pseudonyme stable, ses rôles, ses dates et ses actions restent des données personnelles. La pseudonymisation n'est pas l'anonymisation, et dans une petite structure un rôle unique réidentifie. Conserver les rôles sans nom n'est acceptable que si Compliance confirme le besoin de traçabilité des habilitations. Sinon, pseudonymiser aussi les liens de rôle historiques. Le pseudonyme doit être aléatoire, non dérivé de l'identifiant, et ne jamais apparaître hors de l'audit. Vérifier aussi l'identifiant externe de connexion (IdP) : il ne doit pas permettre de rattacher le compte après pseudonymisation.

**6. E-mail absent du texte R5 : À CORRIGER maintenant.**
R5 liste trois éléments, alors que `users.email` (migration 002) est conservé et copié dans le journal. Une information incomplète est un défaut indépendant de la purge. Correction proposée dans la section 2 (C1). Le DPO a déjà validé la note D6 : seule la phrase modifiée lui est soumise pour confirmation, pas la note entière.

**7. Autres textes libres du journal (motifs de rôle, désignations, profils) : À CORRIGER, ouvrir un point séparé.**
`UserService` passe `input.reason` à l'affectation de rôle (l. 159), et ce texte reste dans le journal sans durée. Ces textes peuvent nommer des personnes. Hors q217, mais à inscrire maintenant dans `ACTION_ITEMS` (owner A15 puis PO). Bloquant pour toute affirmation de « durée maîtrisée » du journal.

**8. Exports déjà réalisés : À CORRIGER (procédure, pas seulement R5).**
Un export déjà téléchargé échappe à toute purge. R5 ne doit pas promettre l'effacement des copies extraites. Consignes à proposer au DPO : limiter les exports aux besoins, les tracer (si un événement d'export existe, à vérifier), et demander leur suppression après usage. Aucune durée n'est proposée.

## 2. Corrections à porter

- **C1 (R5, non bloquant pour D6 mais à faire maintenant)** : ajouter l'e-mail dans « ce qui est enregistré » et dans « conservé avec votre compte ». Préciser que nom, e-mail et rôles figurent aussi dans les lignes du journal. Proposition de phrase, à valider par le DPO :
  « Votre nom affiché, votre adresse e-mail et vos rôles sont conservés avec votre compte. Ils figurent aussi dans les lignes du journal d'audit, qui servent à la traçabilité. La durée de conservation de ces données est en cours de fixation par votre organisation. »
  Remplacer cette phrase par la durée fixée dès qu'elle l'est. Mettre aussi à jour la ligne de statut du fichier R5 (« projet, à valider par le DPO ») quand le DPO a confirmé.
- **C2 (q237)** : ne livrer aucune purge « identité » avant la décision sur les copies du journal (point 5). Tant que D n'est pas fixée, `identity_retention_days` reste NULL, et la purge n'efface rien (fail-closed).
- **C3 (q241)** : inclure les motifs `resource.readall` dans la durée d'un an par défaut (point 2).
- **C4 (q243, plancher et réduction)** : la règle « seconde personne » doit valoir pour tout changement de durée, à la hausse comme à la baisse. Un allongement augmente le risque autant qu'une baisse le réduit. Le plancher de 365 jours est un choix PO ; A15 ne le valide pas et demande sa confirmation par le DPO. Un plancher n'est défendable que si Compliance justifie le cycle d'audit qu'il protège.
- **C5 (q242)** : revue périodique des motifs encore actifs (point 3).
- **C6** : ouvrir le point sur les textes libres du journal (point 7).
- **C7 (exports)** : consigne d'export et information du DPO (point 8).

## 3. H1 : ce qu'elle change

H1 n'est pas vérifiable par A15. Elle se vérifie par une requête de lecture dont le résultat est versé en preuve (orchestrateur ou DevOps).
- **Si H1 est vraie** : option A pour q217 sans exception ni traitement de l'historique. L'exception B n'est pas à ouvrir. La question « historique » disparaît en production, mais reste ouverte sur staging.
- **Si H1 est fausse** : le point 4 devient une décision HUMAN à prendre avant toute mise en production du lot de motifs.
- **Dans les deux cas** : aucun motif ne doit être écrit en production tant que la table de motifs n'existe pas. Par ailleurs, H3 suppose que staging ne contient que des données de test : le confirmer, car une copie de production non masquée ferait tomber cette hypothèse.

## 4. Formulations proposées pour le cockpit

Les numéros sont indicatifs. L'orchestrateur les attribue.

**Q-A. Motifs de changement d'accès : comment les effacer au bout d'un an sans toucher au journal d'audit ?**
- A (reco) : le motif est rangé dans un espace séparé, que le journal référence. Le texte est effacé à l'échéance ; la trace de l'action reste.
- B : exception qui permet d'effacer le seul texte du journal. Revue A23 et A10, décision HUMAN.
- C : motif choisi dans une liste, sans texte libre. Ne règle pas l'historique, et revient sur la décision de texte libre.
- Reco : A, avec C possible en complément.

**Q-B. Quels motifs sont effacés au bout d'un an ?**
- A (reco) : tous les motifs qui justifient qui peut voir une fiche restreinte, y compris les demandes de lecture.
- B : seulement les changements de niveau ou de liste.
- Reco : A. Les demandes de lecture restent couvertes par la même règle, sauf exception documentée par Compliance.

**Q-C. Quand commence le délai d'un an pour un motif ?**
- A : à la date où le motif est saisi. Une restriction encore active peut perdre sa justification.
- B (reco) : à la date où le motif cesse de s'appliquer. Une restriction active garde son motif, avec une revue périodique.
- Reco : B.

**Q-D. Qui peut modifier la durée des motifs, et dans quel sens ?**
- A (reco) : toute modification, raccourcir ou allonger, demande une seconde personne, et est tracée. Le plancher de 365 jours est confirmé par le DPO.
- B : seulement les réductions demandent une seconde personne.
- Reco : A.

**Q-E. Nom, e-mail et rôles d'une personne partie : jusqu'à quand les garder ?**
- A (reco) : après une durée fixée par le DPO, le nom et l'e-mail sont remplacés par un pseudonyme, qui reste lié aux actions du journal. Tant que la durée n'est pas fixée, rien n'est effacé. Pseudonymiser n'est pas effacer.
- B : sans limite, comme le journal. Le texte R5 devra le dire.
- Reco : A, sous réserve de Q-F.

**Q-F. Noms et e-mails déjà écrits dans le journal d'audit : que fait-on ?** (nouvelle question, bloquante pour Q-E)
- A (reco, immédiat) : ne plus écrire le nom ni l'e-mail dans les valeurs du journal, pour les nouvelles lignes.
- B : traiter aussi les lignes anciennes, par une exception à l'ajout seul. Décision HUMAN, avis DPO.
- C : laisser en l'état. Incompatible avec une durée décidée, à refuser au-delà de D.
- Reco : A tout de suite ; B à étudier avec les juristes. Cette question gagne en importance si le journal est conservé 10 ans : sans retrait de l'identité des nouvelles lignes, un nom et un e-mail resteraient 10 ans dans les valeurs du journal.

**Q-G. Durée du journal d'audit de l'outil : quelle durée, et à quel texte la rattache-t-on ?** (remplace q245, reprise de la réponse Compliance `docs/compliance/CMP-q217-q237-conservation-2026-11-08.md`)
Contexte : DECISION-038 n° 8 (« 10 ans, configurable ») ne dit pas si elle vise les évidences ou le journal. Le dépôt ne tranche pas. Le plancher de 10 ans pour la piste d'audit vient de l'Instruction BCEAO 017-12-2010, citée par le prompt Compliance ; son applicabilité à Djamo (SFD, établissement de monnaie électronique ou de paiement) n'est pas établie, et le juriste doit la confirmer.
- A (reco Compliance) : 10 ans pour le journal, configurable. Statu quo sans purge d'ici là.
- B : 10 ans pour les évidences seulement ; durée du journal fixée plus tard avec le juriste. q237 reste suspendue.
- C : sans limite pour le journal, jusqu'à avis juridique.
Avis Privacy : A15 n'accepte pas le plancher de 10 ans comme acquis pour un journal contenant des données personnelles. Si le juriste le confirme, il ne justifie que la piste (qui, quand, quoi, référence), pas le nom ni l'e-mail. Ces derniers doivent rester hors du journal (Q-F), ou sous pseudonyme stable. Reco Privacy : A, sous réserve que le juriste confirme à la fois le régime de Djamo et l'objet de la piste d'audit, et que le DPO valide la proportionnalité. Prérequis de toute purge : avis juriste et DPO.

## 5. À porter au DPO (liste courte)

1. Durée D du nom, de l'e-mail et des rôles, et plancher éventuel. Aucune valeur n'est proposée par A15. D dépend de la durée du journal (Q-G) : si le journal est conservé 10 ans, D ne peut être fixée qu'avec le DPO, au plus tôt après 10 ans si l'identité de l'auteur est exigée.
1bis. Articulation du plancher de 10 ans (Compliance, Q-G) avec la loi 2013-450 et la proportionnalité : le juriste établit d'abord le régime de Djamo, puis le DPO se prononce.
2. Durée d'un an des motifs, et plancher de 365 jours.
3. Acceptation de la pseudonymisation comme fin de conservation (et non comme anonymisation).
4. Phrase R5 corrigée : e-mail, copies dans le journal, durée (C1).
5. Exports et sauvegardes (point 8).
6. Traitement des lignes anciennes du journal (Q-F) : avis avant toute exception à l'ajout seul.

## Statut

- Global : GAP_IDENTIFIED.
- Promesse d'effacement du nom et de l'e-mail : BLOCKED tant que Q-F n'est pas tranchée.
- Motifs : CHALLENGED, avec corrections C3 à C5.
- Relecture A15 à refaire après réponse du PO à Q-A à Q-G, après avis du juriste (régime de Djamo, objet de la piste d'audit), et après vérification de H1.
- Q-G : la réponse Compliance (A14) ne fixe pas la durée du journal. Le plancher de 10 ans reste une hypothèse de travail du dépôt, non vérifiée pour Djamo. Aucune purge avant avis juriste et DPO.
