# Administration et reprise du registre des risques — cadrage

**Date** : 2026-10-08. **Sources** : UX Designer (A04) et Architecte (A05),
consultations en lecture seule. **Statut** : proposition, en arbitrage PO
dans la page de pilotage (q13 à q16).

## 1. Où se règle chaque objet (UX Designer)

**Principe** : une source de vérité par objet, un seul lieu d'édition. Les
sections ne portent que des raccourcis (« Configurer »), jamais un second
formulaire.

- **Réglages de plateforme → Administration** : valent pour toute
  l'organisation, changent rarement.
- **Réglages du Dispositif → espace Dispositif** : versionnés, approuvés,
  effet au cycle suivant (DECISION-015, DECISION-017 n° 5).
  L'Administration les affiche en lecture et renvoie vers le Dispositif.

| Objet | Où se règle | Raccourci depuis | Fréquence |
|---|---|---|---|
| Groupes, départements, membres | Administration | Fenêtre de refus, groupe approbateur vide | Par cycle |
| Rôles et droits | Administration | Fenêtre de refus | Rare |
| Dispositifs par défaut (modèles) | Administration | Assistant de création | Rare |
| Mode, cumuls, délégation, auto-proposition | Dispositif | Évaluations, Registre | Par cycle |
| Échelles, axes, descriptifs | Dispositif | Grilles de cotation, Évaluations | Par cycle |
| Appétence et seuils | Dispositif | Appétence, Évaluations | Par cycle |
| Approbateur (Audit ou Comité) | Dispositif | Checklist | Rare |
| Règle de clôture et échéance du Comité | Dispositif | « À faire » du Comité | Rare |
| E-mail (fournisseur, expéditeur, nom affiché) | Administration | Cloche des notifications | Rare |
| Stockage (dossiers Drive actif / supprimé) | Administration | Import d'évidences | Rare |
| Masquage / Ignorer (valeur par défaut) | Administration ; choix par colonne à l'import | Import | Rare / par import |
| Clé de rapprochement (défaut) | Administration ; surcharge par Dispositif ou contrôle | Contrôles, import | Rare |
| Champs d'évidences, schémas | Administration | Évidences | Par cycle |
| Processus et rôles RO / DEL / EXEC | Section Dispositif | « À faire » | Quotidienne |
| Feedback / Userback | Administration | En-tête | Rare |

**Arborescence de l'Administration** : (1) Accès et organisation — groupes
et départements, rôles et droits, approbations ; (2) Plateforme — e-mail,
stockage, données personnelles et masquage, rapprochement, champs
d'évidences, Dispositifs par défaut ; (3) Journal — changements de
configuration (lu depuis l'audit), feedback. Recherche de réglage, badge
de portée Plateforme / Dispositif, état « Configuré / À compléter /
Défaut actif », réglages avancés repliés, mode assistant ou expert.
Aucun nouvel atome : un seul gabarit « page de réglage ».

Constat : `AdminPage.tsx` n'a aujourd'hui que deux onglets (Rôles,
Feedback) ; « Paramètres & référentiels » et « Dispositif de risque » sont
des emplacements vides.

## 2. Reprise du registre des risques (Architecte) — lot RRI

**Existant** : `RiskImportService` lit un .xlsx (première feuille, en-tête
ligne 1), deux colonnes (`process`, `description`), crée des risques
`DRAFT` sans transaction, ne conserve pas le fichier, n'empêche pas un
double import ; plafond de lignes vérifié après chargement (bombe de
décompression, correctif R0.3) ; permission `config.manage`.

**Proposition** : un seul moteur partagé avec l'import d'évidences (lecteur
sécurisé, analyse, récapitulatif modifiable, correspondance des colonnes,
fichier conservé avec SHA-256, table d'import commune avec un `kind`
EVIDENCE / RISK_REGISTER — à décider avant la migration EVD-4). Pour un
registre : champs cibles fixes (Processus, Département, description,
probabilité, impact par axe, contrôle), étape de rapprochement des noms
avec les Processus / Départements existants, création par les services
existants (permissions et audit conservés), conversion des valeurs
d'échelle dans le récapitulatif.

**Règles** : objets importés en brouillon, activés par le groupe Risk
Manager ; cotations conservées comme historique « reprise », jamais
officielles (sinon contournement du maker-checker) ; doublons signalés et
ignorés par défaut, même fichier refusé ; une colonne « Owner » n'est
qu'une proposition passant par le circuit B-5 ; un événement d'audit par
import ; annulation d'un import encore en brouillon par archivage, avec
permission dédiée et motif ; nouvelle permission `risk.import`.

**Google Sheets** : MVP = le client télécharge sa feuille en .xlsx (zéro
code, zéro coût) ; lien direct vers une feuille partagée en V1.1 (lot S),
après la preuve de l'authentification Drive en production (R0.4).

**Lot RRI** : RRI-1 backend (M), RRI-2 écran repris d'EVD-5 (S) ; dépend de
R0.3, B-8, B-9, B-6, EVD-2 (et B-5 pour les propositions d'Owner) ; place
en R3. Passages QA, Security, Compliance, Privacy.
