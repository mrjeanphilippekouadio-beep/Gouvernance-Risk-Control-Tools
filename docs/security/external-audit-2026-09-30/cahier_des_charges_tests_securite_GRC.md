# Cahier des charges — Plan de tests et de revue de sécurité
## Application Gouvernance Risk & Control Tools (GRC)

**Version :** 1.0  
**Date :** 30 septembre 2026  
**Statut :** Document de cadrage à valider avant exécution  
**Périmètre applicatif :** nouvelle application web GRC, API backend, base PostgreSQL, gestion des preuves, intégration Google Identity / Google Drive, chaîne CI/CD et infrastructure de déploiement.  
**Hors périmètre :** `apps-script-legacy/`, correspondant à l’ancien système remplacé, sauf besoin explicite d’une analyse de migration ou de coexistence.

---

# 1. Objet et objectifs

Ce cahier des charges définit les tests à réaliser pour vérifier que l’application GRC protège correctement les données de risques, contrôles, évaluations, indicateurs, plans d’action, affectations RACI, rapports et preuves d’audit.

Les tests doivent permettre de démontrer que :

1. un utilisateur ne consulte et ne modifie que les données autorisées ;
2. les périmètres tenant, entité, département, processus et rôle sont appliqués de manière cohérente ;
3. les règles métier GRC et les séparations de tâches sont respectées ;
4. les preuves et journaux d’audit ne peuvent pas être consultés ou modifiés indûment ;
5. l’authentification, les sessions, les API et les fichiers résistent aux attaques courantes ;
6. les migrations, dépendances, images de conteneur et pipelines de livraison ne fragilisent pas la sécurité ;
7. les sauvegardes, restaurations et mécanismes de reprise fonctionnent ;
8. les résultats sont reproductibles, traçables et utilisables pour une décision de mise en production.

**Principe directeur :** une vérification de sécurité ne se limite pas à constater qu’un écran masque une information. Les contrôles doivent être appliqués côté serveur, dans les services métier et dans les requêtes de données.

---

# 2. Référentiels et frameworks de test

Les référentiels ci-dessous servent de grille de couverture. Ils ne signifient pas que l’application est certifiée conforme à ces référentiels.

| Référentiel | Utilisation dans ce plan | Couverture attendue |
|---|---|---|
| **OWASP Top 10 (édition applicable au projet)** | Catégoriser les principaux risques applicatifs | Contrôle d’accès, configuration, chaîne logicielle, cryptographie, injection, conception, authentification, intégrité, journalisation, erreurs |
| **OWASP ASVS** | Transformer les exigences de sécurité en critères vérifiables | Authentification, autorisation, sessions, validation, API, fichiers, données, journalisation, configuration |
| **OWASP Web Security Testing Guide (WSTG)** | Méthodologie des tests web manuels | Cartographie, configuration, identité, authentification, autorisation, sessions, entrées, erreurs, logique métier |
| **OWASP API Security Top 10** | Tester les API REST et leurs objets | BOLA/IDOR, autorisation fonctionnelle, exposition de propriétés, consommation de ressources, fonctions sensibles, SSRF et mauvaises configurations lorsque applicables |
| **OWASP SAMM** | Structurer l’amélioration continue | Gouvernance, conception, implémentation, vérification, opérations |
| **NIST SSDF** | Sécuriser le cycle de développement | Protection du code, dépendances, construction, tests, traitement des vulnérabilités et livraison |
| **CIS Docker Benchmark** | Vérifier la configuration des conteneurs | Utilisateur non privilégié, capacités, secrets, image, réseau, système de fichiers et journalisation |
| **Bonnes pratiques Google Cloud / Cloud Run** | Revue de l’environnement de déploiement, si Cloud Run est utilisé | Identités de service, IAM, secrets, ingress, réseau, logs, déploiement et séparation des environnements |
| **Bonnes pratiques PostgreSQL** | Revue des droits et de l’intégrité des données | Moindre privilège, transactions, contraintes, chiffrement de transport, sauvegarde, restauration et audit |
| **Exigences internes GRC** | Vérifier les règles métier propres à l’application | RACI, séparation des tâches, workflow, appétence, preuves, piste d’audit et périmètres |

## 2.1 Niveau de vérification

- **Conception :** les exigences, responsabilités et règles de sécurité sont définies.
- **Code :** les contrôles existent dans le code et les services.
- **Test automatisé :** un test vérifie le comportement attendu.
- **Test dynamique :** le comportement est vérifié en exécutant l’application dans un environnement autorisé.
- **Configuration :** les paramètres d’hébergement, de base, d’identité et de pipeline sont vérifiés.
- **Preuve :** un résultat reproductible est conservé : sortie de test, capture expurgée, journal, rapport d’outil ou référence de commit.

---

# 3. Périmètre technique

## 3.1 Inclus

1. Frontend web et navigation.
2. API backend et middleware.
3. Authentification Google Identity et vérification des jetons.
4. Autorisation RBAC et permissions fonctionnelles.
5. Périmètres tenant / entité / département / processus.
6. RACI et résolution des périmètres des tableaux de bord.
7. Services métier : cartographie des risques, évaluations, appétence, contrôles, plans d’action, KPI/KRI, rapports et exports.
8. Preuves : téléversement, métadonnées, stockage, lecture, téléchargement, suppression et partage.
9. Journal d’audit et traçabilité des opérations.
10. PostgreSQL : schéma, contraintes, migrations, transactions et droits.
11. Intégrations Google Drive et autres services externes.
12. CI/CD, dépendances, secrets, images de conteneur et configuration de déploiement.
13. Sauvegarde, restauration, supervision, gestion des erreurs et résilience.
14. Tests de charge ciblés sur les fonctions critiques.

## 3.2 Exclus ou conditionnels

- `apps-script-legacy/` : exclu des constats sur la nouvelle application.
- Test d’intrusion externe sur une production réelle : uniquement après autorisation écrite et définition des limites.
- Audit organisationnel complet, audit de conformité réglementaire ou certification : hors du seul périmètre de ce cahier.
- Services cloud non utilisés par l’application : marqués « non applicable » avec justification.
- Données personnelles réelles : éviter leur usage dans les tests ; utiliser des données synthétiques.

---

# 4. Environnements, données et règles d’exécution

## 4.1 Environnements

| Environnement | Usage | Conditions minimales |
|---|---|---|
| Local / CI | Tests unitaires, composants, migrations et contrôles statiques | Données synthétiques, services isolés ou conteneurisés |
| Staging / préproduction | Tests d’intégration, API, autorisation, DAST et charge | Configuration proche de la production, comptes de test, journalisation active |
| Production | Vérifications non destructives uniquement | Autorisation préalable, fenêtre définie, aucun test de charge ou destructif sans validation spécifique |

## 4.2 Jeu de données de test minimal

Créer au moins deux tenants fictifs et plusieurs utilisateurs par tenant.

