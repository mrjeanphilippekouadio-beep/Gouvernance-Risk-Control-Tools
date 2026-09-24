/**
 * =====================================================================
 *  FICHIER  : 30_Cartographie         type : Script (.gs)
 *  SECTION  : MENU 3 · Cartographie
 *             > Générer l'image PNG (inhérent vs résiduel) -> genererCartographie
 *             > Effacer l'image de la feuille CARTOGRAPHIE  -> effacerCartographie
 *  VA AVEC  : UI_Cartographie (HTML)
 *  VERSION  : v10
 * =====================================================================
 *
 * Les deux grilles 5x5 de la feuille CARTOGRAPHIE sont vivantes et se
 * recalculent seules. Ce fichier en produit une IMAGE PNG, pour un rapport
 * ou un support de comite : les deux matrices, inherente et residuelle, cote
 * a cote, avec l'echelle de probabilite et l'echelle d'impact sur chacune.
 *
 * Le serveur fournit les donnees, la boite de dialogue dessine l'image, le
 * serveur la pose dans la feuille. Chaque generation remplace la precedente ;
 * seules les images portant le marqueur ci-dessous sont supprimees, un logo
 * ajoute a la main survit.
 */

const MARQUEUR_IMAGE = 'GRC_HEATMAP_PNG';
const MARQUEURS_ANCIENS = ['GRC_HEATMAP', 'GRC_HEATMAP_INH', 'GRC_HEATMAP_RES'];
const CARTO_LIGNE_IMAGE = 16;
const TAILLE_MAX_IMAGE = 2 * 1024 * 1024;   // limite Google pour une image posee sur une feuille

function genererCartographie() {
  assurerNiveauClasseur_();
  ouvrirDialogue_('UI_Cartographie', 'Cartographie des risques, image PNG', 1120, 800);
}

function effacerCartographie() {
  const sheet = getSheet(SHEETS.CARTOGRAPHIE);
  assurerTaille_(sheet, CARTO_LIGNE_IMAGE + 40, 14);
  const n = supprimerImagesCarto_(sheet);
  sheet.getRange(CARTO_LIGNE_IMAGE - 1, 1, 1, 14).clearContent();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    n ? n + ' image(s) supprimée(s).' : 'Aucune image de cartographie à supprimer.',
    'Cartographie', 5);
}

// ---------------------------------------------------------------- //
// Donnees appelees par la boite de dialogue
// ---------------------------------------------------------------- //

function nombre1a5_(v) {
  const n = Number(v);
  return (!isBlank(v) && !isNaN(n) && n >= 1 && n <= 5) ? Math.round(n) : null;
}

/**
 * Derniere evaluation de chaque risque, comme les grilles vivantes, ou
 * derniere evaluation VALIDEE si perimetre vaut 'validees'.
 */
