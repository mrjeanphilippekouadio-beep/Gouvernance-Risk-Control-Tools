# B-6a Dispositif : arbitrage Risk Manager (A13) sur F-B6a-04, F-B6a-05 et C-B6a-03

Date : 2026-10-12. Statut : **recommandations, non arbitrées par le PO**. Aucun code ni spec modifié.
Sources lues : contrat `RISK_MANAGEMENT_V1_FINAL_DECISIONS.md` (§5, §8, §10, invariants 1, 5, 10), spec B-6 §5.2 à 5.4, revue A10 « B-6a Dispositif » (F-B6a-04, F-B6a-05), revue A14 C-B6a-03.

Distinction fait / hypothèse / avis : les faits viennent des revues A10 et A14 (code non relu par moi) ; mes recommandations sont des avis.

## 1. F-B6a-04 : l'auteur de l'échelle en brouillon peut approuver la version qui la référence

**Faits (A10).** Les bandes, descriptifs et axes de l'échelle font partie de ce que la version de Dispositif fait approuver. Une échelle DRAFT reste modifiable par tout détenteur de `ratingscale.update` jusqu'au passage en PENDING. `authorsOf` ne lit que l'audit de la version, pas celui de l'échelle.

**Recommandation : exclure l'auteur, et ne pas exiger une échelle déjà figée.**

1. Ajouter aux exclus de la décision toute personne présente dans l'audit `CREATE`/`UPDATE` de l'échelle référencée (`RatingScale`, `ratingScaleId`), en plus des auteurs de la version.
2. Limiter cette exclusion aux échelles encore en brouillon au moment de la demande. Une échelle déjà ACTIVE ou ARCHIVED a été validée par un cycle antérieur : ses anciens rédacteurs ne sont pas exclus (sinon exclusion excessive, sans gain de contrôle). Hypothèse : toute échelle ACTIVE héritée a été validée par son propre circuit ; à confirmer par A06.
3. Ne pas retenir « échelle figée avant la demande ». Raison : (i) le contrat dit que le Dispositif **porte** l'échelle et la versionne avec lui (§10) ; l'échelle devient ACTIVE par la décision du Dispositif (le miroir, F-B6a-01), donc exiger une échelle déjà ACTIVE est circulaire ; (ii) cela créerait une seconde approbation, celle de l'échelle, que le contrat ne prévoit pas ; (iii) cela ne règle pas le fond, car l'auteur d'une échelle figée par lui-même pourrait encore approuver.

**Principe.** Séparation des tâches, invariant 1 : « on ne valide jamais ce qu'on a saisi » ; ce qui est approuvé, c'est l'ensemble version plus échelle, pas seulement la version. Trois lignes : le contrôle reste interne à la 2e ligne (groupe Risk Manager) ; l'exclusion se fait par personne, jamais en déplaçant la décision vers Audit (3e ligne) pour contourner un manque de personnes.

**Conséquence à connaître.** Avec deux Risk Managers seulement, si l'un a rédigé l'échelle et l'autre fait la demande, personne ne peut décider. Le cas q75 s'applique : demande PENDING, alerte à tous les Risk Managers, jamais de validation tacite. C'est voulu. Issue normale : un 3e Risk Manager, ou une nouvelle version rédigée autrement. Le miroir (F-B6a-01) et le verrou (F-B6a-02) sont des sujets distincts.

**Décision PO : non requise.** C'est l'application d'un invariant déjà validé. À informer seulement : les petites équipes auront besoin d'au moins trois Risk Managers pour activer un Dispositif sans blocage.

## 2. F-B6a-05 : un membre RM + Comité qui modifie un brouillon fait tomber le Comité en repli

**Faits.** Le cumul RM + Comité est autorisé (q58). Ce membre, auteur du brouillon, est exclu du vote. Avec un Comité de 2 personnes, il reste 1 éligible, donc moins de 2 : le Comité n'est pas sollicité (q72) et le circuit passe à Audit (si au moins 2 éligibles), puis au repli RM (`FALLBACK`).

**Est-ce voulu ? Oui, au sens du contrat, mais il reste un effet à encadrer.** Le contrat §8 prévoit explicitement : « si le quorum est impossible (trop de votants exclus du vote, ou échéance dépassée), l'envoi au Comité est refusé et la demande suit le circuit unique ». L'exclusion de l'auteur est donc traitée comme une absence. Je n'y vois pas une anomalie de code.

**Réserve (avis).** Ce mécanisme donne un levier : un membre du Comité qui est aussi RM peut, en modifiant le brouillon, faire passer la décision d'un vote collectif à un régime plus léger, choisi sans que le client l'ait voulu. Je n'ai pas de preuve d'abus ; c'est une exposition.

