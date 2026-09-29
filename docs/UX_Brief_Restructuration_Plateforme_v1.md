# Brief UX/UI — Restructuration des interfaces et pages du dispositif de gestion des risques

> Document reçu du Product Owner (Jean-Philippe) le 2026-09-28, copié ici
> verbatim (même convention que `Cahier_des_charges_GRC_v0.1.md`). Voir
> `.claude/agent-context/ACTION_ITEMS.md` pour l'entrée de suivi et
> `SHARED_LOG.md` pour la réponse au point Figma (§14).

## 1. Constat sur l'interface actuelle

L'interface proposée actuellement **ne correspond pas suffisamment à l'interface de référence attendue{*charte et le niveau de détail de l'interface Cartographie de référence, Évaluations , RACI compact — panneau latéral Comments / RACI / Evidence}**.

En particulier :

* la **navigation principale / navbar est absente sur la gauche fixé** ;
* la structure générale des pages ne reprend pas suffisamment les éléments de l'interface de référence ;
* la **charte graphique, les détails UI, les composants et la cohérence visuelle** de l'interface de référence doivent être davantage conservés. {*charte et le niveau de détail de l'interface Cartographie de référence, Évaluations , RACI compact — panneau latéral Comments / RACI / Evidence}

L'objectif n'est donc pas simplement de créer de nouvelles pages, mais de **reproduire une expérience utilisateur cohérente avec l'interface de référence**, en conservant son niveau de détail, sa logique de navigation et sa qualité visuelle.

---

# 2. Interface de référence

Les pages **Cartographie,, Évaluations , RACI compact — panneau latéral Comments / RACI / Evidence** doit servir de **référence UX/UI minimale** pour l'ensemble du produit il y a beaucoup de composante deja dans ces pages

Elle doit notamment servir de référence pour :

* la navbar ;
* la navigation entre les modules ;
* la hiérarchie visuelle ;
* les layouts ;
* les cartes ;
* les tableaux ;
* les formulaires ;
* les filtres ;
* les boutons et actions ;
* les badges et statuts ;
* les modales ;
* les panneaux latéraux ;
* les composants de visualisation ;
* les espacements ;
* la typographie ;
* les couleurs ;
* les états des composants ;
* les interactions ;
* la responsive design.

**Important :** je souhaite conserver le niveau de finition et les détails de la charte graphique de l'interface de référence. Il ne faut pas créer une interface générique différente pour les nouveaux modules.

---

# 3. Pages et modules à concevoir

L'interface doit couvrir au minimum les pages / modules suivants :

### Gouvernance et gestion des risques

1. **Cartographie des risques**
2. **Évaluation des risques**
3. **Appétence au risque / Risk Appetite**
4. **Grilles de cotation**
5. **Registre des risques**
6. **Fiches de risques**
7. **Dispositif de risque**

   * mode participatif ;
   * mode classique.
8. **Risk 360 / Vue 360° du risque**

### Contrôle interne

9. **Contrôles**
10. **Fiches de procédures / fiches de contrôle individualisées**
11. **Exécution des contrôles**
12. **Statistiques des contrôles**
13. **Plan de contrôle**
14. **Lignes de défense**

### Indicateurs

15. **KRI — Key Risk Indicators**
16. **KPI — Key Performance Indicators**
17. **Dashboards**
18. **Dashboards personnalisés selon le rôle de l'utilisateur**

### Plans et suivi

19. **Plans d'action**
20. **Cycle de revue**
21. **Suivi des actions et échéances**

### Audit

22. **Audit**
23. **Constats / recommandations**
24. **Suivi des recommandations**, lorsque pertinent.

### Administration / Configuration

25. **Paramètres**
26. **Gestion IAM — Identity & Access Management**
27. **Gestion des rôles et permissions**
28. **Gestion des utilisateurs**
29. **Paramétrage des référentiels**

---

# 4. Exigences spécifiques pour le module Contrôles

Le module **Contrôles** doit aller au-delà d'une simple liste de contrôles.

Chaque contrôle doit pouvoir disposer d'une **fiche de procédure individualisée**, idéalement accessible depuis le contrôle et pouvant également être présentée / exportée en annexe.

Chaque fiche doit systématiquement préciser :