| Identifiant logique | Tenant | Profil | Périmètre métier | Usage |
|---|---|---|---|---|
| T-A-ADMIN | Tenant A | Administrateur | Tenant A | Contrôle des privilèges administratifs |
| T-A-RISK | Tenant A | Risk Manager | Risques autorisés de A | Cartographie et évaluations |
| T-A-DEPT1 | Tenant A | Responsable département 1 | Département 1 | Test de cloisonnement |
| T-A-DEPT2 | Tenant A | Responsable département 2 | Département 2 | Vérification négative |
| T-A-AUDIT | Tenant A | Auditeur | Lecture selon mandat | Contrôle lecture seule et preuves |
| T-A-READ | Tenant A | Lecteur | Périmètre restreint | Vérification des permissions |
| T-B-ADMIN | Tenant B | Administrateur | Tenant B | Vérification de séparation des tenants |
| T-B-USER | Tenant B | Utilisateur standard | Tenant B | Tentatives d’accès inter-tenant |
| T-A-DISABLED | Tenant A | Compte désactivé | Aucun accès attendu | Révocation et compte désactivé |

Les données synthétiques doivent comprendre des risques, évaluations, contrôles, plans d’action, KPI/KRI, alertes, rapports, affectations RACI et preuves dans les deux tenants et plusieurs départements. Les identifiants doivent être connus des testeurs, mais les noms et contenus ne doivent pas correspondre à des personnes ou dossiers réels.

## 4.3 Règles d’exécution

- Toute tentative d’accès non autorisé doit être testée via l’API, pas uniquement via l’interface.
- Tester à la fois les lectures, créations, mises à jour, suppressions, exports et actions de workflow.
- Pour chaque contrôle, tester le cas autorisé et au moins un cas interdit.
- Vérifier les données retournées, les effets en base, les fichiers, les journaux et les effets secondaires.
- Utiliser des comptes et données de test dédiés.
- Ne pas inscrire de jetons, mots de passe, clés ou données sensibles dans les rapports.
- Conserver le commit, la version déployée, la date, l’environnement et la version des outils pour chaque campagne.
- Un test non exécuté n’est jamais déclaré « réussi » ; utiliser « non testé », « bloqué » ou « non applicable justifié ».

---

# 5. Matrice de traçabilité des référentiels

| ID | Domaine | Référentiel principal | Application au projet | Livrable |
|---|---|---|---|---|
| REF-01 | Contrôle d’accès | OWASP Top 10 / ASVS / API Security Top 10 | Tenant, objet, fonction, département, processus | Matrice d’autorisation et résultats négatifs |
| REF-02 | Authentification/session | OWASP ASVS / WSTG | Google Identity, jetons, session, révocation | Rapport d’authentification |
| REF-03 | Entrées et fichiers | OWASP ASVS / WSTG | API, formulaires, uploads, exports | Rapport de validation et tests de fichiers |
| REF-04 | API | OWASP API Security Top 10 | Autorisation par objet, propriété, fonction et ressources | Rapport API |
| REF-05 | Code et dépendances | NIST SSDF / OWASP SAMM | SAST, SCA, secrets, revue de code | Rapports CI et registre de vulnérabilités |
| REF-06 | Conteneurs | CIS Docker Benchmark | Image, utilisateur, capacités, secrets, filesystem | Rapport de configuration |
| REF-07 | Cloud | Bonnes pratiques Google Cloud | IAM, secrets, réseau, logs, déploiement | Checklist cloud |
| REF-08 | Base de données | Bonnes pratiques PostgreSQL | Droits, contraintes, migrations, transactions | Rapport DB |
| REF-09 | Audit | OWASP ASVS / exigences internes | Intégrité, attribution, chronologie, accès aux journaux | Échantillon de piste d’audit |
| REF-10 | Résilience | OWASP SAMM / exigences internes | Pannes, reprise, sauvegarde/restauration | Rapport de reprise |
| REF-11 | Métier GRC | Règles internes GRC | RACI, maker-checker, appétence, workflow | Matrice métier |
| REF-12 | Vérification continue | NIST SSDF / OWASP SAMM | CI, seuils de blocage, régression | Pipeline et critères de sortie |

---

# 6. Matrice de criticité

| Niveau | Définition | Exemple | Traitement |
|---|---|---|---|
| **P0 — Bloquant** | Accès non autorisé à des données d’un autre tenant ou périmètre, élévation de privilèges, falsification de preuves/audit, contournement majeur d’un workflow sensible | Un utilisateur du département A obtient les KRI confidentiels du département B | Bloquer la fusion ou la mise en production jusqu’à correction et re-test |
| **P1 — Élevé** | Faiblesse exploitable affectant une fonction sensible, données importantes ou mécanisme de sécurité | Upload dangereux, révocation de session inefficace, droits DB trop larges | Corriger avant mise en production, sauf dérogation formelle et temporaire |
| **P2 — Modéré** | Risque limité ou nécessitant des conditions particulières, sans impact critique démontré | Informations techniques exposées, rate limit incomplet sur une fonction non critique | Corriger dans un délai convenu et suivre le risque |
| **P3 — Faible** | Défaut à faible impact direct, durcissement ou amélioration | En-tête non critique manquant dans un contexte limité | Planifier et documenter |
| **N/A** | Test non applicable | Fonction absente du produit | Justification documentée et validée |

La gravité finale dépend de l’impact, de l’exploitabilité, des données exposées, du périmètre atteint et des protections compensatoires. Le niveau ne doit pas être déduit uniquement du nom d’un contrôle.

---

# 7. Matrice principale des tests de sécurité

## 7.1 Autorisation, isolation et périmètres — priorité P0

