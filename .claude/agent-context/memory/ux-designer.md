# Mémoire — ux-designer (A04)

Créée le 2026-10-18 (n'existait pas avant). Historique antérieur : voir SHARED_LOG (tag @ux-designer) et `docs/ux/`.

## Principes tenus
- Le frontend reflète, le backend décide : masquer un bouton n'est pas un contrôle ; bouton désactivé + raison + `PermissionDeniedDialog`.
- Un réglage = un écran d'Administration = un appel. Ailleurs, raccourci de navigation seulement (DECISION-054).
- Ne jamais spécifier un champ dont la décision PO est ouverte (ex. Analyse, q121/OD-10) : réserver l'emplacement.
- Simplicité d'abord (skill `ponytail` indisponible : appliqué à la main) : réutiliser les composants existants (carte « Identification & Analyse » de `EvaluationPage`, `FrameworksPage`).

## Positions prises
- 2026-10-18, `docs/ux/RM-V1-Navigation-Risques.md` (DRAFT, DECISION-062) : Administration > Méthodologie (Dispositif, Grilles, Appétence) ; fiche risque en onglets Identification · Analyse · Évaluation · Historique ; Cartographie et « Évaluations » conservées ; 6 raccourcis (S1-S6) ; écritures d'appétence hors Dispositif supprimées. Remplace le §4 et la question 5 de `RM-V1-Experience-Dispositif.md`. Questions PO Q1-Q4 ouvertes.

- 2026-10-18, `docs/ux/RM-V1-Panel-Principes-Gouvernance.md` (DRAFT, DECISION-073) : Administration > séparateur « Gouvernance » > « Principes de gouvernance » (compteur en menu) ; synthèse (taille + pourquoi + décompte par gravité) puis liste puis détail (objets en cause, conséquence, 3 colonnes TPE/PME/GE). Surbrillance = marqueur textuel + icône + `aria-current` + bordure, jamais couleur seule ; colonne choisie par le serveur. Contenu A13 en « Exemple » tant que non validé. Onglet « Seuils d'appétence » ajouté au détail du Dispositif (Checklist · Paramètres · Échelles · Seuils · Versions). Questions PO Q1-Q3 ouvertes (visibilité, taille fausse/indéterminée, acquittement).

## Constats utiles
- `AdminPage.tsx` n'est pas branché dans `App.tsx` (code mort).
- Appétence et grille existent à deux endroits côté API (`/appetite`, `/rating-scales` et dans la version de Dispositif) ; B-6b a fermé les écrivains `ConfigService`/`RiskAppetiteService` quand le Dispositif est branché : l'écran Appétence propose encore des actions refusées.
- `NotificationCenter` : cibles limitées à `risks | actions | controls | evaluation | roles`.

- 2026-10-18, `docs/ux/plan-livraison-vues-front-v1.md` (DRAFT, DECISION-079 pt 5) : 33 vues manquantes (15 obligatoires, 8 souhaitables, 2 API seule, 8 à trancher) ; lots F0 à F8, F0-F4 sans attendre le serveur, F5 (panel) attend D5/D6. Constat : `apiRequest` ne renvoie que `payload.data` (le 202 `pendingRequest` est perdu) et le 409 `GOVERNANCE_CONFIRMATION_REQUIRED` n'a pas de champ `code`. Spec du panel à réviser (q138 acceptation décidée, alors que la spec la déconseillait). Questions PO Q1-Q6 ouvertes.
