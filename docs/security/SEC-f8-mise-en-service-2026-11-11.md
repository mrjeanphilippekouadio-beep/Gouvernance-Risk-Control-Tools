# Revue sécurité A10 : F8 partie R1, écrans de mise en service

- Date : 2026-11-11
- Agent : A10 (Security)
- Cible : `origin/feat/r1-f8-mise-en-service`, tête `a173822` (diff contre `origin/staging` : frontend seul)
- Fichiers revus : `frontend/src/features/setup/*.tsx`, `frontend/src/api/setup.ts`, `frontend/src/api/client.ts` (option `formData`), `frontend/src/App.tsx` (menu). Routes et services backend appelés (déjà en staging) : `api/v1/tenants.routes.ts` + `services/TenantService.ts` + `PostgresTenantRepository.ts`, `api/v1/branding.routes.ts` + `services/BrandingService.ts` + `GoogleDriveStorage.upload`, `api/v1/moduleToggles.routes.ts` + `services/ModuleToggleService.ts`, `api/v1/riskImport.routes.ts` + `services/RiskImportService.ts`, `server.ts` (`lookupMembership`, montages), `api/middleware/errorHandler.ts`.
- Méthode : revue statique ; vitest ciblé (`TenantService`, `BrandingService`, `ModuleToggleService` : 30 verts ; `RiskImportService` non lancé, `exceljs` absent de l'environnement local) ; PoC `tsx` hors dépôt sur le vrai `TenantService` avec un dépôt factice qui reproduit le SQL réel (`WHERE id = $1`, sans tenant). Aucune base distante, aucun appel Neon, aucune écriture Drive.

## Escalade HUMAN

**Pas d'escalade obligatoire aujourd'hui : CVSS maximal 5,5.**

En revanche, **une décision PO est demandée tout de suite**. La chaîne SEC-F8-01 + SEC-F8-02 + SEC-F8-03 passe à **8,2 (HIGH)** dès que la désactivation d'un client aura un effet réel, ce qui est la suite logique du correctif SEC-F8-03. Vecteur : `CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:C/C:L/I:L/A:H`. Il faut donc corriger dans cet ordre : SEC-F8-01 et SEC-F8-02 d'abord, SEC-F8-03 ensuite. Sinon, l'administrateur d'un client pourra couper l'accès d'un autre client.

## Verdict : ORANGE

Le frontend est propre : aucun secret, rendu React échappé, lien du logo filtré en `https://`, et aucune décision d'autorisation prise côté client. Le motif des modules (DECISION-058) est bien exigé par le serveur, et l'import revalide le fichier au commit.

Le blocage vient du modèle de droits de l'écran Clients. `config.manage` est une permission **locale à un client**, que l'administrateur d'un client peut s'attribuer par un rôle ordinaire. Or elle ouvre la gestion de **tous** les clients de la plateforme : liste, création, renommage et désactivation. L'écran ne doit pas être exposé, et aucun deuxième client ne doit être créé, tant que SEC-F8-01 n'est pas tranché.

Les écrans Image de marque, Modules et Import peuvent partir en staging. Leurs constats sont LOW.

## Point 1 : désactivation d'un client (signalée par le dev front)

**Confirmé.** `PATCH /api/v1/tenants/:id` avec `{active:false}` :

- passe sous `config.manage` seul (`TenantService.update`, l. 57), comme un simple renommage ;
- n'exige pas de motif (`reason: null` dans l'audit) ;
- passe par `buildUpdateSet` sur `active` : la réactivation (`active:true`) est donc tout aussi libre, et elle est tracée en `UPDATE`, pas en `STATUS_CHANGE` ;
- est tracée dans le tenant **de l'acteur**, pas dans celui du client désactivé. Les auditeurs du client touché ne voient rien.

C'est la classe SEC-013/SEC-014 de CLAUDE.md : une transition terminale gardée par la permission générique de mise à jour. Gravité seule : SEC-F8-02, LOW 2,7. Elle est faible aujourd'hui parce que la désactivation n'a aucun effet (SEC-F8-03), et elle monte à 8,2 en chaîne, comme expliqué plus haut. L'écran ne l'expose pas, mais l'API l'accepte.

## Constats

### SEC-F8-01 : la gestion de tous les clients repose sur une permission locale à un client (BFLA multi-tenant)

