# ACT-072 — Proposition de cadrage minimal (purge RGPD de l'audit trail)

**Statut** : PROPOSITION — non arbitrée. À confirmer ou amender par le PO (et, pour la partie
applicabilité juridique, par le juridique/DPO le cas échéant).

**Auteur** : Agent Compliance (fonction GRC de deuxième ligne).

**Objet** : ACT-072 est "Post-MVP", sans étude depuis 2026-09-27
(`.claude/backlog/grc-actions.yaml`). Le module Audit UX arrive prochainement dans la séquence
des 29 modules (maquettage uniquement, pas de code). Condition déjà posée par Compliance
(`SHARED_LOG.md`, ligne ~1946-1948) : ne pas maquetter de bouton "purger" ni de politique de
rétention explicite tant qu'ACT-072 n'a pas au moins une hypothèse par défaut tranchée.

Ce document ne résout pas ACT-072. Il propose une hypothèse de travail suffisante pour débloquer
le maquettage, à valider rapidement par le PO plutôt que de partir d'une page blanche.

---

## 1. Ce qui est déjà établi dans le repo

- **Conservation réglementaire BCEAO** (`compliance.md` §13) : pour les SFD concernés par
  l'Instruction n°017-12-2010, les éléments constitutifs de la piste d'audit sont prévus pour
  être conservés pendant **au moins dix ans**. C'est une contrainte plancher, pas une durée
  cible — rien n'autorise une purge sous ce seuil.
- **Applicabilité du RGPD non établie** (`privacy.md` §4-5) : le RGPD ne s'applique pas
  automatiquement à un SFD situé en Côte d'Ivoire. Le droit applicable par défaut est la loi
  ivoirienne n°2013-450, sous supervision ARTCI, qui prévoit elle aussi des droits d'accès, de
  rectification et de suppression — mais selon un régime distinct du RGPD (pas de "droit à
  l'oubli" absolu, pas de délai de purge automatique équivalent). **ACT-072, tel que nommé
  ("Purge RGPD"), part d'une prémisse juridique non vérifiée.** Avant toute chose, la question
  n'est pas "quelle politique de purge RGPD" mais "quel texte de protection des données
  s'applique réellement à cet audit trail, et prévoit-il une obligation de purge ou seulement un
  droit de rectification/suppression exerçable sur demande".
- **Silence du CDC v0.1 sur le périmètre LBC/FT** : déjà signalé comme gap ouvert
  (`SHARED_LOG.md`). Or l'audit trail est aussi une pièce du dispositif LBC/FT
  (`compliance.md` §85 : Record Keeping). Les obligations de conservation LBC/FT (surveillance,
  investigation, déclarations de soupçon) ont leurs propres durées et ne se raisonnent pas
  comme un sujet RGPD.
- **Tension déjà notée par @privacy** entre audit trail append-only et droit à la rectification :
  un log d'audit correctement conçu ne doit jamais être modifié ou supprimé ligne à ligne (intégrité
  de la preuve), ce qui entre structurellement en tension avec un droit individuel de rectification
  ou de suppression s'il était reconnu applicable.

Ces trois éléments pointent vers la même conclusion : **la purge n'est pas d'abord un problème
UX ou technique, c'est un problème de qualification juridique non résolu.** Le maquettage ne
doit pas anticiper une réponse que le cadrage n'a pas donnée.

---

## 2. Trois options de cadrage minimal

### Option A — Rétention stricte, aucune purge automatisée (statu quo assumé)

**Contenu.** L'audit trail est conservé indéfiniment (ou a minima au-delà des 10 ans BCEAO, sans
mécanisme de purge automatique). Tout retrait de données ne peut se faire qu'au cas par cas, sur
décision humaine documentée (ex. ordonnance, demande ARTCI, erreur avérée), jamais par un
job planifié ni par un bouton self-service.

**Ce que ça autorise à l'écran Audit** : un écran de consultation en lecture seule (déjà couvert
par ACT-071), éventuellement un lien "Demander un retrait" qui ouvre un ticket vers une revue
humaine hors écran — pas d'action de suppression exécutable depuis l'UI. Aucun champ "durée de
rétention" configurable par l'utilisateur.

**Compatibilité BCEAO ≥10 ans** : totale et sans ambiguïté — c'est l'option la plus conservatrice
vis-à-vis du plancher réglementaire.

**Risque principal** : si le RGPD ou un droit équivalent s'avère effectivement applicable
(ex. clients ou traitements liés à des personnes situées dans l'UE, ou évolution du droit
ivoirien), l'absence totale de mécanisme de purge devient elle-même un gap de conformité —
non-respect d'un droit à l'effacement reconnu, sans même une procédure de traitement des
demandes.

### Option B — Purge automatique post-rétention, avec approbation humaine obligatoire (ACT-072 tel que rédigé aujourd'hui)