| Élément                   | Description attendue                                      |
| ------------------------- | --------------------------------------------------------- |
| ID du contrôle            | Identifiant unique                                        |
| Intitulé                  | Nom du contrôle                                           |
| Objectif                  | Ce que le contrôle cherche à prévenir ou détecter         |
| Risque couvert            | Risque(s) associé(s)                                      |
| Processus                 | Processus concerné                                        |
| Activité                  | Activité concernée                                        |
| Ligne de défense          | L1 / L2 / L3                                              |
| Responsable               | Poste / fonction en charge                                |
| Exécutant                 | Poste réalisant concrètement le contrôle                  |
| Fréquence                 | Quotidienne, hebdomadaire, mensuelle, trimestrielle, etc. |
| Nature                    | Préventif / détectif / correctif                          |
| Méthode                   | Description détaillée de l'exécution                      |
| Population                | Population soumise au contrôle                            |
| Taille de l'échantillon   | Nombre / méthode de sélection                             |
| Critère d'échantillonnage | Règle utilisée pour sélectionner les éléments             |
| Pièces justificatives     | Nature exacte des preuves à joindre                       |
| Critères de conformité    | Conditions permettant de considérer le contrôle conforme  |
| Seuil / tolérance         | Lorsque applicable                                        |
| Résultat                  | Conforme / non conforme / partiellement conforme          |
| Anomalies                 | Anomalies constatées                                      |
| Actions                   | Actions correctives éventuelles                           |
| Preuves                   | Documents ou fichiers justificatifs                       |
| Traçabilité               | Historique des exécutions et validations                  |

### Principe important

Ces informations doivent être **systématiquement structurées**, et non laissées uniquement dans des champs libres.

L'objectif est de pouvoir ensuite :

* exécuter les contrôles ;
* mesurer leur efficacité ;
* analyser les anomalies ;
* comparer les résultats dans le temps ;
* produire des statistiques ;
* rattacher les contrôles aux risques ;
* rattacher les contrôles aux lignes de défense ;
* préparer les éléments nécessaires aux audits.

---

# 5. Registre des risques

Le **Registre des risques** doit constituer une vue exhaustive des risques de l'organisation.

Il doit permettre notamment de visualiser :

* l'identifiant du risque ;
* le risque ;
* sa description ;
* la catégorie ;
* le processus ;
* le propriétaire du risque ;
* les causes ;
* les conséquences ;
* le niveau de risque inhérent ;
* les contrôles associés ;
* le niveau de risque résiduel ;
* les KRI associés ;
* les plans d'action associés ;
* le statut ;
* la date de dernière revue ;
* la prochaine revue ;
* les mécanismes de réponse au risque.

### Mécanismes de réponse au risque

Le système doit permettre de gérer les mécanismes de réponse au risque **propres à l'organisation**, plutôt que de supposer une liste générique figée.

Les réponses doivent donc être configurables dans les paramètres / référentiels.

---

# 6. Dispositif de risque

Le produit doit supporter deux modes de fonctionnement :

### Mode classique

Processus de gestion des risques centralisé avec :

* identification ;
* évaluation ;
* validation ;
* traitement ;
* suivi ;
* revue.

### Mode participatif

Permettre aux différentes parties prenantes de contribuer au dispositif :

* identification des risques ;
* contribution à l'évaluation ;
* commentaires ;
* propositions ;
* validation ;
* remontée d'informations ;
* suivi collaboratif.

L'UX doit clairement différencier les responsabilités et droits d'intervention selon le rôle de l'utilisateur.

---

# 7. Dashboards et vues par rôle

Les dashboards doivent être **adaptatifs selon le rôle de l'utilisateur**.

Exemples de profils :

* Direction ;
* Risk Manager ;
* Responsable Contrôle Interne ;
* Compliance ;
* Process Owner ;
* Contrôleur ;
* Auditeur ;
* Administrateur.

Chaque rôle doit accéder à une vue correspondant à ses responsabilités, ses indicateurs et ses actions attendues.

Le dashboard ne doit donc pas être une simple page statistique générique.

---

# 8. KRI et KPI

Les **KRI et KPI doivent rester deux entités fonctionnelles distinctes**.

L'interface doit permettre de différencier clairement :

### KRI

Indicateurs permettant de surveiller l'exposition ou l'évolution des risques.

### KPI

Indicateurs permettant de mesurer la performance opérationnelle ou organisationnelle.

Ils peuvent éventuellement être associés à des dashboards communs, mais leur logique métier, leur définition et leur gestion doivent rester distinctes.

---

# 9. Risk 360

La fonctionnalité **Risk 360** doit fournir une vue consolidée d'un risque.

Depuis une fiche de risque, l'utilisateur doit pouvoir accéder aux éléments associés :

**Risque → Causes → Impacts → Évaluation → Contrôles → Résultats des contrôles → KRI → KPI associés si pertinent → Incidents → Plans d'action → Audits → Revues → Historique**

L'objectif est de permettre à l'utilisateur de comprendre rapidement **l'ensemble de l'écosystème associé à un risque** sans devoir naviguer manuellement dans plusieurs modules.

---

# 10. Cycle de revue

Le module de cycle de revue doit permettre de gérer :

