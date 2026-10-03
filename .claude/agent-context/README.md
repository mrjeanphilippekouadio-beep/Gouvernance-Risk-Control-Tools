# Contexte partagé inter-agents — GRC Tools

**Objet** : ce dossier est le mécanisme de "mise en copie" voulu par le
Product Owner — même un agent jamais dispatché doit pouvoir savoir ce
qui a été décidé sur son périmètre et où en est le projet, sans qu'on
ait à le lui redemander à chaque fois. Deux fichiers :

- **`SHARED_LOG.md`** — journal chronologique, append-only, de toute
  décision qui concerne le périmètre d'un ou plusieurs agents. Chaque
  entrée est taguée `@<agent>` (peut en avoir plusieurs). N'importe qui
  — humain ou agent — peut grep son propre tag pour voir tout ce qui le
  concerne sans lire tout l'historique.
- **`RETEX_2026-10-03_STAGING_NEON_RENDER.md`** — RETEX opérationnel de la transition Neon/Render/staging/QA, à lire avant toute intervention d'infrastructure ou de recette.
- **`ACTION_ITEMS.md`** — la liste vivante des points en attente d'une
  intervention d'un agent précis, avec statut. C'est ce que
  l'orchestrateur consulte avant de décider qui dispatcher ensuite.

## Comment un agent s'en sert

1. **Avant de commencer une tâche**, un agent dispatché doit lire (ou se
   faire pointer par l'orchestrateur vers) les entrées de `SHARED_LOG.md`
   taguées à son nom, plus la ligne le concernant dans `ACTION_ITEMS.md`
   si elle existe.
2. **S'il prend une décision qui concerne le périmètre d'un autre
   agent** (même non dispatché), il doit le signaler dans son résumé
   final ; c'est l'orchestrateur qui ajoute l'entrée dans `SHARED_LOG.md`
   avec le bon tag (les agents n'ont pas accès en écriture à ce dossier
   hors de leur propre worktree).
3. **Une fois un point d'action traité**, l'orchestrateur le marque
   résolu dans `ACTION_ITEMS.md` (ne pas supprimer la ligne — passer son
   statut à `Résolu` avec la date et le lien commit/PR, pour garder la
   trace).

## Lien avec l'apprentissage inter-projets

Ce dossier est **local à ce dépôt** — il disparaît avec le projet. Ce
qui a une valeur au-delà de ce seul projet (une convention, une règle
d'autorisation, un pattern qui a marché ou pas) doit être remonté par
l'orchestrateur dans `~/.agentic-framework/agents/<role>/LEARNINGS.md`
(en dehors du dépôt, voir son propre README) — c'est ce dossier-là qui
survit au projet et enrichit le suivant.

*Mis en place le 27 septembre 2026, à la demande explicite du Product
Owner — voir `RETEX_MULTI_AGENTS.md` pour le contexte complet de cette
décision.*