| ID | Test | Précondition / scénario | Résultat attendu | Preuve à conserver | Référentiel |
|---|---|---|---|---|---|
| SEC-001 | Isolation inter-tenant en lecture | T-B-USER demande par ID un risque, contrôle, KRI, plan d’action ou rapport de T-A | Refus (403/404 selon convention) ; aucune donnée de T-A retournée | Requête/réponse expurgée et vérification DB | ASVS, API Top 10 BOLA |
| SEC-002 | Isolation inter-tenant en écriture | T-B-USER modifie/supprime un objet de T-A en substituant son ID | Refus ; objet inchangé ; événement de sécurité si prévu | Avant/après DB et réponse API | ASVS, API Top 10 |
| SEC-003 | Isolation par département | T-A-DEPT1 demande les objets de T-A-DEPT2 | Les objets hors périmètre sont absents ou refusés | Requêtes et comparaison des jeux de données | ASVS, API Top 10 |
| SEC-004 | Isolation des dashboards | T-A-DEPT1 consulte les vues exécutives, comité des risques, rapports consolidés et agrégats KRI | Les lignes, alertes, totaux, graphiques et détails respectent le scope ; aucun agrégat ne révèle les objets exclus | Réponses API, totaux attendus, test de non-régression | ASVS, API Top 10 |
| SEC-005 | Isolation des exports | Un utilisateur restreint exporte CSV/XLSX/PDF ou télécharge un rapport | L’export contient uniquement les données autorisées, y compris dans les onglets cachés et métadonnées | Fichier d’export synthétique et comparaison | ASVS, API Top 10 |
| SEC-006 | Accès par identifiant direct (IDOR/BOLA) | Remplacer les IDs dans URL, corps, paramètres et sous-ressources | Le serveur vérifie le droit sur chaque objet, indépendamment de l’interface | Corpus de requêtes positives/négatives | API Top 10 |
| SEC-007 | Autorisation fonctionnelle | Appeler directement une route réservée à un rôle supérieur | Refus côté serveur, même si l’interface masque le bouton | Réponses par profil | ASVS, API Top 10 |
| SEC-008 | Révocation de droits | Retirer un rôle ou une affectation, puis réutiliser session et URL déjà connues | Les droits retirés ne restent pas actifs au-delà du délai prévu et documenté | Chronologie de révocation | ASVS |
| SEC-009 | Filtre entité contrôlé côté serveur | Soumettre un `entityFilter` arbitraire dans un rapport consolidé | Le filtre est intersecté avec le scope autorisé ; aucune entité interdite ne fuit dans les détails ou les totaux | Requête et résultat | ASVS, API Top 10 |
| SEC-010 | Liste vide de périmètre | Simuler un utilisateur sans risque/objet autorisé et appeler chaque vue | Aucun objet ni agrégat sensible ne revient ; une liste vide ne doit jamais signifier « aucun filtre » | Tests avec scope vide et logs | ASVS |
| SEC-011 | Contournement tenant par champs fournis | Modifier `tenantId`, `ownerId`, `departmentId`, `createdBy` dans le payload | Le serveur ignore ou rejette les valeurs non autorisées et dérive le contexte de l’identité vérifiée | Requêtes et état DB | ASVS |
| SEC-012 | Recherche et pagination | Jouer sur `search`, `sort`, `page`, `limit`, filtres combinés | Les filtres ne permettent pas de sortir du périmètre ; limite maximale imposée | Résultats de pagination et requêtes | API Top 10 |

**Critère d’acceptation SEC-001 à SEC-012 :** aucun accès non autorisé confirmé. Toute fuite entre tenants ou périmètres constitue un échec P0 jusqu’à correction et re-test.

## 7.2 Authentification et sessions — P1/P0 selon impact

| ID | Test | Scénario | Résultat attendu | Preuve | Référentiel |
|---|---|---|---|---|---|
| AUTH-001 | Jeton absent | Appeler une route protégée sans jeton | 401 ou réponse d’authentification documentée | Requête/réponse | ASVS, WSTG |
| AUTH-002 | Jeton invalide ou altéré | Modifier une partie du jeton | Rejet, aucune identité créée à partir du payload non vérifié | Test automatisé | ASVS |
| AUTH-003 | Jeton expiré | Utiliser un jeton expiré | Rejet | Résultat horodaté | ASVS |
| AUTH-004 | Audience incorrecte | Jeton valide pour une autre application | Rejet côté serveur | Test d’intégration | ASVS |
| AUTH-005 | Émetteur/signature incorrects | Jeton d’un émetteur non approuvé ou signature invalide | Rejet | Test d’intégration | ASVS |
| AUTH-006 | Email non vérifié | Utiliser une identité non vérifiée si ce cas est représentable | Rejet ou comportement conforme à la politique écrite | Résultat | ASVS |
| AUTH-007 | Compte désactivé/supprimé | Compte existant dans l’IdP mais désactivé dans la base applicative | Aucun accès | Test DB/API | ASVS |
| AUTH-008 | Utilisateur d’un tenant différent | Identité valide mais non rattachée au tenant visé | Aucun accès aux objets hors tenant | Test API | ASVS |
| AUTH-009 | Usurpation d’en-têtes | Modifier `X-User`, `X-Tenant`, `X-Role` ou équivalent | Ces valeurs ne remplacent pas l’identité vérifiée | Test API | ASVS |
| AUTH-010 | Révocation après changement de rôle | Retirer permission puis réutiliser jeton/session | Révocation effective selon délai maximal documenté | Chronologie | ASVS |
| AUTH-011 | Brute force / rate limiting | Répéter des appels de connexion ou opérations sensibles | Limitation, temporisation ou protection appropriée sans verrouillage abusif | Logs et mesures | ASVS, WSTG |
| AUTH-012 | Secrets et données de session | Inspecter logs, erreurs et stockage navigateur | Aucun jeton ou secret sensible dans les logs/URL ; stockage adapté au modèle de session | Inspection expurgée | ASVS |

## 7.3 RBAC, RACI et séparation des tâches — P0/P1

| ID | Test | Scénario | Résultat attendu | Preuve | Référentiel |
|---|---|---|---|---|---|
| RACI-001 | Permissions RBAC sur chaque route | Matrice rôle × endpoint × action | Seules les permissions prévues permettent l’action | Matrice de résultats | ASVS |
| RACI-002 | Affectation RACI inter-tenant | Affecter à un utilisateur d’un autre tenant | Refus, sauf modèle inter-tenant explicitement conçu et autorisé | Réponse et état DB | Exigence métier |
| RACI-003 | Utilisateur cible inactif | Affecter un rôle RACI à un utilisateur désactivé/supprimé | Refus ou statut explicitement non exécutable | Test service/API | Exigence métier |
| RACI-004 | Objet cible hors tenant | Affecter RACI sur risque/contrôle/action d’un autre tenant | Refus | Test API | ASVS |
| RACI-005 | Conflit R/A | Une même personne est Responsable (R) et Approbateur (A) lorsque la règle interdit l’auto-approbation | Refus dans tous les ordres d’affectation et après modification | Tests de séquence | Séparation des tâches |
| RACI-006 | Changement de rôle | Modifier le rôle après création de l’affectation | Les autorisations effectives suivent la politique documentée ; pas de privilège hérité inattendu | Test d’intégration | ASVS |
| RACI-007 | Suppression/désactivation d’affectation | Retirer une affectation RACI | Les écrans, API, dashboards et workflows reflètent le retrait | Vérification multi-couches | Exigence métier |
| RACI-008 | Autorité d’approbation | L’approbateur tente d’approuver un objet qu’il a préparé lorsque maker-checker est obligatoire | Refus et absence de changement d’état | Audit + DB | Exigence métier |
| RACI-009 | Actions concurrentes | Deux approbations ou modifications simultanées | État final cohérent, pas de double approbation ou perte d’affectation | Test de concurrence | Exigence métier |
| RACI-010 | Historique RACI | Créer, modifier et supprimer une affectation | Acteur, date, ancienne/nouvelle valeur et motif requis sont traçables | Événements d’audit | Auditabilité |

## 7.4 Services métier GRC — P0/P1/P2