* les périodicités ;
* les prochaines échéances ;
* les responsabilités ;
* les éléments à revoir ;
* les validations ;
* les changements depuis la dernière revue ;
* l'historique ;
* les retards ;
* les relances ;
* les résultats de revue.

Les cycles peuvent notamment concerner :

* les risques ;
* les contrôles ;
* les KRI ;
* les plans d'action ;
* les dispositifs ;
* les évaluations.

---

# 11. Audit

Le module Audit doit pouvoir s'intégrer au reste du dispositif.

Il doit notamment permettre de rattacher :

* les missions d'audit ;
* les périmètres ;
* les constats ;
* les risques concernés ;
* les contrôles concernés ;
* les recommandations ;
* les responsables ;
* les échéances ;
* les plans d'action ;
* les preuves ;
* le suivi de résolution.

L'objectif est d'éviter que l'audit fonctionne comme un module isolé.

---

# 12. IAM et gestion des accès

Une page dédiée à la **gestion IAM** doit être prévue.

Elle doit permettre de gérer notamment :

* utilisateurs ;
* rôles ;
* permissions ;
* groupes ;
* périmètres ;
* droits d'accès ;
* séparation des tâches ;
* habilitations ;
* éventuellement les workflows de demande / validation des accès.

Les dashboards, pages et actions accessibles doivent dépendre du rôle et des permissions de l'utilisateur.

---

# 13. Paramètres et référentiels

La page **Paramètres** doit centraliser les éléments configurables de l'application.

Exemples :

* catégories de risques ;
* processus ;
* types de risques ;
* mécanismes de réponse ;
* niveaux de risque ;
* grilles de cotation ;
* fréquences ;
* types de contrôles ;
* lignes de défense ;
* types de KRI ;
* types de KPI ;
* statuts ;
* rôles ;
* permissions ;
* autres référentiels nécessaires au fonctionnement du système.

L'objectif est de limiter au maximum les valeurs codées en dur.

---

# 14. Figma — exigence importante

Le **UX Designer doit produire les templates / maquettes Figma** des principaux écrans.

Il faut se pencher spécifiquement sur ce point.

Si le UX Designer ne produit actuellement pas les templates Figma, il faut identifier précisément :

1. ce qui l'empêche de le faire ;
2. s'il existe une contrainte technique ;
3. s'il existe une contrainte de processus ;
4. si des composants manquent ;
5. si le Design System doit être créé ou complété ;
6. si l'accès / l'intégration Figma pose problème ;
7. quelle solution permet de débloquer la production des maquettes.

**L'objectif est d'aboutir à un véritable référentiel UX/UI dans Figma**, et pas uniquement à des interfaces générées directement dans le produit.

> **Réponse (2026-09-28)** : voir `.claude/agent-context/SHARED_LOG.md`,
> entrée `@orchestrator` du 2026-09-28 — contrainte technique confirmée,
> pas un manque de composants ni de Design System.

---

# 15. Liste exhaustive des impacts UX/UI

Enfin, il faut produire une **liste exhaustive des pages, écrans, composants et sections impactés par les changements apportés aujourd'hui**.

Cette analyse doit couvrir au minimum :

* pages existantes à modifier ;
* nouvelles pages à créer ;
* sections à modifier ;
* navigation ;
* navbar ;
* sidebar ;
* dashboards ;
* formulaires ;
* tableaux ;
* filtres ;
* modales ;
* fiches ;
* workflows ;
* composants réutilisables ;
* permissions / vues par rôle ;
* liens entre modules ;
* états vides ;
* états d'erreur ;
* états de chargement ;
* états de validation ;
* responsive design.

Pour chaque élément, préciser :

| Élément    | Action                        | Impact      | Priorité                | Dépendances         |
| ---------- | ------------------------------ | ----------- | ------------------------ | -------------------- |
| Page       | Créer / modifier / conserver  | Description | Haute / Moyenne / Basse | Modules concernés   |
| Composant  | Créer / modifier / réutiliser | Description | Haute / Moyenne / Basse | Design System       |
| Navigation | Modifier                      | Description | Haute                    | Architecture        |
| Workflow   | Modifier / créer              | Description | Haute                    | Rôles / permissions |

---

# 16. Résultat attendu

Le livrable attendu n'est donc pas uniquement une collection de nouvelles pages.

Il faut construire une **architecture UX/UI cohérente de la plateforme de gestion des risques**, avec :

**Navigation → Modules → Pages → Fiches → Workflows → Rôles → Permissions → Données → Relations entre entités → Dashboards → Reporting**

L'ensemble doit conserver la **charte et le niveau de détail de l'interface Cartographie de référence, Évaluations , RACI compact — panneau latéral Comments / RACI / Evidence**, tout en permettant une évolution cohérente vers l'ensemble des modules de gestion des risques, contrôle interne, audit et gouvernance.
