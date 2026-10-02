# PRD — Temps réel GRC & Backend WebSocket-Ready

Document ID: PRD-GRC-REALTIME-001  
Version: 1.0  
Statut: PROPOSED — architecture cible à intégrer à la V1  
Date: 2026-10-02  
Produit: GRC Tools / Gouvernance-Risk-Control-Tools

## 1. Objet

Ce PRD fixe la dernière couche technique de cette version : le temps réel basé sur WebSocket bidirectionnel.

Règle structurante : le WebSocket est ajouté comme dernière couche de la V1, mais le backend doit être écrit dès maintenant de manière WebSocket-ready.

Le cœur métier ne dépend donc jamais directement de WebSocket. Les services métier produisent des événements applicatifs indépendants du transport.

## 2. Décisions

### DEC-REALTIME-001 — WebSocket bidirectionnel
WebSocket bidirectionnel est le transport temps réel de référence. SSE est remplacé pour le temps réel applicatif.

### DEC-REALTIME-002 — WebSocket = transport uniquement
WebSocket ne constitue ni la source de vérité métier, ni la source d'autorisation, ni le journal d'audit, ni le mécanisme de versioning.

### DEC-REALTIME-003 — Backend WebSocket-ready
Les services métier doivent pouvoir publier des événements structurés sans connaître l'implémentation WebSocket.

Interdit dans le domaine et les services métier :
~~~text
websocket.emit(...)
socket.broadcast(...)
socket.to(...)
~~~

### DEC-REALTIME-004 — WebSocket en dernière couche
L'implémentation du serveur WebSocket intervient après stabilisation du cœur métier, de l'autorisation, de l'audit, des notifications et des mécanismes asynchrones.

Cette décision n'autorise pas à repousser la conception des contrats d'événements, de l'idempotence ou de l'outbox.

### DEC-REALTIME-005 — Présence éphémère
Les états supportés sont ONLINE, AWAY, OFFLINE, VIEWING et EDITING.

### DEC-REALTIME-006 — PostgreSQL reste la vérité métier
Tout changement métier durable doit être persistant dans PostgreSQL avant diffusion temps réel.

## 3. Objectifs produit

Le système doit pouvoir à terme :
- signaler en temps réel les changements de risques, contrôles, évaluations, findings et plans d'action ;
- suivre les transitions de workflow ;
- afficher l'avancement des jobs ;
- notifier les utilisateurs ;
- afficher les utilisateurs présents sur une ressource ;
- diffuser les événements autorisés d'audit ;
- gérer plusieurs instances Cloud Run ;
- gérer la reconnexion et la resynchronisation ;
- éviter les doublons côté client ;
- conserver une isolation tenant stricte.

## 4. Hors périmètre initial

Ne pas introduire sans décision explicite : Pusher, Ably, Redis Cloud, Kubernetes, un SaaS realtime dédié ou une base métier séparée.

Le domaine ne doit pas être couplé à un fournisseur cloud, à Socket.IO ou à une implémentation spécifique de WebSocket.

## 5. Architecture cible

~~~text
                    FRONTEND
                        │
             ┌──────────┴──────────┐
             │                     │
            HTTPS              WebSocket
             │                     │
             ▼                     ▼
        ┌───────────┐        ┌──────────────┐
        │  GRC API  │        │ GRC Realtime │
        │ Cloud Run │        │  Cloud Run   │
        └─────┬─────┘        └──────┬───────┘
              │                     │
              └──────────┬──────────┘
                         ▼
                 APPLICATION CORE
                 DOMAIN / SERVICES
                         │
              ┌──────────┼───────────┐
              │          │           │
              ▼          ▼           ▼
         PostgreSQL    Outbox       Audit
              │          │
              │          ▼
              │       Pub/Sub
              │          │
              │          ▼
              │       Workers
              │
              └──────────┬───────────
                         ▼
                    Notifications
~~~

Architecture de référence infrastructure :

~~~text
Internet
   ↓
Cloudflare
   ↓
Google External Application Load Balancer
   ↓