**Contenu.** Reprend la formulation actuelle du backlog (`grc-actions.yaml` : "DELETE ciblé sur
audit_logs (données expirées)", "Approbation HUMAN obligatoire avant purge"). Une politique de
rétention explicite est définie (ex. 10 ans + marge), et un job identifie les enregistrements
expirés, mais **aucune suppression n'est exécutée sans validation humaine explicite et tracée**
(elle-même journalisée — paradoxe assumé : la purge de l'audit trail doit générer sa propre
entrée d'audit).

**Ce que ça autorise à l'écran Audit** : un écran de suivi des purges proposées/en attente
d'approbation (liste des lots candidats, avec date d'expiration calculée), un bouton
"Approuver la purge" réservé à un rôle habilité (jamais en libre-service), et une trace de qui a
approuvé quoi. Pas de bouton "purger" en accès direct pour un utilisateur standard.

**Compatibilité BCEAO ≥10 ans** : compatible **si et seulement si** le seuil de rétention
configuré est strictement supérieur ou égal à 10 ans, et que ce seuil est lui-même verrouillé
(non modifiable par un utilisateur métier sans revalidation Compliance). Le risque n'est pas dans
le principe mais dans le paramétrage.

**Risque principal** : construit une politique de purge alors que la prémisse ("RGPD") n'est pas
vérifiée — risque de bâtir un mécanisme pour un cadre juridique non confirmé, potentiellement mal
calibré (mauvais déclencheur, mauvaise durée) une fois la vraie base légale identifiée. Risque
opérationnel supplémentaire : toute purge automatique, même approuvée, est un point de
défaillance possible vis-à-vis du plancher BCEAO si le paramétrage dérive avec le temps
(ex. changement de seuil non revalidé).

### Option C — Pas de purge, séparation "accès/visibilité" vs "conservation" (droit de rectification traité sans toucher à l'intégrité du log)

**Contenu.** L'audit trail reste conservé intégralement et sans purge (append-only strict,
compatible avec la tension notée par @privacy). Un droit de rectification ou de restriction
éventuel, s'il est reconnu applicable, est traité non par suppression physique mais par un
mécanisme de **masquage/restriction d'accès** sur les champs identifiants d'une entrée (ex.
pseudonymisation d'un champ "nom utilisateur" dans l'affichage, alors que l'enregistrement brut
et sa preuve d'intégrité restent conservés côté base). La distinction "ce qui est stocké" vs
"ce qui est visible/exploitable" devient le levier, pas la suppression.

**Ce que ça autorise à l'écran Audit** : un écran de consultation avec un statut par entrée
(normal / restreint), et une action "Restreindre la visibilité" réservée à un rôle habilité,
avec motif et référence obligatoires — jamais une action "supprimer" ou "purger". Techniquement
proche d'ACT-071 (read-only) avec un filtre de visibilité en plus.

**Compatibilité BCEAO ≥10 ans** : totale — rien n'est supprimé, seule la présentation change,
donc le plancher réglementaire n'est jamais mis en risque par construction.

**Risque principal** : si un cadre juridique applicable exige un jour une suppression effective
(et pas seulement une restriction de visibilité) et que ce cadre prévaut sur la conservation
BCEAO dans le cas d'espèce, cette option ne suffit pas et nécessitera une révision ultérieure —
mais contrairement à l'Option B, elle ne construit rien de faux en attendant, donc le coût de
correction reste faible.

---

## 3. Recommandation

**Option C**, comme hypothèse par défaut pour débloquer le maquettage de l'écran Audit
maintenant, avec l'Option A comme filet en cas d'ambiguïté persistante sur les rôles habilités.

Justification : l'analyse ci-dessus montre que rien dans le repo n'établit aujourd'hui que le
RGPD (ou un droit équivalent au droit à l'effacement) s'applique réellement à ce SFD. Construire
l'Option B maintenant, c'est maquetter — et bientôt coder — un mécanisme de suppression pour
répondre à une obligation dont l'existence même n'est pas démontrée, tout en portant le risque
opérationnel le plus élevé vis-à-vis du plancher BCEAO ≥10 ans (tout paramétrage de durée de
rétention est un point de dérive possible). L'Option A est sûre vis-à-vis de BCEAO mais ferme la
porte à toute réponse à un futur droit de rectification reconnu, sans même prévoir de procédure.
L'Option C est la seule qui (i) ne prend aucun engagement irréversible avant que la base légale
soit qualifiée, (ii) reste triviale à faire évoluer vers l'Option B si une obligation de purge
effective est confirmée plus tard, et (iii) donne déjà au PO un geste concret et défendable
("restreindre la visibilité", pas "purger") à présenter si la question se pose avant
qualification complète du cadre juridique.

Cette recommandation ne dispense pas d'un arbitrage PO/juridique en bonne et due forme sur
l'applicabilité RGPD/loi n°2013-450 à ce SFD — elle fixe seulement l'hypothèse par défaut pour ne
pas bloquer le maquettage en attendant cet arbitrage. Tant que cet arbitrage n'a pas eu lieu, le
statut d'ACT-072 doit rester `EVIDENCE_REQUIRED` (pas `NOT_APPLICABLE`, pas `COMPLIANT`) et
aucun bouton de suppression physique ne doit être maquetté.
