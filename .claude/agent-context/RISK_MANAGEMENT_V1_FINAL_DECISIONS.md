# Risk Management V1 — Decision & Execution Record

> Statut : **REFERENCE DE TRAVAIL VALIDEE**
>
> Ce document consolide les décisions métier, UX et architecture arrêtées avant l'implémentation frontend. Il complète les Decision Logs existants ; il ne remplace pas les décisions antérieures.

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

Le Risk Owner reste le seul décideur des cotations Inherent et Résiduel.

> Contribution ≠ Cotation ≠ Décision ≠ Validation.

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

- Classique ;
- Participatif ;
- Hybride.

Ils ne créent pas trois workflows métier différents.

Contributions possibles :

- Signalement ;
- Identification ;
- Analyse ;
- Inherent ;
- Maîtrise.

Aucune contribution sur le Résiduel. Le contributeur apporte de l'information et ne cote jamais à la place du Risk Owner.

## 8. Appétence et Treatment Decision

L'appétence est une référence de décision dans le cycle d'évaluation.

Un dépassement peut déclencher une Treatment Decision, rattachée à l'évaluation qui l'a déclenchée.

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
- décider seul des règles maker-checker, Comité ou Dispositif ;
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
3. Évaluation Inherent ;
4. Maîtrise ;
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