┌───────────────────────┬───────────────────────┐
│                       │                       │
▼                       ▼                       ▼
grc-tools-api       grc-realtime             workers
Cloud Run            Cloud Run               Cloud Run
│                       │
└───────────────┬───────┘
                ▼
        Neon PostgreSQL
~~~

Le cœur applicatif reste provider-agnostic. Les composants edge, load balancer et compute sont des adapters/configurations d'infrastructure.

## 6. Séparation des responsabilités

### Domain
Contient la logique métier : Risk, Control, Evaluation, Finding, ActionPlan, RACI, Notification, etc. Aucune dépendance WebSocket.

### Application
Orchestre les commandes, les transactions, l'autorisation, l'audit, les événements et les traitements asynchrones.

### HTTP
Expose l'API REST et reste opérationnelle même si le realtime est indisponible.

### WebSocket
Traduit les événements applicatifs autorisés en messages temps réel et accepte uniquement les commandes realtime prévues.

### Workers
Exécutent les traitements lourds ou différés avec des privilèges minimaux.

## 7. Pattern de traitement obligatoire

~~~text
HTTP / Command
      ↓
Application Service
      ↓
Authorization
      ↓
Business logic
      ↓
PostgreSQL transaction
      ↓
Audit + Event
      ↓
Transactional Outbox
      ↓
Pub/Sub / worker / transport
      ↓
WebSocket / notification
~~~

Une panne ou une déconnexion WebSocket ne doit jamais annuler la transaction métier.

## 8. Contrats d'événements

Format minimal recommandé :

~~~text
id
type
version
tenantId
occurredAt
actorId
correlationId
causationId
payload
~~~

Exemple logique :

~~~text
type: risk.updated
version: 1
tenantId: T1
correlationId: C123
payload:
  riskId: R1
  resourceVersion: 15
  changedFields: [status, owner]
~~~

Chaque événement doit être identifiable, versionné, corrélable, tenant-scoped, idempotent côté consommation et dépourvu de secrets.

## 9. Catalogue initial d'événements

### Risk
risk.created, risk.updated, risk.deleted, risk.status_changed

### Evaluation
evaluation.created, evaluation.submitted, evaluation.approved, evaluation.rejected, evaluation.updated

### Control
control.created, control.updated, control.execution_started, control.execution_completed, control.result_changed

### Finding
finding.created, finding.updated, finding.status_changed

### Action Plan
action_plan.created, action_plan.updated, action_plan.status_changed, action_plan.overdue

### Workflow
workflow.started, workflow.step_changed, workflow.completed, workflow.rejected

### Job
job.queued, job.started, job.progress, job.completed, job.failed

### Notification
notification.created, notification.read, notification.failed

### Audit
audit.recorded

### Presence
presence.online, presence.away, presence.viewing, presence.editing, presence.offline

### System
system.maintenance, system.degraded, system.broadcast

## 10. Namespaces WebSocket

Namespaces fonctionnels : presence.*, notification.*, resource.*, workflow.*, job.*, audit.*, system.*.

Le client ne peut jamais déduire que la connaissance d'un identifiant de tenant, de ressource ou de workflow lui donne le droit de s'abonner.

## 11. Authentification et autorisation

Le handshake WebSocket doit être authentifié côté serveur.

Pipeline obligatoire :

~~~text
Handshake
   ↓
Identity verification
   ↓
Tenant resolution
   ↓
RBAC resolution
   ↓
Resource / scope resolution
   ↓
Subscription allow / deny
~~~

Le client ne peut pas imposer userId, tenantId, role ou permission.

L'autorisation backend reste autoritative et doit reprendre les mêmes règles que l'API HTTP.

## 12. RBAC et RACI

RBAC :

~~~text
User → UserRole → Role → RolePermission → Permission
~~~

RACI :

~~~text
Objet GRC → RaciAssignment → User → R/A/C/I
~~~

Une responsabilité RACI ne donne pas automatiquement un droit technique.

RACI reste déclaratif et ne doit jamais devenir la source d'autorisation.

## 13. Présence

La présence est éphémère et gérée par grc-realtime.

Fonctions : heartbeat, expiration, multi-onglets, portée tenant, portée ressource, VIEWING et EDITING.