| ID | Domaine | Scénario de test | Résultat attendu | Priorité |
|---|---|---|---|---|
| GRC-001 | Cartographie | Créer/consulter/modifier un risque hors périmètre | Accès refusé ; aucune modification indirecte | P0 |
| GRC-002 | Évaluation | Soumettre une évaluation avec un risque d’un autre tenant | Refus ; évaluation non créée | P0 |
| GRC-003 | Appétence | Désactiver un seuil d’appétence puis recalculer le risque résiduel | Le seuil inactif n’est pas appliqué, conformément à la règle métier | P1 |
| GRC-004 | Appétence | Seuil absent, désactivé, archivé, dupliqué ou chevauchant | Comportement explicite, déterministe et documenté | P1 |
| GRC-005 | Contrôles / PCOD | Changer le statut d’un contrôle sans permission | Refus ; statut inchangé | P0 |
| GRC-006 | Plan d’action | Clôturer une action sans satisfaire les conditions obligatoires | Refus ou dérogation tracée et autorisée | P1 |
| GRC-007 | KPI/KRI | Calcul, seuil, dénominateur nul, valeur manquante, données tardives | Résultat exact, aucun NaN/Infinity exposé, traitement documenté | P1 |
| GRC-008 | KRI consolidés | Comparer les valeurs affichées avec les enregistrements autorisés | Totaux, alertes et tendances ne contiennent que les objets autorisés | P0 |
| GRC-009 | États de workflow | Appeler directement une transition interdite | Transition refusée côté serveur | P0 |
| GRC-010 | Répétition d’opération | Réenvoyer une requête de création/approbation | Pas de doublon non souhaité ; idempotence si attendue | P1 |
| GRC-011 | Données archivées | Appeler les endpoints avec des objets archivés/inactifs | Règle de visibilité et d’utilisation cohérente | P1 |
| GRC-012 | Import de données | Importer fichier avec IDs externes, lignes invalides ou tenant falsifié | Validation ligne par ligne, rapport d’erreur sans fuite, pas de contournement du périmètre | P1 |
| GRC-013 | Export | Vérifier les colonnes, feuilles cachées, formules et métadonnées | Pas de données non autorisées ou secrets cachés | P1 |
| GRC-014 | Cohérence des calculs | Recalculer indépendamment les indicateurs sur jeu synthétique | Écart nul ou expliqué selon règle d’arrondi | P1 |
| GRC-015 | Historique | Modifier un objet évalué ou approuvé | L’historique montre la modification ; statut de validation cohérent | P1 |

## 7.5 Preuves, fichiers et stockage externe — P0/P1

| ID | Test | Scénario | Résultat attendu | Preuve | Référentiel |
|---|---|---|---|---|---|
| EVD-001 | Lecture de preuve hors tenant | Reprendre l’ID d’une preuve d’un autre tenant | Refus côté serveur, même avec URL connue | Requête et journal | ASVS, API Top 10 |
| EVD-002 | Lecture hors périmètre métier | Un utilisateur du département 1 demande une preuve du département 2 | Refus ou filtrage conforme au modèle de droits | Test API | ASVS |
| EVD-003 | Upload extension trompeuse | Fichier exécutable ou HTML renommé en PDF/image | Rejet selon liste blanche et validation de contenu | Résultat de test | ASVS, WSTG |
| EVD-004 | Signature réelle du fichier | MIME déclaré différent de la signature réelle | Détection/rejet ou traitement sûr documenté | Rapport de validation | ASVS |
| EVD-005 | Taille et concurrence | Dépasser la taille limite et lancer des uploads parallèles autorisés | Rejet propre ; mémoire et CPU restent dans des limites fixées | Métriques | ASVS |
| EVD-006 | Nom de fichier hostile | `../`, caractères de contrôle, noms très longs, Unicode ambigu | Nom normalisé ; aucun chemin local ou commande construit à partir du nom | Test unitaire/intégration | WSTG |
| EVD-007 | Contenu actif | HTML/SVG/Office contenant contenu actif ou macro | Pas d’exécution dans le contexte de l’application ; téléchargement avec en-têtes sûrs | Test navigateur/API | ASVS |
| EVD-008 | Malware / quarantaine | Fichier de test antivirus inoffensif prévu à cet effet, tel que EICAR, uniquement si autorisé | Détection/quarantaine conforme au dispositif retenu | Rapport antivirus | Exigence sécurité |
| EVD-009 | URL de stockage | Réutiliser une URL signée expirée, altérée ou appartenant à une autre preuve | Refus ; durée et portée limitées | Résultat horodaté | ASVS |
| EVD-010 | Révocation de preuve | Retirer accès ou supprimer logiquement une preuve | Accès retiré selon politique, y compris liens précédemment émis lorsque possible | Test de révocation | Exigence métier |
| EVD-011 | Métadonnées | Falsifier tenant, auteur, catégorie, objet lié ou date | Métadonnées sensibles dérivées du serveur ; validation de l’objet et du tenant | État DB/audit | ASVS |
| EVD-012 | Échec Google Drive | Timeout, quota, permission insuffisante ou panne Drive | Pas de preuve fantôme ; état cohérent, erreur sûre et reprise maîtrisée | Logs + état DB | Résilience |

**Point spécifique :** vérifier la limite de téléversement annoncée (25 Mo dans le code consulté), le stockage en mémoire, la validation réelle du contenu et les protections contre les uploads concurrents. Ne pas conclure à l’absence d’antivirus sans vérifier l’ensemble du pipeline de stockage.

## 7.6 Validation des entrées, API et sécurité web — P1/P2

| ID | Test | Scénario | Résultat attendu | Référentiel |
|---|---|---|---|---|
| WEB-001 | SQL injection | Entrées de recherche, tri, filtres et IDs | Les entrées sont paramétrées/validées ; aucun changement de logique SQL | WSTG, ASVS |
| WEB-002 | XSS stocké/réfléchi | Nom de risque, commentaire, preuve, description | Texte encodé selon le contexte ; pas d’exécution de script | WSTG, ASVS |
| WEB-003 | Injection de template/commande | Champs réutilisés dans génération de rapport ou appels système | Aucune interprétation non prévue ; commandes et templates sûrs | WSTG |
| WEB-004 | Validation JSON | Propriétés inconnues, type erroné, valeurs excessives, tableaux imbriqués | Rejet ou normalisation documentée | ASVS |
| WEB-005 | Mass assignment | Envoyer `role`, `tenantId`, `createdBy`, `approvedBy`, `isAdmin` dans un payload métier | Champs réservés ignorés/rejetés | ASVS, API Top 10 |
| WEB-006 | SSRF | URL contrôlable par utilisateur, si une fonction récupère des URL | Accès aux adresses internes/métadonnées cloud bloqué ; allowlist si possible | API Top 10, WSTG |
| WEB-007 | CORS | Origines inconnues, credentials et préflight | Seules les origines prévues sont autorisées ; pas de wildcard incompatible avec credentials | ASVS |
| WEB-008 | En-têtes HTTP | CSP, HSTS en HTTPS, `X-Content-Type-Options`, politique de framing et referrer | Politique adaptée à l’architecture et sans casser l’application | ASVS |
| WEB-009 | Erreurs | Provoquer erreurs de validation, DB, Drive et serveur | Messages sans stack trace, secrets, SQL ou données d’autres tenants | ASVS |
| WEB-010 | Rate limiting | Appels intensifs sur endpoints de recherche, exports, login et uploads | Limites adaptées et erreurs maîtrisées | API Top 10 |
| WEB-011 | Pagination et coût | Très grandes limites, tris complexes, filtres multiples | Limites serveur, timeout et consommation bornés | API Top 10 |
| WEB-012 | Content-Type et méthodes | Mauvais Content-Type, méthode HTTP inattendue, corps vide | Rejet cohérent ; aucune route sensible accessible par méthode alternative | WSTG |

