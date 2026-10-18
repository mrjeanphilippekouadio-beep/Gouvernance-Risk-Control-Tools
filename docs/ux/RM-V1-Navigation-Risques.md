# RM V1 — Navigation de la section Risques (A04, UX Designer)

**Statut** : DRAFT pour validation PO. Spécification de navigation uniquement, pas de maquette, pas de code.
**Base** : DECISION-054, 060, 062 ; contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` §3 (Cartographie conservée), §4 (Identification, Analyse, contexte cumulatif), §13 (fiche risque portant le cycle, Dispositif en lecture seule dans l'évaluation) ; `App.tsx` actuel ; `docs/ux/RM-V1-Experience-Dispositif.md` §4 (cette note remplace le §4 sur le regroupement et sa question 5).
**Hors périmètre** : champs de l'étape Analyse (attend q121 / OD-10), file « À faire », contenu des écrans non cités.

## 1. Règles retenues (décidées par le PO)

1. Les réglages (Dispositif : échelles, appétence, paramètres ; réglages plateforme) vivent dans l'Administration.
2. Ailleurs, un réglage n'apparaît que comme **raccourci** : un lien qui ouvre le même écran d'Administration (ou la même action). Jamais de second formulaire, jamais de second chemin d'écriture.
3. L'administrateur peut aussi proposer et modifier la méthodologie (DECISION-060). Le circuit d'approbation des changements de Dispositif ne change pas ; l'auteur d'une demande ne l'approuve jamais (déjà vrai dans `FrameworksPage`).
4. Cacher un bouton n'est pas un contrôle d'accès : le serveur décide. Un utilisateur sans droit voit l'action désactivée avec sa raison, et le clic ouvre `PermissionDeniedDialog` (existant).

## 2. Arborescence cible

```
Risques                         (le parcours, pour travailler un risque)
  Cartographie                  vue de synthèse, conservée
  Registre                      liste ; ouvre la fiche risque
    Fiche risque                porte le cycle, étapes en onglets :
      Identification            Risk Owner ; éditable à cette étape seulement
      Analyse                   emplacement réservé (q121) ; lecture seule du contexte Identification au-dessus
      Évaluation                Inhérent, Maîtrise, Résiduel, appétence, décision ; Identification + Analyse en lecture seule au-dessus
      Historique                existant
  Évaluations                   file de travail : liste des évaluations ; un clic ouvre la fiche à l'étape Évaluation

Contrôle interne, Indicateurs, Plans & revues, Audit     inchangés

Administration
  Méthodologie
    Dispositif de risque        versions, paramètres, demandes en attente, approbation
    Grilles de cotation         (voir §3 et question Q1)
    Appétence                   (voir §3 et question Q1)
  Référentiels
    Processus · Départements · Catégories de risque      inchangés
  Plateforme
    IAM · Rôles · Feedback · Paramètres & référentiels   inchangés
