/* ==========================================================================
   Valise — listes de voyage à cocher, personnalisées.
   100% local (localStorage), sans compte. Météo via Open-Meteo (sans clé).
   ========================================================================== */
'use strict';

/* -------------------------------------------------------------------------
   1. STOCKAGE LOCAL
   ------------------------------------------------------------------------- */
const APP_VERSION = 'v8';
const STORE_KEY = 'valise.v1';
const BACKUP_KEY = 'valise.backup'; // sauvegarde automatique de secours

let state = { trips: [] };
let route = { name: 'home', tripId: null }; // home | wizard | trip
let wizard = null; // brouillon en cours de création
let swReg = null;        // registration du service worker (pour la mise à jour manuelle)
let updateReady = false; // une nouvelle version est installée et prête à prendre la main

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = JSON.parse(raw);
    if (!Array.isArray(state.trips)) state.trips = [];
  } catch (e) {
    // Données principales illisibles : on tente la sauvegarde automatique.
    if (restoreFromBackup()) return;
    state = { trips: [] };
  }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    // Sauvegarde automatique : copie horodatée du dernier état valide, filet
    // de sécurité si le stockage principal est effacé ou corrompu.
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), version: APP_VERSION, data: state }));
    } catch (e) { /* backup best-effort */ }
  } catch (e) {
    toast('Sauvegarde impossible (stockage plein ?)');
  }
}
function readBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (b && b.data && Array.isArray(b.data.trips)) return b;
  } catch (e) { /* backup illisible */ }
  return null;
}
function restoreFromBackup() {
  const b = readBackup();
  if (!b) return false;
  state = b.data;
  if (!Array.isArray(state.trips)) state.trips = [];
  return true;
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

/* -------------------------------------------------------------------------
   2. OUTILS DATES
   ------------------------------------------------------------------------- */
function todayISO() {
  const d = new Date();
  return fmtISO(d);
}
function fmtISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d); // heure locale, pas UTC
}
function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
function nbNights(trip) { return Math.max(1, daysBetween(trip.startDate, trip.endDate)); }
function nbDaysInclusive(trip) { return nbNights(trip) + 1; }

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
function humanDayFull(iso) {
  const d = parseISO(iso);
  return JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()];
}
function humanDate(iso) {
  const d = parseISO(iso);
  return d.getDate() + ' ' + MOIS[d.getMonth()];
}
function humanRange(a, b) {
  const da = parseISO(a), db = parseISO(b);
  if (da.getFullYear() !== db.getFullYear())
    return humanDate(a) + ' ' + da.getFullYear() + ' → ' + humanDate(b) + ' ' + db.getFullYear();
  return humanDate(a) + ' → ' + humanDate(b) + ' ' + db.getFullYear();
}
function humanDateTime(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return d.getDate() + ' ' + MOIS[d.getMonth()] + ' à ' + hh + 'h' + mm;
}

/* -------------------------------------------------------------------------
   3. TYPES & STYLES DE VOYAGE
   ------------------------------------------------------------------------- */
const TRIP_TYPES = [
  { id: 'plage', label: 'Plage', emoji: '🏖️' },
  { id: 'montagne', label: 'Montagne', emoji: '⛰️' },
  { id: 'ville', label: 'Ville', emoji: '🏙️' },
  { id: 'roadtrip', label: 'Roadtrip', emoji: '🚗' },
  { id: 'camping', label: 'Camping', emoji: '⛺' },
  { id: 'ski', label: 'Ski / neige', emoji: '🎿' },
  { id: 'rando', label: 'Randonnée', emoji: '🥾' },
  { id: 'business', label: 'Pro / business', emoji: '💼' },
  { id: 'croisiere', label: 'Croisière', emoji: '🚢' },
  { id: 'festival', label: 'Festival', emoji: '🎪' },
  { id: 'bienetre', label: 'Bien-être / spa', emoji: '🧖' },
];
const TRIP_STYLES = [
  { id: 'budget', label: 'Petit budget', emoji: '💰' },
  { id: 'confort', label: 'Confort', emoji: '🛋️' },
  { id: 'luxe', label: 'Luxe', emoji: '✨' },
  { id: 'aventure', label: 'Aventure', emoji: '🧭' },
];
const TRANSPORTS = [
  { id: 'avion', label: 'Avion', emoji: '✈️' },
  { id: 'voiture', label: 'Voiture', emoji: '🚗' },
  { id: 'train', label: 'Train', emoji: '🚆' },
  { id: 'bateau', label: 'Bateau / ferry', emoji: '⛴️' },
];
function typeMeta(id) { return TRIP_TYPES.find(t => t.id === id); }
function tripEmoji(trip) {
  if (trip.types && trip.types.length) { const m = typeMeta(trip.types[0]); if (m) return m.emoji; }
  return '🧳';
}

/* -------------------------------------------------------------------------
   4. MÉTÉO — Open-Meteo (géocodage, prévision, historique de secours)
   ------------------------------------------------------------------------- */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Géocodage : nom de ville -> liste de lieux
async function geocode(name) {
  const url = 'https://geocoding-api.open-meteo.com/v1/search?count=6&language=fr&format=json&name=' + encodeURIComponent(name);
  const data = await fetchJSON(url);
  return (data.results || []).map(r => ({
    name: r.name,
    admin1: r.admin1 || '',
    country: r.country || '',
    countryCode: r.country_code || '',
    lat: r.latitude,
    lon: r.longitude,
  }));
}

// Drapeau emoji depuis le code pays ISO-2
function flagEmoji(cc) {
  if (!cc || cc.length !== 2) return '📍';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + cc.charCodeAt(0) - 65, A + cc.charCodeAt(1) - 65);
}

/* Récupère un résumé météo pour [start, end].
   - Prévision Open-Meteo si la période tombe dans les 16 prochains jours.
   - Sinon (ou pour la partie hors fenêtre), moyennes de l'an dernier (archive).
   Retourne { tmin, tmax, precipDays, nDays, source, codes } ou { error:true }. */
async function getWeather(lat, lon, start, end) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const horizon = addDays(today, 15); // Open-Meteo prévoit ~16 jours
  const startD = parseISO(start), endD = parseISO(end);

  // Map jour(ISO) -> {tmax,tmin,precip}
  const byDate = {};
  let usedForecast = false, usedArchive = false;

  // --- 1. Partie couverte par la prévision ---
  const fStart = new Date(Math.max(startD, today));
  const fEnd = new Date(Math.min(endD, horizon));
  if (fStart <= fEnd) {
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon
        + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode'
        + '&timezone=auto&start_date=' + fmtISO(fStart) + '&end_date=' + fmtISO(fEnd);
      const d = await fetchJSON(url);
      mergeDaily(byDate, d.daily);
      usedForecast = true;
    } catch (e) { /* on tentera l'historique */ }
  }

  // --- 2. Jours non couverts -> historique de l'an dernier (mêmes dates) ---
  const missing = [];
  for (let dd = new Date(startD); dd <= endD; dd = addDays(dd, 1)) {
    if (!byDate[fmtISO(dd)]) missing.push(new Date(dd));
  }
  if (missing.length) {
    // Un seul appel archive sur la plage décalée d'un an, puis on recale par jour/mois.
    const aStart = addDays(startD, -365), aEnd = addDays(endD, -365);
    try {
      const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat + '&longitude=' + lon
        + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum'
        + '&timezone=auto&start_date=' + fmtISO(aStart) + '&end_date=' + fmtISO(aEnd);
      const d = await fetchJSON(url);
      const histByMD = {};
      const t = d.daily && d.daily.time || [];
      for (let i = 0; i < t.length; i++) {
        const md = t[i].slice(5); // MM-DD
        histByMD[md] = {
          tmax: d.daily.temperature_2m_max[i],
          tmin: d.daily.temperature_2m_min[i],
          precip: d.daily.precipitation_sum[i],
        };
      }
      for (const dd of missing) {
        const md = fmtISO(dd).slice(5);
        if (histByMD[md]) { byDate[fmtISO(dd)] = histByMD[md]; usedArchive = true; }
      }
    } catch (e) { /* historique indisponible */ }
  }

  const keys = Object.keys(byDate);
  if (!keys.length) return { error: true };

  let tmin = Infinity, tmax = -Infinity, precipDays = 0, precipTotal = 0;
  for (const k of keys) {
    const v = byDate[k];
    if (typeof v.tmin === 'number') tmin = Math.min(tmin, v.tmin);
    if (typeof v.tmax === 'number') tmax = Math.max(tmax, v.tmax);
    if (typeof v.precip === 'number') { precipTotal += v.precip; if (v.precip >= 1) precipDays++; }
  }
  const days = keys.slice().sort().map(k => ({
    date: k,
    tmin: byDate[k].tmin,
    tmax: byDate[k].tmax,
    precip: byDate[k].precip,
  }));

  return {
    tmin: Math.round(tmin),
    tmax: Math.round(tmax),
    precipDays,
    precipTotal: Math.round(precipTotal),
    nDays: keys.length,
    source: usedForecast && !usedArchive ? 'forecast' : (usedForecast ? 'mixte' : 'archive'),
    days,
  };
}