## 7.7 Journal d’audit et traçabilité — P0/P1

| ID | Test | Scénario | Résultat attendu | Priorité |
|---|---|---|---|---|
| AUD-001 | Opération sensible auditée | Créer/modifier/supprimer/valider/exporter | Événement complet : acteur, action, objet, date, résultat et contexte utile | P0 |
| AUD-002 | Échec d’audit | Simuler une panne d’écriture du journal lors d’une action critique | La politique est explicite : transaction bloquée ou procédure de secours ; pas de perte silencieuse | P0 |
| AUD-003 | Modification/suppression d’audit | Tenter UPDATE/DELETE avec compte applicatif | Refus par permissions DB ou contrôle compensatoire robuste | P1 |
| AUD-004 | Transaction métier/audit | Faire échouer la transaction entre écriture métier et journal | Pas de divergence silencieuse ; atomicité ou stratégie compensatoire documentée | P0 |
| AUD-005 | Falsification acteur | Envoyer `actorId` dans le payload | L’acteur vient de l’identité serveur vérifiée | P0 |
| AUD-006 | Données sensibles dans logs | Générer erreurs avec tokens, contenu de preuve ou données personnelles | Aucun secret ni contenu sensible inutile dans les logs | P1 |
| AUD-007 | Accès aux journaux | Utilisateur métier tente de lire/exporter les journaux techniques complets | Accès limité au besoin métier et au rôle autorisé | P1 |
| AUD-008 | Horodatage et ordre | Modifier plusieurs objets rapidement ou en concurrence | Chronologie exploitable, timezone documentée, identifiants de corrélation | P1 |
| AUD-009 | Événements de sécurité | Refus d’accès, tentative inter-tenant, erreurs d’authentification | Événements significatifs détectables sans journaliser des secrets | P1 |
| AUD-010 | Rétention et export | Appliquer règles de conservation et exporter l’historique | Rétention, intégrité et export conformes à la politique approuvée | P2 |

## 7.8 PostgreSQL, migrations et intégrité — P0/P1

| ID | Test | Scénario | Résultat attendu |
|---|---|---|---|
| DB-001 | Moindre privilège | Examiner les rôles SQL utilisés par l’application et les migrations | Compte runtime sans privilèges superuser ni DDL inutile |
| DB-002 | Isolation tenant dans les repositories | Revoir toutes les lectures/écritures sur entités tenantées | Tenant et périmètre inclus dans les requêtes ou contrôles de service fiables |
| DB-003 | Contraintes FK | Supprimer/réassigner un utilisateur, risque ou objet référencé | Contraintes empêchent les références orphelines ou appliquent une règle documentée |
| DB-004 | Cohérence tenant des relations | Tenter d’associer un objet du tenant A à un utilisateur/objet du tenant B | Rejet côté service et, si pertinent, par contraintes DB |
| DB-005 | Transactions | Simuler une erreur à chaque étape d’une opération multi-table | Rollback complet ou stratégie compensatoire documentée |
| DB-006 | Concurrence | Deux mises à jour simultanées sur une même évaluation/affectation | Pas de perte silencieuse ; verrouillage/versioning cohérent |
| DB-007 | Migrations propres | Appliquer toutes les migrations sur une base vide | Succès reproductible et schéma attendu |
| DB-008 | Migrations de mise à niveau | Appliquer migrations sur une copie de base représentative | Données préservées et contraintes cohérentes |
| DB-009 | Reprise après migration échouée | Interrompre en staging une migration non destructive et contrôlée | Procédure de reprise documentée, pas de schéma incohérent |
| DB-010 | Rollback / expand-contract | Vérifier les migrations qui changent des champs ou relations existantes | Compatibilité pendant le déploiement et stratégie de rollback définie |
| DB-011 | Index et performances | Requêtes de dashboard, listes et filtres à volume réaliste | Plans et temps d’exécution compatibles avec les objectifs |
| DB-012 | TLS et secrets | Vérifier transport DB, stockage et rotation des secrets | TLS selon configuration, aucun secret dans dépôt ou logs |
| DB-013 | Sauvegarde/restauration | Restaurer une sauvegarde en environnement isolé | Restauration vérifiée, données et contraintes cohérentes |
| DB-014 | RLS éventuelle | Si Row-Level Security est activée, tester rôle runtime, session pooling et contournements | La politique est appliquée dans le contexte réel ; aucune dépendance à une variable utilisateur falsifiable |

## 7.9 CI/CD, dépendances et code source — P1/P2

| ID | Test | Scénario | Résultat attendu |
|---|---|---|---|
| SUP-001 | Installation reproductible | Installer frontend/backend à partir des fichiers de verrouillage | Versions reproductibles ; pas de suppression du lockfile pour installer |
| SUP-002 | SAST | Exécuter l’analyse statique sur le code applicatif | Résultats examinés ; seuil de blocage documenté |
| SUP-003 | SCA | Scanner dépendances directes/transitives et images | Vulnérabilités triées, plan de correction et seuil CI définis |
| SUP-004 | Secret scanning | Scanner l’historique et les fichiers du dépôt | Aucun secret actif ; rotation si exposition avérée |
| SUP-005 | Versions GitHub Actions | Inspecter les actions tierces du workflow | Actions épinglées à des SHA immuables lorsque la politique l’exige |
| SUP-006 | Échec d’outil de sécurité | Simuler un outil indisponible ou en erreur | Le pipeline échoue ou produit une dérogation visible selon la criticité ; pas d’échec silencieux |
| SUP-007 | Protection des branches | Vérifier revue obligatoire, tests requis, permissions de push et bypass | Seules les personnes autorisées peuvent contourner les règles |
| SUP-008 | Artefacts | Vérifier que l’artefact testé est celui qui sera déployé | Provenance, version et commit traçables |
| SUP-009 | Dépendances non maintenues | Identifier packages abandonnés, vulnérables ou non nécessaires | Remplacement, isolation ou acceptation documentée |
| SUP-010 | Licences | Scanner les licences des dépendances | Compatibilité avec la politique de distribution du produit |

## 7.10 Docker, Cloud Run et configuration — P1

À exécuter uniquement pour les composants effectivement utilisés.