- Gravité : **MEDIUM 5,5**, `CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:C/C:L/I:L/A:N`
- Confiance : CONFIRMED (code + PoC sur le service réel)
- Composant : `TenantService` (list/get/create/update), `PostgresTenantRepository` (`SELECT … FROM tenants`, `UPDATE tenants … WHERE id = $1`, aucun filtre de tenant), écran `ClientsPage`.
- Cause : `TenantService` ne filtre pas par tenant, par construction (commentaire de `Tenant.ts` : « Super-admin uniquement »). Mais aucune notion de super-administrateur n'existe. `config.manage` est accordée par un rôle **du tenant** (`user_roles` joint à `roles` sur `ur.tenant_id = users.tenant_id`, `lookupMembership`). Le catalogue des droits la marque « configurable : oui, par le client ». Elle sert aussi aux modules, aux référentiels, aux catégories et à l'import. Tout administrateur d'un client qui la détient pour paramétrer son propre compte détient donc la gestion de toute la plateforme.
- Scénario : l'administrateur du client B (`config.manage` via un rôle de B) appelle `GET /tenants` et voit la liste nominative de tous les clients. Il appelle ensuite `PATCH /tenants/<id A>` avec `{name, deploymentMode, active:false}`, puis `POST /tenants` pour créer des clients fantômes (chacun reçoit ses trois groupes fixes).
- PoC (`tsx`, `TenantService` réel, acteur `{tenantId:"B", roles:["config.manage"]}`) :
  ```
  list: [ 'Client A', 'Client B' ]
  tenant A after: { id: 'A', name: 'pwned', deploymentMode: 'managed_saas', active: false }
  audit: [ [ 'B', 'A', 'STATUS_CHANGE', null ] ]
  ```
- Exposition actuelle : un seul client en base, donc l'impact effectif est nul tant que l'écran Clients ne sert pas à en créer un deuxième. Le constat devient réel au premier client ajouté.
- Le texte de l'écran est inexact : « Réservé au super-administrateur : le serveur refuse tout autre compte ».
- Correctif proposé (décision PO + A05/A06) : créer un droit plateforme distinct, par exemple `platform.tenant.manage`, **impossible à accorder par un rôle de tenant**. Il peut être refusé par `RoleService.assertKnownPermissions` pour tout rôle et accordé seulement par une liste d'adresses en variable d'environnement, ou par l'appartenance à un tenant « opérateur » désigné par configuration. `TenantService` doit exiger ce droit au lieu de `config.manage`, et `config.manage` reste le paramétrage local. Il faut aussi tracer chaque changement **dans le tenant visé**, en plus de celui de l'acteur.
- Test de non-régression : un acteur qui détient `config.manage` dans un tenant (sans le droit plateforme) reçoit 403 sur les 4 routes `/tenants`. Un rôle de tenant qui tente de porter le droit plateforme est refusé à la création et à la mise à jour.
- Propriétaire : PO (décision), A05 (modèle), A06 (code).

### SEC-F8-02 : désactivation et réactivation d'un client sans permission dédiée ni motif