La présence ne doit jamais être utilisée pour autoriser une action, valider un workflow, prouver une exécution ou remplacer l'audit.

## 14. Reconnexion et resynchronisation

Le frontend doit gérer :
- reconnexion avec backoff et jitter ;
- renouvellement/validation de session ;
- resynchronisation après reconnexion ;
- détection d'événements manquants ;
- nouveau contrôle d'autorisation lors d'une reconnexion.

Une reconnexion ne doit jamais supposer le retour sur la même instance Cloud Run.

## 15. Idempotence et ordre

Les consommateurs doivent supporter la livraison en double sans effet métier incorrect.

La clé minimale d'idempotence est event.id.

L'ordre global des événements ne doit pas être supposé. L'ordre pertinent est celui de la ressource, de l'aggregate, du workflow, du job ou de la version métier concernée.

Un événement plus ancien doit pouvoir être ignoré et un trou de version doit déclencher une resynchronisation via l'API.

## 16. Backpressure et limites

Configurer des limites sur :
- connexions par utilisateur ;
- connexions par tenant ;
- taille des messages ;
- fréquence des messages ;
- nombre de subscriptions ;
- fréquence des reconnexions ;
- fréquence des heartbeats.

En cas de dépassement : rejet, ralentissement ou déconnexion contrôlée selon la politique.

## 17. Sécurité WebSocket

Tests obligatoires :
- handshake sans token ;
- token invalide/expiré/révoqué ;
- Viewer vers mutation ;
- cross-tenant subscription ;
- cross-tenant event ;
- accès à une ressource hors scope ;
- CSWSH / Origin non autorisé ;
- spoof userId/tenantId ;
- message malformé ;
- payload trop volumineux ;
- flooding ;
- reconnect flooding ;
- replay et duplicate command ;
- stale session après révocation ;
- fausse identité de présence ;
- nombre excessif de connexions.

Après révocation d'un rôle ou d'une permission, une connexion existante ne doit pas conserver indéfiniment l'ancien niveau de privilège. La stratégie d'invalidation doit être explicite et testée.

## 18. Notifications

Canaux : IN_APP, EMAIL, WEB_PUSH.

Entités recommandées : notifications, notification_deliveries, notification_preferences, notification_outbox, push_subscriptions.

Règles : destinataire server-side, tenant isolation, idempotence, retry borné, livraison externe asynchrone, minimisation des données sensibles, delivery state distinct de read state.

Une indisponibilité d'un fournisseur email ou push ne doit pas casser la transaction métier.

## 19. Transactional Outbox

L'outbox doit permettre de rendre atomique le changement métier et l'enregistrement de l'événement à publier.

~~~text
BEGIN
  UPDATE business data
  INSERT audit
  INSERT outbox event
COMMIT
~~~

Puis :

~~~text
Outbox worker → Pub/Sub → Realtime / Notifications / Workers
~~~

Les événements doivent rester durables jusqu'à confirmation du traitement selon la politique de fiabilité retenue.

## 20. Pub/Sub et Cloud Tasks

Pub/Sub : fan-out inter-instance et diffusion d'événements vers plusieurs consommateurs.

Cloud Tasks : traitements ciblés nécessitant retry, délai, limitation de débit ou exécution individuelle.

Chaque consommateur et chaque tâche critique doivent être idempotents.

## 21. Workers

Les workers sont séparés du serveur HTTP lorsque le traitement est lourd ou différé.

Principes : privilèges minimaux, tenant scope, timeout, retry borné, backoff, logs corrélables, métriques, gestion d'échec.

## 22. Cloud Run

Prévoir à terme les services :

~~~text
grc-tools-api
grc-realtime
grc-workers
~~~

Le service realtime ne doit pas stocker de vérité métier durable uniquement en mémoire.

Cloud Run impose de concevoir la reconnexion et le partage d'état pour le multi-instance ; la conception ne doit donc jamais dépendre d'une affinité de connexion ou d'un cache mémoire local comme source de vérité.

## 23. Cloudflare et Load Balancer

Architecture de référence :

