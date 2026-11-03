/**
 * Governance principles catalog (lot D6), copied from docs/governance/principes/principes-gouvernance.json (A13,
 * validated as D0 by the PO, DECISION-076). The server never reads docs/ at run time; a test checks that this copy and
 * the JSON stay identical. Regenerate by copying the JSON fields, never by hand-editing the texts.
 */
export const CATALOG_VERSION = "0.3-PROPOSITION";

export type PrincipleSeverity = "elevee" | "moyenne" | "faible";
export type RequirementLevel = "exige" | "recommande" | "informatif";
export interface PrincipleEntry {
  id: string;
  title: string;
  consequence: string;
  severity: PrincipleSeverity;
  indications: Record<"TPE" | "PME" | "GRANDE_ENTREPRISE", { level: RequirementLevel; action: string }>;
}

export const PRINCIPLES = [
  {
    "id": "GOV-SOD-01",
    "title": "Quatre yeux : on ne valide pas ce que l'on a saisi",
    "consequence": "Une évaluation, une action ou un traitement est donné comme contrôlé alors qu'une seule personne l'a produit et approuvé. Le Comité et l'Audit croient qu'un second regard a eu lieu. En cas d'erreur ou de manipulation, rien ne l'aurait arrêtée.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Accepter que la même personne valide, mais jamais en silence : motif écrit, seconde confirmation, mention « sans second regard » sur le rapport. Désigner un tiers externe (gérant, expert-comptable, conseil) qui reçoit le journal de ces validations et le relit une fois par trimestre ou au moins une fois par an."
      },
      "PME": {
        "level": "exige",
        "action": "Faire valider toute évaluation sensible par un second Risk Manager ou par le directeur concerné. Si un seul Risk Manager existe, désigner un validateur de repli nommé (directeur financier, directeur général) et suivre la part de validations sans second regard (objectif proposé : moins de 10 % des validations, à valider PO)."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Aucune validation par l'auteur. La 2e ligne valide la 1re ; le Comité valide au-dessus d'un seuil. Toute exception exige l'accord d'un membre du Comité et apparaît dans le rapport trimestriel au Comité et à l'Audit."
      }
    }
  },
  {
    "id": "GOV-SOD-02",
    "title": "La méthode ne se décide pas seul (Dispositif, échelles, appétence)",
    "consequence": "Les échelles et seuils qui servent à juger tous les risques ont été fixés et approuvés par la même personne. Un risque peut passer pour acceptable simplement parce que la règle a été choisie sur mesure.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Accepter l'amorçage par une personne, avec marquage « décidé sans second regard ». Faire relire le Dispositif par un tiers (gérant, conseil externe) dans les 90 jours, et noter cette relecture dans l'outil."
      },
      "PME": {
        "level": "exige",
        "action": "Faire approuver chaque version par le Comité ou à défaut par un second Risk Manager. Toute décision de repli est ratifiée à la séance suivante."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Approbation par le Comité, avis de l'Audit tracé, effet au cycle suivant. Aucun repli sans ratification sous 30 jours (délai à valider PO)."
      }
    }
  },
  {
    "id": "GOV-SOD-03",
    "title": "Pas d'auto-attribution de rôle ni d'auto-élévation",
    "consequence": "Un administrateur peut se donner la fonction de Risk Manager ou d'Audit, puis valider ses propres décisions : le contrôle existe sur le papier et n'existe plus dans les faits.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Faire attribuer le premier rôle par l'éditeur à l'ouverture. Ensuite, toute auto-attribution passe par le régime déclaré avec information du gérant. Revoir la liste des rôles chaque année."
      },
      "PME": {
        "level": "exige",
        "action": "Prévoir au moins deux administrateurs de confiance qui s'attribuent mutuellement leurs rôles ; revue trimestrielle des attributions par la fonction risque."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Attribution sur demande validée par le responsable hiérarchique et la sécurité ; recertification semestrielle des rôles par les propriétaires ; aucune auto-attribution."
      }
    }
  },
  {
    "id": "GOV-SOD-04",
    "title": "Le cumul de rôles est visible et encadré",
    "consequence": "La même personne contrôle et est contrôlée. Les décisions du Comité ou les constats de l'Audit n'apportent plus le regard indépendant qu'on leur prête.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "informatif",
        "action": "Accepter le cumul administrateur + Risk Manager (cas normal du gérant, du RSSI ou du responsable IT). Le laisser visible, faire relire annuellement ses décisions par un tiers externe."
      },
      "PME": {
        "level": "recommande",
        "action": "Admettre admin + Risk Manager avec marquage. Séparer au moins Comité et Audit. Interdire qu'un cumulant vote sur ses propres demandes."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Aucun cumul entre fonctions de contrôle. Administrateur technique distinct du Risk Manager, du Comité et de l'Audit. Tout cumul résiduel est une exception datée, validée par le Comité."
      }
    }
  },
  {
    "id": "GOV-SOD-05",
    "title": "Une même personne ne tient pas plusieurs lignes de défense sur un même dossier",
    "consequence": "Le contrôle est jugé efficace par celui qui l'a exécuté. Le Comité reçoit un risque résiduel bas qui repose sur une auto-évaluation.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "informatif",
        "action": "Admettre le cumul (peu de personnes), le tracer, et faire contrôler par échantillon (2 à 3 dossiers par an) par un tiers externe."
      },
      "PME": {
        "level": "recommande",
        "action": "Désigner des exécutants de contrôle distincts du Risk Manager pour les contrôles clés. Garder le cumul comme exception visible sur le dossier."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Retirer au groupe Risk Manager les droits d'exécution de contrôle. 1re ligne exécute, 2e ligne évalue, 3e ligne vérifie."
      }
    }
  },
  {
    "id": "GOV-RISK-01",
    "title": "Indépendance et existence de la fonction risque",
    "consequence": "Personne ne challenge les cotations des propriétaires de risques. Les risques sont cotés et validés dans la même ligne, avec un biais d'auto-évaluation.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Désigner une personne formellement responsable de la fonction risque (souvent le gérant ou le responsable conformité), et un suppléant nommé. Le cumul avec d'autres fonctions est accepté mais visible."
      },
      "PME": {
        "level": "exige",
        "action": "Au moins deux Risk Managers (un titulaire, un suppléant actif) rattachés à la direction générale et non à un département opérationnel."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Équipe risque dédiée, trois Risk Managers ou plus, rattachée à la direction des risques, indépendante des métiers, avec revue par le Comité."
      }
    }
  },
  {
    "id": "GOV-RISK-02",
    "title": "Continuité des rôles clés : pas de groupe vidé, intérim ou vacance déclarée",
    "consequence": "Soit l'outil bloque le client parce que personne ne peut valider, soit un compte d'ancien salarié reste actif pour que l'outil continue de fonctionner. Dans les deux cas, la gouvernance est affaiblie ou l'accès n'est plus maîtrisé.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Nommer à l'avance un intérim (le gérant ou le responsable le plus proche) qui prend la fonction risque par écrit en cas de départ. Au départ du seul Risk Manager : couper son accès le jour même, déclarer la vacance dans l'outil, faire statuer le gérant pendant au plus 90 jours (délai à valider PO)."
      },
      "PME": {
        "level": "exige",
        "action": "Un suppléant permanent par rôle clé (deuxième Risk Manager). Plan de remplacement écrit avec délai maximal de remplacement de 60 jours (à valider PO). Aucune vacance sans accord du directeur général."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Équipe et suppléants nommés, plan de succession pour chaque fonction de contrôle, intérim formel borné dans le temps, information du Comité de tout départ d'un membre d'Audit ou de Comité dans les 5 jours."
      }
    }
  },
  {
    "id": "GOV-AUD-01",
    "title": "Indépendance de l'Audit : informé, jamais décideur",
    "consequence": "Un auditeur qui a participé à une décision ne peut plus la contrôler librement. Les constats d'audit perdent leur valeur de preuve indépendante.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "informatif",
        "action": "Pas d'Audit interne : désigner un auditeur externe (commissaire aux comptes, cabinet, pair) qui lit le journal une fois par an. Ne pas créer de faux compte d'Audit."
      },
      "PME": {
        "level": "recommande",
        "action": "Une personne d'Audit ou de contrôle interne rattachée à la direction générale ou au conseil, sans droit d'écriture, qui reçoit les décisions prises en repli pour ratification."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Fonction d'audit interne rattachée au Comité d'audit ou au conseil. L'Audit est informé et ratifie, il ne décide jamais. Si une décision l'a impliqué, la mission correspondante est confiée à un autre auditeur."
      }
    }
  },
  {
    "id": "GOV-AUD-02",
    "title": "Une 3e ligne existe et sa visibilité n'est pas réduite par ceux qu'elle contrôle",
    "consequence": "Personne n'examine l'ensemble de la gouvernance en indépendance. Un administrateur peut réduire la vue de l'Audit sur ses propres actions sans que personne ne le sache.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "informatif",
        "action": "Pas de membre d'Audit : c'est attendu. Prévoir une revue externe annuelle du journal, et signaler dans le panel « aucun contre-pouvoir sur les droits d'Audit »."
      },
      "PME": {
        "level": "recommande",
        "action": "Nommer au moins un membre d'Audit ou de contrôle interne. À son arrivée, tout changement de ses droits passe par sa validation."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Au moins deux membres d'Audit actifs. Tout changement de leurs droits est validé par l'un d'eux ou par le Comité, jamais appliqué seul par un administrateur."
      }
    }
  },
  {
    "id": "GOV-COM-01",
    "title": "Supervision par un Comité des risques",
    "consequence": "Les risques les plus graves sont décidés sans instance collective. Les risques sensibles ne sont pas vus par la direction ; personne n'est prévenu quand le passage au Comité est supprimé.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Remplacer le Comité par une revue trimestrielle courte entre le gérant et le Risk Manager (30 minutes, compte rendu dans l'outil). Garder le seuil de passage au Comité configuré pour le jour où il existera."
      },
      "PME": {
        "level": "exige",
        "action": "Comité de 3 personnes (direction générale, finance, Risk Manager sans droit de vote sur ses propres dossiers), réuni chaque trimestre. Fixer les deux seuils de score."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Comité des risques formel avec charte, quorum, président non exécutif ou indépendant si possible, réunion mensuelle ou trimestrielle, comptes rendus et suivi des décisions."
      }
    }
  },
  {
    "id": "GOV-COM-02",
    "title": "Pas de validation tacite, ni par un seul membre du Comité",
    "consequence": "Une décision attribuée au Comité a été prise par une seule personne ou par défaut. Le Comité croit avoir approuvé ce qu'il n'a pas vu.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "informatif",
        "action": "Sans Comité, la décision du gérant est tracée avec son motif et marquée « sans second regard ». Elle est relue par un tiers externe au moins une fois par an."
      },
      "PME": {
        "level": "exige",
        "action": "Décision écrite d'au moins deux membres. En cas d'absence de quorum, escalade au directeur général, jamais de validation par défaut."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Quorum et majorité définis dans la charte du Comité, votes nominatifs motivés, ratification de tout repli à la séance suivante."
      }
    }
  },
  {
    "id": "GOV-APP-01",
    "title": "L'appétence est fixée par l'instance de gouvernance et ne se modifie pas pour faire disparaître un dépassement",
    "consequence": "Un risque qui dépasse la limite peut devenir acceptable en déplaçant la limite. La direction croit que les risques restent dans ce qu'elle a accepté.",
    "severity": "elevee",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Autoriser le gérant ou l'administrateur seul à fixer ses seuils, avec motif et marquage « sans second regard ». Faire valider le niveau d'appétence une fois par an par un tiers (conseil, associé)."
      },
      "PME": {
        "level": "exige",
        "action": "Faire approuver les seuils par le Comité ou la direction générale. Tout changement montre l'ancien et le nouveau dépassement pendant un cycle."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Appétence approuvée par le conseil ou le Comité, déclinée en limites, révisée annuellement, changement par le circuit du Dispositif (version, approbation d'un tiers, effet au cycle suivant)."
      }
    }
  },
  {
    "id": "GOV-OWN-01",
    "title": "Chaque risque a un propriétaire actif et la désignation est confirmée par un tiers",
    "consequence": "Un risque sans propriétaire n'est piloté par personne. Un propriétaire qui s'est désigné seul peut minimiser le risque qu'il porte.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Le gérant ou le responsable de service est propriétaire par défaut. Auto-désignation acceptée avec marquage ; revue annuelle de la liste par un tiers."
      },
      "PME": {
        "level": "exige",
        "action": "Le propriétaire du processus est propriétaire par défaut, puis assigne à son équipe. Le Risk Manager confirme les désignations ; aucun risque sans propriétaire plus de 30 jours (à valider PO)."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Propriétaire nommé dans la fiche de poste, remplacé dans les 10 jours en cas de départ, revue par la 2e ligne chaque trimestre, aucune auto-désignation."
      }
    }
  },
  {
    "id": "GOV-OWN-02",
    "title": "Propriétaire de processus = propriétaire par défaut des risques, avec un champion de risque par processus",
    "consequence": "Les risques d'un processus n'ont pas de responsable proche du terrain. Le Risk Manager les porte à la place des métiers, et la responsabilité se concentre sur la 2e ligne.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "informatif",
        "action": "Le gérant est propriétaire de tous les processus et champion unique. Se contenter d'une liste de 5 à 10 processus clés avec un nom pour chacun."
      },
      "PME": {
        "level": "exige",
        "action": "Un propriétaire nommé par processus (responsable de service) et un champion de risque dans son équipe. Le Risk Manager prépare la répartition, le propriétaire confirme."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Réseau de champions de risque dans chaque direction, formés, animés par la 2e ligne, avec réunions périodiques et objectifs inscrits dans leur évaluation annuelle."
      }
    }
  },
  {
    "id": "GOV-OWN-03",
    "title": "Celui qui rédige l'Analyse ne valide pas l'évaluation qui s'en nourrit",
    "consequence": "Le propriétaire du processus choisit les causes qui seront retenues, puis valide la cotation qui en découle, avec un intérêt à minimiser les causes de son propre processus.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "informatif",
        "action": "Admettre qu'une personne rédige l'Analyse et valide, avec le marquage « validateur auteur de l'Analyse » et relecture externe annuelle."
      },
      "PME": {
        "level": "recommande",
        "action": "Faire valider l'évaluation par le Risk Manager ou le Comité, jamais par le propriétaire du processus qui a rédigé l'Analyse."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Exclusion systématique de l'auteur de l'Analyse de la validation ; challenge de l'Analyse par la 2e ligne avant cotation."
      }
    }
  },
  {
    "id": "GOV-ACC-01",
    "title": "Moindre privilège : peu d'administrateurs, des rôles étroits",
    "consequence": "Un compte avec trop de droits, ou qui n'est plus utilisé, devient la porte d'entrée d'une erreur ou d'une fraude. Plus il y a d'administrateurs, plus l'effet d'un compte compromis est grand.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "recommande",
        "action": "Un administrateur principal et un secours (gérant ou prestataire). Pas plus de deux administrateurs. Revue annuelle de la liste des comptes."
      },
      "PME": {
        "level": "exige",
        "action": "Deux à trois administrateurs maximum, rôles nommés par fonction, revue semestrielle des droits et des comptes inactifs."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Administrateurs techniques distincts des fonctions de gouvernance, recertification trimestrielle, suspension automatique des comptes inactifs au-delà d'un délai à fixer."
      }
    }
  },
  {
    "id": "GOV-TRC-01",
    "title": "Toute décision sans seconde validation est tracée, motivée et visible",
    "consequence": "Une décision prise seule ne se distingue pas d'une décision contrôlée. Quand l'Audit ou le Comité arrive, il ne sait pas quoi rouvrir.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "exige",
        "action": "Toujours un motif écrit, une seconde confirmation, et un récapitulatif annuel des décisions sans second regard envoyé au gérant ou à un tiers externe."
      },
      "PME": {
        "level": "exige",
        "action": "Récapitulatif trimestriel au Comité ou à la direction ; chaque décision sans second regard est revue ou ratifiée dans les 90 jours (à valider PO)."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Les exceptions sont rares, datées, validées par le Comité, et leur nombre est un indicateur de risque (KRI) présenté au Comité et à l'Audit."
      }
    }
  },
  {
    "id": "GOV-TRC-02",
    "title": "Un gérant désigné est informé ou statue quand une règle ne peut pas être respectée",
    "consequence": "Quand le seul contrôle possible est de prévenir quelqu'un, personne n'est prévenu. Les décisions sans second regard n'ont aucun destinataire.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "exige",
        "action": "Désigner le gérant ou un conseil de confiance, qui reçoit un message à chaque décision sans second regard et chaque vacance de rôle clé."
      },
      "PME": {
        "level": "exige",
        "action": "Désigner le directeur général, avec un second destinataire (directeur financier ou juridique)."
      },
      "GRANDE_ENTREPRISE": {
        "level": "recommande",
        "action": "Remplacer par le Comité des risques et l'Audit, qui reçoivent ces informations par le circuit normal. Le gérant désigné reste un destinataire de secours."
      }
    }
  },
  {
    "id": "GOV-REG-01",
    "title": "Le régime « structure à une personne » est déclaré, affiché et levé à l'arrivée d'un tiers",
    "consequence": "Soit le client contourne l'outil avec un faux deuxième compte, soit le régime reste actif alors qu'un tiers existe et la double validation n'est plus exigée.",
    "severity": "moyenne",
    "indications": {
      "TPE": {
        "level": "exige",
        "action": "Régime déclaré à l'ouverture, affiché partout. Revue annuelle : « avons-nous une deuxième personne, interne ou externe, qui peut regarder ? »."
      },
      "PME": {
        "level": "exige",
        "action": "Le régime ne doit pas exister. Si le panel le détecte encore, c'est une anomalie à lever : nommer un second Risk Manager ou un validateur de repli."
      },
      "GRANDE_ENTREPRISE": {
        "level": "exige",
        "action": "Le régime ne doit pas exister. Sa détection est un incident de gouvernance à escalader au Comité."
      }
    }
  }
] as const satisfies readonly PrincipleEntry[];

export type PrincipleId = (typeof PRINCIPLES)[number]["id"];