```

Sous-titres « Méthodologie / Référentiels / Plateforme » : simples séparateurs dans la liste du groupe Administration, pas de nouveau niveau de menu. Le libellé « Référentiel méthodologique » du contrat §13 reste possible pour « Méthodologie » ; non nécessaire en V1.

**Principe du parcours** : à chaque étape, le contexte des étapes précédentes est affiché en bandeau replié en tête, en lecture seule. Le composant existe déjà dans `EvaluationPage` (carte « Identification & Analyse », « visible ici, non modifiable depuis l'évaluation ») ; il est réutilisé tel quel pour l'étape Analyse. Le Dispositif n'est pas une étape : il apparaît comme ligne de contexte (version, grille, seuil) dans l'Évaluation, avec un raccourci.

**Étape Analyse, emplacement seulement** : l'onglet existe, il affiche aujourd'hui ce que l'évaluation montre déjà (contrôles connus, lecture seule). Aucun champ n'est spécifié avant la réponse à q121. Tant que q121 est ouverte, aucune colonne ni formulaire Analyse côté backend (DECISION-062).

## 3. Écrans actuels : conservé, déplacé, fusionné

| Écran actuel (`View`) | Sort | Où | Remarque |
|---|---|---|---|
| `cartography` Cartographie | Conservé | Risques | Aucun changement. Reste une vue de synthèse sans recalcul propre. |
| `risks` Registre | Conservé, renforcé | Risques > Registre | La fiche (ouverture d'une ligne) reçoit les onglets Identification · Analyse · Évaluation · Historique. Le formulaire « Identifier un risque » reste l'entrée de l'étape Identification. |
| `evaluation` Évaluations | Conservé, aussi atteignable par la fiche | Risques > Évaluations, et fiche > Évaluation | Même composant `EvaluationPage` (il prend déjà `initialRiskId`) : l'onglet Évaluation de la fiche l'ouvre pour ce risque. Un seul écran, deux entrées. |
| `frameworks` Dispositif de risque | Déplacé | Administration > Méthodologie | Aucun changement de contenu ni de circuit. Le droit de proposer s'étend à l'administrateur (DECISION-060), côté serveur. |
| `scales` Grilles de cotation | Déplacé, écritures réduites | Administration > Méthodologie | Voir « Ce qui disparaît » et Q1. |
| `appetite` Appétence | Déplacé, écritures retirées | Administration > Méthodologie | Voir « Ce qui disparaît ». La liste des seuils reste consultable. |
| `processes`, `departments`, `riskcategories` | Conservés | Administration > Référentiels | Déjà dans Administration. Le Processus (qui porte RO/Délégué) reçoit un raccourci depuis la fiche (§4). |
| `roles`, `feedback` | Conservés | Administration > Plateforme | `AdminPage.tsx` (onglets Rôles/Feedback) n'est pas branché dans `App.tsx` : code mort, à supprimer par Dev Frontend ou à ignorer. |
| `placeholder` « Paramètres & référentiels » | Conservé | Administration > Plateforme | Réglages plateforme à venir. |
| Autres (`controls`, `monitoring`, `anomalies`, `kri`, `kpi`, `actions`, `findings`, `auditlog`) | Inchangés | Idem | Hors sujet. |

Ajouts de câblage (pas de nouvel écran) : `NotificationCenter` a une cible `frameworks` à ajouter pour les demandes d'approbation de Dispositif (aujourd'hui `risks | actions | controls | evaluation | roles`) ; `ContextRail` suit la nouvelle liste de vues.

## 4. Raccourcis

Un raccourci est un lien « Voir / Configurer … » qui **navigue** vers l'écran d'Administration, déjà positionné sur l'objet concerné. Il n'exécute rien, ne contient aucun champ et n'appelle aucune API d'écriture. Toute écriture se fait ensuite sur l'écran d'Administration, avec son motif, son audit et son circuit d'approbation inchangés.

| # | Où | Libellé | Destination | Action d'Administration qui s'y exerce |
|---|---|---|---|---|
| S1 | Fiche > Évaluation, ligne de contexte « Dispositif v3 » | Voir le Dispositif | Administration > Dispositif, version active | Aucune écriture à l'arrivée. Sur place : `createDraft` (nouveau brouillon) → `updateDraft` → `requestActivation`, puis approbation par le circuit. |
| S2 | Fiche > Évaluation, comparaison à l'appétence | Voir le seuil d'appétence | Administration > Appétence, ligne de la sous-catégorie | Modifier un seuil = `updateDraft` sur le brouillon du Dispositif (même circuit que S1). |
| S3 | Fiche > Évaluation, grille utilisée | Voir la grille | Administration > Grilles de cotation, version utilisée | Voir Q1. |
| S4 | Cartographie, légende des seuils | Voir l'appétence | Administration > Appétence | Idem S2. |
| S5 | Fiche > Identification, Processus, Risk Owner, Délégué | Voir le Processus | Administration > Processus, ligne du Processus | Désignation RO/Délégué : action existante de l'écran Processus (proposée par la direction du département, approuvée par l'équipe risque). |
| S6 | Notification « demande d'approbation de Dispositif » | Voir la demande | Administration > Dispositif > Demandes en attente | `approve` / `reject` / `withdraw` (`FrameworksPage`). |

Règles communes :
- Le raccourci est visible pour tout utilisateur qui voit l'objet ; l'arrivée en lecture est toujours possible (Q3). Les boutons d'écriture de l'écran cible sont désactivés avec la raison si le droit manque.
- Après une action sur l'écran cible, un lien « Retour à la fiche » (retour navigateur) ramène au risque d'origine. Rien n'est recopié dans la fiche.
- Si un lot ultérieur voulait ouvrir la modale de l'Administration depuis la fiche, ce serait le même composant appelant la même API : non retenu en V1 (Q2).

## 5. Ce qui disparaît

1. **Les entrées « Appétence », « Grilles de cotation » et « Dispositif de risque » du groupe Risques** (elles passent dans Administration > Méthodologie).
2. **Toute écriture d'appétence hors Dispositif** : le formulaire « Enregistrer le seuil » (`PUT /appetite/:subCategory`) et « Retirer le seuil » (`POST /appetite/:id/archive`) de `AppetitePage`. Les seuils se modifient dans un brouillon de Dispositif (`appetiteThresholds`). L'écran Appétence garde la liste des seuils de la version active, en lecture, plus le raccourci vers le brouillon. Cohérent avec le SHARED_LOG du 2026-10-12 (B-6b : écrivains `ConfigService`/`RiskAppetiteService` déjà fermés quand le Dispositif est branché) : l'écran doit cesser de proposer une action que le serveur refuse.
3. **Les écritures de grille sur une grille rattachée à une version de Dispositif** : une telle grille est figée (trigger `rating_scales_framework_freeze`). L'écran n'affiche alors aucun bouton d'édition, seulement le motif « Grille utilisée par la version v3 du Dispositif ».
4. **Le doublon de lieu d'écriture** décrit dans l'item « Refonte » (« Appétence et Grilles encore éditables hors Dispositif ») : après cette refonte, un réglage a un seul écran et un seul appel.
5. Aucun second formulaire n'est créé dans les autres sections. Les raccourcis S1 à S6 sont des liens.

## 6. États à prévoir (essentiel)

- **Droit manquant sur l'écran cible** : bouton désactivé, texte de raison au focus, clic = `PermissionDeniedDialog`. Pas de masquage.
- **Étape sans contenu** (Analyse avant q121) : texte « Cette étape sera renseignée prochainement » + contexte Identification en lecture seule, sans bouton d'écriture.
- **Brouillon en cours** : sur S1/S2/S3, bandeau « Un brouillon v4 est en attente de <approbateur> » si une demande existe ; la version active continue de s'appliquer.
- **Accessibilité** (WCAG 2.1 AA) : onglets de fiche au clavier (flèches), onglet courant annoncé, ordre de focus = ordre de lecture, retour de focus sur le raccourci d'origine en revenant ; sous-titres de groupe Administration lisibles par lecteur d'écran.

## 7. Impacts

- **Security** : aucune règle ne passe côté UI. Les raccourcis ne contournent aucun contrôle ; l'extension du droit à l'administrateur (DECISION-060) reste à confirmer par A13 et à poser côté serveur par A06 avant que le bouton « Modifier » ne s'affiche pour lui.
- **Privacy** : aucune donnée personnelle ajoutée ; S5 montre RO/Délégué déjà visibles dans la fiche.
- **Compliance / Audit** : aucun texte réglementaire touché. L'historique du Dispositif reste dans son écran.
- **Dev Backend (A06)** : aucune nouvelle route pour la navigation. L'unicité du chemin d'écriture (appétence, grilles) est son lot.
- **Dev Frontend** : `App.tsx` (`NAV_GROUPS`, `View`, `PAGE_TITLES`), `ContextRail`, `NotificationCenter` (cible `frameworks`), `AppetitePage`/`RatingScalesPage` (retrait des formulaires), `RisksPage` (onglets de la fiche), `EvaluationPage` (réutilisé). Ordre proposé : (1) déplacer les entrées ; (2) retirer les écritures ; (3) onglets de fiche ; (4) raccourcis.
- **QA** : critères testables : (a) aucune écriture d'appétence ou de grille atteignable hors Dispositif ; (b) chaque raccourci arrive sur la bonne ligne ; (c) un utilisateur sans droit voit l'action désactivée et la fenêtre de refus ; (d) l'étape Évaluation n'offre aucun champ Identification/Analyse modifiable.

## 8. Points à trancher par le PO

**Q1. Grilles de cotation.** Une grille (axes, seuils, maîtrise) ne se crée et ne se modifie-t-elle que depuis un brouillon de Dispositif, donc sous son circuit d'approbation ? (oui / non)
Recommandation : **oui**. C'est la lecture de « pas d'écriture de Grilles hors Dispositif » ; le backend fige déjà la grille une fois rattachée. Sur l'écran Grilles, une grille non rattachée reste éditable tant qu'aucun Dispositif ne la référence. A06 confirme le détail technique.

**Q2. Raccourcis.** En V1, un raccourci se limite-t-il à ouvrir l'écran d'Administration (sans ouvrir de fenêtre d'édition depuis la fiche) ? (oui / non)
Recommandation : **oui**. Plus simple, aucun risque de second chemin, et le retour à la fiche est un simple retour.

**Q3. Lecture de la méthodologie.** Tous les rôles qui lisent les risques (équipe risque, Risk Owner, Comité, Audit) peuvent-ils consulter Administration > Méthodologie en lecture seule ? (oui / non)
Recommandation : **oui**. Ils en ont besoin pour comprendre une cotation (S1 à S4) ; les actions d'écriture restent désactivées avec raison pour ceux qui n'ont pas le droit. Le reste d'Administration garde ses droits actuels.

**Q4. Entrée « Évaluations ».** Garde-t-on l'entrée « Évaluations » dans la barre latérale, en plus de l'onglet Évaluation de la fiche ? (oui / non)
Recommandation : **oui** en V1 : c'est la file de travail actuelle, aucun développement. À réexaminer quand la file « À faire » (`RM-V1-Experience-Dispositif.md`) sera livrée.

Aucune de ces questions ne bloque le déplacement des entrées (§3) ni le retrait de l'appétence (§5.2) ; Q1 conditionne seulement l'écran Grilles.
