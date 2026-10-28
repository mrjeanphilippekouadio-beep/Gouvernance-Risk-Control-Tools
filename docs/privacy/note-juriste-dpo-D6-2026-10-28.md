# Note au juriste et au DPO de Djamo : trois avis attendus pour débloquer D6

Date : 28 octobre 2026. Auteur : fonction Privacy (A15). Statut : en attente d'avis. Aucun avis juridique n'est donné ici, et aucun article de loi n'est cité (non vérifié).

## Contexte

L'outil de gouvernance des risques enregistre, pour chaque compte, la date de sa dernière activité. Il affiche aux personnes habilitées l'annuaire des comptes (identifiant et nom affiché), ainsi que les rôles et droits de chaque compte. Les personnes concernées sont, par hypothèse, des salariés et des prestataires de Djamo (à confirmer).

## Les trois points attendus

### R3. Durée de conservation de la « dernière activité »

- **Aujourd'hui** : une seule date par compte, remplacée à chaque nouvelle activité, sans historique. Aucune durée n'est définie : la date reste tant que le compte existe, et après sa suppression logique. Les sauvegardes et la restauration à un instant donné gardent des valeurs plus anciennes.
- **Question** : combien de temps conserver cette date, à partir de quel événement, et que dit-on des copies de sauvegarde ?
- **Qui décide** : le Product Owner fixe la durée. Le juriste ou le DPO valide la règle, y compris la position sur les sauvegardes. Une purge éventuelle est ensuite réalisée par l'équipe base de données.
- **Proposition du Product Owner (28 octobre 2026)** : conserver la date **5 ans**, durée **paramétrable** par chaque client. À valider par le juriste ou le DPO : le point de départ (dernière activité, suspension ou fin du compte) et le traitement des sauvegardes au-delà de cette durée.

### R5. Texte d'information des personnes

- **Aujourd'hui** : aucun texte n'existe. Les personnes ne sont pas informées.
- **Question** : quelle rédaction valide-t-on, et par quel canal (page de profil ou accueil) ? Le texte doit couvrir : ce qui est enregistré, la finalité (repérer les comptes à privilèges inactifs), la durée (selon R3), les droits, le contact du DPO. Deux ajouts déjà demandés, dans le même texte : (i) le nom affiché est visible des personnes qui désignent des responsables, composent des équipes de mission ou contrôlent les habilitations ; (ii) les rôles et droits d'un compte sont consultables par l'administration, l'Audit et le Risk Manager. Les droits des personnes dépendent du cadre applicable (R6) et ne sont pas présumés.
- **Qui décide** : le Product Owner arrête le contenu et le canal. Le juriste ou le DPO valide la rédaction. Privacy relit en dernier.
- **Proposition par défaut** : pas de rédaction finale à ce jour. Privacy peut fournir un projet une fois R3 et R6 connus. Échéance fixée par l'avis : au plus tard avant D6.

### R6. Base légale et formalités auprès de l'ARTCI (loi ivoirienne n° 2013-450)

- **Aujourd'hui** : aucune formalité identifiée dans le projet.
- **Question (sans la trancher)** : le suivi de la dernière activité des comptes internes, et l'affichage de l'annuaire et des droits, relèvent-ils d'une déclaration, d'une autorisation, d'une formalité déjà couverte, ou d'aucune ? Quelle base légale retenir ? L'hypothèse de travail est l'intérêt légitime de sécurité et de gestion des habilitations, ou l'obligation de contrôle interne si Compliance le confirme. Le consentement n'est pas adapté dans une relation de travail. Le contrôle de l'activité de salariés demande information préalable et proportionnalité (à valider). La référence BCEAO sur le contrôle interne est à fournir par Compliance.
- **Applicabilité du RGPD** : non établie. Aucun établissement dans l'Union ni ciblage de personnes dans l'Union n'est constaté. À réexaminer si cela change.
- **Qui décide** : le juriste ou le DPO confirme la base légale et les formalités. Le Product Owner décide de déclarer ou non, une fois l'avis rendu.
- **Proposition par défaut** : aucune sur les formalités. Seule l'hypothèse de base légale ci-dessus, à confirmer.

## Déjà réglé

- **R1** (libellé « connexion » contre déclencheur « activité ») : tranché par le Product Owner (q175) ; l'outil affiche « dernière activité », ce qu'il enregistre vraiment. Le texte R5 emploie ce même terme.
- **R2** (dates par personne visibles) : sans le droit de lecture de l'audit, seuls des comptages sont affichés. Les dates par personne restent réservées.
- **R4** (identifiant de la personne dans le journal technique d'erreur) : correction de code, il est retiré.

(Revalidation par Privacy encore à faire pour ces trois lignes : preuves de tests attendues.)

## Ce dont nous avons besoin en retour

1. R3 : règle de durée validée, avec position sur les sauvegardes.
2. R5 : texte d'information validé.
3. R6 : avis écrit sur la base légale et les formalités ARTCI.

**Bloquant** : R3 avant la mise en production du panneau D6 ; R5 au plus tard avant D6 ; R6 avant D6. Date de D6 : à confirmer par le Product Owner. Passé ce délai, Privacy ne pourra pas revalider D6.