| ID | Test | Scénario | Résultat attendu |
|---|---|---|---|
| INF-001 | Conteneur non-root | Inspecter l’utilisateur effectif de l’image | Processus applicatif non privilégié |
| INF-002 | Image minimale | Inspecter paquets, outils de debug et composants inutiles | Surface d’attaque limitée ; vulnérabilités traitées |
| INF-003 | Secrets | Inspecter Dockerfile, variables, image et logs | Aucun secret incorporé à l’image ou au dépôt |
| INF-004 | Droits de service | Vérifier service account Cloud Run et IAM | Moindre privilège, pas de rôle Owner/Editor inutile |
| INF-005 | Exposition réseau | Vérifier ingress, accès public et authentification | Service public uniquement si nécessaire et protégé par l’application |
| INF-006 | Secrets Manager | Vérifier stockage, accès, version et rotation des secrets | Secrets externalisés et accessibles uniquement au service nécessaire |
| INF-007 | Logs cloud | Examiner logs applicatifs et d’infrastructure | Pas de tokens, mots de passe ou contenus de preuves |
| INF-008 | Variables d’environnement | Vérifier valeurs par défaut et configuration par environnement | Pas de mode debug ou configuration de test en production |
| INF-009 | TLS PostgreSQL/Drive | Vérifier validation du certificat et configuration client | Transport sécurisé ; pas de désactivation non justifiée de la vérification |
| INF-010 | Limites Cloud Run | Vérifier concurrence, mémoire, timeout et nombre d’instances | Paramètres cohérents avec uploads, dashboards et appels externes |
| INF-011 | Déploiement/rollback | Déployer version de test, vérifier health check et rollback | Retour à la version précédente sans corruption des données |
| INF-012 | Séparation environnements | Vérifier projets, comptes, bases et secrets de dev/staging/prod | Pas de mélange de données ni de secrets entre environnements |

## 7.11 Disponibilité, résilience et performance — P1/P2

| ID | Test | Scénario | Résultat attendu |
|---|---|---|---|
| RES-001 | Indisponibilité PostgreSQL | Panne simulée en staging | Erreur contrôlée, pas de fuite technique, reprise sans corruption |
| RES-002 | Indisponibilité Google Drive | Drive timeout/quota/erreur | État cohérent, reprise ou nouvelle tentative contrôlée |
| RES-003 | Pool de connexions saturé | Charge synthétique sur endpoints DB | Pas de saturation durable ; timeouts et limites appropriés |
| RES-004 | Dashboard volumineux | Volume synthétique représentatif de risques et KRI | Temps et mémoire dans les objectifs fixés |
| RES-005 | Export volumineux | Export de volume maximal autorisé | Limites, timeout, pagination ou traitement asynchrone appropriés |
| RES-006 | Uploads concurrents | Plusieurs uploads proches de la taille limite | Pas d’épuisement mémoire ; rejet maîtrisé en cas de dépassement |
| RES-007 | Requêtes coûteuses | Filtres complexes, grandes pages, appels répétés | Rate limiting, timeouts et quotas fonctionnels |
| RES-008 | Redémarrage pendant opération | Redémarrage contrôlé en staging pendant opération multi-étapes | Aucun état partiel non détecté ; reprise documentée |
| RES-009 | Backup/restore | Restaurer base et documents/metadata nécessaires | RPO/RTO mesurés et acceptés par le propriétaire |
| RES-010 | Alerting | Provoquer erreurs de sécurité et pannes contrôlées | Alertes émises vers le canal attendu et actionnables |

---

# 8. Matrice spécifique de revue des dashboards et rapports

Cette matrice est prioritaire compte tenu des modifications récentes du résolveur de périmètre des dashboards.

| ID | Fonction | Vérification requise | Cas négatif obligatoire |
|---|---|---|---|
| DASH-001 | Vue KRI consolidée | Filtrer les KRI sur les IDs de risques autorisés | Scope vide : aucune ligne, alerte ou total |
| DASH-002 | Vue exécutive | Appliquer le scope aux synthèses KRI, risques, alertes et agrégats | Utilisateur du département A ne voit pas les KRI du département B |
| DASH-003 | Rapport du comité des risques | Scope sur les détails et sur les chiffres agrégés | Totaux identiques à la somme des objets autorisés uniquement |
| DASH-004 | Rapport consolidé | Vérifier les risques, KRI, entités et filtres demandés | Un `entityFilter` arbitraire ne contourne pas le scope |
| DASH-005 | Appétence vs résiduel | Vérifier le scope et le traitement des seuils actifs/inactifs | Un seuil inactif ne doit pas influencer le calcul si la règle métier l’exclut |
| DASH-006 | Comparaison de périodes | Vérifier que toutes les périodes utilisent le même périmètre autorisé | Pas de données historiques hors périmètre |
| DASH-007 | Cache | Changer de compte/périmètre et relire la vue | Pas de données d’un utilisateur dans le cache d’un autre |
| DASH-008 | Export depuis dashboard | Exporter la vue affichée et comparer aux données de l’API | L’export n’est pas plus large que l’affichage autorisé |
| DASH-009 | Filtres de recherche | Modifier département, entité, catégorie, période et propriétaire | Les filtres utilisateur réduisent le scope, ne l’élargissent jamais |
| DASH-010 | Contrôle de non-régression | Exécuter les mêmes tests avec admin, risk manager, auditeur, utilisateur restreint et compte sans scope | Chaque profil reçoit exactement les données prévues |

**Règle technique recommandée :** calculer une fois le scope autorisé côté serveur et le transmettre explicitement aux requêtes des risques, KRI, alertes, entités et exports. Éviter les méthodes qui appellent un `getAll...()` global puis filtrent partiellement les résultats. Vérifier également les agrégats, caches et exports : filtrer les lignes visibles sans filtrer les totaux n’est pas suffisant.

---

# 9. Matrice de revue de code ciblée

Cette section transforme les points de revue connus en vérifications à confirmer sur le commit candidat. Ce ne sont pas tous des vulnérabilités confirmées.

