# Dispositif de suivi — commentaires PO sur l'artefact de revue visuelle

Artefact : https://claude.ai/artifact/9kExAKw22AmH71rh59bdq4 (grc-review.html)

But : ne plus jamais perdre un commentaire du PO au fil des itérations. Cette
table est mise à jour à chaque nouveau commentaire lu (`Artifact
action:"comments"`) et à chaque action prise (reply/resolve). Ne pas
supprimer une ligne — un fil "resolved" reste dans la table avec son
statut, comme les lignes de `ACTION_ITEMS.md`.

Convention : `thread_id` tronqué à 8 caractères (suffisant pour retrouver le
fil complet via l'artefact). Colonne **Statut artefact** = état réel côté
outil (open/resolved). Colonne **Suivi** = où le sujet est éventuellement
répercuté ailleurs (ACTION_ITEMS.md, SHARED_LOG.md, code réel).

## Fils ouverts (action requise ou décision PO en attente)

| Thread | Écran | Sujet | Statut artefact | Suivi |
|---|---|---|---|---|
| `d6f42b77` | Évaluation des risques | Cotation qualitative sans chiffre — tranché (garder chiffres bandeau/seuil) | **resolved (2026-09-29)** | — |
| `94482ab3` | Registre des risques (Risques) | Formulaire recentré sur l'identification (Processus/Description/Département, champs réels de `CreateRiskInput`) ; actions Évaluer/Modifier/RACI/Archiver ajoutées ; "Supprimer" remplacé par "Archiver" (pas de hard-delete côté backend). | **resolved (2026-09-29, v20)** | Détail agent Risk Manager ci-dessous dans ce fichier |
| `5e29fd18` | Panneau générique (Évaluation + Design System) | Nouveau 4e onglet "Occurrence" (historique incident/anomalie/constat sectoriel), distinct d'Evidence. Libellé confirmé par le PO. | **resolved (2026-09-29, v22)** | — |
| `927e753a` | idem (doublon de 5e29fd18) | Même demande, fil dupliqué | **resolved (2026-09-29, v21)** — renvoyé vers 5e29fd18 | — |
| `6ee89a11` | Évaluation des risques | Brut/inhérent selon mode Classique/Participatif — **DECISION-006 tranchée par le PO** : mode réglé au niveau Processus (badge sur futur écran Processus, backlog, pas construit maintenant), gouvernance = Risk Manager direct ou propriétaire-processus+validation propriétaire-risque. Arbitrage `risk_processes` rouvert (prémisse fausse corrigée). **Volet encore ouvert, pas couvert par ce fil** : le PO veut aussi qu'on reprenne le backend d'évaluation entier via le principe "objet imbricable" (composition/héritage, DECISION-003/CHALLENGE-002) et qu'on détecte systématiquement les divergences avec le backend existant — action séparée, pas encore lancée. | **resolved (2026-09-29)** | `ACTION_ITEMS.md` DECISION-006, DECISION-003/CHALLENGE-002 |

**Cartographie des risques — 4 nouveaux fils reçus le 2026-09-29 (démarrage de l'écran) :**
| Thread | Sujet | Statut |
|---|---|---|
| `f22ccabd` | Séparer Inhérent/Résiduel en 2 cartes distinctes | resolved (v24) |
| `bc9cba92` | Couleur des points = criticité (pas statut) + filtre | resolved (v25) |
| `5e3eedcf` | 3e info "décision de traitement" + liste défilable | resolved (v25) |
| `85d640e2` | Bandeau réutilisé pour les états — ambigu, clarification demandée | **open — attente précision PO** |
| `faa01c24` | Déplacer un élément pour faire place au panneau Commentaires — ambigu, clarification demandée | **open — attente précision PO** |
| `ac1bf7c2` | Cartes animées via Chart.js + déplaçables via GridStack | resolved (v26) — vraies libs chargées (Chart.js 4.4.7, GridStack 14.0.0, CDN cdnjs, CSS GridStack inlinée) |
| `f2fdacb0` | Détails du risque au survol | resolved (v26) — tooltip Chart.js riche (processus/département/statut/traitement/zone) |
| `787b4e53` | Points mal centrés dans les cellules | resolved (v26) — résolu de fait par les vraies coordonnées Chart.js |
| `91b9756d` | 4 graphiques : ajouter répartition par processus + par département, proposer plusieurs variantes A/B/C | **open — 3 variantes livrées (v26), attente validation PO sur laquelle garder** |
| `6131a28a` | Fond des cases à cocher en blanc (Admin·Rôles) | resolved (v26) |
| `85d640e2` | Bandeau "Dépend d'Évaluation" doit refléter les états des évaluations | resolved (v27) — résumé badges ajouté (3 Validé/1 En attente/1 Brouillon/1 Rejetée) |
| `33664e00` | Description du risque manquante dans la liste | resolved (v27) |
| `a3e10b3d` | Colonnes de tags non alignées (largeur du mot le plus long) | resolved (v27) — liste passée en vraie grille CSS |
| `bc9cba92` (rouvert) | Teintes des points de criticité trop pâles, difficiles à distinguer | resolved (v27) — palette saturée dédiée aux points, distincte du fond pâle de la heatmap |
| `927e753a` (rouvert) | Panneau Comments/RACI/Evidence/Occurrence : déplacer de bas de page vers la colonne droite (au-dessus Historique/Actions), redimensionner | resolved (v27) — écran Évaluation |
| `faa01c24` | Panneau Commentaires sur Cartographie — ambigu, clarification demandée | **open — attente précision PO** |
| `d0942768` | Teintes de la heatmap trop claires, rendre plus vives | resolved (v28) — palette de fond saturée |
| — | **Limite d'outil notée (2026-09-29)** : pas d'action pour relire une ancienne version publiée d'un artefact — impossible de "retrouver" un état antérieur exact. Seul recours : la mémoire de session + ce qui reste inchangé dans le CSS/HTML actuel. | note |
| `68461ff8`, `1862344a`, `f22ccabd` (rouvert), `787b4e53` (rouvert) | **BUG RÉEL "je ne vois rien" (PO), persistant même après correctif d'URL v29.** Décision (2026-09-29) : abandon complet de Chart.js/GridStack — v32 (SVG brut, rendu garanti). **Correction PO (2026-09-29)** : le style des heatmaps 1/2 n'aurait pas dû changer — il fallait juste les dupliquer (Inhérent/Résiduel), le SVG était une sur-correction. v33 restaure le style CSS grille original (`.heatmap`/`.heatmap-cell`, déjà validé plus tôt dans la session) avec les vrais correctifs déjà demandés dessus (centrage, teintes saturées, couleur des points = criticité). Graphiques 3/4 (barres) inchangés, libre choix confirmé par le PO. | **open — attente confirmation PO que ça s'affiche enfin** |
| `6f893859` | Badges "Réduire Validé" sans titre, illisibles | resolved (v30) — en-têtes de colonnes ajoutés |
| `33c084d8` | Ordre des colonnes : Statut avant Traitement | resolved (v31) |
| `91b9756d` | Choix direct (pas de variantes) pour les graphiques 3/4 | resolved (v32) — barres horizontales pour les deux, même échelle |
| `6f893859` (v30), `33c084d8` (v31) | Voir plus haut | resolved |
| — (v33-36) | Style heatmap 1/2 restauré (grille CSS, points bleus/bordure blanche), légende par carte centrée, scrollbar bleue | resolved |
| `ced89476` | Treemap possible ? | resolved (v37) — graphique 5 ajouté, treemap CSS pur par processus, taille = poids de criticité cumulé |
| `4e0daba1` | Graphiques 3/4 repensés en heatmap (grille), tous processus/départements, teinte→rouge selon concentration | resolved (v38) |
| `23e7baee` | **Vraie nomenclature Djamo reçue (9 processus, 15 directions)** — remplace les listes illustratives ; case-par-criticité (span CSS) au lieu de teinte seule | **open (v39) — attente validation PO comme référence définitive, pas encore propagée au registre/évaluation** |
| `95f13578` | "Retire ce bloc" — ambigu, proposé et retiré graphique 5 (treemap, redondant avec 3/4) | **open (v40) — attente confirmation que c'était le bon bloc** |
| `7fe0e5a8` | Graphiques 3/4 : couleurs vert→rouge (mêmes teintes que heatmap 1/2) + visualiser la "surface" quand plusieurs risques/nombres différents | resolved (v41) — palette `#a6e0ba→#e0483a` reprise, cases passées de `grid-column:span N` à taille explicite largeur+hauteur (44px/86px), côté ∝ √(nb risques) donc surface réellement proportionnelle |
| `fbc778f5` | Décalage horizontal (regression v41) sur graphiques 3/4 — cases pas alignées | resolved (v42) — repassé de flex-wrap à grille CSS à colonnes fixes (4/5), taille variable déplacée dans un `.swatch` interne centré, alignement propre conservé avec surface toujours ∝ risques |
| `69a001f2` | Heatmap façon ECharts treemap-show-parent (zoom/drill-down + breadcrumb) | resolved — PO : "plus d'actualité", abandonné, clarification retirée |
| `7c5f4a8e` | Graphique 3 : matrice 3×3 taille uniforme (nom le plus long), nombre+couleur | resolved (v43) — annule/remplace la logique "surface ∝ risques" du fil `7fe0e5a8`, retour à une grille uniforme |
| `f0009f21` | Graphique 4 : matrice 3×5 taille uniforme (nom le plus long), nombre+couleur | resolved (v43) — idem, grille uniforme |
| `1c22291e` | Déséquilibre visuel 3×3 vs 3×5 (graphique 3 plus court que 4) — composant ajustable demandé | resolved (v44) — légende vert→rouge ajoutée sous le graphique 3, comble l'écart et reste valable si le nombre de processus augmente |

Écran **« Évaluation des risques » STATUÉ** (24/24 résolus, DECISION-006). Cartographie en cours de revue. 2 chantiers issus de commentaires restent ouverts en dehors du mécanisme de fils (suivis dans `ACTION_ITEMS.md`, pas des threads à répondre) :
- Arbitrage `risk_processes` à refaire (@dev-db + @architect, prémisse fausse corrigée) — DECISION-006/ligne @architect.
- Audit systématique des divergences backend vs principe "objet imbricable" (composition/héritage), demandé par le PO le 2026-09-29 — pas encore lancé.

## Fils résolus (pour mémoire — ne pas rouvrir sauf nouveau commentaire du PO)

| Thread | Écran | Sujet | Statut |
|---|---|---|---|
| `4d6fa7f9` | Admin·Rôles | Barre de recherche pour filtrer les permissions | resolved |
| `db10c9ea` | Sidebar (global) | Nav latérale rétractable | resolved |
| `1ad23d23` | Évaluation des risques | Pictogrammes devant titres de sections/sous-sections | resolved |
| `4df60e19` | Admin·Rôles | Boutons "Révoquer" → fond violet, texte blanc (`.btn-caution`) | resolved |
| `f3aa10eb` | Admin·Rôles | Clarification couleur violette (doublon de 4df60e19) | resolved |
| `44f2e542` | Admin·Rôles | Permissions affichées en badges | resolved |
| `29ceb9c9` | Admin·Rôles | Bouton destructif en rouge plein (même traitement que le bleu) | resolved |
| `e4da2e8e` | Admin·Rôles | Clarification violet (doublon de 4df60e19/f3aa10eb) | resolved |
| `757cd0d5` | RACI | Alignement horizontal user id / Assigner / Révoquer / Désactiver | resolved |
| `c87757f5` | RACI | Positionnement (clarifié par 757cd0d5) | resolved |
| `e1278579` | RACI | Alignement 2 champs de saisie + bouton | resolved |
| `431b6c9e` | RACI | Alignement 2 champs de sélection + bouton | resolved |
| `d541dc2b` | Design System | États bouton bleu/rouge/désactivé | resolved |
| `cc50a762` | RACI | Tirets pour cellules vides de la matrice | resolved |
| `f1dcc5fa` | Design System | Alignement grille des 4 boutons | resolved |
| `932dd27f` | RACI | Alignement (regroupé avec fils voisins) | resolved |
| `aa8a5463` | RACI | Rail d'onglets — bug réel (libellé "Commentaires" cassait sur 2 lignes) | resolved |
| `d5ff2b36` | RACI | Passage en matrice RACI (R/A/C/I) | resolved |
| `70c76e0f` | — | Confirmation PO sans action | resolved |

**Total : 22 fils — 19 résolus, 3 ouverts.**

## Procédure (rappel, ne pas dévier)

1. À chaque notification de commentaire : lire le fil complet (`action:
   "comments"`, `thread_id`), l'ajouter/mettre à jour dans ce tableau
   AVANT toute autre action.
2. Traiter le fond (pas de devinette — si ambigu, demander comme documenté
   dans les fils `d541dc2b`/`757cd0d5`/`f3aa10eb`).
3. Republier l'artefact, répondre sur le fil, `resolve` si traité, mettre
   à jour cette table.
4. Si le sujet dépasse l'UI (question métier/archi/sécurité), loguer aussi
   dans `ACTION_ITEMS.md`/`SHARED_LOG.md` — colonne Suivi ci-dessus pointe
   vers ces entrées.