function mergeDaily(byDate, daily) {
  if (!daily || !daily.time) return;
  for (let i = 0; i < daily.time.length; i++) {
    byDate[daily.time[i]] = {
      tmax: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
      tmin: daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
      precip: daily.precipitation_sum ? daily.precipitation_sum[i] : null,
    };
  }
}

// Traduit le résumé météo en libellé + icône + drapeaux utiles pour les règles
function weatherView(w) {
  if (!w || w.error) {
    return { ico: '🌡️', title: 'Météo indisponible', desc: 'Liste générée sans la météo. Vérifie la connexion.', cls: 'err' };
  }
  const hot = w.tmax >= 27, warm = w.tmax >= 21, cold = w.tmin <= 5, cool = w.tmin <= 12;
  const rainy = w.precipDays >= Math.max(1, Math.ceil(w.nDays * 0.35)) || w.precipTotal >= 15;
  let ico = '🌤️';
  if (rainy) ico = '🌧️'; else if (hot) ico = '☀️'; else if (cold) ico = '❄️'; else if (warm) ico = '🌤️'; else ico = '⛅';
  const parts = [];
  parts.push(w.tmin + '°/' + w.tmax + '°C');
  if (rainy) parts.push('pluie probable (' + w.precipDays + ' j)');
  else parts.push('temps plutôt sec');
  const srcLabel = w.source === 'forecast' ? 'Prévision Open-Meteo'
    : w.source === 'mixte' ? 'Prévision + moyennes saisonnières'
    : 'Moyennes saisonnières (an dernier)';
  return {
    ico,
    title: parts.join(' · '),
    desc: srcLabel,
    cls: w.source === 'forecast' ? '' : 'est',
    flags: { hot, warm, cold, cool, rainy },
  };
}

// Icône météo pour une seule journée (à partir de sa température et de sa pluie).
function dayIcon(d) {
  if (typeof d.precip === 'number' && d.precip >= 1) return '🌧️';
  if (typeof d.tmax === 'number' && d.tmax >= 27) return '☀️';
  if (typeof d.tmin === 'number' && d.tmin <= 5) return '❄️';
  if (typeof d.tmax === 'number' && d.tmax >= 21) return '🌤️';
  return '⛅';
}

/* -------------------------------------------------------------------------
   5. MOTEUR DE RÈGLES — génère la liste d'items
   ------------------------------------------------------------------------- */
const CATS = ['À faire avant de partir', 'Documents & argent', 'Vêtements', 'Toilette & santé', 'Électronique',
  'Plage', 'Montagne & rando', 'Ski', 'Camping', 'Roadtrip', 'Business', 'Enfants', 'Divers'];

function qty(days, perDay, cap) { return Math.min(cap, Math.max(1, Math.ceil(days * perDay))); }
// Quantité totale pour le groupe : quantité par personne (plafonnée) × nombre de personnes.
function qtyLabel(name, days, perDay, cap, nbPeople) {
  const total = qty(days, perDay, cap) * Math.max(1, nbPeople);
  return name + ' · ' + total + (nbPeople > 1 ? ' (' + nbPeople + ' pers.)' : '');
}