| ID | Zone à inspecter | Question de revue | Critère de validation | Statut initial |
|---|---|---|---|---|
| REV-001 | `DashboardService.ts` | Les vues exécutives, comité et rapports utilisent-elles toutes le scope pour les KRI, alertes et agrégats ? | Tous les chemins passent le scope autorisé, y compris scope vide | À vérifier/corriger |
| REV-002 | `DashboardService.ts` | Le filtre d’entité fourni par l’utilisateur est-il intersecté avec les entités autorisées ? | Aucun filtre utilisateur ne peut élargir le périmètre | À vérifier |
| REV-003 | `RaciAssignmentService.ts` | Le destinataire est-il actif et rattaché au même tenant que l’objet ? | Validation serveur et cohérence DB | À vérifier |
| REV-004 | `RaciAssignmentService.ts` | Le conflit R/A est-il vérifié pour les deux ordres de création/modification ? | Tests couvrant R puis A, A puis R, modification et concurrence | À vérifier |
| REV-005 | Migration audit | Les permissions DB empêchent-elles la modification/suppression des journaux par le rôle applicatif ? | Droits minimaux ou mécanisme compensatoire documenté | À vérifier |
| REV-006 | Service de preuves | Le type réel du fichier est-il contrôlé, et l’antivirus/quarantaine est-il présent si requis ? | Pipeline de validation documenté et testé | À vérifier |
| REV-007 | Routes preuves | Chaque accès/download vérifie-t-il le tenant et le périmètre de l’objet lié ? | Tests négatifs sur URL directe et ID substitué | À vérifier |
| REV-008 | Workflow CI | Les dépendances sont-elles installées à partir des lockfiles ? | Installation reproductible | À corriger si confirmé |
| REV-009 | Workflow CI | Les échecs des scanners sécurité peuvent-ils être ignorés ? | Seuils de blocage explicites, pas d’échec silencieux | À vérifier |
| REV-010 | Auth Google | Le serveur vérifie signature, issuer, audience, expiration et identité attendue ? | Tests d’intégration négatifs pour chaque validation | À vérifier |
| REV-011 | Google Drive | Le scope OAuth est-il limité au strict nécessaire ? | Scope minimal documenté et testé | À vérifier |
| REV-012 | Seuils d’appétence | Les méthodes de lecture et d’évaluation ignorent-elles toutes les règles inactives ? | Test de non-régression pour seuil désactivé | À vérifier |
| REV-013 | SQL/repositories | Les filtres tenant/périmètre sont-ils imposés sur tous les chemins de lecture et écriture ? | Matrice endpoint/service/repository revue | À vérifier |
| REV-014 | Cache | Les clés de cache incluent-elles le périmètre et les permissions effectives ? | Test de changement de rôle/tenant sans fuite | À vérifier |

---

# 10. Matrice des outils et automatisations

Les outils proposés sont des moyens de preuve, pas des substituts à la revue métier.

| Domaine | Outil possible | Mode | Fréquence | Critère de réussite |
|---|---|---|---|---|
| Tests unitaires/intégration | Framework déjà utilisé par le projet | CI | Chaque PR | Tous les tests requis passent |
| Couverture | Couverture intégrée au framework | CI | Chaque PR | Seuil défini pour modules critiques ; ne pas utiliser la couverture seule comme preuve de sécurité |
| SAST | Semgrep ou outil équivalent | CI | Chaque PR | Aucun finding bloquant non traité |
| SCA | npm audit / OSV-Scanner / outil équivalent | CI | Chaque PR et quotidien | Vulnérabilités triées selon sévérité et exploitabilité |
| Secrets | Gitleaks ou équivalent | CI + historique | Chaque PR et périodique | Aucun secret actif exposé |
| DAST | OWASP ZAP ou équivalent | Staging | À chaque version candidate et périodiquement | Résultats examinés, aucun P0/P1 non traité |
| API | Tests contractuels et tests d’autorisation | CI/staging | Chaque PR | Toutes les routes sensibles couvertes |
| Fuzzing | Fuzzer adapté aux API/parseurs | Staging/CI ciblée | Périodique et après changement sensible | Pas de crash exploitable ni contournement de validation |
| Conteneurs | Trivy ou équivalent | CI | Chaque build | Images scannées, seuil de blocage défini |
| Configuration Cloud | Revue IAM/config et outil IaC si applicable | Préproduction | Chaque changement d’infrastructure | Aucune permission critique injustifiée |
| PostgreSQL | Scripts de vérification + revue des rôles | Préproduction | Chaque release majeure | Moindre privilège et migrations validés |
| Charge | k6, Artillery ou outil équivalent | Staging | Avant mise en production et après changement majeur | Objectifs de latence/erreur respectés |
| Sauvegarde | Procédure et test de restauration | Environnement isolé | Selon RPO/RTO approuvés | Restauration réussie et mesurée |

**Configuration CI recommandée :**
- Bloquer la fusion si les tests de contrôle d’accès, d’isolation tenant, de workflow critique ou les tests unitaires obligatoires échouent.
- Ne pas rendre un scanner « non bloquant » sans règle de dérogation, propriétaire, date d’expiration et justification.
- Générer un rapport de test attaché au commit/à la PR.
- Épingler les actions tierces à des versions immuables selon la politique de sécurité du dépôt.
- Garder les secrets hors du code et limiter leur exposition aux jobs qui en ont besoin.
- Distinguer les résultats d’outil confirmés, les faux positifs validés et les tests non exécutés.

---

# 11. Déroulement d’une campagne

## Phase 0 — Préparation

1. Identifier le commit exact et la version déployée.
2. Confirmer les endpoints et les rôles réels à partir du code courant.
3. Construire la matrice rôle × ressource × action × tenant × département.
4. Préparer deux tenants synthétiques, plusieurs départements et tous les profils.
5. Définir les seuils de charge, RPO/RTO, taille maximale de fichier et durée de révocation.
6. Obtenir l’autorisation des tests dynamiques et fixer les limites.
7. Vérifier les sauvegardes et la possibilité de restaurer staging.

**Livrable :** fiche de campagne validée.

## Phase 1 — Tests bloquants P0

Exécuter SEC-001 à SEC-012, les tests critiques RACI, les transitions métier sensibles, l’audit des opérations critiques et les tests DASH-001 à DASH-010.

**Condition de sortie :** aucun accès non autorisé confirmé, aucun contournement de workflow critique, aucune fuite inter-tenant/périmètre.

## Phase 2 — Tests P1

Authentification, uploads, validation API, DB, CI/CD, conteneurs, cloud, intégrations et résilience.

**Condition de sortie :** aucune vulnérabilité P1 non corrigée sans dérogation formelle.

## Phase 3 — Tests P2 et robustesse

Charge, exports volumineux, performance, ergonomie des erreurs, tests de migration étendus et amélioration continue.

**Condition de sortie :** objectifs de performance et de disponibilité approuvés ; risques résiduels acceptés par le propriétaire désigné.

## Phase 4 — Re-test et clôture

1. Réexécuter les tests échoués après correction.
2. Ajouter un test de non-régression pour chaque vulnérabilité confirmée.
3. Vérifier les preuves et le commit corrigé.
4. Mettre à jour le registre des constats.
5. Obtenir l’acceptation des risques résiduels.
6. Publier un rapport final avec conclusion limitée aux tests effectivement exécutés.

---

# 12. Fiche de test standard

Utiliser cette fiche pour chaque test.

| Champ | Valeur à renseigner |
|---|---|
| ID du test | Ex. SEC-001 |
| Nom | Description courte |
| Référentiel | ASVS / WSTG / API Top 10 / exigence interne |
| Commit / version | Hash exact et tag si disponible |
| Environnement | CI, staging ou production autorisée |
| Préconditions | Comptes, rôles, données synthétiques et configuration |
| Étapes | Étapes reproductibles |
| Requête / action | Endpoint, méthode, paramètres, action UI |
| Résultat attendu | Contrôle attendu |
| Résultat observé | Comportement réel |
| Verdict | Réussi / Échoué / Bloqué / Non testé / N/A justifié |
| Gravité | P0 / P1 / P2 / P3 |
| Preuve | Référence de log, capture expurgée, sortie d’outil ou test |
| Défaut associé | Ticket/issue |
| Correctif | Commit/PR de correction |
| Re-test | Date, version et résultat |
| Testeur / réviseur | Nom ou identifiant professionnel |
| Commentaires | Limites et observations |

