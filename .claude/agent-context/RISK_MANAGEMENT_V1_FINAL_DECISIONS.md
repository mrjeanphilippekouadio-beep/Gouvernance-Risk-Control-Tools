# Risk Management V1 — Decision & Execution Record

> Statut : **REFERENCE DE TRAVAIL VALIDEE**
>
> Ce document consolide les décisions métier, UX et architecture arrêtées avant l'implémentation frontend. Il complète les Decision Logs existants ; il ne remplace pas les décisions antérieures.
>
> **Amendement du 2026-10-08** (DECISION-014 et DECISION-015, `.claude/agent-context/ACTION_ITEMS.md`) : modes de cotation, rôles Risk Owner / Délégué / Exécuteur, paramètres du Dispositif. Paragraphes touchés : §4, §5, §7, §8, §10, §16, §17 (Phase 4). Origine : `docs/architecture/RM-V1-Modes-cotation-objections.md` et `docs/architecture/RM-V1-Amendement-contrat-modes-PROJET.md`.

## 1. Gouvernance de conception

- **Jean-Philippe / N0** : décision finale et arbitrage.
- **Risk Manager** : porte la logique Risk Management, impulse la méthodologie, challenge les propositions et vérifie leur cohérence avec les principes de référence.
- **UX Designer** : transforme la logique validée en parcours, information architecture, interactions et design Penpot.
- **Architecte** : analyse l'existant, vérifie la faisabilité, propose la traduction technique et identifie les écarts ; il ne redéfinit pas la logique Risk.
- **Orchestrator** : transforme les décisions validées en lots d'exécution bornés.
- **dev-frontend** : implémente uniquement les lots validés.

Le code existant est une **contrainte à analyser**, pas la définition du produit.

```
Jean-Philippe
    ↓
Risk Manager — logique métier
    ↓
UX Designer — expérience
    ↓
Risk Manager + Jean-Philippe — validation
    ↓
Architecte — faisabilité / traduction technique
    ↓
Architecte + Risk Manager + Jean-Philippe — arbitrage
    ↓
UX / Penpot — design final
    ↓
Orchestrator
    ↓
dev-frontend
    ↓
QA
```

## 2. Finalité du produit Risk Management

Le produit est conçu autour du **processus de gestion des risques**, et non autour d'une collection d'onglets techniques.

```
Identification
    ↓
Analyse
    ↓
Évaluation
    ├── Inhérent
    ├── Maîtrise
    └── Résiduel
    ↓
Comparaison à l'appétence
    ↓
Décision de traitement si nécessaire
    ↓
Validation
    ↓
Traitement
    ↓
Suivi
    ↓
Réévaluation
    ↓
Cartographie / Risk 360
```

Cette structuration s'appuie sur ISO 31000 et COSO ERM comme **cadres de conception**, adaptés à DJAMO et non copiés littéralement dans l'application.

## 3. Cartographie

**Décision validée : la Cartographie est conservée comme acquis produit.**

Elle reste une vue de synthèse de pilotage et ne doit pas recalculer indépendamment les données métier.

```
Cartographie
     ↓
Évaluation faisant foi
     ↓
Analyse
     ↓
Identification
```

Les autres anciens onglets/pages ne sont pas considérés comme définitifs : ils doivent être repensés comme capacités du parcours Risk Management.

## 4. Identification et Analyse

L'identification officielle relève du Risk Owner.

Le Risk Owner est un responsable métier (directeur de département, chef de projet, manager). Il est désigné au niveau du **Processus**, avec un **Délégué** quand l'effectif du département le permet ; les risques du Processus en héritent. Une surcharge sur un risque donné remplace toujours la paire Risk Owner + Délégué ensemble. La désignation est faite par la direction du département, approuvée par l'équipe risque et tracée (auteur, motif, valeur précédente, approbateur).

L'Analyse est une étape distincte de l'Identification et de l'Évaluation. Elle sert notamment à documenter causes, événements, impacts potentiels, contexte et contrôles connus.

Le contexte est cumulatif :

```
Identification
    ↓
visible dans Analyse
    ↓
Identification + Analyse
    ↓
visibles dans Évaluation
```