function generateItems(trip, wflags) {
  const items = [];
  const seen = new Set();
  const add = (label, cat, why) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ id: uid(), label, cat, why: why || '', checked: false, custom: false });
  };

  const days = nbDaysInclusive(trip);
  const nights = nbNights(trip);
  const kids = trip.children || [];
  const people = trip.adults + kids.length;
  // Personnes qui portent des vêtements "adultes" (bébés ≤ 2 ans habillés via la section Enfants).
  const clothingPeople = Math.max(1, trip.adults + kids.filter(a => a > 2).length);
  const abroad = trip.countryCode && trip.countryCode.toUpperCase() !== 'FR';
  const types = trip.types || [];
  const has = (t) => types.includes(t);
  const transport = trip.transport || '';
  const f = wflags || {};

  /* --- À faire avant de partir (tâches, pas des objets) --- */
  const AV = 'À faire avant de partir';
  add('Charger tous les appareils la veille', AV);
  add('Vérifier fenêtres et portes fermées', AV);
  add('Baisser le chauffage / couper l’eau si besoin', AV);
  add('Débrancher les appareils inutiles', AV);
  add('Sortir les poubelles / vider le frigo', AV);
  if (nights >= 4) add('Faire suivre ou suspendre le courrier', AV, 'Absence prolongée');
  add('Prévenir un proche ou un voisin', AV);
  add('Laisser un double des clés à quelqu’un de confiance', AV);
  add('Faire garder animaux / arroser les plantes', AV);
  if (abroad) {
    add('Vérifier la validité du passeport (6 mois)', AV, 'Voyage à l’étranger');
    add('Prévenir la banque du voyage à l’étranger', AV);
    add('Activer une option data / carte SIM locale', AV);
  }
  if (transport === 'avion') {
    add('Enregistrement en ligne + carte d’embarquement', AV, 'Vol');
    add('Vérifier poids et dimensions des bagages', AV, 'Vol');
  }
  if (transport === 'voiture' || has('roadtrip')) {
    add('Faire le plein et vérifier les pneus', AV, 'Trajet en voiture');
    add('Vérifier niveaux (huile, lave-glace)', AV);
  }
  if (transport === 'train') add('Billets de train / QR code enregistrés', AV, 'Train');

  /* --- Documents & argent (toujours) --- */
  add(abroad ? 'Passeport' : "Carte d'identité", 'Documents & argent');
  add('Carte bancaire', 'Documents & argent');
  add('Un peu d’espèces', 'Documents & argent');
  add('Billets de transport / réservations', 'Documents & argent');
  add('Permis de conduire', 'Documents & argent');
  if (abroad) {
    add('Passeport valide (vérifier la date)', 'Documents & argent', 'Voyage à l’étranger');
    add('Assurance / assistance voyage', 'Documents & argent', 'Voyage à l’étranger');
    add('Carte Vitale / carte d’assurance santé', 'Documents & argent');
    add('Copies (papier + photo) des documents', 'Documents & argent', 'En cas de perte');
    add('Adaptateur de prise', 'Électronique', 'Prises différentes à l’étranger');
  }

  /* --- Vêtements (selon durée + météo + nombre de personnes) --- */
  add(qtyLabel('Sous-vêtements', days, 1, 12, clothingPeople), 'Vêtements');
  add(qtyLabel('Chaussettes', days, 1, 12, clothingPeople), 'Vêtements');
  add('Pyjama', 'Vêtements');
  add('Tenue confortable pour voyager', 'Vêtements');
  if (f.hot || f.warm) {
    add(qtyLabel('T-shirts', days, 0.8, 10, clothingPeople), 'Vêtements', 'Il va faire chaud');
    add(qtyLabel('Short / jupe', days, 0.5, 5, clothingPeople), 'Vêtements', 'Il va faire chaud');
    add('Vêtements légers et respirants', 'Vêtements');
  } else {
    add(qtyLabel('Hauts / pulls', days, 0.6, 8, clothingPeople), 'Vêtements');
    add(qtyLabel('Pantalons', days, 0.35, 4, clothingPeople), 'Vêtements');
  }
  if (f.hot) {
    add('Casquette / chapeau', 'Vêtements', 'Forte chaleur / soleil');
    add('Lunettes de soleil', 'Vêtements', 'Fort soleil');
  }
  if (f.cool) {
    add('Pull chaud / sweat', 'Vêtements', 'Les soirées seront fraîches');
    add('Veste', 'Vêtements', 'Températures fraîches');
  }
  if (f.cold) {
    add('Manteau chaud', 'Vêtements', 'Il va faire froid');
    add('Bonnet, gants, écharpe', 'Vêtements', 'Il va faire froid');
    add('Sous-couche thermique', 'Vêtements', 'Grand froid');
  }
  if (f.rainy) {
    add('Imperméable / coupe-vent', 'Vêtements', 'Pluie annoncée');
    add('Parapluie compact', 'Divers', 'Pluie annoncée');
    add('Chaussures imperméables', 'Vêtements', 'Pluie annoncée');
  }
  add('Chaussures confortables', 'Vêtements');

  /* --- Toilette & santé (toujours) --- */
  add('Brosse à dents + dentifrice', 'Toilette & santé');
  add('Gel douche / savon', 'Toilette & santé');
  add('Shampooing', 'Toilette & santé');
  add('Déodorant', 'Toilette & santé');
  add('Brosse / peigne', 'Toilette & santé');
  add('Trousse à pharmacie (pansements, doliprane…)', 'Toilette & santé');
  add('Médicaments personnels + ordonnance', 'Toilette & santé');
  add('Mouchoirs', 'Toilette & santé');
  if (f.hot || has('plage') || has('montagne') || has('ski') || has('rando')) {
    add('Crème solaire', 'Toilette & santé', 'Exposition au soleil');
  }
  if (people >= 2) add('Nécessaire de rasage / épilation', 'Toilette & santé');
  if (transport === 'avion') {
    add('Liquides ≤ 100 ml dans un sac transparent', 'Toilette & santé', 'Contrôle cabine avion');
    add('Médicaments en cabine avec ordonnance', 'Toilette & santé', 'Vol');
  }

  /* --- Électronique (toujours) --- */
  add('Téléphone', 'Électronique');
  add('Chargeur de téléphone', 'Électronique');
  add('Batterie externe', 'Électronique');
  add('Écouteurs / casque', 'Électronique');
  if (nights >= 3) add('Multiprise / chargeur multiple', 'Électronique');
  if (transport === 'avion') {
    add('Batterie externe en bagage cabine (interdite en soute)', 'Électronique', 'Règle avion');
  }

  /* --- Par type de voyage --- */
  if (has('plage')) {
    add(qtyLabel('Maillot de bain', days, 0.3, 3, clothingPeople), 'Plage');
    add('Serviette de plage', 'Plage');
    add('Tongs / claquettes', 'Plage');
    add('Lunettes de soleil', 'Plage');
    add('Chapeau / casquette', 'Plage');
    add('Sac étanche pour le téléphone', 'Plage');
    add('Après-soleil / hydratant', 'Plage');
  }
  if (has('montagne') || has('rando')) {
    add('Chaussures de randonnée', 'Montagne & rando');
    add('Sac à dos de journée', 'Montagne & rando');
    add('Gourde / poche à eau', 'Montagne & rando');
    add('Coupe-vent / veste imperméable', 'Montagne & rando');
    add('Bâtons de marche', 'Montagne & rando');
    add('Encas énergétiques (barres, fruits secs)', 'Montagne & rando');
    add('Casquette + crème solaire (altitude)', 'Montagne & rando');
    add('Petite trousse premiers secours', 'Montagne & rando');
  }
  if (has('ville')) {
    add('Chaussures de marche confortables', 'Vêtements', 'Beaucoup de marche en ville');
    add('Sac à dos / sac à main sécurisé', 'Divers');
    add('Tenue un peu habillée (resto / sortie)', 'Vêtements');
    add('Plan / guide / appli hors-ligne', 'Divers');
  }
  if (has('roadtrip')) {
    add('Chargeur voiture / allume-cigare', 'Roadtrip');
    add('Support téléphone / GPS', 'Roadtrip');
    add('Playlist / musique hors-ligne', 'Roadtrip');
    add('Encas et boissons pour la route', 'Roadtrip');
    add('Oreiller de voyage', 'Roadtrip');
    add('Documents du véhicule + assurance', 'Roadtrip');
    add('Gilet jaune + triangle', 'Roadtrip');
  }
  if (has('camping')) {
    add('Tente', 'Camping');
    add('Sac de couchage', 'Camping');
    add('Matelas / tapis de sol', 'Camping');
    add('Lampe frontale + piles', 'Camping');
    add('Réchaud + gaz', 'Camping');
    add('Briquet / allumettes', 'Camping');
    add('Popote / couverts réutilisables', 'Camping');
    add('Couteau multifonction', 'Camping');
    add('Anti-moustiques', 'Camping');
    add('Sacs poubelle', 'Camping');
  }
  if (has('ski')) {
    add('Combinaison / veste + pantalon de ski', 'Ski');
    add('Gants de ski', 'Ski');
    add('Masque / lunettes de ski', 'Ski');
    add('Bonnet + cache-cou', 'Ski');
    add('Sous-vêtements thermiques', 'Ski');
    add('Chaussettes de ski', 'Ski');
    add('Après-ski / chaussures chaudes', 'Ski');
    add('Crème solaire haute protection + stick lèvres', 'Ski');
  }
  if (has('business')) {
    add('Tenue professionnelle', 'Business');
    add('Chaussures habillées', 'Business');
    add('Ordinateur portable + chargeur', 'Business');
    add('Cartes de visite', 'Business');
    add('Documents / dossiers de travail', 'Business');
    add('Bloc-notes + stylo', 'Business');
  }
  if (has('croisiere')) {
    add('Documents d’embarquement de la croisière', 'Documents & argent');
    add('Médicaments contre le mal de mer', 'Toilette & santé', 'Croisière');
    add('Tenue habillée pour les dîners', 'Vêtements', 'Croisière');
    add('Maillot de bain', 'Divers', 'Croisière');
    add('Petit sac pour les escales / excursions', 'Divers');
    add('Chaussures de pont antidérapantes', 'Vêtements');
  }
  if (has('festival')) {
    add('Billets / bracelet du festival', 'Documents & argent', 'Festival');
    add('Bouchons d’oreilles', 'Divers', 'Festival');
    add('Poncho / K-way de pluie', 'Divers', 'Festival');
    add('Batterie externe grande capacité', 'Électronique', 'Festival');
    add('Chaussures fermées confortables', 'Vêtements', 'Festival');
    add('Un peu d’espèces (paiement sur place)', 'Documents & argent');
    add('Gourde vide (remplissage sur place)', 'Divers');
    add('Lingettes + gel hydroalcoolique', 'Toilette & santé');
  }
  if (has('bienetre')) {
    add('Maillot de bain (spa / thermes)', 'Divers', 'Bien-être');
    add('Tongs / claquettes', 'Divers', 'Bien-être');
    add('Peignoir (si non fourni)', 'Vêtements');
    add('Bonnet de bain', 'Divers');
    add('Tenue de détente confortable', 'Vêtements');
    add('Crème hydratante / soins', 'Toilette & santé');
    add('Livre / carnet', 'Divers');
  }
  if (transport === 'bateau' || has('croisiere')) {
    add('Médicaments contre le mal de mer', 'Toilette & santé', 'Traversée en bateau');
  }
  if (transport === 'train') {
    add('Billets de train / QR code', 'Documents & argent', 'Train');
    add('Encas et boisson pour le trajet', 'Divers');
  }

  /* --- Enfants (selon âge) --- */
  kids.forEach((age, i) => {
    const n = kids.length > 1 ? ' (enfant ' + (i + 1) + ', ' + age + ' ans)' : '';
    if (age <= 2) {
      add('Couches' + n, 'Enfants', 'Bébé');
      add('Lingettes + change' + n, 'Enfants', 'Bébé');
      add('Biberons + lait / repas' + n, 'Enfants', 'Bébé');
      add('Body et pyjamas bébé' + n, 'Enfants', 'Bébé');
      add('Doudou / tétine' + n, 'Enfants', 'Bébé');
      add('Poussette', 'Enfants');
      add('Porte-bébé', 'Enfants');
      add('Thermomètre + doliprane enfant' + n, 'Enfants');
      add('Bavoirs', 'Enfants');
    } else if (age <= 6) {
      add('Doudou' + n, 'Enfants');
      add('Rechange complet (petits accidents)' + n, 'Enfants');
      add('Jouets / livres' + n, 'Enfants');
      add('Encas et gourde' + n, 'Enfants');
      add('Siège auto / réhausseur', 'Enfants');
      add('Lingettes + gel hydroalcoolique', 'Enfants');
    } else if (age <= 12) {
      add('Livres / jeux / cahier' + n, 'Enfants');
      add('Tablette + écouteurs' + n, 'Enfants');
      add('Doudou éventuel' + n, 'Enfants');
      add('Encas' + n, 'Enfants');
    } else {
      add('Chargeur + écouteurs' + n, 'Enfants');
    }
    if ((has('plage')) && age <= 8) add('Brassards / bouée' + n, 'Enfants', 'Plage avec enfant');
    if ((has('plage')) && age <= 8) add('Jeux de plage (seau, pelle)' + n, 'Enfants', 'Plage avec enfant');
  });

  /* --- Style de voyage --- */
  if (trip.style === 'budget') {
    add('Gourde réutilisable', 'Divers', 'Petit budget');
    add('Encas / repas maison pour le trajet', 'Divers', 'Petit budget');
    add('Sac de courses pliable', 'Divers', 'Petit budget');
  } else if (trip.style === 'luxe') {
    add('Tenue habillée / de soirée', 'Vêtements', 'Voyage confort/luxe');
    add('Accessoires (bijoux, montre)', 'Divers');
    add('Trousse de soins / cosmétiques', 'Toilette & santé');
  } else if (trip.style === 'aventure') {
    add('Trousse premiers secours complète', 'Divers', 'Aventure');
    add('Couteau multifonction', 'Divers', 'Aventure');
    add('Lampe frontale', 'Divers', 'Aventure');
    add('Boussole / GPS + carte papier', 'Divers', 'Aventure');
    add('Filtre / pastilles à eau', 'Divers', 'Aventure');
  }

  /* --- Divers utiles (toujours) --- */
  add('Sac à dos / sac de jour', 'Divers');
  add('Bouteille / gourde d’eau', 'Divers');
  add('Sacs plastique pour linge sale', 'Divers');
  add('Cadenas', 'Divers');
  if (nights >= 2) add('Trousse de couture / kit de secours', 'Divers');
  if (people >= 2 || kids.length) add('Jeu de cartes / petits jeux', 'Divers');

  return items;
}