~~~text
Frontend → Cloudflare → Google External Application Load Balancer → grc-tools-api / grc-realtime
~~~

La même application doit pouvoir évoluer vers d'autres combinaisons d'edge, load balancer et compute via les abstractions d'infrastructure du projet.

## 24. Provider-agnosticité

Interdit dans le domaine :

~~~text
if (CLOUD_RUN) ...
if (CLOUDFLARE) ...
if (AWS) ...
~~~

Utiliser des adapters tels que ComputeProvider, EdgeProvider, LoadBalancerProvider et RealtimeTransport.

## 25. Structure backend cible

~~~text
backend/src/
├── domain/
│   ├── risks/
│   ├── controls/
│   ├── evaluations/
│   ├── findings/
│   ├── raci/
│   ├── notifications/
│   └── events/
├── application/
│   ├── risks/
│   ├── controls/
│   ├── workflows/
│   ├── jobs/
│   ├── notifications/
│   └── events/
├── infrastructure/
│   ├── database/
│   ├── messaging/
│   ├── realtime/
│   ├── workers/
│   └── integrations/
└── api/
    ├── v1/
    └── realtime/
~~~

Le nom exact des dossiers peut suivre les conventions déjà présentes dans le repo ; la séparation des responsabilités reste obligatoire.

## 26. Interfaces recommandées

~~~text
EventPublisher
  publish(event)

RealtimeTransport
  publishToUser(userId, event)
  publishToTenant(tenantId, event)
  publishToResource(tenantId, resourceType, resourceId, event)
  disconnect(connectionId)
~~~

Les services métier dépendent des abstractions, jamais de WebSocket concret.

## 27. Filtrage des événements

Un événement n'est jamais diffusé uniquement parce qu'il existe.

Pipeline :

~~~text
Business Event
   ↓
Resolve tenant
   ↓
Resolve audience
   ↓
Resolve authorization / scope
   ↓
Filter sensitive fields
   ↓
Publish
~~~

Le serveur demeure responsable du filtrage.

## 28. Données sensibles

Ne jamais transmettre inutilement : secrets, tokens, mots de passe, credentials, données personnelles non nécessaires ou contenu complet de documents sensibles.

Préférer un événement compact contenant resourceId, version, eventType, changedFields et summary, puis permettre au frontend de relire les données autorisées via l'API.

## 29. Audit

Le WebSocket n'est jamais la preuve d'une opération.

Une opération métier significative est auditée au moment de sa mutation effective. Le message WebSocket constitue une conséquence observable de l'événement métier.

## 30. Frontend

Le frontend devra disposer d'un gestionnaire de connexion, de reconnexion, de heartbeat, de subscriptions, de déduplication, de resynchronisation, de gestion d'erreur, de cache/version et d'affichage de présence.

Une réception WebSocket ne constitue jamais une preuve d'autorisation.

## 31. Observabilité

Les événements et connexions importantes doivent être corrélables au minimum avec : requestId, correlationId, eventId, userId, tenantId et connectionId.

Métriques minimales : active connections, connexions par tenant, rejected handshakes, authorization denials, reconnect rate, messages/sec, messages rejected, event lag, outbox lag, worker latency et notification latency.

## 32. Tests

### Unité
- construction et validation des événements ;
- tenant scope ;
- idempotence ;
- filtrage d'audience ;
- versioning.

### Intégration
- API → DB → Outbox ;
- Outbox → Pub/Sub ;
- Pub/Sub → Realtime ;
- Realtime → client autorisé ;
- notification pipeline ;
- worker pipeline.

### Sécurité
- authentification ;
- autorisation ;
- tenant isolation ;
- resource scope ;
- CSWSH ;
- spoofing ;
- flooding ;
- replay ;
- revocation.

### Résilience
- restart d'instance ;
- reconnexion ;
- changement d'instance ;
- indisponibilité temporaire de Pub/Sub ;
- indisponibilité DB ;
- retry worker ;
- double livraison.

### Charge
- 100 utilisateurs simultanés ;
- connexions persistantes ;
- activité simultanée ;
- burst de notifications ;
- reconnect massif ;
- traitements lourds.

## 33. Critères d'acceptation

