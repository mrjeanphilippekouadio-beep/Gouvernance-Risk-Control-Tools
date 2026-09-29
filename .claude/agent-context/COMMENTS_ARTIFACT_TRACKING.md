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

**Tous les fils de commentaires sont actuellement résolus (24/24, vérifié le 2026-09-29).** Écran **« Évaluation des risques » déclaré STATUÉ** (zéro commentaire ouvert, mode Classique/Participatif tranché DECISION-006). Prochain écran : Cartographie des risques. 2 chantiers issus de commentaires restent ouverts en dehors du mécanisme de fils (suivis dans `ACTION_ITEMS.md`, pas des threads à répondre) :
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