/* Fusionne une liste régénérée avec l'ancienne pour ne rien perdre :
   - conserve l'état coché des objets qui existent toujours (repérés par leur nom) ;
   - garde les objets ajoutés ou modifiés à la main (custom) absents de la nouvelle liste. */
function mergeItems(oldItems, newItems) {
  const oldByKey = {};
  (oldItems || []).forEach(i => { oldByKey[i.label.toLowerCase()] = i; });
  const result = newItems.map(ni => {
    const oi = oldByKey[ni.label.toLowerCase()];
    return oi ? Object.assign({}, ni, { checked: oi.checked }) : ni;
  });
  const newKeys = new Set(newItems.map(i => i.label.toLowerCase()));
  (oldItems || []).forEach(oi => {
    if (oi.custom && !newKeys.has(oi.label.toLowerCase())) result.push(oi);
  });
  return result;
}

/* -------------------------------------------------------------------------
   6. RENDU — routeur simple
   ------------------------------------------------------------------------- */
const elView = () => document.getElementById('view');
const elTop = () => document.getElementById('topbar');

// Image de fond d'un voyage (photos embarquées, libres de droits).
// Priorité au PAYS de la destination ; à défaut, photo du TYPE de voyage.
const TYPE_BG = { plage:1, montagne:1, ville:1, roadtrip:1, camping:1, ski:1, rando:1, business:1, croisiere:1, festival:1, bienetre:1 };
const COUNTRY_BG = { fr:1, es:1, it:1, gb:1, de:1, nl:1, ch:1, gr:1, pt:1, tr:1, ma:1, eg:1, us:1, ca:1, mx:1, jp:1, th:1, id:1 };
// Ces types priment sur le pays : la scène (plage, ski) est plus parlante que la capitale.
const TYPE_FIRST = { plage:1, ski:1 };
function tripBg(trip) {
  const types = trip.types || [];
  const forced = types.find(x => TYPE_FIRST[x]);
  if (forced) return 'img/bg-' + forced + '.jpg';
  const cc = (trip.countryCode || '').toLowerCase();
  if (COUNTRY_BG[cc]) return 'img/pays-' + cc + '.jpg';
  const t = types.find(x => TYPE_BG[x]);
  return 'img/bg-' + (t || 'home') + '.jpg';
}

