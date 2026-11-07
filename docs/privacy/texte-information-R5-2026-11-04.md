# Texte d'information R5 — « Vos données de compte »

**Statut : projet, à valider par le DPO.** Rédaction transmise par la fonction Privacy (A15) le 2026-11-04, suite à
q227 A (DECISION-114). Source affichée dans l'outil : `frontend/src/features/privacy/privacyNotice.ts`
(`PRIVACY_NOTICE_R5`) — toute modification se fait dans les deux fichiers.

Variables remplies à l'affichage :
- `{duree}` : la durée de conservation configurée par le client (`configs.last_seen_retention_days`, R3), en années
  quand elle vaut un nombre entier d'années (1826 jours = 5 ans), sinon en jours ; « 5 ans » dans le texte d'origine.
- `{contactDpo}` : le contact du DPO du client ; aucun réglage ne le porte encore, l'écran affiche « à renseigner par
  l'administrateur » (aucun contact n'est inventé).

## Vos données de compte

Ce qui est enregistré : la date de votre dernière activité sur le compte (une seule date, mise à jour à chaque nouvelle connexion ou renouvellement de session), votre nom affiché, et vos rôles et droits.

Pourquoi : repérer les comptes à privilèges restés inactifs, gérer les habilitations et assurer le contrôle interne.

Qui peut voir quoi : votre nom affiché est visible des personnes qui désignent des responsables, composent des équipes de mission ou contrôlent les habilitations. Vos rôles et droits sont consultables par l'administration, l'Audit et le Risk Manager. La date de dernière activité n'est visible que par les personnes ayant le droit de consulter l'audit ; les autres ne voient que des totaux.

Durée : la date de dernière activité est conservée 5 ans après la fin de votre compte (durée paramétrable par votre organisation), puis effacée. Les copies de sauvegarde disparaissent au rythme normal de leur rotation.

Votre nom affiché et vos rôles sont conservés avec votre compte, y compris après sa suspension, car ils servent à la traçabilité du journal d'audit ; aucune durée n'est fixée à ce jour.

Base légale : intérêt légitime de sécurité et de gestion des habilitations.

Vos droits : vous pouvez exercer vos droits d'accès, de rectification et d'opposition prévus par la réglementation applicable. Contact du délégué à la protection des données : {contactDpo}.