---

# 13. Modèle de registre des constats

| ID | Constat | Actif concerné | Référentiel | Gravité | Preuve | Impact | Cause racine | Correctif | Responsable | Échéance | Statut | Risque résiduel |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FIND-001 | À compléter après test | API / Dashboard / DB | Référence applicable | P0–P3 | Lien de preuve | À documenter | À documenter | À documenter | À attribuer | À fixer | Ouvert | À évaluer |

Ne pas créer un constat de vulnérabilité uniquement parce qu’une vérification manque. Distinguer :
- **Vulnérabilité confirmée :** un test reproductible démontre le défaut.
- **Écart de conception :** un contrôle requis est absent ou insuffisamment défini.
- **Point à vérifier :** les éléments disponibles ne permettent pas de conclure.
- **Faux positif :** analyse documentée montrant que le résultat ne constitue pas un défaut dans le contexte.
- **Risque accepté :** décision formelle, temporaire si possible, avec responsable et date d’expiration.

---

# 14. Critères de sortie et décision de mise en production

La campagne peut être proposée à validation lorsque tous les points suivants sont remplis :

- [ ] Les tests P0 sont exécutés et réussis.
- [ ] Aucun accès inter-tenant ou hors périmètre n’est confirmé.
- [ ] Les dashboards, agrégats et exports respectent les mêmes périmètres que les endpoints sources.
- [ ] Les permissions RBAC, les affectations RACI et les règles de séparation des tâches sont testées.
- [ ] Les actions métier critiques sont auditées et leur cohérence transactionnelle est vérifiée.
- [ ] Les preuves ne sont accessibles qu’aux utilisateurs autorisés ; la validation des fichiers est documentée.
- [ ] Les migrations ont été testées sur une base vide et une base de mise à niveau représentative.
- [ ] Les scans SAST, SCA, secrets et conteneurs ont été exécutés ; les résultats sont triés.
- [ ] Les configurations de déploiement, IAM, secrets et bases sont revues.
- [ ] La sauvegarde et la restauration ont été testées et les RPO/RTO mesurés.
- [ ] Les défauts P1 sont corrigés ou font l’objet d’une dérogation formelle approuvée.
- [ ] Les tests de non-régression associés aux corrections sont intégrés à la CI.
- [ ] Le rapport final identifie clairement les limites et les tests non exécutés.

**La validation finale de mise en production appartient au propriétaire du produit et aux responsables sécurité/risques désignés.** Le présent document ne vaut ni certification, ni pentest réussi, ni attestation de conformité réglementaire.

---

# 15. Livrables attendus

1. Plan de campagne validé et périmètre exact.
2. Matrice de couverture des référentiels.
3. Matrice de tests détaillée avec résultats et preuves.
4. Rapport SAST/SCA/secret scanning/scan conteneur.
5. Rapport de tests API et contrôle d’accès.
6. Rapport de revue PostgreSQL et migrations.
7. Checklist Cloud/Docker/Google Drive, si applicable.
8. Registre des constats et plan de remédiation.
9. Rapport de re-test après corrections.
10. Rapport final de sécurité et décision de mise en production.
11. Tests de non-régression intégrés au pipeline CI.

---

# 16. Répartition indicative des responsabilités

| Activité | Développeur | QA / testeur | Responsable sécurité / risques | DevOps / DB | Product Owner |
|---|---|---|---|---|---|
| Préparer les données synthétiques | C | R | A | C | I |
| Définir les règles d’accès et périmètres | C | C | R | I | A |
| Écrire les tests unitaires et intégration | R | C | C | I | I |
| Exécuter tests API/DAST autorisés | C | R | A | C | I |
| Revue IAM, conteneurs et CI/CD | C | C | A | R | I |
| Revue PostgreSQL et migrations | C | C | A | R | I |
| Qualifier les constats | C | R | A | C | I |
| Corriger le code | R | C | C | C | I |
| Accepter un risque résiduel | I | C | R | C | A |
| Décision de mise en production | C | C | R | C | A |

**R = Réalise ; A = Responsable final/valide ; C = Consulté ; I = Informé.** Cette matrice doit être ajustée à l’organisation réelle.

---

# 17. Réserves et hypothèses

- Ce cahier des charges est basé sur le périmètre technique décrit et sur des points de revue préliminaires. Les chemins exacts, noms de routes, modèles de données et versions de frameworks doivent être confirmés sur le commit candidat.
- Les constats initiaux dans la matrice de revue sont des points à vérifier, sauf ceux démontrés par un test reproductible.
- Les versions exactes des référentiels doivent être consignées dans le rapport de campagne au moment de l’exécution.
- Un scan automatique seul ne prouve pas l’absence de vulnérabilité.
- Une revue de code seule ne prouve pas que le comportement runtime est sûr.
- Un test réussi dans un environnement différent de la production doit être accompagné des différences de configuration connues.
- Toute modification du modèle de tenant, des rôles, du RACI, des dashboards, des exports, de l’authentification, du stockage de preuves ou des migrations doit déclencher une campagne de régression ciblée.

---

## Annexe A — Ordre d’exécution conseillé

1. SEC-001 à SEC-012 : isolation et autorisation.
2. DASH-001 à DASH-010 : dashboards, KRI et rapports.
3. RACI-001 à RACI-010 : permissions et séparation des tâches.
4. GRC-001 à GRC-015 : règles métier.
5. AUD-001 à AUD-010 : audit.
6. EVD-001 à EVD-012 : preuves et fichiers.
7. AUTH-001 à AUTH-012 : authentification/session.
8. DB-001 à DB-014 : base et migrations.
9. WEB-001 à WEB-012 : API et sécurité web.
10. SUP-001 à SUP-010 : CI/CD et dépendances.
11. INF-001 à INF-012 : infrastructure.
12. RES-001 à RES-010 : résilience et performance.

## Annexe B — Format minimal d’un test automatisé de contrôle d’accès

Pour chaque endpoint sensible, prévoir au minimum :
- une requête autorisée par un profil qui possède le droit ;
- une requête refusée par un profil du même tenant mais hors périmètre ;
- une requête refusée par un profil d’un autre tenant ;
- une requête refusée sans authentification ;
- une requête refusée après révocation du droit, selon le délai défini ;
- une vérification de l’état final de la base pour confirmer qu’aucune modification n’a eu lieu ;
- une vérification que la réponse et les logs ne révèlent pas de données sensibles.

Le test doit aussi couvrir les agrégats, exports, caches, sous-ressources et chemins alternatifs, pas seulement la route principale.
