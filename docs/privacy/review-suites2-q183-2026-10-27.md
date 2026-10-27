# Revue Privacy : suites des arbitrages 2, q183 (annuaire) et q178 (vacance Risk Manager)

- Identifiant : PRIV-REV-SUITES2-001
- Date : 2026-10-27
- Assesseur : @privacy (A24). Relecteur : Compliance (A15), à désigner.
- Branche : `feat/r1-suites-arbitrages-2`. Décisions : DECISION-094 (q183), DECISION-095 (q178).
- Méthode et réserves antérieures : `docs/privacy/review-d2a-last-seen-2026-10-18.md` (R1 à R8). Lecture seule du code.
- Cadre : RGPD NOT_ESTABLISHED ; loi n° 2013-450 et ARTCI à confirmer par le juriste de Djamo (aucun article cité, non vérifié). Les personnes concernées sont, par hypothèse, des collaborateurs ou prestataires.

## Verdict

- Point 1 (q183) : **OK AVEC RÉSERVES**, non bloquant.
- Point 2 (q178) : **OK AVEC RÉSERVES**, non bloquant.

## Point 1. `GET /users/directory`, ouverture à `audit.mission.create`

### Faits vérifiés (CONFIRMED)

- `UserService.directory` (l. 192 à 201) : garde sur `DIRECTORY_PERMISSIONS` (4 droits), `users.list(actor.tenantId, { limit: 500 })`, filtre `deletedAt`, projection `{ id, displayName }`, tri par nom. Pas d'e-mail, pas de rôle. Tenant-scopé par `actor.tenantId`.
- Aucun appel à `audit.record` dans la méthode : pas de journal de consultation.
- La troncature à 500 est silencieuse (pas de drapeau, pas de total).
- Le filtre `deletedAt` s'applique après la limite : si des comptes supprimés figurent parmi les 500 lignes lues, la liste servie peut être plus courte que 500 actifs. Point technique à confirmer avec dev-backend (dépend du filtre de `list`).

### Analyse

- **Proportionnalité** : la finalité (composer l'équipe d'une mission) exige de pouvoir choisir un compte ; l'identifiant et le nom affiché suffisent. Le nouvel appelant (détenteur de `audit.mission.create`, fonction Audit) a un besoin comparable à ceux déjà admis pour `process.responsibility.assign` et `designation.manage`. La surface s'élargit d'une population de lecteurs, pas d'une catégorie de données. Proportionné.
- **Minimisation** : conforme (deux champs, comptes actifs). Le nom affiché d'un collègue est une donnée peu sensible. Point d'attention : le nom affiché est un texte libre fixé par le compte ou l'IdP ; si l'annuaire est repris tel quel dans un export ou un livrable de mission, ce n'est plus la même revue.
- **Finalité** : le droit `audit.mission.create` ouvre une liste de tous les comptes actifs, y compris des personnes sans lien avec l'audit. Acceptable parce que l'équipe d'audit peut être composée de n'importe quel compte ; à ne pas étendre à d'autres usages (nouvelle revue Privacy).
- **Information des personnes (lien R5)** : l'inscription de chacun dans un sélecteur interne est un usage normal d'un annuaire ; une information distincte n'est pas nécessaire pour cette seule finalité. En revanche, le texte R5 en attente (D2a) devrait mentionner, en une phrase, que le nom affiché est visible des personnes qui désignent ou composent des équipes (administrateur, Audit). À regrouper avec R5, pas de texte séparé.
- **Journalisation de consultation (CMP-F4-08)** : le plancher fixé en principe 8 vaut pour les données confidentielles. Un annuaire (id et nom) n'en est pas une ; auditer chaque lecture créerait du bruit dans un journal append-only et conserverait des traces de personnes sans gain. Recommandation : **pas de journal de consultation**. Compensation : le journal HTTP existant (route, utilisateur) suffit pour une enquête, sous réserve de R7 (IP et user-agent). La désignation ou la composition de l'équipe est déjà auditée au moment de l'écriture, ce qui est l'événement utile. À reconsidérer si l'annuaire gagne un champ (e-mail, service, rôle).
- **Troncature à 500** : c'est un risque d'exactitude, pas de confidentialité : une personne absente de la liste ne peut pas être désignée, sans que l'écran le dise (CMP-F4-08). Recommandation : renvoyer un indicateur `truncated` (ou un total) et l'afficher, ou prévoir une recherche par nom. Ne pas relever le plafond pour contourner : cela augmente l'exposition sans besoin démontré.

### Réserves

