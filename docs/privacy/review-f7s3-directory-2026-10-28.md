# Revue Privacy : F7-S3, ouverture de l'annuaire à `role.read` (DECISION-097, q187)

- Identifiant : PRIV-REV-F7S3-001
- Date : 2026-10-28
- Assesseur : @privacy (A24). Relecteur : Compliance (A15), à désigner.
- Branche : `feat/r1-f7-s3` (commit local 15eae48, non commité par A24).
- Avis précédent : `docs/privacy/review-suites2-q183-2026-10-27.md` (réserve 5 : tout nouvel appelant ou champ déclenche une revue). Réserves antérieures : D2a R1 à R8.
- Cadre : RGPD NOT_ESTABLISHED ; loi n° 2013-450 et ARTCI à confirmer par le juriste de Djamo (aucun article cité, non vérifié). Personnes concernées : collaborateurs et prestataires (hypothèse).

## Verdict

**OK AVEC RÉSERVES**, non bloquant.

## Faits vérifiés (CONFIRMED, lecture du code, aucune requête base)

- `DIRECTORY_PERMISSIONS` (UserService l. 47 à 55) gagne `role.read`. `directory` est inchangé : comptes actifs du tenant, `{ id, displayName }`, tri par nom, plafond 500, aucun `audit.record`.
- La donnée nouvelle n'est pas l'annuaire mais l'écran qu'il alimente : `RoleService.getEffectivePermissions` et `getEffectivePermissionSources` (l. 678 à 717), gardés par `role.read` (déjà le cas avant ce changement), renvoient pour un compte ses droits effectifs et leur origine (BASE, DIRECT, rôle nommé, groupe fixe). Ni e-mail ni donnée de connexion. Compte suspendu : liste vide et indicateur `suspended`.
- Ces deux lectures ne sont pas journalisées. Ce qui change : deux populations de lecteurs (Audit, Risk Manager) s'ajoutent aux administrateurs.

## Finalité et proportionnalité

- Finalité : revue des habilitations (qui détient quoi, par quelle voie), contrôle de type GOV-ACC. Légitime et directement liée à la fonction Audit ; pour le Risk Manager, elle sert l'appréciation du risque d'accès (DECISION-097). Je la juge proportionnée.
- Le nom affiché reste une donnée peu sensible (avis q183). Les droits d'un compte le sont davantage : ils révèlent la fonction (membre du groupe Audit, Risk Manager, administrateur, comité) et, par recoupement, la position d'une personne dans le dispositif de contrôle. C'est de la donnée d'habilitation, pas de la donnée de vie privée, et le lecteur est ici le contrôleur naturel. Le besoin de savoir est établi pour Audit ; pour le Risk Manager il tient à son rôle d'évaluation du risque et se limite à la lecture.
- Point d'attention de gouvernance (pas un blocage Privacy) : le Risk Manager voit ainsi les droits des membres du groupe Audit. Compliance et le PO confirment que cela ne contredit pas la séparation Audit / Risk Manager (F-B8b-05, q43). Décision à eux, pas à A24.

## Minimisation

- Conforme : identifiant et nom pour le sélecteur ; droits et origines pour l'écran, rien d'autre. Aucun champ ajouté à l'annuaire.
- Garder la réponse en lecture seule et limitée au compte choisi : pas d'export en masse « tous les comptes x tous les droits » sans nouvelle revue. Une matrice complète exportée devient un livrable nominatif distinct.
- Le plafond de 500 est plus gênant ici que pour l'équipe de mission : un auditeur des habilitations qui ne peut pas atteindre un compte conclura sur une population incomplète sans le savoir (défaut d'exactitude, déjà noté en réserve 1 de q183, qui reste ouverte). Les comptes suspendus sont absents de l'annuaire, donc injoignables pour un contrôle de leurs droits résiduels : à signaler au PO.

## Texte d'information R5

Oui, un ajout, regroupé avec la phrase déjà demandée (pas de texte séparé) : le nom affiché est visible des personnes qui désignent, composent des équipes ou contrôlent les habilitations, et **les rôles et droits d'un compte sont consultables par l'administration, l'Audit et le Risk Manager**. Le texte R5 reste en attente de décision PO et juriste ; A24 n'en fixe pas la rédaction finale.

## Journalisation de consultation

**Pas de journal de consultation par lecture**, ce qui prolonge l'avis précédent. Raisons : (i) les droits d'un compte ne sont pas une donnée confidentielle au sens du plancher du principe 8 (ni signalement, ni contenu de dossier) ; (ii) le droit `role.read` est déjà tenu par l'administration sans journal ; (iii) auditer chaque lecture d'un écran de contrôle créerait du bruit dans un journal append-only et des traces nominatives sans gain ; (iv) le journal HTTP (route, utilisateur) permet une enquête, sous réserve de R7 (IP, user-agent). Pour un écran d'audit des habilitations, la preuve utile est le résultat du contrôle (constat, mission), pas chaque consultation.
À rouvrir si : un champ s'ajoute (e-mail, service, connexion, `last_seen_at`), un export est créé, ou un lecteur hors Audit, Risk Manager et administration reçoit `role.read`.

## Réserves

1. **Troncature à 500** : indicateur `truncated` ou total à l'écran, et vérification de l'ordre limite puis filtre. Reprend la réserve 1 de q183, aggravée ici (contrôle incomplet). Qui : PO, dev-backend, A13/A05.
2. **R5** : ajouter la phrase ci-dessus. Qui : PO, juriste Djamo.
3. **Séparation Audit / Risk Manager** : confirmer la lecture croisée. Qui : Compliance (A15), PO.
4. **Liste fermée** : `role.read` ne doit pas être attribué à un rôle large par défaut ; tout nouvel appelant ou champ rouvre la revue. La migration 078 limite le droit au Risk Manager : vérifier qu'elle n'élargit rien d'autre.
5. **Test** : la réponse de l'annuaire ne contient que `id` et `displayName` ; l'écran n'expose ni e-mail ni connexion ; un compte sans `role.read` (et sans autre droit de la liste) reçoit 403 ; un compte d'un autre tenant donne 404. Qui : dev-backend, QA ; A24 vérifie.
6. **Suspendus** : décision PO sur le contrôle des droits résiduels d'un compte suspendu (hors annuaire actuel).

## Niveau de confiance

Faits sur le code : CONFIRMED. Migration 078 et frontend non relus : OPEN. Cadre juridique : OPEN.

## Limites

Revue documentaire et de code, pas de requête base ni test d'environnement, pas d'avis juridique. Je ne décide ni pour le PO ni pour le juriste.

## Revalidation demandée

Réserves 1, 4, 5 (code, migration, tests) ; 2, 3, 6 (PO, juriste, Compliance). Statut : **OPEN**.