- Gravité : **LOW 2,7** seul (`AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N`) ; **8,2 en chaîne** avec SEC-F8-01 une fois SEC-F8-03 corrigé.
- Confiance : CONFIRMED.
- Cause : `active` est accepté par `UpdateTenantBody` et par `TenantService.update` sous `config.manage`. Voir le point 1.
- Correctif proposé : refuser `active` dans `PATCH /tenants/:id`, au niveau de la route (`.strict()` sans `active`) **et** du service (comme `RiskService.update` refuse `ARCHIVED`). Créer deux routes dédiées, `POST /tenants/:id/deactivate` et `/reactivate`, avec un droit dédié (`platform.tenant.deactivate`, sous le même modèle que SEC-F8-01), un motif obligatoire (`reasonText`), et l'audit dans la même transaction, enregistré dans les deux tenants. Refuser que l'acteur désactive son propre tenant (sinon il se coupe l'accès, et personne ne peut plus réactiver). Le maker-checker pour la réactivation est laissé à la décision du PO.
- Test de non-régression : `PATCH {active:false}` et `PATCH {active:true}` donnent 400. La route dédiée sans motif donne 400, sans le droit dédié 403, et sur son propre tenant 400.
- Propriétaire : A06.

### SEC-F8-03 : la désactivation d'un client n'a aucun effet (contrôle documenté mais inexistant)

- Gravité : **MEDIUM 4,3** (`AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N`) : les utilisateurs d'un client « Inactif », par exemple en fin de contrat, gardent tout leur accès.
- Confiance : CONFIRMED (statique). `tenants.active` n'est lu que par `PostgresTenantRepository` pour l'affichage. `lookupMembership` (`server.ts`) ne joint pas `tenants`, et aucune autre requête ne lit `active`.
- Écart : DOCUMENTATION EXISTS but BEHAVIOR IS NOT VERIFIED. L'écran affiche « Inactif » alors que rien n'est coupé.
- Correctif proposé : dans `lookupMembership`, joindre `tenants` et refuser l'identification si `active = false` (fail-closed). **À ne livrer qu'après SEC-F8-01 et SEC-F8-02.**
- Test de non-régression : un utilisateur d'un tenant inactif reçoit 401/403 sur toute route. Après réactivation, l'accès revient.
- Propriétaire : A06 (après décision PO sur la portée exacte : connexion seulement, ou aussi les jetons en cours).

### SEC-F8-04 : logo, type déclaré par le client, SVG accepté

- Gravité : **LOW 2,0** aujourd'hui (rien n'est rendu sur notre origine).
- Confiance : CONFIRMED pour l'absence de vérification ; impact SUSPECTED (dépend d'un rendu futur).
- Constat : `BrandingService` contrôle la taille (multer 5 Mo, puis 413 générique, et le service revérifie) et le type MIME. Mais ce type est le `Content-Type` de la partie multipart, **déclaré par le client**, sans vérification des octets. `image/svg+xml` est accepté, et un SVG peut porter du script. Le fichier est servi par Drive (`webViewLink`, domaine Google, hors de notre origine). L'URL est **produite par le serveur** à partir de la réponse Drive, jamais fournie par le client. Le front n'en fait qu'un lien `https://` avec `rel="noopener noreferrer"`. Il n'y a donc pas de lien vers un fichier non vérifié, ni d'injection dans notre rendu aujourd'hui.
- Risque futur : si le logo est un jour affiché dans l'en-tête via un proxy servi sur notre origine, ou inséré en SVG inline ou dans un `<object>`, cela devient du XSS stocké. Un `<img>` reste sûr.
- Correctif proposé : vérifier la signature (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF….WEBP`) et retirer SVG, ou bien, si le PO tient au SVG, l'assainir côté serveur et ne jamais le servir autrement que dans un `<img>` avec `Content-Type` forcé et `Content-Security-Policy: sandbox`.
- INFO lié : `GoogleDriveStorage.upload` dépose le logo dans `activeFolderId`, le dossier des évidences, commun à tous les tenants quand il est défini. Le logo se mélange donc aux évidences, et l'isolation par tenant n'existe pas au niveau Drive (constat antérieur, hors périmètre F8).
- Propriétaire : A06.

### SEC-F8-05 : dépôt de logo sans limite de débit, anciens fichiers conservés

- Gravité : **LOW 2,7** (`AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:L`).
- Constat : `POST /branding` n'a pas de `costlyOperationRateLimiter`, contrairement à l'import. Chaque dépôt crée un fichier Drive de 5 Mo au plus, et l'ancien n'est jamais supprimé (choix documenté dans le service). Un détenteur de `branding.update` peut faire croître le stockage Drive sans borne.
- Correctif proposé : ajouter `costlyOperationRateLimiter()` sur la route, et éventuellement placer l'ancien logo dans le dossier `deleted` (soft delete Drive existant).
- Propriétaire : A06.

### SEC-F8-06 : l'import renvoie le message brut des erreurs internes

- Gravité : **LOW 2,7** (`AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:N/A:N`).
- Confiance : CONFIRMED (code) ; déclenchement par une erreur PostgreSQL : PROBABLE.
- Constat : dans `RiskImportService.commit`, le `catch` pousse `err.message` de **toute** erreur dans la réponse 200. L'`errorHandler`, qui masque les 500 (« Internal server error »), est ainsi contourné. Une erreur de base (texte avec caractère NUL, coupure de connexion, contrainte) renvoie son message PostgreSQL, avec des noms de colonne ou de contrainte, à l'utilisateur.
- Correctif proposé : ne recopier que les messages de `ValidationError`, `NotFoundError` et `ConflictError`. Pour le reste, renvoyer « Erreur interne (requestId …) » et journaliser côté serveur.
- Propriétaire : A06.

### SEC-F8-07 : commit d'import non idempotent

- Gravité : **LOW 2,7** (`AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N`).
- Constat : rejouer `POST /import/excel/commit` avec le même fichier (double clic, nouvel essai réseau, rejeu) recrée tous les risques. Il n'y a ni empreinte du fichier, ni clé d'idempotence, ni transaction : un échec au milieu laisse un import partiel. Le front masque le bouton après succès, mais l'API reste rejouable. Les cellules n'ont pas de borne de longueur (colonnes `text`). Elles sont bornées seulement par le fichier (10 Mo, garde zip) et les 2 000 lignes.
- Correctif proposé : un en-tête `Idempotency-Key`, ou une empreinte SHA-256 du fichier mémorisée par tenant pendant N minutes (409 si déjà importé), et une longueur maximale par cellule dans `RiskImportRowSchema`.
- Propriétaire : A06 ; décision PO pour savoir si un réimport volontaire du même fichier doit rester possible.

### INFO

- **SEC-F8-08** : `PATCH /modules/:name/toggle` coupe l'Audit sous `config.manage`. Déjà relevé (F-SWP INFO 04, catalogue : `config.module.toggle` recommandé). Ce n'est pas une transition terminale (réversible, motif exigé, audit avant/après dans la transaction), donc ce n'est pas la classe SEC-013/014. L'option PO reste ouverte, rien de nouveau.
- **SEC-F8-09** : le type `setupApi.updateTenant` du front accepte `active`. Il n'est pas utilisé, mais il faut le retirer en même temps que SEC-F8-02 pour ne pas inviter à l'exposer. `TenantBranding.logoUpdatedBy` (identifiant utilisateur) est renvoyé à tout détenteur de `branding.read` : acceptable dans le tenant.
- **SEC-F8-10** : `CreateTenantBody.name` et `UpdateTenantBody.name` n'ont pas de longueur maximale.

## Vérifications PASS

| Point | Résultat | Preuve |
|---|---|---|
| Secrets frontend | PASS | Aucun secret dans `setup/*`, `setup.ts`, `client.ts`. Seules variables : `VITE_API_BASE_URL` et les variables d'authentification existantes. |
| Décision d'autorisation côté client | PASS | `requires` du menu (`branding.read`, `config.read`, `config.manage`) est cosmétique. Chaque service appelle `requirePermission` (`branding.read`/`update`, `config.read`/`manage`). Un 403 ferme la modale sans rien supposer. |
| Injection dans le rendu | PASS | Aucun `dangerouslySetInnerHTML` ni `innerHTML`. Les cellules Excel, les noms de client et de module sont rendus en texte React. Le lien du logo est filtré en `^https://`, en `target=_blank` avec `noopener noreferrer`. |
| `formData` dans `client.ts` | PASS | Le `Content-Type` n'est plus forcé quand `formData` est présent (le navigateur pose la frontière). Le jeton reste en en-tête `Authorization`. Pas de cookie, donc pas de CSRF nouveau. |
| Attribution | PASS | Aucun champ `...By` accepté du client : `logo_updated_by`, `updatedBy` des modules et `userId` de l'audit valent `actor.userId`. L'import crée par `RiskService.create(actor, …)`. |
| Tenant : branding, modules, import | PASS | `getBranding`/`setLogo` sur `actor.tenantId`, upload Drive avec `actor.tenantId`. Modules : `list`/`upsert` sur `actor.tenantId`, nom du module en liste blanche. Import : `RiskService.create` (tenant de l'acteur, `risk.create` exigé **en plus** de `config.manage`). |
| Import : taille, rejeu de l'aperçu | PASS | multer 10 Mo, 1 fichier, 0 champ, 1 partie, puis 413. `assertSafeXlsxArchive` (bombe de décompression), 2 000 lignes au plus, `exceljs` sans évaluation de formules, limiteur `costlyOperationRateLimiter`. Le commit **re-parse et revalide** le fichier sans jamais réutiliser le verdict de l'aperçu. |
| `boundedArray` | PASS (sans objet) | Aucun `z.array` dans les quatre routes : multipart ou objets plats. |
| Motif des modules (préalable DECISION-080 q165) | PASS | `reasonText(500)` en route, `trim` revérifié au service, motif dans l'audit `STATUS_CHANGE`, état et audit dans une seule transaction. |
| Erreurs d'upload | PASS | `MulterError` donne 413/400 « Téléversement invalide. », sans détail interne. |

## Limites

- Aucun test sur base réelle ni sur Drive : le PoC SEC-F8-01 exerce le service réel avec un dépôt factice. Le SQL réel (`WHERE id = $1`, sans tenant) a été vérifié en lecture.
- `RiskImportService.test.ts` n'a pas tourné localement (`exceljs` non installé dans l'environnement de revue).
- Les détenteurs réels de `config.manage` et de `branding.*` en staging et en production n'ont pas été vérifiés (pas d'accès base).
- Le partage Drive du logo (qui peut ouvrir le lien) n'a pas été vérifié.

## Décisions demandées au PO

1. **SEC-F8-01** : modèle du « super-administrateur » plateforme (droit non attribuable par un rôle de tenant, et source de ce droit : liste en variable d'environnement ou tenant opérateur). Tant que ce n'est pas tranché, ne pas exposer l'écran Clients et ne pas créer de deuxième client.
2. **SEC-F8-02 / SEC-F8-03** : désactiver un client coupe-t-il la connexion seulement, ou aussi les sessions en cours ? La réactivation exige-t-elle une deuxième personne ?
3. **SEC-F8-04** : garder le SVG (avec assainissement) ou le retirer.
4. **SEC-F8-07** : faut-il pouvoir réimporter volontairement le même fichier ?
