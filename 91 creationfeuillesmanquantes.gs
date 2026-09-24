/**
 * =====================================================================
 *  FICHIER  : 91_CreationFeuillesManquantes   type : Script (.gs)
 *  USAGE    : Outil ponctuel. Colle ce fichier, lance
 *             creerFeuillesManquantes() une fois (Exécuter > la fonction,
 *             ou via l'éditeur Apps Script), puis SUPPRIME ce fichier du
 *             projet : il ne fait pas partie du dispositif v10 et
 *             n'est volontairement pas raccordé au menu Risk Management.
 * =====================================================================
 *
 * Crée les 5 feuilles propres au projet, absentes du template GRC_DJAMO
 * (DEPARTEMENTS, ANOMALIES, PROCESSUS, IAM_PERMISSIONS, JOURNAL_GLOBAL),
 * avec leurs en-têtes en ligne 4 (HEADER_ROW), exactement comme les
 * dictionnaires de 02_Colonnes.gs les attendent. Idempotent : une feuille
 * déjà présente n'est jamais recréée ni modifiée. ### to delete after
 */

function creerFeuillesManquantes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const specs = [
    {
      nom: 'DEPARTEMENTS',
      entetes: ['ID Département', 'Nom département', 'Entité', 'Manager', 'Pilote de risque',
        'Pilote désigné par', 'Date désignation', 'Processus rattachés', 'Actif']
    },
    {
      nom: 'ANOMALIES',
      entetes: ['ID Anomalie', 'ID Contrôle', 'ID Exécution', 'ID Risque', 'Date constat',
        'Description', 'Gravité', 'Origine', 'Détecté par', 'Statut anomalie',
        'Actions associées', 'Date clôture', 'Commentaire clôture']
    },
    {
      nom: 'PROCESSUS',
      entetes: ['ID Processus', 'ID Processus parent', 'Niveau', 'Nom processus', 'Description',
        'Type de document', 'Document lié', 'Propriétaire', 'Actif']
    },
    {
      nom: 'IAM_PERMISSIONS',
      entetes: ['ID Permission', 'Type cible', 'Cible', 'Ressource', 'Lecture', 'Ecriture',
        'Validation', 'Admin']
    },
    {
      nom: 'JOURNAL_GLOBAL',
      entetes: ['ID Entrée', 'Date', 'Utilisateur', 'Objet', 'Action', 'Détail']
    }
  ];

  const rapport = [];
  specs.forEach(function (spec) {
    let sheet = ss.getSheetByName(spec.nom);
    if (sheet) {
      rapport.push(spec.nom + ' : déjà présente, non modifiée.');
      return;
    }
    sheet = ss.insertSheet(spec.nom);

    // Ligne 4 = HEADER_ROW (01_Parametres.gs). Les 3 lignes au-dessus
    // restent vides, comme sur les autres feuilles du template.
    sheet.getRange(4, 1, 1, spec.entetes.length)
      .setValues([spec.entetes])
      .setFontWeight('bold')
      .setBackground('#E2F0D9');
    sheet.setFrozenRows(4);
    sheet.autoResizeColumns(1, spec.entetes.length);

    rapport.push(spec.nom + ' : créée avec ' + spec.entetes.length + ' colonne(s), en-têtes en ligne 4.');
  });

  SpreadsheetApp.getUi().alert('Création des feuilles manquantes',
    rapport.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}