function render() {
  elTop().style.backgroundImage = ''; // réinitialise le fond photo (remis par renderTrip)
  if (route.name === 'home') return renderHome();
  if (route.name === 'wizard') return renderWizard();
  if (route.name === 'trip') return renderTrip();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- ACCUEIL ---------- */
function renderHome() {
  elTop().innerHTML = `<div class="tb-title">🧳 Valise<span class="tb-sub">Tes listes de voyage</span></div>
    <button class="tb-action" id="h-settings" aria-label="Réglages">⚙️</button>`;
  const trips = state.trips.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  let html = `<div class="hero"><h1>Prêt à partir ?</h1><p>Crée une liste personnalisée selon ta destination et la météo.</p></div>`;

  if (!trips.length) {
    html += `<div class="empty"><div class="big">🏝️</div><p>Aucune liste pour l’instant.<br>Appuie sur le bouton <b>+</b> pour créer ton premier voyage.</p></div>`;
  } else {
    html += trips.map(t => {
      const total = t.items.length;
      const done = t.items.filter(i => i.checked).length;
      const pct = total ? Math.round(done / total * 100) : 0;
      return `<div class="card trip-card" data-open="${t.id}" style="background-image:url('${tripBg(t)}')">
        <div class="tc-emoji">${tripEmoji(t)}</div>
        <div class="tc-body">
          <div class="tc-name">${esc(t.name)}</div>
          <div class="tc-meta">${esc(humanRange(t.startDate, t.endDate))} · ${t.adults + (t.children ? t.children.length : 0)} pers.</div>
          <div class="tc-prog"><i style="width:${pct}%"></i></div>
          <div class="tc-count">${done}/${total} préparés</div>
        </div>
      </div>`;
    }).join('');
  }

  elView().innerHTML = html + `<button class="fab" id="fab-new" aria-label="Nouveau voyage">＋</button>`;
}

/* ---------- WIZARD (formulaire en étapes) ---------- */
function newWizard(trip) {
  if (trip) {
    // Mode édition : on repart des données du voyage existant.
    wizard = {
      step: 0,
      editId: trip.id,
      name: trip.name || '',
      destination: trip.destination || '',
      place: {
        name: trip.destination || trip.name, admin1: '',
        country: trip.country || '', countryCode: trip.countryCode || '',
        lat: trip.lat, lon: trip.lon,
      },
      geoResults: null,
      geoLoading: false,
      startDate: trip.startDate,
      endDate: trip.endDate,
      adults: trip.adults,
      children: (trip.children || []).slice(),
      types: (trip.types || []).slice(),
      style: trip.style || '',
      transport: trip.transport || '',
    };
    return;
  }
  wizard = {
    step: 0,
    editId: null,
    name: '',
    destination: '',
    place: null,   // {name, admin1, country, countryCode, lat, lon}
    geoResults: null,
    geoLoading: false,
    startDate: fmtISO(addDays(new Date(), 14)),
    endDate: fmtISO(addDays(new Date(), 21)),
    adults: 2,
    children: [],  // âges
    types: [],
    style: '',
    transport: '',
  };
}
const WSTEPS = 3;

function renderWizard() {
  const w = wizard;
  elTop().innerHTML = `<button class="tb-back" id="w-back">‹</button>
    <div class="tb-title">${w.editId ? 'Modifier le voyage' : 'Nouveau voyage'}<span class="tb-sub">Étape ${w.step + 1} sur ${WSTEPS}</span></div>`;

  let body = `<div class="steps">` +
    Array.from({ length: WSTEPS }, (_, i) => `<i class="${i <= w.step ? 'done' : ''}"></i>`).join('') +
    `</div>`;

  if (w.step === 0) body += stepDestination(w);
  if (w.step === 1) body += stepPeople(w);
  if (w.step === 2) body += stepTypeStyle(w);

  // Barre d'action
  const isLast = w.step === WSTEPS - 1;
  const nextLabel = isLast ? (w.editId ? '✅ Enregistrer les modifications' : '🧳 Générer ma liste') : 'Continuer';
  const canNext = stepValid(w);
  body += `<div class="mt">
    <button class="btn btn-primary btn-block" id="w-next" ${canNext ? '' : 'disabled'}>${nextLabel}</button>
    ${w.step > 0 ? `<button class="btn btn-ghost btn-block mt" id="w-prev">Revenir en arrière</button>` : ''}
  </div>`;

  elView().innerHTML = body;
}

function stepDestination(w) {
  let geo = '';
  if (w.place) {
    geo = `<div class="geo-picked">
      <span>${flagEmoji(w.place.countryCode)} ${esc(w.place.name)}${w.place.admin1 ? ', ' + esc(w.place.admin1) : ''} · ${esc(w.place.country)}</span>
      <button id="geo-clear">changer</button>
    </div>`;
  } else if (w.geoLoading) {
    geo = `<div class="spinner"></div>`;
  } else if (w.geoResults) {
    geo = w.geoResults.length
      ? `<div class="geo-results">` + w.geoResults.map((r, i) =>
          `<button class="geo-item" data-geo="${i}"><span class="flag">${flagEmoji(r.countryCode)}</span>${esc(r.name)}<span class="sub"> — ${esc(r.admin1 ? r.admin1 + ', ' : '')}${esc(r.country)}</span></button>`
        ).join('') + `</div>`
      : `<p class="center-msg">Aucun lieu trouvé. Vérifie l’orthographe.</p>`;
  }

  return `<div class="card">
    <div class="field">
      <label>Où pars-tu ?</label>
      <div class="hint">Ville ou pays. On récupère la météo prévue pour ce lieu.</div>
      <div class="row2" style="gap:8px">
        <div class="field" style="margin:0;flex:1"><input type="text" id="w-dest" placeholder="Ex : Barcelone" value="${esc(w.destination)}" autocomplete="off" /></div>
        <button class="btn btn-primary" id="geo-search" style="min-width:64px">🔍</button>
      </div>
      ${geo}
    </div>
  </div>
  <div class="card">
    <div class="row2">
      <div class="field"><label>Date de départ</label><input type="date" id="w-start" value="${w.startDate}" /></div>
      <div class="field"><label>Date de retour</label><input type="date" id="w-end" value="${w.endDate}" /></div>
    </div>
    <div class="hint" id="w-duration">${durationHint(w)}</div>
  </div>`;
}

function durationHint(w) {
  if (!w.startDate || !w.endDate) return '';
  const n = daysBetween(w.startDate, w.endDate);
  if (n < 0) return '⚠️ La date de retour est avant le départ.';
  if (n === 0) return 'Voyage à la journée.';
  return `${n} nuit${n > 1 ? 's' : ''} · ${n + 1} jours.`;
}

function stepPeople(w) {
  return `<div class="card">
    <div class="field">
      <label>Combien d’adultes ?</label>
      <div class="stepper">
        <button data-adj="adults" data-d="-1">−</button>
        <span class="val" id="v-adults">${w.adults}</span>
        <button data-adj="adults" data-d="1">＋</button>
      </div>
    </div>
    <hr class="sep" />
    <div class="field">
      <label>Combien d’enfants ?</label>
      <div class="hint">On adapte la liste à leur âge (couches, jouets, etc.).</div>
      <div class="stepper">
        <button data-adj="kids" data-d="-1">−</button>
        <span class="val" id="v-kids">${w.children.length}</span>
        <button data-adj="kids" data-d="1">＋</button>
      </div>
    </div>
    ${w.children.length ? `<div class="kids mt">` + w.children.map((age, i) =>
      `<div class="kid-row">
        <label>Âge de l’enfant ${i + 1}</label>
        <select data-kid="${i}">
          ${Array.from({ length: 18 }, (_, a) => `<option value="${a}" ${a === age ? 'selected' : ''}>${a === 0 ? 'moins d’1 an' : a + ' an' + (a > 1 ? 's' : '')}</option>`).join('')}
        </select>
      </div>`).join('') + `</div>` : ''}
  </div>`;
}

function stepTypeStyle(w) {
  return `<div class="card">
    <div class="field">
      <label>Type de voyage</label>
      <div class="hint">Choisis un ou plusieurs types.</div>
      <div class="chips">${TRIP_TYPES.map(t =>
        `<button class="chip ${w.types.includes(t.id) ? 'on' : ''}" data-type="${t.id}">${t.emoji} ${t.label}</button>`).join('')}</div>
    </div>
  </div>
  <div class="card">
    <div class="field">
      <label>Comment voyages-tu ? <span style="color:var(--muted);font-weight:400">(optionnel)</span></label>
      <div class="hint">Pour adapter la liste (règles avion, plein d’essence, billets…).</div>
      <div class="chips">${TRANSPORTS.map(t =>
        `<button class="chip ${w.transport === t.id ? 'on' : ''}" data-transport="${t.id}">${t.emoji} ${t.label}</button>`).join('')}</div>
    </div>
  </div>
  <div class="card">
    <div class="field">
      <label>Style de voyage <span style="color:var(--muted);font-weight:400">(optionnel)</span></label>
      <div class="chips">${TRIP_STYLES.map(s =>
        `<button class="chip ${w.style === s.id ? 'on' : ''}" data-style="${s.id}">${s.emoji} ${s.label}</button>`).join('')}</div>
    </div>
  </div>`;
}

function stepValid(w) {
  if (w.step === 0) return !!w.place && daysBetween(w.startDate, w.endDate) >= 0;
  if (w.step === 1) return w.adults + w.children.length >= 1 && w.children.every(a => a >= 0);
  if (w.step === 2) return w.types.length >= 1;
  return true;
}

/* ---------- TRIP (checklist) ---------- */
let tripUi = { id: null, expanded: {} }; // catégories dépliées à la main (état d'affichage, non sauvegardé)

function renderTrip() {
  const t = state.trips.find(x => x.id === route.tripId);
  if (!t) { route = { name: 'home' }; return render(); }

  // Nouveau voyage à l'écran : on repart d'un état d'affichage neuf.
  if (tripUi.id !== t.id) tripUi = { id: t.id, expanded: {} };

  // Rafraîchissement de la météo en tâche de fond si elle est ancienne (ne bloque pas le rendu).
  maybeRefreshWeather(t);

  const total = t.items.length;
  const done = t.items.filter(i => i.checked).length;
  const pct = total ? Math.round(done / total * 100) : 0;

  elTop().innerHTML = `<button class="tb-back" id="t-back">‹</button>
    <div class="tb-title">${esc(t.name)}<span class="tb-sub">${esc(humanRange(t.startDate, t.endDate))}</span></div>
    <button class="tb-action" id="t-menu">⋯</button>`;
  // Fond photo du type de voyage, sous le dégradé teal semi-transparent.
  elTop().style.backgroundImage = `linear-gradient(135deg, rgba(13,148,136,.72), rgba(15,118,110,.86)), url('${tripBg(t)}')`;

  const wv = t.weather ? weatherView(t.weather) : null;

  let html = '';
  if (wv) {
    const clickable = !wv.cls || wv.cls !== 'err';
    html += `<div class="weather ${wv.cls} ${clickable ? 'tappable' : ''}" ${clickable ? 'id="weather-banner"' : ''}>
      <div class="w-ico">${wv.ico}</div>
      <div class="w-body"><div class="w-t">${esc(wv.title)}</div><div class="w-d">${esc(wv.desc)}</div></div>
      ${clickable ? `<div class="w-more">détail ›</div>` : ''}
    </div>`;
  }

  html += `<div class="progress-wrap">
    <div class="pw-top"><span>${done} sur ${total} préparés</span><span>${pct}%</span></div>
    <div class="pw-bar"><i style="width:${pct}%"></i></div>
  </div>`;

  html += `<div class="add-inline">
    <input type="text" id="add-item" placeholder="Ajouter un objet…" />
    <button class="btn btn-primary" id="add-btn">＋</button>
  </div>`;

  // Groupé par catégorie, dans l'ordre CATS
  const byCat = {};
  t.items.forEach(i => { (byCat[i.cat] = byCat[i.cat] || []).push(i); });
  const cats = CATS.filter(c => byCat[c]).concat(Object.keys(byCat).filter(c => !CATS.includes(c)));

  cats.forEach(cat => {
    const list = byCat[cat];
    const d = list.filter(i => i.checked).length;
    // Catégorie entièrement cochée : repliée par défaut (dépliable au tap).
    const allDone = list.length > 0 && d === list.length;
    const collapsed = allDone && !tripUi.expanded[cat];
    html += `<div class="cat-title ${allDone ? 'clickable' : ''} ${collapsed ? 'collapsed' : ''}" ${allDone ? `data-cat="${esc(cat)}"` : ''}>
      ${allDone ? `<span class="caret">${collapsed ? '▸' : '▾'}</span>` : ''}${esc(cat)} <span class="cat-n">${allDone ? '✓ ' : ''}${d}/${list.length}</span></div>`;
    if (collapsed) return;
    html += list.map(i => `<div class="item ${i.checked ? 'done' : ''}" data-item="${i.id}">
      <div class="chk" data-toggle="${i.id}">✓</div>
      <div class="lbl" data-edit="${i.id}">${esc(i.label)}${i.why ? `<span class="why">${esc(i.why)}</span>` : ''}</div>
      <button class="del" data-del="${i.id}" aria-label="Supprimer">✕</button>
    </div>`).join('');
  });

  elView().innerHTML = html;
}

/* Rafraîchit la météo d'un voyage à venir si elle est ancienne (> 6 h).
   Met à jour uniquement le bandeau, jamais la liste (on ne touche pas aux objets cochés
   ou ajoutés à la main). Prévient si la prévision est devenue disponible. */
const weatherRefreshing = {};
const WEATHER_MAX_AGE = 6 * 3600 * 1000;
async function maybeRefreshWeather(t) {
  if (!t || !t.lat || !t.lon) return;
  if (parseISO(t.endDate) < parseISO(todayISO())) return;      // voyage passé : inutile
  if (Date.now() - (t.weatherAt || 0) < WEATHER_MAX_AGE) return; // encore fraîche
  if (weatherRefreshing[t.id]) return;                          // déjà en cours
  weatherRefreshing[t.id] = true;
  const prevSource = t.weather && t.weather.source;
  try {
    const w = await getWeather(t.lat, t.lon, t.startDate, t.endDate);
    if (!w || w.error) return;
    t.weather = w;
    t.weatherAt = Date.now();
    save();
    if (route.name === 'trip' && route.tripId === t.id) {
      renderTrip();
      if (prevSource && prevSource !== 'forecast' && w.source === 'forecast') {
        toast('Météo mise à jour · pense à régénérer la liste si besoin');
      }
    }
  } catch (e) {
    /* réseau indisponible : on garde la météo précédente */
  } finally {
    weatherRefreshing[t.id] = false;
  }
}

/* -------------------------------------------------------------------------
   7. ÉVÉNEMENTS (délégation)
   ------------------------------------------------------------------------- */
function go(name, tripId) { route = { name, tripId: tripId || null }; render(); }

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-open],[data-geo],[data-type],[data-style],[data-transport],[data-adj],[data-toggle],[data-del],[data-edit],[data-cat],#fab-new,#w-back,#w-next,#w-prev,#geo-search,#geo-clear,#t-back,#t-menu,#add-btn,#h-settings,#weather-banner');
  if (!el) return;

  // --- Accueil ---
  if (el.id === 'fab-new') { newWizard(); return go('wizard'); }
  if (el.id === 'h-settings') return openSettings();
  if (el.hasAttribute('data-open')) return go('trip', el.getAttribute('data-open'));

  // --- Wizard navigation ---
  if (el.id === 'w-back' || el.id === 'w-prev') {
    if (wizard && wizard.step > 0) { syncStepInputs(); wizard.step--; return renderWizard(); }
    return go('home');
  }
  if (el.id === 'w-next') {
    syncStepInputs();
    if (!stepValid(wizard)) return;
    if (wizard.step < WSTEPS - 1) { wizard.step++; return renderWizard(); }
    return finishWizard();
  }

  // --- Géocodage ---
  if (el.id === 'geo-search') { syncStepInputs(); return runGeocode(); }
  if (el.id === 'geo-clear') { wizard.place = null; wizard.geoResults = null; return renderWizard(); }
  if (el.hasAttribute('data-geo')) {
    const idx = +el.getAttribute('data-geo');
    const r = wizard.geoResults[idx];
    wizard.place = r;
    wizard.destination = r.name;
    if (!wizard.name) wizard.name = r.name;
    wizard.geoResults = null;
    return renderWizard();
  }

  // --- Steppers adultes / enfants ---
  if (el.hasAttribute('data-adj')) {
    syncStepInputs();
    const which = el.getAttribute('data-adj');
    const d = +el.getAttribute('data-d');
    if (which === 'adults') wizard.adults = Math.max(0, Math.min(12, wizard.adults + d));
    if (which === 'kids') {
      if (d > 0 && wizard.children.length < 8) wizard.children.push(4);
      if (d < 0 && wizard.children.length > 0) wizard.children.pop();
    }
    if (wizard.adults + wizard.children.length < 1) wizard.adults = 1;
    return renderWizard();
  }

  // --- Chips type / style ---
  if (el.hasAttribute('data-type')) {
    const id = el.getAttribute('data-type');
    const i = wizard.types.indexOf(id);
    if (i >= 0) wizard.types.splice(i, 1); else wizard.types.push(id);
    return renderWizard();
  }
  if (el.hasAttribute('data-style')) {
    const id = el.getAttribute('data-style');
    wizard.style = (wizard.style === id) ? '' : id;
    return renderWizard();
  }
  if (el.hasAttribute('data-transport')) {
    const id = el.getAttribute('data-transport');
    wizard.transport = (wizard.transport === id) ? '' : id;
    return renderWizard();
  }

  // --- Checklist ---
  if (el.id === 't-back') return go('home');
  if (el.id === 't-menu') return openTripMenu();
  if (el.id === 'weather-banner') {
    const t = state.trips.find(x => x.id === route.tripId);
    if (t) openWeatherDetail(t);
    return;
  }
  if (el.hasAttribute('data-cat')) {
    const cat = el.getAttribute('data-cat');
    tripUi.expanded[cat] = !tripUi.expanded[cat];
    return renderTrip();
  }
  if (el.hasAttribute('data-toggle')) {
    const t = state.trips.find(x => x.id === route.tripId);
    const it = t.items.find(i => i.id === el.getAttribute('data-toggle'));
    if (it) { it.checked = !it.checked; save(); renderTrip(); }
    return;
  }
  if (el.hasAttribute('data-del')) {
    const t = state.trips.find(x => x.id === route.tripId);
    t.items = t.items.filter(i => i.id !== el.getAttribute('data-del'));
    save(); renderTrip();
    return;
  }
  if (el.hasAttribute('data-edit')) return openItemEdit(el.getAttribute('data-edit'));
  if (el.id === 'add-btn') return addCustomItem();
});