- [ ] Le domaine ne dépend pas de WebSocket.
- [ ] L'API fonctionne sans couche realtime.
- [ ] Les services métier produisent des événements via abstraction.
- [ ] Les événements sont versionnés, tenant-scoped et corrélables.
- [ ] L'autorisation WebSocket est server-side.
- [ ] Le client ne peut pas usurper userId ou tenantId.
- [ ] Les subscriptions sont contrôlées par permission et scope.
- [ ] L'idempotence est testée.
- [ ] La reconnexion et la resynchronisation sont testées.
- [ ] Le fonctionnement multi-instance est testé.
- [ ] La présence est éphémère.
- [ ] L'audit reste indépendant du realtime.
- [ ] Les données métier ne dépendent pas de la mémoire locale realtime.
- [ ] Les tests de charge à 100 utilisateurs passent les seuils définis.

## 34. Release gates

La release est bloquée en cas de :
- bypass d'authentification ;
- bypass d'autorisation ;
- fuite cross-tenant ;
- accès WebSocket hors scope ;
- secret exposé ;
- privilege escalation critique ;
- injection critique ;
- perte silencieuse d'un événement critique ;
- dépendance à la mémoire realtime comme vérité métier ;
- incapacité à récupérer après restart.

## 35. Séquencement

### Phase 1 — Backend maintenant
1. Définir les interfaces d'événements.
2. Définir les types d'événements.
3. Ajouter eventId, version et correlationId.
4. Préparer EventPublisher.
5. Préparer l'Outbox.
6. Découpler les services du transport.
7. Documenter les contrats.

### Phase 2 — Stabilisation
1. Notifications.
2. Workers.
3. Cloud Tasks.
4. Pub/Sub.
5. Tests sécurité.
6. Isolation tenant.

### Phase 3 — Dernière couche V1
1. grc-realtime.
2. Handshake.
3. Subscriptions.
4. Presence.
5. Diffusion.
6. Reconnexion.
7. Limites et backpressure.
8. Observabilité.

### Phase 4 — Validation
1. Security regression suite.
2. Load test 100 users.
3. Multi-instance test.
4. Failure scenarios.
5. Review indépendante sécurité.

## 36. Definition of Done backend WebSocket-ready

Une fonctionnalité métier est WebSocket-ready lorsque :
1. son état durable est persisté dans PostgreSQL ;
2. son audit est produit selon les règles du produit ;
3. un événement applicatif peut être produit sans dépendance au transport ;
4. l'événement est identifiable et versionné ;
5. le tenant scope est explicite ;
6. le destinataire est déterminé côté serveur ;
7. la consommation est idempotente ;
8. un adapter WebSocket peut consommer l'événement sans modifier le service métier ;
9. les tests de sécurité existent ;
10. la fonctionnalité reste correcte même sans connexion WebSocket.

## 37. Règles pour les agents IA

- Ne jamais appeler directement WebSocket depuis un service métier.
- Ne jamais utiliser le RACI comme permission.
- Ne jamais contourner tenant scope.
- Ne jamais utiliser Presence comme autorisation.
- Ne jamais stocker la vérité métier uniquement en mémoire.
- Ne pas supprimer un événement uniquement pour faire passer un test.
- Ne pas casser les identifiants de corrélation.
- Ne pas ajouter un événement non idempotent sur un flux critique.
- Ne pas décider silencieusement d'un arbitrage encore OPEN.
- Préserver les modifications locales existantes.

## 38. Décision finale

> Le backend GRC V1 doit être conçu dès maintenant pour le temps réel, mais le WebSocket est implémenté comme la dernière couche de la version.

> Domain et Application Core → événements → Outbox → transport.

> PostgreSQL reste la vérité métier ; le WebSocket est un transport ; l'autorisation reste server-side ; RACI reste déclaratif ; Presence reste éphémère.

## 39. Source de contexte

Ce PRD complète le GRC Enterprise Context Pack et formalise les exigences de développement découlant des décisions WebSocket, présence, notifications, workers, Pub/Sub et outbox déjà retenues.

Référence interne : GRC-CONTEXT-2026-10-02.