1. **Troncature silencieuse (qualité de donnée, fort impact fonctionnel)** : signaler la troncature à l'écran ; vérifier l'ordre « limite puis filtre actifs » (voir faits). Qui : PO (choix du signal), dev-backend, A13/A05 pour l'écran.
2. **Pas de journal de consultation : acceptable en l'état** (recommandation Privacy, non tranchée). Décision à consigner par le PO ; à rouvrir si un champ s'ajoute. Qui : PO.
3. **Information (R5)** : ajouter une phrase sur la visibilité du nom affiché au texte R5. Qui : PO, juriste Djamo.
4. **Test de non-régression** : la réponse ne contient que `id` et `displayName`, et un compte sans l'un des quatre droits reçoit 403. Qui : dev-backend ; A24 vérifie.
5. **Extension future** : tout nouvel appelant ou nouveau champ de l'annuaire déclenche une revue Privacy (liste fermée `DIRECTORY_PERMISSIONS`).

## Point 2. q178, vacance du dernier Risk Manager

### Faits vérifiés (CONFIRMED)

- `GET /governance-designations` (droit `designation.manage`) renvoie `riskManagerVacancy: { since, maxDays, overdue }` (`GovernanceDesignationService.riskManagerVacancy`). Pas de nom, pas d'identifiant d'utilisateur dans l'objet.
- `since` = `max(timestamp)` de la trace d'audit `riskManager.vacancy` tant qu'aucun membre actif ne tient le groupe (`PostgresGovernanceQueries.riskManagerVacancySince`).
- Notification `RISK_MANAGER_VACANCY` (`GovernanceNotifier` l. 124 à 131) : destinataires = membres des groupes AUDIT et RISK_COMMITTEE ; texte « Le groupe Risk Manager est vacant : son dernier membre est parti sans intérim… » ; aucun nom. Le lien porte `row.id` (identifiant de la ligne d'audit).
- La ligne d'audit sous-jacente (RoleService l. 559 à 571) est l'événement de retrait de rôle, qui porte l'identité de la personne retirée et de l'acteur.

### Analyse

- **Donnée personnelle au-delà du nécessaire** : non, dans les deux sorties. Elles décrivent l'état d'une fonction (vacante depuis le X), pas une personne. La date est une donnée de gouvernance. Elle est cependant indirectement identifiante : le groupe Risk Manager étant petit, la date de départ du dernier membre correspond à un départ connu (PROBABLE). Les destinataires (administrateur, Audit, Comité) connaissent déjà la composition du groupe ; le risque marginal est faible.
- **Nécessité** : la date sert à calculer le dépassement (`overdue`, 60 jours par défaut) et à responsabiliser la désignation d'un intérim ; elle est utile et proportionnée. Aucun motif du retrait n'est exposé, ce qui est correct.
- **Point d'attention** : le lien de la notification pointe vers la ligne d'audit. Les membres du Comité n'ont pas forcément `audit.read`. Vérifier que l'ouverture du lien n'expose pas, ni ne contourne, la lecture de l'identité de la personne retirée pour un destinataire sans ce droit (les membres AUDIT l'ont déjà par leur rôle). Si le lien conduit à l'écran de désignation, rien à faire.
- **Libellé** : « son dernier membre est parti » est exact sans nommer personne ; ne pas enrichir le message (nom, motif, ancienneté).

### Réserves

6. **Lien de notification** : confirmer qu'un destinataire sans `audit.read` ne voit pas l'identité de la personne retirée via `entityId`. Qui : dev-backend ; Security (A10) en cas de doute. Test à ajouter.
7. **Message et payload figés** : aucun nom, motif ni date de départ individuelle dans la notification, y compris en pièce jointe, e-mail ou futur canal externe (revue Privacy si un canal est ajouté). Qui : dev-backend ; A24 revalide.
8. **Durée de conservation** (même arbitrage que R3 de D2a) : la notification et la ligne d'audit relèvent de la règle générale de conservation de l'audit, à confirmer par le PO et le juriste. Pas de durée imposée par A24.

## Niveau de confiance

- Faits sur le code : CONFIRMED (lecture, 2026-10-27). Je n'ai pas exécuté les requêtes ni vérifié la cible du lien de notification côté frontend (réserve 6).
- Identifiabilité par la date : PROBABLE. Cadre juridique : OPEN.

## Limites

Revue documentaire et de code. Pas de test en environnement. Pas d'avis juridique. Je ne décide ni pour le PO ni pour le juriste.

## Revalidation demandée

Réserves 1, 4, 6 et 7 (code et tests) ; 2, 3, 8 (décisions PO et juriste). Statut : **OPEN**.
