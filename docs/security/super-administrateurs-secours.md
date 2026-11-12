# Super-administrateurs : règles et secours DevOps (q275, q277, q282)

## Configuration serveur (validée au démarrage)

- `SUPER_ADMIN_EMAILS` : adresses exactes des super-administrateurs. **Au moins deux** (le démarrage journalise un avertissement sinon, sans afficher les adresses).
- `SUPER_ADMIN_DOMAINS` : domaines que le fournisseur d'identité doit **attester** (Google : revendication `hd`). Vide = personne : **obligatoire avec `SUPER_ADMIN_EMAILS`** (sans domaine, aucun super-administrateur). Les deux variables figurent dans `backend/.env.example`.
- Un compte est super-administrateur seulement si son adresse est dans la liste ET le domaine attesté par le fournisseur est celui de l'adresse ET figure dans `SUPER_ADMIN_DOMAINS`.
- Jeton local (dev/staging) : aucun domaine attesté par défaut ; `LOCAL_AUTH_ATTESTED_DOMAIN` permet de tester en staging et est **refusée au démarrage en production**.

## Règle de désactivation d'un client (q277)

Une désactivation est refusée s'il ne resterait aucun autre super-administrateur actif, hors du client visé et hors de l'acteur, pour la réactiver. Les désactivations et réactivations sont sérialisées (verrou) et leur audit est écrit dans la même transaction.

## Liaison des comptes à l'identifiant du fournisseur (q282 A)

À la première connexion, `users.identity_provider` / `identity_subject` enregistrent l'identifiant stable (Google `sub`). Ensuite un autre identifiant pour la même adresse est refusé (connexion 403). Comptes locaux : sans liaison.

Changement légitime de compte d'une personne (procédure DevOps, tracée) : après décision écrite du responsable, exécuter
`UPDATE users SET identity_provider = NULL, identity_subject = NULL WHERE id = '<id>'` ; le compte se relie à la prochaine connexion. Consigner la demande et l'exécutant dans le ticket de changement.

## Secours : client désactivé impossible à réactiver

Cas : plus aucun super-administrateur capable de réactiver. Procédure DevOps, modification tracée de la configuration (ticket + revue par une deuxième personne) :

1. Ajouter une adresse de super-administrateur (et son domaine si besoin) dans `SUPER_ADMIN_EMAILS` / `SUPER_ADMIN_DOMAINS`, redéployer. Le compte doit exister dans un client actif.
2. Ce super-administrateur réactive le client par l'API (motif obligatoire, audit normal).
3. Retirer l'ajout temporaire si ce n'était pas un deuxième titulaire durable, redéployer, clôturer le ticket.

Éviter toute écriture SQL directe sur `tenants.active` : elle contourne l'audit.
