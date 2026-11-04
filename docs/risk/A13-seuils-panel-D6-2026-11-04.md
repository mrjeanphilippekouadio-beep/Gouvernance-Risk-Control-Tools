# A13 : valeurs de départ des seuils du panel « santé de la gouvernance » (lot D6)

- Auteur : A13 (Risk Manager), 2026-11-04
- Origine : DECISION-115 (q229 option A). Valeurs de DÉPART réglables par client.
- Statut : **PROPOSITION, à valider par le PO.** Aucun code modifié.
- Sources lues : `docs/governance/principes/principes-gouvernance.json` (GOV-RISK-01 l.214, GOV-OWN-01 l.414, GOV-ACC-01 l.496, D13 l.730), `docs/architecture/RM-V1-Panel-Principes-Gouvernance.md` (R-1 ligne 4 `last_seen_at`, R-6.2 `trackedSince`, R-7).
- Réserve de sourcing : les références de place (IIA, ISO 31000, ISO 27001) sont marquées « à vérifier » dans le catalogue et je n'ai pas les textes. Je n'en cite aucune ici. Toutes les justifications sont de la « pratique courante » ou un choix de prudence. Aucune exigence réglementaire BCEAO n'est invoquée. Ces valeurs sont des paramètres du client, pas des normes.

## Fait, hypothèse, avis

- Fait : la spec D6 ne contient pas ces seuils. Le catalogue dit « seuil à valider PO » pour la largeur de rôle (ACC-01 b), propose 90 jours pour le dormant (D13), et ne donne aucune valeur pour la part RISK-01 ni pour OWN-01 (d).
- Fait : `permissions.ts` compte au moins 127 chaînes de permission (comptage approximatif par motif, à confirmer par A06).
- Hypothèse : un client de 50 à 300 personnes a entre 3 et 15 comptes avec rôle côté risque et 20 à 150 risques au registre.
- Avis : les valeurs ci-dessous.

## Tableau

| Seuil | Valeur de départ | Plage réglable | Justification | Trop bas | Trop haut |
|---|---|---|---|---|---|
| RISK-01 : part max des risques dont un Risk Manager est propriétaire direct | **20 %** (évalué seulement si au moins 10 risques au registre) | 10 % à 40 % | Pratique courante : la 2e ligne challenge, la 1re ligne porte. Un RM propriétaire de quelques risques propres (conformité, risque de la fonction elle-même) est normal ; un cinquième est le point où le challenge devient auto-évaluation. Le plancher de 10 risques évite qu'un registre naissant déclenche à 1 risque sur 3. | Alerte permanente dans une PME où le RM porte légitimement les risques de la fonction risque ; fatigue d'alerte, panel ignoré. | Séparation 1re/2e ligne non détectée : le RM cote et challenge ses propres risques. |
| ACC-01 (a) : nombre max d'administrateurs actifs | **3** | 2 à 5 | Pratique courante : au moins 2 pour la continuité (un seul est un point de défaillance, traité par GOV-RISK-02, pas ici), 3 pour absorber une absence. Pour 50 à 300 personnes, plus de 3 à 5 sans raison est rare. Le catalogue mesure aussi la part des actifs avec rôle ; je propose de ne signaler que le nombre absolu, plus simple à lire. | À 1 : fausse alerte sur le minimum de continuité et pression à n'avoir qu'un seul administrateur. | Un compte compromis ouvre trop de droits ; les administrateurs « de confort » s'accumulent. |
| ACC-01 (b) : largeur de rôle jugée excessive | **Rôle personnalisé (systemGroup null) qui porte plus de 25 permissions, OU qui couvre 4 familles de permissions ou plus.** Famille = premier segment avant le point (`risk`, `control`, `config`, ...). Se cumule avec la règle déjà au catalogue : rôle qui mêle écriture métier et droit d'administration (alerte quel que soit le décompte). Les rôles des groupes fixes sont exclus. | 15 à 40 permissions ; 3 à 6 familles | Pratique courante (revue de rôles « trop larges ») : un nombre brut seul pénalise un rôle légitime riche ; un nombre de familles seul rate un rôle large dans une seule famille. Les deux sont simples et mesurables à partir de `roles.permissions`. 25 représente environ un cinquième du catalogue de permissions. | Les rôles métier normaux d'un Risk Owner ou d'un Contrôleur sont signalés à tort. | Un rôle « fourre-tout » passe inaperçu, d'où dérive de privilèges. |
| ACC-01 (c) : jours sans activité avant « dormant » pour un compte à privilèges | **90 jours** (aligné sur D13 du catalogue) | 45 à 180 jours | Pratique courante : un trimestre. Mesure sur `users.last_seen_at` (granularité 1 h). Règles de lecture : `NULL` n'est « dormant » qu'après 90 jours depuis `trackedSince`, jamais avant (sinon tous les comptes sont dormants le jour de la mise en service). Le panel signale, il ne suspend jamais automatiquement (principe 55). | Les membres d'Audit et du Comité, qui se connectent par cycle trimestriel, sont signalés à tort ; congés longs. | Un compte d'un salarié parti reste actif plusieurs mois sans être vu. |
| OWN-01 (d) : part max des risques dont le créateur est aussi le propriétaire | **50 %** (évalué seulement si au moins 10 risques ; hors désignations confirmées par un tiers, qui relèvent de (c)) | 25 % à 80 % | Seuil manquant de la partie (d). Choix de prudence, pas une norme : être propriétaire de son risque est souhaitable (position A13 OD-9) ; le signal est la majorité de risques créés, nommés et portés par la même personne sans autre regard. Indicatif seulement en TPE (le gérant crée et porte tout). | Une organisation où les propriétaires saisissent eux-mêmes leurs risques (bonne pratique) est signalée à tort. | Une personne seule alimente et possède le registre sans que personne ne le voie. |

## Règles communes proposées

1. Chaque seuil est un paramètre du client, avec valeur de départ et plage bornée par l'éditeur ; tout changement est tracé (auteur, ancienne et nouvelle valeur, motif), selon le principe PO « tout modulable, défaut strict ».
2. Un seuil changé ne peut pas effacer un dépassement en silence : le panel affiche l'ancienne et la nouvelle valeur pendant un cycle (même esprit que GOV-APP-01 ; invariant : appétence non masquable). Abaisser un seuil de façon à faire disparaître une alerte est le cas à tracer.
3. Un échantillon trop petit donne « non évaluable : échantillon insuffisant », jamais « respecté » (principe 53).
4. Les seuils proposés ne dépendent pas de la taille de l'organisation en V1 ; la surbrillance TPE / PME / GE reste portée par les indications du catalogue.

## Questions pour le PO (facultatives)

- Q-A13-D6-1 : valider les cinq valeurs de départ et leurs plages, ou ajuster.
- Q-A13-D6-2 : confirmer que la largeur de rôle ne s'applique qu'aux rôles personnalisés (les groupes fixes en sont exclus).
- Q-A13-D6-3 : confirmer le plancher « au moins 10 risques » pour RISK-01 et OWN-01 (d).