function getDonneesCartographie(perimetre) {
  const map = mapRisques();
  const values = lireToutesLesLignes_();
  const ref = getReferentiels();
  const axes = ref.impact.axes;
  const colsInh = colonnesImpact_(SHEETS.RISQUES, axes, 'inh');
  const colsRes = colonnesImpact_(SHEETS.RISQUES, axes, 'res');
  const seulementValidees = perimetre === 'validees';
  const cibleValidee = normalizeText(STATUT_VALIDEE);

  const tous = {};
  const retenues = {};
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = lire_(row, map, 'ID_RISQUE');
    if (isBlank(id)) continue;
    tous[id] = true;
    if (!ligneCotee_(row, map)) continue;
    if (seulementValidees && normalizeText(lire_(row, map, 'STATUT_EVAL')) !== cibleValidee) continue;
    const d = lire_(row, map, 'DATE_EVAL');
    const t = d instanceof Date ? d.getTime() : 0;
    const prec = retenues[id];
    if (!prec || t > prec.t || (t === prec.t && i > prec.i)) retenues[id] = { row: row, t: t, i: i };
  }

  function phase(row, cleP, cleI, cols) {
    const p = nombre1a5_(lire_(row, map, cleP));
    let im = nombre1a5_(lire_(row, map, cleI));
    if (im === null) {
      const vals = cols.map(function (c) { return nombre1a5_(row[c - 1]); })
        .filter(function (v) { return v !== null; });
      im = vals.length ? Math.max.apply(null, vals) : null;
    }
    const s = (p && im) ? p * im : null;
    return { p: p, i: im, s: s, niveau: s ? calculateRiskLevel(s) : '' };
  }

  const entites = {};
  const risques = Object.keys(retenues).sort().map(function (id) {
    const row = retenues[id].row;
    const ent = String(lire_(row, map, 'ENTITE') || '');
    if (ent) entites[ent] = (entites[ent] || 0) + 1;
    return {
      id: String(id),
      court: String(id).split('-').pop(),
      intitule: String(lire_(row, map, 'INTITULE') || ''),
      sousCategorie: String(lire_(row, map, 'SOUS_CATEGORIE') || ''),
      statut: String(lire_(row, map, 'STATUT_EVAL') || ''),
      date: lire_(row, map, 'DATE_EVAL'),
      inh: phase(row, 'PROBA_INH', 'IMPACT_RETENU_INH', colsInh),
      res: phase(row, 'PROBA_RES', 'IMPACT_RETENU_RES', colsRes)
    };
  });

  const listeEntites = Object.keys(entites).sort(function (a, b) { return entites[b] - entites[a]; });
  const maintenant = new Date();
  const tz = Session.getScriptTimeZone();

  return pourClient_({
    perimetre: seulementValidees ? 'validees' : 'derniere',
    risques: risques,
    totalRisques: Object.keys(tous).length,
    entite: listeEntites.length === 1 ? listeEntites[0] : (listeEntites.length ? 'Groupe Djamo' : ''),
    seuils: seuilsNiveau_(),
    echelles: {
      probabilite: ref.probabilite.map(function (p) { return { niveau: p.niveau, libelle: String(p.libelle) }; }),
      impact: ref.impact.niveaux.map(function (n) {
        return { niveau: n.niveau, libelle: String(n.libelle).split('·').pop().trim() };
      })
    },
    methodologie: getActiveMethodologyVersion(),
    genereLe: Utilities.formatDate(maintenant, tz, 'dd/MM/yyyy') + ' à ' +
      Utilities.formatDate(maintenant, tz, 'HH:mm'),
    fichier: 'cartographie_risques_' + Utilities.formatDate(maintenant, tz, 'yyyy-MM-dd') + '.png',
    auteur: getCurrentUser()
  });
}

/**
 * Pose l'image PNG dessinee par la boite de dialogue dans la feuille
 * CARTOGRAPHIE, a la ligne CARTO_LIGNE_IMAGE, en remplacant la precedente.
 */
function poserImageCartographie(base64, legende) {
  if (isBlank(base64)) throw new Error("Image vide : rien n'a été posé dans la feuille.");
  const brut = String(base64).replace(/^data:image\/png;base64,/, '');
  const octets = Utilities.base64Decode(brut);
  if (octets.length > TAILLE_MAX_IMAGE) {
    throw new Error('Image trop lourde pour Google Sheets (' +
      Math.round(octets.length / 1024) + ' Ko, 2 048 Ko au plus).');
  }
  // Signature PNG. Les octets Apps Script sont signes : 0x89 vaut -119.
  if ((octets[0] & 0xff) !== 0x89 || octets[1] !== 0x50 || octets[2] !== 0x4E || octets[3] !== 0x47) {
    throw new Error("Le contenu reçu n'est pas une image PNG.");
  }

  const blob = Utilities.newBlob(octets, 'image/png', 'cartographie_risques.png');
  const sheet = getSheet(SHEETS.CARTOGRAPHIE);
  // L'image occupe une quarantaine de lignes sous l'ancre : elles doivent exister.
  assurerTaille_(sheet, CARTO_LIGNE_IMAGE + 40, 14);
  const remplacees = supprimerImagesCarto_(sheet);

  const img = sheet.insertImage(blob, 1, CARTO_LIGNE_IMAGE);
  img.setAltTextTitle(MARQUEUR_IMAGE);
  img.setAltTextDescription(legende || 'Cartographie des risques');

  sheet.getRange(CARTO_LIGNE_IMAGE - 1, 1).setValue(legende || '')
    .setFontStyle('italic').setFontSize(9).setFontColor('#5A6672');
  sheet.activate();
  SpreadsheetApp.flush();

  return pourClient_({ feuille: sheet.getName(), ligne: CARTO_LIGNE_IMAGE, remplacees: remplacees });
}

function supprimerImagesCarto_(sheet) {
  const marqueurs = [MARQUEUR_IMAGE].concat(MARQUEURS_ANCIENS);
  let n = 0;
  sheet.getImages().forEach(function (img) {
    if (marqueurs.indexOf(img.getAltTextTitle()) !== -1) { img.remove(); n++; }
  });
  return n;
}

// Marqueur lu par Administration > Contrôler l'installation. Ne pas modifier.
function fichier_30_Cartographie_() { return 'v10'; }