// Entrée clavier dans les champs (recherche / ajout)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'w-dest') { e.preventDefault(); syncStepInputs(); runGeocode(); }
  if (e.target.id === 'add-item') { e.preventDefault(); addCustomItem(); }
});

// Mise à jour de l'indice durée quand on change une date
document.addEventListener('change', (e) => {
  if (e.target.id === 'w-start' || e.target.id === 'w-end') {
    syncStepInputs();
    const h = document.getElementById('w-duration');
    if (h) h.textContent = durationHint(wizard);
    const nb = document.getElementById('w-next');
    if (nb) nb.disabled = !stepValid(wizard);
  }
  if (e.target.hasAttribute('data-kid')) {
    wizard.children[+e.target.getAttribute('data-kid')] = +e.target.value;
  }
});

/* Récupère les valeurs des champs de l'étape courante dans le brouillon
   (pour ne rien perdre en changeant d'étape). */
function syncStepInputs() {
  if (!wizard) return;
  const dest = document.getElementById('w-dest');
  if (dest) wizard.destination = dest.value.trim();
  const s = document.getElementById('w-start'); if (s) wizard.startDate = s.value;
  const en = document.getElementById('w-end'); if (en) wizard.endDate = en.value;
  document.querySelectorAll('[data-kid]').forEach(sel => {
    wizard.children[+sel.getAttribute('data-kid')] = +sel.value;
  });
}

