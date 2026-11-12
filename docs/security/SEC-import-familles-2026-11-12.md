# SEC — Revue de l'import « familles et sous-catégories » (q283 A, DECISION-133/135) — 2026-11-12

- Agent : A10 Security. Branche `sec/import-familles` = `origin/feat/r1-import-familles` @ `a03d826`.
- Périmètre : `riskFrameworkFamilyImport.routes.ts` (multer, `preview`, `commit`), `FrameworkFamilyImportService.ts`, `appetiteFamilies.ts`, écran `FamilyImportPanel.tsx`.
- Méthode : revue statique ; typecheck + vitest (2950 verts) ; PoC sur le vrai serveur (tsx, `AUTH_PROVIDER=local`) contre une base PostgreSQL 16 LOCALE jetable (127.0.0.1:55442, jamais Neon), tenant dédié (deux RM, un compte non-RM avec `riskframework.update` en direct), multipart réels (`FormData`). PoC non commité (scratchpad).

## Verdict : VERT avec réserves — aucune escalade (max CVSS 2,0)

| ID | Sévérité | CVSS 3.1 | Owner |
|---|---|---|---|
| SEC-IMP-01 Mise à jour perdue : le commit remplace tout le tableau d'appétence à partir d'une lecture non verrouillée | LOW | 2,0 (AV:N/AC:H/PR:H/UI:N/S:U/C:N/I:L/A:N) | A06 |
| SEC-IMP-02 L'aperçu n'exige pas le groupe Risk Manager (le commit l'exige) | INFO | — | A06 |
| SEC-IMP-03 Ligne d'audit « IMPORT_FAMILIES » écrite hors transaction | INFO | — | A06 |
| SEC-IMP-04 Écho de caractères de direction Unicode (U+202E) dans le rapport | INFO | — | A06 |

## Ce qui tient (PoC)

**Lecture d'un fichier non fiable**
- 65 Ko = 413 (limite multer sur le flux, message générique) ; deux fichiers = 400 ; vide = 400.
- `.csv` ou `application/octet-stream` = 400. Le nom et le type sont fournis par le client, mais ce n'est qu'un premier filtre : les vrais contrôles portent sur les octets.
- Octet NUL = 400 (couvre aussi UTF-16 avec BOM et la plupart des binaires : PE, ELF, PNG) ; en-tête `PK` = 400 ; Latin-1 = 400 avec le numéro de ligne fautive ; plus de 200 lignes de données = 400.
- Caractères de contrôle C0 (dont ESC) et C1 (U+0085) = ligne en erreur ; champ de plus de 120 caractères = erreur.
- Coût : pire cas (200 lignes, famille inconnue de 120 caractères, donc 200 × 24 distances de Levenshtein) = 69 ms ; pas de regex à retour arrière ; limiteur « opération coûteuse » (30 / 15 min / IP) sur les deux routes.

**Injection dans les messages**
- La réponse est du JSON (`application/json`). Le texte brut n'est renvoyé qu'à l'auteur du fichier, dans `family`/`subCategory` de sa propre ligne (120 caractères, sans caractère de contrôle). L'écran l'affiche comme texte React (`render: (l) => l.family`), sans `dangerouslySetInnerHTML` : `<img src=x onerror=…>` reste du texte.
- Le texte brut n'est jamais stocké : l'entrée écrite reprend `cat.name` et `cat.id` du référentiel. Il n'apparaît pas non plus dans l'audit (vérifié).

**Écriture dans le Dispositif**
- Commit : `riskframework.update` + groupe RM (via `updateDraft`) ; un non-RM avec le droit en direct reçoit 403.
- Brouillon seulement (version archivée = 400). Autre tenant = 403. Un nom de sous-catégorie d'un autre tenant = « absente du référentiel » : `categories.list(actor.tenantId)` est la seule source.
- L'importateur devient `lastEditedBy`, donc il est exclu de l'approbation de la version (maker-checker préservé).
- Rejouer le commit ne crée rien (0 créée, 2 conservées). Une valeur déjà saisie n'est pas écrasée (verdict KEPT).

**Empreinte**
- Empreinte fausse = 409 `IMPORT_FINGERPRINT_MISMATCH` ; autre fichier présenté avec l'empreinte de l'aperçu = 409.
- C'est une garde d'intégrité côté utilisateur (« ce que j'ai vu est ce que j'écris »), pas une authentification : le commit ré-analyse le fichier qu'il reçoit et n'écrit que ce que cette analyse produit. Aucun contournement possible.

**Audit**
- Ligne `IMPORT_FAMILIES` avec empreinte et compteurs seulement. La ligne avant/après de `updateDraft` porte des noms et identifiants du référentiel, jamais le contenu du fichier.

## Constats

### SEC-IMP-01 — LOW 2,0 — CONFIRMED (A06)
- Cause : `analyse` lit `version.appetiteThresholds` sans verrou, puis `updateDraft` écrit le tableau complet `[...existing, ...toAdd]`, sans condition sur l'état lu.
- PoC I16 : pendant que le commit attend le verrou de la ligne, un autre RM ajoute à la main l'entrée « Fuite de données » (description « saisie manuelle s2 »). Le commit passe ensuite (200) et le brouillon ne contient plus que les deux entrées importées : **la saisie manuelle est perdue**. C'est contraire à la promesse de l'import (« une valeur saisie par le client n'est jamais écrasée »).
- Traçabilité dégradée : l'audit de `updateDraft` prend son « avant » dans la même lecture périmée, donc il ne montre pas la suppression. Seule la ligne d'audit de l'autre RM permet de la retrouver.
- Impact borné : c'est un brouillon, relu par un tiers avant activation, et il faut deux RM concurrents (AC:H, PR:H). Le même défaut existe déjà pour le `PATCH` générique d'un brouillon ; l'import élargit seulement la fenêtre.
- Recommandation (A06, solution simple) : condition optimiste (`WHERE … AND updated_at = $lu`, 409 sinon), ou relire le tableau sous `FOR UPDATE` dans la transaction d'écriture et y ajouter `toAdd`.
- Test de régression : une entrée ajoutée entre l'aperçu et l'écriture est conservée, ou le commit répond 409.

