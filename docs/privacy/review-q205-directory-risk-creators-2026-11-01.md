# Revue Privacy : q205, annuaire ouvert à `risk.create` et `risk.update` (DECISION-105)

- Identifiant : PRIV-REV-Q205-001
- Date : 2026-11-01
- Assesseur : @privacy (A24). Relecteur : Compliance (A15), à désigner.
- Branche : `chore/suivi-r1-f7s3`. Décision PO : DECISION-105 (q205 A), sous réserve de cet avis.
- Avis précédents : `review-suites2-q183-2026-10-27.md` (réserve 5), `review-f7s3-directory-2026-10-28.md`.
- Cadre : RGPD NOT_ESTABLISHED ; loi n° 2013-450 et ARTCI à confirmer par le juriste de Djamo (aucun article cité, non vérifié). Personnes concernées : collaborateurs et prestataires (hypothèse).

## Verdict

**OK AVEC RÉSERVES**, non bloquant. La réserve principale (recherche plutôt que liste complète) est une recommandation forte, pas une condition de mise en production du contrat actuel.

## Faits vérifiés (CONFIRMED, lecture du code, aucune requête base)

- `UserService.directory` (l. 195 à 204) : garde sur `DIRECTORY_PERMISSIONS` (cinq droits), `users.list(actor.tenantId, { limit: 500 })`, filtre `deletedAt`, projection `{ id, displayName }`, tri. Pas d'e-mail, pas de rôle, aucun `audit.record`. Troncature silencieuse et ordre « limite puis filtre » inchangés (réserve 1 de q183, encore ouverte).
- La nouveauté est la population : `risk.create` et `risk.update` sont des droits de première ligne (propriétaires de risques, contributeurs), très nombreux comparés à l'administration, l'Audit et le Risk Manager. Les données ne changent pas.
- Non relu : spec de visibilité DECISION-100/102 et frontend (OPEN).

## Finalité et proportionnalité

- Finalité : désigner des « personnes nommées » qui verront un risque restreint. Légitime : on ne peut pas choisir un compte sans le voir. Le besoin de savoir existe pour qui restreint un risque.
- Proportionnalité : le contenu (id + nom affiché) est peu sensible, mais la liste complète des comptes actifs devient lisible par toute la première ligne, ce qui est un changement d'échelle. Le besoin réel est de trouver quelques personnes précises, pas de parcourir l'effectif. La liste complète est donc plus large que nécessaire pour ce lecteur, sans être disproportionnée en soi pour un annuaire interne de collaborateurs.
- Point propre à cette finalité : le choix de personnes nommées est lui-même une donnée de gouvernance (qui est dans le cercle d'un risque restreint). Le sélecteur ne doit pas révéler ce cercle ; il ne fait que lister des comptes. À vérifier avec l'Architecte : la liste servie ne dépend pas du risque ouvert et n'indique pas qui est déjà nommé ailleurs.
- Lien q201 (DECISION-104) : un Risk Manager restreint ne voit pas les droits de l'administration et de l'Audit, mais les noms restent dans l'annuaire (option B retenue). Ouvrir l'annuaire à la première ligne étend cette visibilité des noms ; cohérent avec B, aucun droit ni rôle n'est révélé.

## Minimisation et alternative moins intrusive

Recommandation (non obligatoire pour ce verdict) : pour les nouveaux appelants (`risk.create`, `risk.update` sans autre droit de la liste), servir une **recherche par nom** et non la liste :

- paramètre `q` d'au moins 2 ou 3 caractères, résultats plafonnés (20 à 25), tri par nom, mêmes champs `{ id, displayName }` ;
- le filtre est appliqué en base avant la limite, ce qui règle aussi l'ordre limite-puis-filtre et la troncature à 500 pour ce parcours ;
- les droits existants (`user.read`, désignations, mission, `role.read`) gardent la liste complète, leur finalité étant de parcourir ;
- la sélection est validée côté serveur à l'écriture : compte actif, même tenant, jamais un identifiant libre fourni par le client ;
- limiter le débit de la route (énumération de l'effectif par balayage de préfixes) : réduit mais non supprimé, à juger acceptable pour un annuaire interne.

Si le PO retient la liste complète pour la simplicité (q205 A tel quel), c'est acceptable avec les réserves 2 à 5, car les données restent id + nom. Le coût de la recherche (une route, un test) est faible ; je le recommande, je ne l'impose pas.

## Texte d'information R5

Oui, une phrase de plus, regroupée avec celles déjà demandées (pas de texte séparé) :

> « Votre nom affiché peut être consulté par les personnes habilitées à créer ou modifier un risque, uniquement pour choisir les personnes nommées qui auront accès à un risque restreint ; le fait d'être désigné nommément sur un risque est visible des personnes qui ont accès à ce risque. »

Le texte R5 reste en attente de PO et juriste ; A24 n'en fixe pas la rédaction finale.

## Journalisation de consultation

**Pas de journal de consultation par lecture** (prolonge q183 et F7-S3). L'annuaire reste non confidentiel (id + nom) ; auditer chaque lecture de la première ligne produirait un volume élevé de traces nominatives sans gain. L'événement utile est audité à l'écriture : la désignation des personnes nommées sur le risque (acteur, risque, personnes ajoutées ou retirées, sans contenu du risque). À rouvrir si un champ s'ajoute (e-mail, service, rôle, connexion), si un export apparaît, ou si l'annuaire est ouvert à un lecteur hors liste fermée.

## Réserves

1. **Recherche plutôt que liste** pour `risk.create`/`risk.update` (voir ci-dessus). Décision PO, Architecte, dev-backend.
2. **Troncature à 500** : signal à l'écran ou recherche ; ordre limite puis filtre à corriger (q183 R1, toujours ouverte). Dev-backend.
3. **R5** : ajouter la phrase proposée. PO, juriste Djamo.
4. **Test** : réponse limitée à `id` et `displayName` ; un compte sans aucun des droits de la liste reçoit 403 ; autre tenant isolé ; nommés validés côté serveur (actif, tenant). Dev-backend, QA ; A24 vérifie.
5. **Liste fermée** : tout nouvel appelant ou champ rouvre la revue. Le droit `risk.create` ne doit pas être donné à un rôle large « par défaut » sans que l'on mesure qu'il ouvre aussi l'annuaire (à noter dans la matrice des droits).

## Niveau de confiance

Faits sur le code : CONFIRMED. Spec visibilité et frontend : OPEN. Cadre juridique : OPEN.

## Limites

Revue documentaire et de code, pas de requête base ni test d'environnement, pas d'avis juridique. Je ne décide ni pour le PO ni pour le juriste.

## Revalidation demandée

Réserves 1, 2, 4, 5 (code, tests) ; 3 (PO, juriste). Statut : **OPEN**.
