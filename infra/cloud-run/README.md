# Cloud Run production baseline

Ce dossier contient un modèle de déploiement sécurisé pour l'API GRC.

## Règles

1. **Identité** : utiliser un compte de service Google Cloud dédié au runtime.
2. **Secrets** : `DATABASE_URL` doit venir de Secret Manager, jamais d'une
   valeur en clair dans le YAML ou le workflow.
3. **Google Drive** : le runtime utilise l'identité Cloud Run (ADC).
   Aucune clé JSON de service account ne doit être injectée en production.
4. **Image** : référencer l'image par digest (`@sha256:...`), pas par un tag mutable.
5. **Migrations** : le runtime Cloud Run ne reçoit jamais
   `MIGRATION_DATABASE_URL`. Les migrations utilisent le rôle PostgreSQL dédié
   prévu par la PR #38.
6. **Health** : `/ready` contrôle la disponibilité de la base ; `/health` reste
   un signal de vie sans authentification pour Cloud Run.
7. **Accès** : le service peut être joignable publiquement pour le frontend,
   mais toutes les routes métier restent protégées par le bearer token.

## Secret Manager

Créer au minimum le secret `grc-database-url` et accorder au compte de service
runtime uniquement le rôle `roles/secretmanager.secretAccessor` sur ce secret.
Google recommande Secret Manager pour les credentials et clés API plutôt que
les variables d'environnement contenant les valeurs secrètes en clair.
Lorsqu'un secret est injecté comme variable d'environnement, Cloud Run le
récupère avant le démarrage de l'instance.

Le manifeste référence explicitement la version `1` du secret. Google recommande
de pinner une version plutôt que `latest` lorsqu'un secret est consommé comme
variable d'environnement. citeturn447114search3

## Google Drive

Le compte de service `grc-tools-runtime@...` doit être ajouté au Shared Drive
avec uniquement le niveau d'accès nécessaire. La clé JSON historique reste
possible pour le développement local uniquement ; le runtime Cloud Run ne doit
pas utiliser `GOOGLE_APPLICATION_CREDENTIALS` ni une clé de compte de service.
Google recommande un compte de service géré par l'utilisateur comme identité
Cloud Run.

## Avant déploiement

- remplacer `PROJECT_ID`, `REGION`, `IMAGE_DIGEST` et l'adresse du compte de service ;
- créer le secret et sa version validée ;
- accorder au runtime SA uniquement les droits nécessaires ;
- vérifier que `MIGRATION_DATABASE_URL` n'est pas configuré sur le service ;
- vérifier que le compte de service runtime n'est ni propriétaire ni administrateur de Neon ;
- déployer l'image par digest ;
- vérifier `/ready` après création de la révision.