**Recommandation : ne pas rester PENDING, ne pas changer la règle ; rendre la cause visible.**
1. Garder le circuit actuel (pas de blocage dur : une demande qui attend sans issue pour une cause que l'un des acteurs peut provoquer ouvre un déni de service, mon principe 9).
2. Enregistrer la **cause** du repli : `ABSENCE` (groupe vide ou trop petit) ou `EXCLUSION` (groupe suffisant avant exclusion des auteurs ou du demandeur). Elle apparaît dans la vue des décisions prises en l'absence du Comité, dans la notification à Audit, et dans l'indicateur des replis (q62).
3. Les décisions en repli par `EXCLUSION` sont ratifiées en priorité par les membres non concernés du Comité (q73 : on ne ratifie pas ce à quoi on a pris part).
4. KRI suggéré : part des replis par `EXCLUSION`, par membre ayant provoqué l'exclusion. Un seuil de dépassement déclenche une revue par Audit.

**Principe.** Séparation des tâches (l'auteur ne vote pas : correct) ; traçabilité plutôt que blocage ; le repli est un autre régime, marqué et ratifié (invariant 10).

**Décision PO : facultative.** La règle est déjà la sienne ; je ne la remets pas en cause. Si le PO veut la rouvrir, question en langage simple :

> « Quand un membre du Comité qui est aussi de l'équipe risque a lui-même préparé le dossier, il ne peut pas voter, et si le Comité n'a que deux personnes, le dossier est décidé par Audit ou par l'équipe risque au lieu du Comité. Que voulez-vous ?
> Option 1 (ma recommandation) : on garde cette règle, mais on note toujours pourquoi le Comité n'a pas voté, on fait confirmer ces décisions par les autres membres du Comité, et on suit leur nombre.
> Option 2 : on attend toujours un vote du Comité ; le dossier reste bloqué tant qu'un autre membre n'a pas refait le travail.
> Option 3 : on interdit à un membre de l'équipe risque d'être aussi au Comité (cela annule votre décision sur les cumuls). »

Je recommande l'option 1 ; l'option 3 contredit une décision déjà prise (q58).

## 3. C-B6a-03 : « Audit et Comité » avec un seul groupe éligible (pour B-12)

**Avis.** Je rejoins A14 : le comportement actuel (un seul groupe vote) n'est acceptable que comme repli marqué. Un double contrôle voulu par le client qui devient un contrôle simple sans trace est une dégradation silencieuse, donc une faiblesse de gouvernance.

**À encoder dans B-12.**
1. Le résultat de `resolveDecider` doit dire quels groupes votent et quels groupes manquent, avec l'indicateur « double contrôle dégradé ».
2. Une décision dégradée n'est pas écrite `NORMAL` : régime `FALLBACK`, ratification en attente, Audit notifié, marquage visible. Cohérent avec q62, q72 et q76.
3. Si le seul groupe éligible est le Comité, il vote avec la règle du Dispositif. Si c'est Audit seul, la décision est marquée « prise par la 3e ligne » (q64), avec ratification par le Comité dès qu'il existe : la 3e ligne ne doit jamais décider seule sans trace de dégradation (indépendance d'Audit).
4. Ordre des votes (q88, déjà ouvert) : Comité d'abord, Audit ensuite, avec la voix d'Audit marquée 3e ligne ; éviter qu'Audit vote en premier. La même personne n'agit qu'une fois (q73).
5. Prévoir la ratification en table ou événement append-only (action A-5 de A14), sans réécrire la ligne de demande.

**Décision PO : aucune nouvelle ; q88 reste à trancher.** Je n'ajoute pas de question.

## Synthèse

| Point | Recommandation | Décision PO |
|---|---|---|
| F-B6a-04 | Exclure les auteurs de l'échelle en brouillon ; ne pas exiger une échelle figée (circulaire) | Non requise ; informer sur le minimum de 3 Risk Managers |
| F-B6a-05 | Garder la règle ; marquer la cause (absence ou exclusion), ratifier, suivre par KRI | Facultative (question ci-dessus) |
| C-B6a-03 | Repli marqué « double contrôle dégradé », Audit seul marqué 3e ligne, ratification append-only | q88 déjà ouverte |

Actions pour l'orchestrateur : A06 pour F-B6a-04 (exclusion) et le champ « cause du repli » ; A05 pour la ratification (B-12) ; une ligne `ACTION_ITEMS.md` si le PO est interrogé sur l'option 1 de F-B6a-05.
