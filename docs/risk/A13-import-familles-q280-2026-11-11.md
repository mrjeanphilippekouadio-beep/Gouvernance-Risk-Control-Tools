# A13 : import d'un fichier texte « familles et sous-catégories » (réponse du PO à q280, DECISION-133)

- Auteur : A13 (Risk Manager), 2026-11-11
- Statut : **PROPOSITION, à valider par le PO.** Aucun code modifié.
- Besoin : mes seuils d'appétence des Dispositifs par défaut sont donnés par famille de risque (`A13-dispositifs-par-defaut-B13-2026-11-11.md` §6). Chaque client a ses propres sous-catégories. Le PO propose un fichier texte simple, avec des vérifications à l'import.
- Sources lues : `backend/src/domain/entities/RiskCategory.ts`, migration `024_config.sql` (table `risk_categories`), `RiskFramework.ts` / `frameworkAppetite.ts` (entrées d'appétence), `RiskImportService.ts` (import Excel existant : sans état, aperçu puis validation, 2000 lignes max), spec B-6 §2.2 (appétence en jsonb, 200 entrées max).

## 1. Ce qui existe aujourd'hui (faits)

- Les catégories sont dans `risk_categories` : `id`, `tenant_id`, `name`, `parent_id` (NULL = catégorie de premier niveau, sinon sous-catégorie), `active`. Un niveau de profondeur en pratique.
- Aucune colonne « famille de risque » dans cette table. Aucune contrainte d'unicité du nom visible dans les migrations lues (hypothèse : deux sous-catégories de même nom sont possibles, à vérifier par A07).
- Une entrée d'appétence d'un Dispositif porte `subCategory`, `subCategoryId`, `entity`, `threshold`, `description`. Au plus 200 entrées par version, `(subCategory, entity)` unique, `subCategoryId` doit être du tenant.
- Le lien « sous-catégorie du client vers famille de risque » n'est donc stocké nulle part. C'est ce que le fichier doit fournir.

Deux mots à ne pas confondre :
- **Famille d'appétence** : l'une des 12 familles de la taxonomie du mandat (Stratégique, Financier, Opérationnel, Technologique, Conformité, Fraude, Cybersécurité, Tiers, Continuité, Capital humain, Données et vie privée, Réputation). Liste fixe, c'est la clé de mes seuils.
- **Catégorie / sous-catégorie du client** : l'arbre `risk_categories` du client.

Le fichier relie la seconde à la première.

## 2. Format proposé (le plus simple possible)

Un fichier `.txt` : une ligne = un rattachement.

```
famille;sous-catégorie
```

Règles :
| Point | Choix | Raison |
|---|---|---|
| Encodage | UTF-8 (BOM toléré). Autre encodage : refus avec message clair, aucune détection automatique | Deviner l'encodage abîme les accents sans le dire. |
| Séparateur | Point-virgule `;` | Les noms français contiennent des virgules. Excel français exporte en `;`. |
| Fin de ligne | LF ou CRLF | Les deux existent selon le poste. |
| En-tête | Aucun. Une première ligne qui n'est pas une famille connue sera signalée comme erreur | Un fichier sans en-tête est plus simple à écrire à la main. |
| Commentaires | Ligne commençant par `#` ignorée | Permet de documenter le fichier. |
| Lignes vides | Ignorées | Tolérance sans risque. |
| Espaces | Retirés en début et fin de champ | |
| Famille | Libellé français de la liste, insensible à la casse et aux accents ; le code anglais (`COMPLIANCE`) est accepté aussi | Simple pour le client, stable pour l'outil. |
| Colonne 3 facultative | `catégorie parente` | Sert seulement à lever une ambiguïté si deux sous-catégories portent le même nom. |
| Guillemets | Non gérés. Un `;` dans un nom est interdit | Évite un analyseur CSV complet, source d'erreurs. Le message d'erreur le dit. |
| Taille | 64 Ko maximum, 200 lignes de données maximum, 120 caractères par champ | 200 = plafond d'entrées d'appétence d'une version (spec B-6). 120 = longueur max d'un nom de Dispositif. |

Exemple complet :

```
# Rattachement des sous-catégories de risque aux familles d'appétence
# Format : famille;sous-catégorie[;catégorie parente]
Conformité;Lutte contre le blanchiment (LBC-FT)
Conformité;Sanctions et gel des avoirs
Conformité;Reporting réglementaire
Fraude;Fraude interne
Fraude;Fraude sur transactions mobiles
Fraude;Usurpation d'identité client
Cybersécurité;Accès non autorisé
Cybersécurité;Rançongiciel
Données et vie privée;Fuite de données clients
Données et vie privée;Conservation des données au-delà de la durée prévue
Financier;Risque de liquidité
Financier;Écart de réconciliation
Tiers;Défaillance d'un opérateur de paiement
Tiers;Dépendance à un fournisseur cloud
Continuité;Indisponibilité du service de paiement
Opérationnel;Erreur de traitement manuelle
Technologique;Obsolescence d'un système
Capital humain;Départ d'une personne clé
Réputation;Publication négative sur les réseaux
Stratégique;Échec d'un lancement de produit
Opérationnel;Incident;Risques opérationnels
```

La dernière ligne montre la colonne facultative.

Le fichier ne contient **aucun seuil chiffré**. Les valeurs viennent du Dispositif choisi. Un fichier ne peut donc ni alléger ni durcir l'appétence : il ne dit que « à quelle famille appartient cette sous-catégorie ».

## 3. Vérifications à l'import

Tout est vérifié sur le serveur, jamais sur la seule saisie du navigateur. Chaque message donne le numéro de ligne.

### 3.1 Contrôles du fichier (avant lecture)

| Contrôle | Résultat si échec |
|---|---|
| Extension `.txt` et type `text/plain` | Refus |
| Taille ≤ 64 Ko, mesurée sur le flux reçu et non sur l'en-tête | Refus (comme la leçon de l'import Excel : plafonner avant de charger) |
| Pas d'octet NUL, pas d'en-tête de fichier compressé (`PK`, `%PDF`, etc.) | Refus : ce n'est pas du texte |
| UTF-8 valide | Refus avec la ligne fautive |
| Au plus 200 lignes de données | Refus, nombre indiqué |

