# QA import « familles et sous-catégories » (q280 / q283, DECISION-133 et 135 A)

Date : 2026-11-12. Agent A08. Code testé : `a03d826` (branche `feat/r1-import-familles`, base staging 4526d31). Cadrage : `docs/risk/A13-import-familles-q280-2026-11-11.md`. Tests sur `qa/import-familles`.
Ce PASS signifie uniquement que les critères QA couverts sont satisfaits dans l'environnement testé. Pas un avis Security, Privacy, Compliance ni Risk.
Environnement : PostgreSQL 16 local 127.0.0.1:55442 (jamais Neon), base vierge 001 à 091, vrai serveur tsx, Chromium Playwright.

## Verdict : PARTIAL_PASS (un MAJOR, deux MINOR, un TRIVIAL)

Les contrôles du cadrage tiennent un par un. Mais la course signalée par A06 est réelle et mesurée : elle écrase silencieusement une entrée saisie par le client, ce qui contredit l'invariant « valeur client jamais écrasée ».

## Constats

| Id | Gravité | Sujet | Preuve |
|---|---|---|---|
| QA-IMP-01 | MAJOR | **Perte d'une édition cliente par un import concurrent.** `commit` lit le brouillon, puis écrit `[...existant lu avant, ...nouvelles]` par `updateDraft`, qui fait un UPDATE inconditionnel du tableau complet (pas de verrou, pas de comparaison de version ni de `updated_at`). Une édition du même brouillon enregistrée entre la lecture et l'écriture est écrasée sans erreur ni trace : le client a reçu 200, son entrée a disparu. Mesure : 30 courses commit // enregistrement d'une entrée cliente (décalages de 0 à 8 ms), les deux répondent 200 : 9 fois les deux entrées présentes, **13 fois l'entrée cliente perdue**, 8 fois l'import perdu (l'enregistrement client, qui remplace le tableau entier par construction, passe après). Le 2e cas est la sémantique « tableau complet » de l'enregistrement et pas propre à l'import ; le 1er est propre à l'import et viole la règle du cadrage §5. La fenêtre est de quelques millisecondes à l'usage normal, mais l'écran invite à enregistrer puis importer, et l'aperçu peut précéder le commit de plusieurs minutes (la relecture au commit couvre le référentiel, pas le brouillon). Correction suggérée : lire et écrire sous `SELECT … FOR UPDATE` (ou comparer `updated_at` et répondre 409), ou fusionner côté base. | `QA-Import.test.ts` R1 (`it.fails`), R2 (UPDATE inconditionnel vérifié sur la source) |
| QA-IMP-02 | MINOR | **Audit d'import hors transaction.** La ligne d'audit « IMPORT_FAMILIES » est écrite après `updateDraft`. Si elle échoue, le client reçoit un 5xx alors que les entrées sont déjà écrites (2 entrées mesurées) : une relance voit « Conservée » partout. L'écriture reste tracée par l'audit de `updateDraft` (atomique), seule l'empreinte de l'import manque. Même famille que QA-B6C-03. | `it.fails` S4b ; S4a (panne sur l'UPDATE de la version : 5xx et rien d'écrit) passe |
| QA-IMP-03 | MINOR (front) | **Refus métier 403 silencieux.** Le panneau fait `if (!isForbidden(err)) setError(...)` : tout 403 est avalé, y compris « Réservé aux membres du groupe Risk Manager ». Un compte qui a `riskframework.update` sans être membre du groupe passe l'aperçu (200) puis, au clic sur « Confirmer l'import », ne voit rien (ni panneau, ni fenêtre, ni bannière) ; la base est bien inchangée. Même défaut que QA-B6C-07. | Navigateur W6.2 (FAIL) |
| QA-IMP-04 | TRIVIAL | Un 403 devrait être le même à l'aperçu et à la confirmation : l'aperçu n'exige pas l'appartenance au groupe RM (200 pour `adm`), le commit si (403). | S3, W6.1 |