Une information héritée peut être visible sans être éditable dans l'étape suivante.

## 5. Évaluation

L'Évaluation couvre :

- Inhérent ;
- Maîtrise ;
- Résiduel ;
- comparaison à l'appétence ;
- décision de validation.

La saisie de l'Inhérent, de la Maîtrise et du Résiduel est attribuée selon le mode effectif de l'évaluation (§7). L'équipe risque saisit le Résiduel dans tous les modes.

Le Risk Owner décide du traitement ; il ne cote pas. Le Délégué remplace le Risk Owner en son absence ou par délégation datée ; il ne valide jamais ses propres actes ; la responsabilité reste au Risk Owner.

Un acteur ne valide jamais ce qu'il a saisi, revu ou exécuté : le validateur est différent de tous les auteurs de l'évaluation. Par défaut, le validateur est le responsable de la fonction risque, et le Comité au-delà du seuil de passage Comité (§8) ; ce choix est un paramètre du Dispositif (§10).

**Revue de l'Inhérent saisi par la 1re ligne** (mode effectif Participatif) : un membre de l'équipe risque, différent de l'auteur, le **retient**, ou le **retourne / rejette avec une annotation obligatoire** ; un Inhérent retourné revient à la 1re ligne pour une nouvelle saisie. Tant que l'Inhérent n'est pas retenu, le Résiduel ne s'appuie pas dessus.