### 3.2 Contrôles ligne par ligne

| Cas | Gravité | Comportement |
|---|---|---|
| Nombre de champs différent de 2 ou 3 | Erreur | Ligne rejetée |
| Champ vide | Erreur | |
| Champ de plus de 120 caractères, caractère de contrôle | Erreur | |
| Famille inconnue | Erreur | Message avec les 3 familles les plus proches (par l'orthographe) |
| Sous-catégorie absente du référentiel du client | Erreur | « À créer dans le référentiel » : aucune création automatique (voir section 4) |
| Sous-catégorie inactive (`active = false`) | Avertissement | Rattachée mais signalée |
| Sous-catégorie qui est en réalité une catégorie de premier niveau (`parent_id` NULL) | Erreur | Une entrée d'appétence est portée par une sous-catégorie |
| Deux sous-catégories du client de même nom, sans catégorie parente en colonne 3 | Erreur | Demander la colonne 3 |
| Catégorie parente de la colonne 3 inconnue ou qui ne correspond pas | Erreur | |
| Même ligne deux fois (même famille, même sous-catégorie) | Avertissement | Dédoublonnée |
| **Même sous-catégorie dans deux familles différentes** | **Erreur** | Une sous-catégorie a une seule famille, sinon l'appétence serait ambiguë |
| Plus de 200 sous-catégories rattachées au total | Erreur | Plafond du Dispositif |

### 3.3 Contrôles de cohérence (au niveau du fichier)

| Cas | Gravité | Comportement |
|---|---|---|
| Sous-catégorie active du client absente du fichier | Information | Listée : « sans appétence définie ». Elle n'aura pas d'entrée |
| Aucune ligne valide | Erreur | Rien à importer |
| Famille d'appétence stricte (Conformité, Fraude, Cybersécurité, Données) sans aucune sous-catégorie | Avertissement | Probable oubli : le client n'aurait aucune limite sur ses risques les plus sensibles |
| Entrée d'appétence déjà présente et saisie par le client dans la version brouillon | Information | Conservée telle quelle, jamais écrasée (section 5) |

Règle de décision : **une seule erreur bloquante empêche toute écriture.** Tout ou rien, dans une seule transaction.

## 4. Comportement : aperçu puis validation

1. **Aperçu, sans écriture.** Comme l'import Excel existant : le serveur relit le fichier, retourne le détail ligne par ligne (acceptée, avertissement, erreur) et un résumé : « 18 sous-catégories rattachées, 2 avertissements, 0 erreur, 4 sous-catégories du client sans famille ». Aucune écriture, aucun état conservé côté serveur.
2. **Validation.** Le client renvoie le même fichier avec l'empreinte (hash) de l'aperçu. Le serveur refait **toutes** les vérifications (le référentiel a pu changer entre-temps) et refuse si l'empreinte ne correspond pas ou si une erreur apparaît.
3. **Droits.** Permission du même niveau que la modification d'un brouillon de Dispositif (`riskframework.update`, à confirmer par A06). Le tenant vient toujours de l'utilisateur connecté, jamais du fichier.
4. **Audit.** Une ligne d'audit par import : qui, quand, empreinte du fichier, nombre de lignes, nombre d'entrées créées. Le contenu intégral n'est pas recopié (le fichier ne doit pas contenir de données personnelles : le dire à l'écran).
5. **Jamais d'exécution du contenu.** Le fichier est lu comme des lignes de texte. Aucune interprétation de formule. À l'export éventuel, un nom qui commence par `=`, `+`, `-`, `@` doit être neutralisé (même règle que l'import Excel).

## 5. Ce que produit l'import

**Option recommandée : correspondance seulement, sans création de sous-catégories.**

| Élément | Comportement proposé |
|---|---|
| Sous-catégories du client | **Aucune création, aucune modification.** Une sous-catégorie manquante est une erreur : le client la crée par l'écran du référentiel existant, puis relance l'aperçu. |
| Écriture | Dans le **brouillon** de version du Dispositif choisi uniquement (jamais dans une version active : elle est immuable). Une entrée d'appétence par sous-catégorie rattachée. |
| Valeur de chaque entrée | Le seuil de la famille pour ce Dispositif (§6 du document B-13). Strict ou modéré selon la famille. Dans les mêmes limites que le Dispositif : seuil ≤ n². |
| Marquage | Description : « valeur de départ à confirmer ». |
| Entrées déjà saisies par le client | **Conservées, jamais écrasées.** Un import ne peut donc pas abaisser un seuil en silence (invariant : appétence non masquable). L'aperçu les liste comme « conservées ». |
| Activation | Le brouillon suit le circuit normal d'approbation. L'import ne rend rien actif et ne décide rien. |
| Famille stockée ? | **Non** : le schéma n'a pas de colonne pour cela. Les entrées créées sont figées dans la version (jsonb). Une sous-catégorie ajoutée plus tard n'a pas d'entrée tant qu'on ne relance pas un import. |

Pourquoi ne pas créer les sous-catégories manquantes :
1. Créer des sous-catégories est une écriture dans le référentiel, qui a ses propres droits et son propre audit. Un import ne doit pas contourner ces droits.
2. Il faudrait une catégorie parente pour chacune : une décision de taxonomie du client, pas du fichier.
3. Une faute de frappe dans le fichier créerait silencieusement une catégorie en double. C'est le risque principal d'une création automatique.
4. Gain pour le client : un aller-retour de moins. Coût : des doublons dans le référentiel, difficiles à défaire (suppression douce uniquement).

Lacunes du schéma, « à ajouter, à arbitrer » (non nécessaires pour la première version) :
- une colonne ou table portant la famille de chaque sous-catégorie, pour que les nouvelles sous-catégories suivent la règle sans relancer d'import ;
- un indicateur « sous-catégories actives sans appétence » pour le panel (aujourd'hui le panel ne peut pas le calculer sans cette donnée, il doit afficher « non évaluable », jamais « respecté »).

## 6. Comment l'appétence par famille s'applique ensuite

1. Le client choisit un Dispositif (Standard par défaut).
2. Il importe son fichier. L'aperçu puis la validation créent les entrées dans le brouillon.
3. Pour chaque ligne : famille stricte → seuil « faible » du Dispositif ; autre famille → seuil « modéré ». Valeurs par Dispositif : voir B-13 §6 (à jour après le choix des libellés de la section 12.4 de ce document).
4. Le brouillon est soumis au circuit d'approbation, puis activé.
5. Les évaluations comparent le score résiduel au seuil de l'entrée de leur sous-catégorie (`frameworkAppetite.ts`, par `subCategoryId`).
6. Une sous-catégorie sans entrée donne « appétence non définie », jamais « dans l'appétence ».
7. Changer un seuil plus tard = nouvelle version du Dispositif, approuvée (règle existante). Relancer l'import ajoute les entrées manquantes mais ne touche pas aux autres.

## 7. KRI suggérés

- Part des sous-catégories actives sans entrée d'appétence (cible : zéro sur les familles strictes).
- Nombre d'entrées « valeur de départ à confirmer » jamais confirmées, avec leur ancienneté.

## 8. Points qui demandent une décision du PO

Un seul vrai choix : créer ou non les sous-catégories manquantes, et la question liée de stocker ou non la famille. Le reste (format, contrôles, aperçu puis validation, tout ou rien, entrées client jamais écrasées) découle de principes déjà décidés et n'a pas besoin de votre arbitrage.

## Question au PO

**Titre : Import du fichier « familles et sous-catégories » : créer les sous-catégories manquantes ? (suite de q280, DECISION-133)**

**Contexte.**
Vous proposez d'importer un fichier texte pour relier les sous-catégories de chaque client à nos familles de risque, et donc appliquer l'appétence par famille. J'ai prévu un fichier d'une ligne par rattachement (`famille;sous-catégorie`, UTF-8, séparateur point-virgule, 200 lignes et 64 Ko au maximum), un aperçu sans écriture puis une validation, et tout refusé dès qu'une erreur bloquante existe. L'import écrit seulement dans le brouillon du Dispositif, sans valeur chiffrée dans le fichier, et ne remplace jamais une valeur saisie par le client. Le schéma ne stocke pas la famille : les seuils sont figés dans la version. Détail : `docs/risk/A13-import-familles-q280-2026-11-11.md`.

**Options.**
- **A (recommandée) : correspondance seulement.** Une sous-catégorie qui n'existe pas dans le référentiel est une erreur ; le client la crée par l'écran habituel, puis relance. Aucune famille stockée, une sous-catégorie ajoutée plus tard n'a pas d'entrée tant que l'import n'est pas relancé.
- **B : correspondance et création des sous-catégories manquantes**, avec une troisième colonne obligatoire « catégorie parente » et une confirmation explicite dans l'aperçu. Droit de création du référentiel exigé.
- **C : A, plus stockage de la famille dans le référentiel** (changement de schéma) pour que les nouvelles sous-catégories héritent de leur appétence. À prévoir pour une version ultérieure.

**Recommandation : option A.** Elle évite les doublons silencieux dus à une faute de frappe et ne contourne pas les droits du référentiel. Le surcoût pour le client est un aller-retour. L'option C pourra suivre si le manque de couverture se vérifie à l'usage.