Observations INFO :
- Une entrée d'appétence ancienne sans `subCategoryId` (avant q133) bloque tout commit qui ajoute quelque chose (400 « chaque seuil doit désigner une catégorie de risque ») ; un brouillon qui n'en a que de telles lignes avec des lignes déjà présentes (tout « Conservée ») passe. Même règle que l'enregistrement du brouillon, message clair.
- Une sous-catégorie inactive est un AVERTISSEMENT et n'est pas rattachée (aucune entrée), alors que le cadrage §3.2 disait « rattachée mais signalée » ; le code l'explique (une entrée exige une sous-catégorie active) : à confirmer avec A13.
- Type MIME : `text/plain; charset=utf-8` est accepté (200). Un champ de formulaire supplémentaire est toléré à l'aperçu (la limite compte un champ non fichier).
- Caractères bidirectionnels et zéro-largeur dans un nom sont traités comme du texte (la sous-catégorie est introuvable donc rien n'est écrit) ; ils seraient répétés dans l'écho de l'aperçu (non exploitable ici).
- `normalizeLabel` remplace tirets, soulignés et espaces multiples par un espace : deux sous-catégories qui ne diffèrent que par là sont des « homonymes » (erreur demandant la catégorie parente), jamais fusionnées en silence.
- Limiteur : 30 appels par quart d'heure et par IP sur les deux routes ; au-delà 429 propre.
- Non fait : mutation testing.

## Contrôles du cadrage (3.1, 3.2, 3.3, 4, 5) : résultats

- **Fichier (F)** : valide accepté, BOM, CRLF, commentaires et lignes vides tolérés ; refus 400 avec message clair pour vide, octet NUL, signatures PK, %PDF, gzip, OLE, UTF-16, Latin-1 (la ligne fautive est citée), UTF-8 surlongue, substitut isolé, extension `.csv` / absente / `.txt.exe`, type `application/octet-stream` ou `text/csv`, à l'aperçu comme au commit ; 64 Ko exactement accepté, 64 Ko + 1 et 3 Mo refusés en 4xx jamais 500 (plafond sur le flux) ; deux fichiers, fichier absent, corps JSON : 4xx jamais 500 ; 200 lignes de données acceptées, 201 refusées en 400 avec le nombre.
- **Lignes (L)** : 1 et 4 champs, champ vide (début et fin), plus de 120 caractères (120 exactement accepté), tabulation interne, BEL, DEL, NEL : erreur avec numéro de ligne. Famille en français, sans accent, en majuscules, avec espaces, code anglais : acceptées ; inconnue : erreur avec les 3 plus proches. Sous-catégorie absente (rien n'est créé : nombre de catégories inchangé), de premier niveau, homonyme sans parent, parent faux, parent correct (casse et accents ignorés). Deux familles pour une sous-catégorie : erreur à la 2e ligne qui cite la 1re ; même famille deux fois : avertissement ; inactive : avertissement, aucune entrée. Injections (`=`, `+`, `-`, `@`, balise, SQL, bidi, zéro-largeur) : traitées comme du texte, jamais exécutées, aucune écriture.
- **Cohérence** : sous-catégories actives absentes du fichier listées, inactives non ; familles strictes sans sous-catégorie signalées ; aucune ligne valide = erreur.
- **Aperçu sans écriture** : version, audit (toutes entités) et notifications strictement inchangés.
- **Tout ou rien** : une seule erreur et d'autres lignes valides : commit 400, rien d'écrit.
- **Commit** : empreinte mal formée, absente, vide, tronquée : 400 ; différente (un octet) : 409 ; majuscules acceptées. Seuils de l'échelle 5x5 : 4 (familles strictes) et 9 (autres) ; mention « valeur de départ à confirmer », `subCategoryId`, entité nulle ; version reste DRAFT ; le référentiel de catégories n'est jamais écrit. Valeur client conservée (autre seuil, autre description, entrée avec entité, entrée hors fichier) ; rejeu : 0 créée, aucun doublon ; référentiel modifié entre l'aperçu et le commit (même fichier, même empreinte) : tout est revérifié (sous-catégorie désactivée : ignorée ; supprimée : 400 sans écriture). Plafond : 199 entrées + 2 nouvelles : erreur « plus de 200 », 199 + 1 accepté. Entrée ancienne sans identifiant : conservée sans doublon.
- **Audit** : une ligne d'import (empreinte, nombre de lignes, créées, conservées ; aucun nom de sous-catégorie ni contenu) et celle de l'écriture du brouillon (atomique). Panne d'audit sur l'écriture : 5xx et rien d'écrit.
- **Version, tenant, droits** : version ACTIVE ou ARCHIVED refusée (400, « brouillon ») à l'aperçu et au commit ; version ou Dispositif inconnus : 404 ; identifiants non uuid : 400. Un RM d'un autre tenant avec les identifiants de T : 404 identique à un identifiant inconnu ; avec ses propres identifiants et des noms de T : « absente du référentiel » (aucune fuite des catégories de T) et ses entrées portent ses propres identifiants ; T inchangé. Sans jeton 401 ; compte simple, Audit, `process.update` seul : 403 aux deux routes ; un autre RM que l'auteur du brouillon peut importer.

## Navigateur (`tests/integration/qa-import-playwright.mjs`) : 25 / 26

Panneau présent (format, limites, mise en garde) ; fichier à erreurs : « rien n'a été écrit », chaque verdict affiché, aucun bouton de confirmation, base et audit inchangés ; refus d'emblée affichés dans le panneau (Latin-1 avec la ligne, vide, `.csv`, binaire) ; fichier valide : aperçu (seuils 4 et 9, familles strictes signalées, sous-catégories sans famille listées), « Confirmer l'import de 4 entrées », « Import terminé », entrées dans le formulaire avec la mention, base conforme ; réimport : 4 conservées, 0 acceptée, pas de bouton ; zéro erreur JS. Échec : W6.2 (QA-IMP-03).

## Exécution

- `QA-Import.test.ts` (`QA_IMP_LIVE=1`, port 8096, base `grc_qa_imp`) : 26 tests, 24 pass + 2 `it.fails` (QA-IMP-01 R1, QA-IMP-02 S4b). Le serveur tourne avec `TRUST_PROXY_HOPS=1` (variable ajoutée à `qa-b6c-server.sh`) pour varier l'IP du limiteur ; un test dédié (S5) vérifie le 429.
- `npm run typecheck` : OK. `npm test` : 2950 pass / 963 skipped / 0 fail. Build frontend : OK.

## Revues requises

SECURITY : oui pour QA-IMP-01 (altération silencieuse d'une valeur d'appétence saisie par le client). COMPLIANCE / PRIVACY / RISK : non requis par ce lot. RETEST : après correction de QA-IMP-01 / 02 / 03.

## Retest (822d68f) : RETEST_PASS (VERT)

- **QA-IMP-01 clos.** Contrôle optimiste sur `updated_at` : R1 est un test normal et passe (30 courses : 0 saisie cliente perdue, 15 à 20 réponses 409 `DRAFT_CHANGED` de l'import, jamais 500). Le dernier cas « import perdu » (6 à 9 sur 30) ne vient que d'un PATCH sans `expectedUpdatedAt` (compatibilité voulue). Ajout R4 : commit // PATCH portant `expectedUpdatedAt`, 30 courses, deux fois : aucune saisie perdue dans aucun sens, deux 200 => les deux écritures présentes (3 à 5 cas), 409 côté import ou côté PATCH sinon, jamais 500. R3 : PATCH sans `expectedUpdatedAt` reste compatible (200) ; valeur relue renvoyée telle quelle : 200 (pas de faux conflit en millisecondes) ; valeur périmée : 409 `DRAFT_CHANGED`, rien d'écrit ; valeurs mal formées (`hier`, vide, nombre, null, décalage horaire, date impossible) : 400 ; `expectedUpdatedAt` seul : 4xx. L'onglet Seuils d'appétence envoie bien `expectedUpdatedAt` (code vérifié). Limite connue : la comparaison est à la milliseconde (deux écritures dans la même milliseconde ne seraient pas distinguées).
- **QA-IMP-02 clos** : S4b (panne sur la seule ligne d'import) est un test normal : 5xx et rien d'écrit.
- **QA-IMP-03 / 04 clos** : l'aperçu est refusé (403) à un compte hors groupe RM aux deux routes, et le refus « Réservé aux membres du groupe Risk Manager » est affiché dans l'écran (Playwright W6, oracle mis à jour en conséquence).
- **Ajouts d'A06 vérifiés** : L8 caractères de direction (U+202E, 202A, 2066, 200E, 2028) refusés avec message de ligne ; zéro-largeur U+200B et U+2060 : « sous-catégorie absente », U+FEFF interne : traité comme un espace (même sous-catégorie, inoffensif). L7 avertissement « première bande très large » (> 25 % du score maximal) : présent sur une échelle modifiée, sans bloquer, absent sur l'échelle normale.
- Chiffres : `QA-Import.test.ts` 30 / 30 live, deux lancements ; Playwright 26 / 26 ; `npm run typecheck` OK ; `npm test` 2958 pass / 967 skipped / 0 fail ; build frontend OK.