**Maîtrise** : qui la note est un **paramètre du Dispositif**, jamais une valeur figée en code (une organisation peut manquer de personnes pour séparer les saisies). Quand deux acteurs notent la même cellule, les deux saisies sont conservées, celle désignée par le paramètre fait foi (par défaut : l'équipe risque), un commentaire est obligatoire en cas d'écart, sans moyenne.

> Contribution ≠ Saisie ≠ Décision de traitement ≠ Validation.

La maîtrise globale utilise la règle **MIN non-compensatoire**. Le backend reste l'autorité métier ; le frontend ne recalcule pas la vérité métier.

## 6. Axes d'impact

Le nombre d'axes d'impact **n'est pas fixe**. Il est déterminé par la Rating Scale active.

```
Impact retenu = MAX(valeur de tous les axes configurés)
```

Le frontend doit donc itérer dynamiquement sur les axes retournés par le backend.

**Aucun code ne doit supposer 7 axes.**

## 7. Modes et contributions

Modes :

- **Classique** : l'équipe risque saisit l'Inhérent, la Maîtrise et le Résiduel ;
- **Participatif** : l'Exécuteur du contrôle (1re ligne) saisit l'Inhérent et sa part de Maîtrise ; l'équipe risque revoit l'Inhérent (§5), saisit la Maîtrise selon le paramètre du Dispositif et le Résiduel ;
- **Hybride** : politique du Dispositif qui permet de choisir Classique ou Participatif risque par risque.

Ils ne créent pas trois workflows métier différents : les étapes sont identiques, seule l'attribution de la saisie change. Le mode **effectif** d'une évaluation est toujours Classique ou Participatif, jamais Hybride, et il est figé sur l'évaluation.

En mode effectif Participatif, l'équipe risque peut commenter ou annoter l'Inhérent saisi par la 1re ligne. Une annotation ne remplace pas la revue explicite (retenu, ou retourné / rejeté) du §5.

Contributions :

- elles interviennent sur les risques évalués en mode effectif **Participatif** ;
- elles sont faites par la personne désignée par le Risk Owner : le Délégué, l'Exécuteur du contrôle ou le Risk Owner lui-même, toujours selon les règles du Dispositif ;
- types : Identification ; Analyse ; Inherent ; Maîtrise ;
- le **Signalement** reste ouvert indépendamment du mode et du Dispositif (§10, DECISION-012).

Aucune contribution ni saisie de 1re ligne sur le Résiduel. Une contribution apporte de l'information et ne cote jamais. La saisie de l'Inhérent par la 1re ligne n'est pas une contribution : c'est une auto-évaluation soumise à la revue du §5.

Rôles d'organisation (Risk Owner, Délégué, Exécuteur du contrôle) et lignes de défense (L1, L2, L3) sont deux axes distincts. L'Exécuteur est porté par le Contrôle et relié à un utilisateur ; un contrôle sans Exécuteur relié ne permet pas la cotation Participative.

## 8. Appétence et Treatment Decision

L'appétence est une référence de décision dans le cycle d'évaluation.

Un dépassement peut déclencher une Treatment Decision, rattachée à l'évaluation qui l'a déclenchée. Le Risk Owner décide de la Treatment Decision (qui la propose reste à trancher).

Options validées :

- Accepter ;
- Surveiller ;
- Réduire ;
- Transférer ;
- Éviter.

**Accepter** et **Surveiller** restent distincts.

Deux seuils de Comité sont indépendants :

1. seuil de passage Comité de l'Évaluation ;
2. seuil de passage Comité de la Treatment Decision.

Ils sont configurables et ne doivent pas être traités comme une constante métier unique.

## 9. Meeting

Le Meeting est une capacité transverse : ni mode d'évaluation, ni étape obligatoire, ni étape supplémentaire du stepper.

Il peut servir à recueillir des contributions, discuter, décider, valider une identification ou travailler sur une évaluation.

Le Meeting DJAMO est la source de vérité métier. Les calendriers externes sont des projections/synchronisations.

## 10. Dispositif — décision finale RM + UX + Architecture

Le **Dispositif** est le cadre méthodologique de référence qui rend une évaluation interprétable et comparable.

Il est distinct du Risque, du Processus, de l'Évaluation, de l'Appétence, du Meeting et de Risk 360.

### Règles validées

- Un Dispositif peut couvrir plusieurs Processus.
- Un Processus peut avoir un seul Dispositif actif à un instant donné.
- Le Dispositif est résolu après l'identification officielle, à partir du Processus applicable.
- Le signalement ne dépend pas du Dispositif.
- Une évaluation utilise une seule méthodologie de Dispositif applicable.
- Le Dispositif est versionné : `DRAFT → ACTIVE → ARCHIVED`.
- L'historique d'une évaluation ne doit jamais être réécrit par une modification ultérieure du Dispositif.
- Le contexte méthodologique applicable doit être conservé dans l'évaluation.

### Traduction technique validée

Le Dispositif doit être un **objet persistant et versionné**, distinct de Risk 360.

Proposition technique :

- métier : **Dispositif** ;
- UX : **Référentiel de risque** possible ;
- technique : `RiskFramework` / `risk_frameworks`.

L'évaluation doit conserver le lien vers le Dispositif/version applicable et sa lineage/snapshot.

### Paramètres, invariants et gouvernance (amendement 2026-10-08)

Le Dispositif est **configurable** : le client final peut demander des modifications. Ses paramètres sont fixés à la création du Dispositif, avant le premier risque, avec des valeurs par défaut :

| Paramètre | Valeur par défaut |
|---|---|
| Mode par défaut (tenant, puis Processus — DECISION-006) | Classique |
| Politique Hybride (choix du mode par risque) | Désactivée |
| Qui note la Maîtrise, et quelle saisie fait foi | Selon le mode (§7) ; l'équipe risque fait foi |
| Cumul Risk Owner + Exécuteur | Autorisé jusqu'au seuil de criticité « faible » ; au-delà, exception approuvée et revue à chaque cycle |
| Seuil de criticité « faible » | Inscrit à la création du Dispositif |
| Cumul Délégué + Exécuteur | Autorisé, le Délégué ne validant pas sa propre exécution |
| Délégué | Recommandé, jamais bloquant (« Non désigné (équipe trop réduite) ») |
| Durée d'une délégation datée | Fixée par le client |
| Validateur | Responsable de la fonction risque ; Comité au-delà du seuil (§8) |
| Désignation des rôles | Direction du département ; approbation par l'équipe risque |
| Approbateur d'un changement de paramètre de séparation des tâches | Comité |
| Échelles, descriptions de probabilité, appétence, seuils Comité | Déjà paramétrables |

**Invariants** (aucun paramètre ne peut les modifier) :

1. On ne valide jamais ce qu'on a saisi, revu ou exécuté ; le validateur est hors de tous les auteurs.
2. Risk Owner ≠ Délégué ; pas de Délégué sans Risk Owner.
3. Le Résiduel est saisi par l'équipe risque ; aucune contribution ni saisie de 1re ligne sur le Résiduel.
4. Le mode effectif d'une évaluation est Classique ou Participatif, jamais Hybride.
5. Toute désignation (Risk Owner, Délégué, Exécuteur) et tout changement de paramètre sont tracés (auteur, motif, valeur précédente, approbateur), approuvés par un tiers, jamais auto-attribués ni auto-approuvés.
6. Tout cumul de rôles est marqué visiblement.
7. Les champs d'attribution sont forcés côté serveur ; l'audit est append-only ; l'historique d'une évaluation n'est jamais réécrit.
8. Un paramètre ne peut jamais abaisser un invariant, ni être modifié pour faire disparaître un dépassement d'appétence.
9. Un changement ne touche que les cycles à venir ; les évaluations en cours gardent leur instantané.

**Gouvernance d'un changement de paramètre** : l'administrateur du Dispositif (`riskframework.update`) le demande, avec un motif écrit ; le responsable de la fonction risque, différent du demandeur, l'approuve, ou le Comité pour les paramètres de séparation des tâches. Le changement crée une nouvelle version du Dispositif (`DRAFT → ACTIVE`), jamais une modification en place. Le Comité n'étant pas disponible à tout moment, la version reste en `DRAFT` jusqu'à sa séance ; rien n'impose une décision immédiate, puisque l'effet n'intervient qu'au cycle suivant. L'audit conserve l'ancienne et la nouvelle valeur.

Le mode d'un risque donné ne peut différer de celui du Processus que si la politique Hybride l'autorise ; ce choix est motivé, approuvé et prend effet au cycle suivant. Le Dispositif n'est jamais redéfini risque par risque : il est résolu et affiché à l'ajout du risque. Les paramètres et les désignations en vigueur sont figés par instantané dans chaque évaluation.

Permissions cibles :

- `riskframework.read`
- `riskframework.create`
- `riskframework.update`
- `riskframework.activate`
- `riskframework.archive`
- `riskframework.process.assign`

### Risk 360

Le service existant `RiskDeviceViewService` représente une **vue composite Risk 360**, pas le nouveau Dispositif. Il devra être renommé ultérieurement pour supprimer l'ambiguïté terminologique.

## 11. Risk 360

Risk 360 reste une vue consolidée, transverse et en lecture. Il ne devient pas une deuxième source de vérité métier.

## 12. Réévaluation

Une réévaluation est un **nouveau cycle du même risque**. L'historique précédent ne doit jamais être écrasé.

```
Risque
 ├── Évaluation #1
 ├── Treatment Decision #1
 ├── Évaluation #2
 ├── Treatment Decision #2
 └── ...
```

## 13. UX validée

L'expérience doit privilégier :

- une seule source de vérité ;
- un parcours continu ;
- une fiche risque portant le cycle ;
- progressive disclosure ;
- contexte cumulatif ;
- contributions distinctes des décisions ;
- historique lisible ;
- Cartographie/Risk 360 comme vues de synthèse.

Le Dispositif peut être présenté comme **Référentiel méthodologique** dans l'UX. Dans l'évaluation, il apparaît comme contexte en lecture seule et ne devient pas une étape de cotation.

Penpot est la référence visuelle avant implémentation.

## 14. WebSocket-ready

Le frontend doit être préparé pour le temps réel sans implémenter le WebSocket dans le premier lot.

```
PostgreSQL = source de vérité
REST/API = lecture + mutations autoritaires
WebSocket = notification de changement
```

Prévoir une abstraction `RealtimeClient` et une stratégie de resynchronisation.

Le futur contrat événementiel devra traiter versionnement, idempotence, tenant scope, reconnexion et resynchronisation.

## 15. Déjà réalisé

Lot 0 backend intégré à STAGING :

- **R-01** : Rating Scale ACTIVE/ARCHIVED immuable ;
- **P-04** : seuil d'appétence inactif exclu de l'applicable ;
- **D-06** : audit `ESCALATE` accepté par la contrainte DB.

La migration 044 est appliquée et vérifiée sur STAGING. Production n'a pas été modifiée par cette passe.

## 16. Interdictions dev-frontend

Ne pas :

- redéfinir la méthodologie ;
- inventer des règles de scoring ;
- supposer 7 axes ;
- modifier le backend sans lot explicite ;
- créer de migration ;
- créer un nouveau Design System ;
- créer une autre source de vérité ;
- implémenter le serveur WebSocket ;
- décider seul des règles maker-checker, Comité, Dispositif ou paramètres du Dispositif ;
- utiliser l'ancien frontend comme définition du produit.

Si un contrat manque :

```
STOP
↓
documenter le manque
↓
identifier le propriétaire du contrat
↓
attendre arbitrage / lot dédié
```

## 17. Séquence d'exécution

### Phase 0 — Trace et gouvernance

1. Conserver ce document dans le repo avec les Decision Logs.
2. Vérifier les décisions ouvertes et leurs propriétaires.
3. Ne jamais remplacer une décision validée par une supposition technique.

### Phase 1 — Penpot

4. Transformer le modèle RM + UX validé en écrans Penpot.
5. Préserver la Cartographie.
6. Repenser les anciens onglets comme capacités du parcours.
7. Validation Risk Manager.
8. Contrôle de faisabilité Architecte.
9. GO final Jean-Philippe.

### Phase 2 — Architecture exécutable

10. Transformer l'architecture validée en lots.
11. Pour chaque lot : API, DB, permissions, audit, frontend, historique, critères d'acceptation.
12. Identifier explicitement les dépendances bloquantes.

### Phase 3 — Fondations frontend

13. Mettre en place le parcours Risk Management.
14. Réutiliser `@djamo/design-system`.
15. Préparer le contexte cumulatif.
16. Préparer `RealtimeClient` sans WebSocket réel.
17. Obtenir le premier écran visible dans le navigateur.
18. Comparer Penpot ↔ navigateur.
19. Corriger avant d'élargir le périmètre.

### Phase 4 — Parcours métier

Ordre recommandé :

1. Identification ;
2. Analyse ;
3. Évaluation Inherent (saisie selon le mode, revue de la 1re ligne — §5 et §7) ;
4. Maîtrise (selon le paramètre du Dispositif) ;
5. Résiduel ;
6. Appétence ;
7. Treatment Decision ;
8. Validation / Comité ;
9. Traitement ;
10. Suivi ;
11. Réévaluation ;
12. Cartographie / Risk 360.

### Phase 5 — Capacités transverses

13. Dispositif / Référentiel méthodologique ;
14. Contributions ;
15. Meeting ;
16. permissions ;
17. audit ;
18. historique.

### Phase 6 — Temps réel

19. Contrat événementiel Architect + Backend.
20. WebSocket backend.
21. WebSocket frontend.
22. Resynchronisation REST.
23. Tests reconnexion / idempotence / ordre.

### Phase 7 — QA et gates

24. QA fonctionnelle.
25. QA UX / Penpot.
26. QA sécurité / permissions.
27. QA historique / audit.
28. QA realtime.
29. Validation Risk Manager.
30. Validation UX.
31. Validation Architecte.
32. GO Jean-Philippe.
33. STAGING.
34. Validation STAGING.
35. Préparation PROD seulement après validation.

## 18. Gate entre les lots

Chaque lot doit retourner :

- fichiers modifiés ;
- décisions utilisées ;
- contrats utilisés ;
- tests ;
- captures/validation visuelle si pertinent ;
- écarts ;
- blocages ;
- aucun scope supplémentaire.

Le lot suivant ne démarre qu'après le gate humain.

## 19. Statut

```
Méthodologie Risk Management       ✅
RM + UX                            ✅
Dispositif métier                  ✅
Architecture cible                 ✅
Lot 0 backend                      ✅
STAGING                            ✅

Penpot final                       → prochaine étape
Frontend Risk Management           → après validation Penpot
Backend gaps méthodologiques       → lots dédiés
WebSocket                          → couche finale
PROD                               → hors périmètre actuel
```