### SEC-IMP-02 — INFO (A06)
`preview` ne vérifie que `riskframework.update` ; le groupe RM n'est exigé qu'au commit (I2 : un non-RM obtient 200 à l'aperçu, 403 au commit). Rien de nouveau n'est divulgué : les noms de sous-catégories, les entrées du brouillon et les seuils sont déjà lisibles avec `riskframework.read` et la lecture des catégories. Aligner sur le commit pour la cohérence (403 dès l'aperçu).

### SEC-IMP-03 — INFO (A06)
La ligne `IMPORT_FAMILIES` est enregistrée après la transaction de `updateDraft`. Si elle échoue, la réponse est 500 alors que l'écriture est faite. L'écriture reste tracée par la ligne avant/après de `updateDraft`, faite dans sa transaction ; seule l'empreinte du fichier est perdue. À passer dans le callback d'audit de `updateDraft` si l'empreinte doit servir de preuve.

### SEC-IMP-04 — INFO (A06)
Les caractères de direction (U+202A à U+202E, U+2066 à U+2069) et les séparateurs U+2028/U+2029 passent le filtre des caractères de contrôle et sont renvoyés tels quels (I5 « bidi »). Seul l'auteur les voit, et rien n'est stocké. Aucun impact aujourd'hui ; à ajouter au filtre si l'écho doit un jour être montré à quelqu'un d'autre.

## Limites
- Base locale jetable ; frontend lu dans le code, pas exécuté.
- La course SEC-IMP-01 a été provoquée en tenant le verrou de la ligne pendant le commit. L'édition concurrente est émulée par une écriture SQL qui remplace le contenu exact qu'écrirait un `PATCH`.