async function runGeocode() {
  const q = (wizard.destination || '').trim();
  if (q.length < 2) { toast('Entre au moins 2 lettres'); return; }
  wizard.geoLoading = true; wizard.geoResults = null; renderWizard();
  try {
    wizard.geoResults = await geocode(q);
  } catch (e) {
    wizard.geoResults = [];
    toast('Recherche impossible (connexion ?)');
  }
  wizard.geoLoading = false;
  renderWizard();
}

async function finishWizard() {
  const w = wizard;
  // Nom par défaut
  const name = (w.name && w.name.trim()) || w.place.name;

  // Écran de chargement
  elTop().innerHTML = `<div class="tb-title">${w.editId ? 'Mise à jour…' : 'Préparation…'}</div>`;
  elView().innerHTML = `<div class="card"><div class="spinner"></div><p class="center-msg">On récupère la météo et on prépare ta liste…</p></div>`;

  let weather = null;
  try {
    weather = await getWeather(w.place.lat, w.place.lon, w.startDate, w.endDate);
  } catch (e) {
    weather = { error: true };
  }
  const wv = weatherView(weather);

  // --- Mode édition : on met à jour le voyage et on fusionne la liste ---
  if (w.editId) {
    const trip = state.trips.find(x => x.id === w.editId);
    if (trip) {
      const oldItems = trip.items;
      Object.assign(trip, {
        name, destination: w.destination,
        countryCode: w.place.countryCode, country: w.place.country,
        lat: w.place.lat, lon: w.place.lon,
        startDate: w.startDate, endDate: w.endDate,
        adults: w.adults, children: w.children.slice(),
        types: w.types.slice(), style: w.style, transport: w.transport,
        weather, weatherAt: Date.now(),
      });
      trip.items = mergeItems(oldItems, generateItems(trip, wv.flags));
      save();
      wizard = null;
      go('trip', trip.id);
      toast('Voyage mis à jour');
      return;
    }
  }

  const trip = {
    id: uid(),
    name,
    destination: w.destination,
    countryCode: w.place.countryCode,
    country: w.place.country,
    lat: w.place.lat,
    lon: w.place.lon,
    startDate: w.startDate,
    endDate: w.endDate,
    adults: w.adults,
    children: w.children.slice(),
    types: w.types.slice(),
    style: w.style,
    transport: w.transport,
    weather,
    weatherAt: Date.now(),
    createdAt: Date.now(),
    items: [],
  };
  trip.items = generateItems(trip, wv.flags);

  state.trips.push(trip);
  save();
  wizard = null;
  go('trip', trip.id);
  toast('Liste générée · ' + trip.items.length + ' objets');
}

function addCustomItem() {
  const input = document.getElementById('add-item');
  if (!input) return;
  const label = input.value.trim();
  if (!label) return;
  const t = state.trips.find(x => x.id === route.tripId);
  t.items.push({ id: uid(), label, cat: 'Divers', why: '', checked: false, custom: true });
  save();
  renderTrip();
  const again = document.getElementById('add-item');
  if (again) again.focus();
}

/* -------------------------------------------------------------------------
   8. MENU VOYAGE (feuille modale)
   ------------------------------------------------------------------------- */
function openTripMenu() {
  const t = state.trips.find(x => x.id === route.tripId);
  const done = t.items.filter(i => i.checked).length;
  openSheet(`<h3>${esc(t.name)}</h3>
    <p class="center-msg" style="text-align:left;padding:0 0 6px">${esc(humanRange(t.startDate, t.endDate))} · ${esc(t.destination)}</p>
    <button class="btn btn-block" id="m-edit">✏️ Modifier le voyage</button>
    <button class="btn btn-block mt" id="m-share">📤 Partager la liste</button>
    <button class="btn btn-block mt" id="m-uncheck">↺ Tout décocher (${done})</button>
    <button class="btn btn-block mt" id="m-regen">🔄 Régénérer la liste</button>
    <button class="btn btn-block mt btn-danger" id="m-del">🗑️ Supprimer ce voyage</button>
    <button class="btn btn-ghost btn-block mt" id="m-close">Fermer</button>`);

  const bind = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  bind('m-close', closeSheet);
  bind('m-edit', () => { closeSheet(); newWizard(t); go('wizard'); });
  bind('m-share', () => { closeSheet(); shareTrip(t); });
  bind('m-uncheck', () => { t.items.forEach(i => i.checked = false); save(); closeSheet(); renderTrip(); toast('Liste décochée'); });
  bind('m-del', () => {
    if (confirm('Supprimer définitivement « ' + t.name + ' » ?')) {
      state.trips = state.trips.filter(x => x.id !== t.id);
      save(); closeSheet(); go('home'); toast('Voyage supprimé');
    }
  });
  bind('m-regen', async () => {
    closeSheet();
    if (!confirm('Régénérer la liste ? Les objets ajoutés à la main et les cases cochées seront réinitialisés.')) return;
    elView().innerHTML = `<div class="card"><div class="spinner"></div><p class="center-msg">Régénération…</p></div>`;
    try { t.weather = await getWeather(t.lat, t.lon, t.startDate, t.endDate); t.weatherAt = Date.now(); }
    catch (e) { t.weather = { error: true }; }
    const wv = weatherView(t.weather);
    t.items = mergeItems(t.items, generateItems(t, wv.flags));
    save(); renderTrip(); toast('Liste régénérée');
  });
}

/* ---------- Édition d'un objet (renommer + catégorie) ---------- */
function openItemEdit(itemId) {
  const t = state.trips.find(x => x.id === route.tripId);
  if (!t) return;
  const it = t.items.find(i => i.id === itemId);
  if (!it) return;
  const options = CATS.map(c => `<option value="${esc(c)}" ${c === it.cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
  openSheet(`<h3>Modifier l’objet</h3>
    <div class="field"><label>Nom</label><input type="text" id="ie-label" value="${esc(it.label)}" autocomplete="off" /></div>
    <div class="field"><label>Catégorie</label><select id="ie-cat">${options}</select></div>
    <div class="sheet-actions">
      <button class="btn btn-ghost" id="ie-cancel">Annuler</button>
      <button class="btn btn-primary" id="ie-save">Enregistrer</button>
    </div>`);
  const bind = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  bind('ie-cancel', closeSheet);
  bind('ie-save', () => {
    const label = document.getElementById('ie-label').value.trim();
    if (!label) { toast('Le nom ne peut pas être vide'); return; }
    it.label = label;
    it.cat = document.getElementById('ie-cat').value;
    it.custom = true; // objet touché à la main : on le conserve lors des régénérations
    it.why = '';
    save(); closeSheet(); renderTrip(); toast('Objet modifié');
  });
}

/* ---------- Détail météo jour par jour ---------- */
async function openWeatherDetail(t) {
  let w = t.weather;
  // Ancienne météo enregistrée sans le détail : on retente une récupération.
  if (!w || !w.days || !w.days.length) {
    openSheet(`<h3>Météo jour par jour</h3><div class="spinner"></div><p class="center-msg">Chargement…</p>`);
    try {
      const fresh = await getWeather(t.lat, t.lon, t.startDate, t.endDate);
      if (fresh && !fresh.error) { t.weather = fresh; t.weatherAt = Date.now(); save(); w = fresh; }
    } catch (e) { /* réseau indisponible */ }
  }
  if (!w || w.error || !w.days || !w.days.length) {
    closeSheet();
    toast('Détail météo indisponible (connexion ?)');
    return;
  }
  const rows = w.days.map(d => {
    const tmax = typeof d.tmax === 'number' ? Math.round(d.tmax) + '°' : '–';
    const tmin = typeof d.tmin === 'number' ? Math.round(d.tmin) + '°' : '–';
    const rain = (typeof d.precip === 'number' && d.precip >= 1)
      ? `<span class="wd-rain">☔ ${Math.round(d.precip)} mm</span>` : '';
    return `<div class="wd-row">
      <div class="wd-ico">${dayIcon(d)}</div>
      <div class="wd-day">${esc(humanDayFull(d.date))}</div>
      <div class="wd-temp"><b>${tmax}</b> <span class="wd-min">${tmin}</span></div>
      <div class="wd-p">${rain}</div>
    </div>`;
  }).join('');
  openSheet(`<h3>Météo jour par jour</h3>
    <p class="sheet-note">${esc(weatherView(w).desc)}</p>
    <div class="wd-list">${rows}</div>
    <button class="btn btn-ghost btn-block mt" id="wd-close">Fermer</button>`);
  const b = document.getElementById('wd-close'); if (b) b.onclick = closeSheet;
}

/* ---------- Partage d'une liste ---------- */
function tripToText(t) {
  const lines = [];
  lines.push('🧳 ' + t.name);
  lines.push(humanRange(t.startDate, t.endDate) + (t.destination ? ' · ' + t.destination : ''));
  const done = t.items.filter(i => i.checked).length;
  lines.push(done + '/' + t.items.length + ' préparés');
  lines.push('');
  const byCat = {};
  t.items.forEach(i => { (byCat[i.cat] = byCat[i.cat] || []).push(i); });
  const cats = CATS.filter(c => byCat[c]).concat(Object.keys(byCat).filter(c => !CATS.includes(c)));
  cats.forEach(cat => {
    lines.push('— ' + cat + ' —');
    byCat[cat].forEach(i => lines.push((i.checked ? '☑' : '☐') + ' ' + i.label));
    lines.push('');
  });
  lines.push('Créé avec Valise');
  return lines.join('\n');
}

async function shareTrip(t) {
  const text = tripToText(t);
  const title = 'Valise · ' + t.name;
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; /* sinon on tente le repli */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Liste copiée dans le presse-papier');
  } catch (e) {
    openSheet(`<h3>Partager la liste</h3>
      <p class="sheet-note">Copie ce texte pour l’envoyer.</p>
      <textarea class="share-area" readonly>${esc(text)}</textarea>
      <button class="btn btn-ghost btn-block mt" id="sh-close">Fermer</button>`);
    const b = document.getElementById('sh-close'); if (b) b.onclick = closeSheet;
  }
}

/* ---------- Réglages & sauvegarde (export / import / restauration) ---------- */
function openSettings() {
  const b = readBackup();
  const backupInfo = b
    ? 'Dernière sauvegarde automatique : ' + humanDateTime(b.at) + '.'
    : 'Aucune sauvegarde automatique pour l’instant.';
  openSheet(`<h3>Réglages & sauvegarde</h3>
    <p class="sheet-note">Tes voyages restent sur cet appareil. Exporte un fichier pour les sauvegarder ailleurs ou les transférer sur un autre téléphone.</p>
    <button class="btn btn-block" id="s-export">⬇️ Exporter mes voyages (fichier)</button>
    <label class="btn btn-block mt" for="s-import-file" style="cursor:pointer">⬆️ Importer une sauvegarde</label>
    <input type="file" id="s-import-file" accept="application/json,.json" class="hidden" />
    <button class="btn btn-block mt" id="s-restore" ${b ? '' : 'disabled'}>↺ Restaurer la sauvegarde automatique</button>
    <p class="sheet-note">${esc(backupInfo)}</p>
    <hr class="sep" />
    <button class="btn btn-block ${updateReady ? 'btn-primary' : ''}" id="s-update">${updateReady ? '⬇️ Installer la nouvelle version' : '🔄 Mettre à jour l’appli'}</button>
    <p class="sheet-note">🔒 Une mise à jour n’efface jamais tes voyages. Elle ne remplace que l’application.</p>
    <button class="btn btn-ghost btn-block mt" id="s-close">Fermer</button>
    <p class="sheet-ver">Valise ${APP_VERSION}</p>`);
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bind('s-close', closeSheet);
  bind('s-update', doAppUpdate);
  bind('s-export', exportData);
  bind('s-restore', () => {
    if (restoreFromBackup()) { save(); closeSheet(); go('home'); toast('Sauvegarde automatique restaurée'); }
    else toast('Aucune sauvegarde à restaurer');
  });
  const fileInput = document.getElementById('s-import-file');
  if (fileInput) fileInput.onchange = (e) => { const f = e.target.files[0]; if (f) importData(f); };
}

function exportData() {
  const payload = { app: 'valise', version: APP_VERSION, exportedAt: new Date().toISOString(), trips: state.trips };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'valise-sauvegarde-' + fmtISO(new Date()) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Sauvegarde exportée');
}

/* Import non destructif : ajoute les voyages absents (repérés par id), sans écraser. */
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const trips = Array.isArray(data) ? data : (Array.isArray(data.trips) ? data.trips : null);
      if (!trips) throw new Error('format');
      const clean = trips.filter(t => t && t.id && Array.isArray(t.items));
      if (!clean.length) throw new Error('vide');
      const known = new Set(state.trips.map(t => t.id));
      let added = 0;
      clean.forEach(t => { if (!known.has(t.id)) { state.trips.push(t); added++; } });
      save();
      closeSheet();
      go('home');
      toast(added ? 'Importé · ' + added + ' voyage(s) ajouté(s)' : 'Rien à importer (déjà présents)');
    } catch (e) {
      toast('Fichier invalide');
    }
  };
  reader.onerror = () => toast('Lecture du fichier impossible');
  reader.readAsText(file);
}

/* -------------------------------------------------------------------------
   9. FEUILLE MODALE + TOAST
   ------------------------------------------------------------------------- */
function openSheet(html) {
  const sheet = document.getElementById('sheet');
  const bd = document.getElementById('sheet-backdrop');
  sheet.innerHTML = html;
  sheet.classList.remove('hidden');
  bd.classList.remove('hidden');
  bd.onclick = closeSheet;
}
function closeSheet() {
  document.getElementById('sheet').classList.add('hidden');
  document.getElementById('sheet-backdrop').classList.add('hidden');
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}

/* -------------------------------------------------------------------------
   11. MISE À JOUR DE L'APPLI (service worker, comme Coffre)
   ------------------------------------------------------------------------- */
// Une nouvelle version est prête : on l'indique et on rafraîchit la feuille Réglages si ouverte.
function markUpdateReady() {
  updateReady = true;
  if (document.getElementById('s-update')) openSettings(); // la feuille est ouverte : on la réaffiche
}

// Mise à jour à toute épreuve : active le nouveau worker, VIDE le cache du code (jamais les
// voyages, qui sont en localStorage), puis recharge du réseau. Impossible de rester bloqué.
let updating = false;
async function doAppUpdate() {
  if (updating) return;
  updating = true;
  toast('Mise à jour…');
  try {
    if (swReg) {
      await swReg.update();
      if (swReg.waiting) swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  } catch (e) { /* hors-ligne : on tente quand même le rechargement */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (e) { /* ignore */ }
  setTimeout(() => location.reload(), 500);
}

/* -------------------------------------------------------------------------
   12. DÉMARRAGE
   ------------------------------------------------------------------------- */
load();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swReg = reg;
    reg.update();
    if (reg.waiting && navigator.serviceWorker.controller) markUpdateReady();
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) markUpdateReady();
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });
  }).catch(() => {});
  // Quand un nouveau service worker prend la main, on recharge une fois.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });
}
