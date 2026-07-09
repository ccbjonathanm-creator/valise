/* ==========================================================================
   Valise — listes de voyage à cocher, personnalisées.
   100% local (localStorage), sans compte. Météo via Open-Meteo (sans clé).
   ========================================================================== */
'use strict';

/* -------------------------------------------------------------------------
   1. STOCKAGE LOCAL
   ------------------------------------------------------------------------- */
const STORE_KEY = 'valise.v1';

let state = { trips: [] };
let route = { name: 'home', tripId: null }; // home | wizard | trip
let wizard = null; // brouillon en cours de création

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) state = JSON.parse(raw);
    if (!Array.isArray(state.trips)) state.trips = [];
  } catch (e) {
    state = { trips: [] };
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Sauvegarde impossible (stockage plein ?)'); }
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
];
const TRIP_STYLES = [
  { id: 'budget', label: 'Petit budget', emoji: '💰' },
  { id: 'confort', label: 'Confort', emoji: '🛋️' },
  { id: 'luxe', label: 'Luxe', emoji: '✨' },
  { id: 'aventure', label: 'Aventure', emoji: '🧭' },
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
  return {
    tmin: Math.round(tmin),
    tmax: Math.round(tmax),
    precipDays,
    precipTotal: Math.round(precipTotal),
    nDays: keys.length,
    source: usedForecast && !usedArchive ? 'forecast' : (usedForecast ? 'mixte' : 'archive'),
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

/* -------------------------------------------------------------------------
   5. MOTEUR DE RÈGLES — génère la liste d'items
   ------------------------------------------------------------------------- */
const CATS = ['Documents & argent', 'Vêtements', 'Toilette & santé', 'Électronique',
  'Plage', 'Montagne & rando', 'Ski', 'Camping', 'Roadtrip', 'Business', 'Enfants', 'Divers'];

function qty(days, perDay, cap) { return Math.min(cap, Math.max(1, Math.ceil(days * perDay))); }

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
  const people = trip.adults + (trip.children ? trip.children.length : 0);
  const kids = trip.children || [];
  const abroad = trip.countryCode && trip.countryCode.toUpperCase() !== 'FR';
  const types = trip.types || [];
  const has = (t) => types.includes(t);
  const f = wflags || {};

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

  /* --- Vêtements (selon durée + météo) --- */
  add('Sous-vêtements · ' + qty(days, 1, 12) + '/pers.', 'Vêtements');
  add('Chaussettes · ' + qty(days, 1, 12) + '/pers.', 'Vêtements');
  add('Pyjama', 'Vêtements');
  add('Tenue confortable pour voyager', 'Vêtements');
  if (f.hot || f.warm) {
    add('T-shirts · ' + qty(days, 0.8, 10) + '/pers.', 'Vêtements', 'Il va faire chaud');
    add('Short / jupe · ' + qty(days, 0.5, 5) + '/pers.', 'Vêtements', 'Il va faire chaud');
    add('Vêtements légers et respirants', 'Vêtements');
  } else {
    add('Hauts / pulls · ' + qty(days, 0.6, 8) + '/pers.', 'Vêtements');
    add('Pantalons · ' + qty(days, 0.35, 4) + '/pers.', 'Vêtements');
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

  /* --- Électronique (toujours) --- */
  add('Téléphone', 'Électronique');
  add('Chargeur de téléphone', 'Électronique');
  add('Batterie externe', 'Électronique');
  add('Écouteurs / casque', 'Électronique');
  if (nights >= 3) add('Multiprise / chargeur multiple', 'Électronique');

  /* --- Par type de voyage --- */
  if (has('plage')) {
    add('Maillot de bain · ' + qty(days, 0.3, 3) + '/pers.', 'Plage');
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

/* -------------------------------------------------------------------------
   6. RENDU — routeur simple
   ------------------------------------------------------------------------- */
const elView = () => document.getElementById('view');
const elTop = () => document.getElementById('topbar');

function render() {
  if (route.name === 'home') return renderHome();
  if (route.name === 'wizard') return renderWizard();
  if (route.name === 'trip') return renderTrip();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- ACCUEIL ---------- */
function renderHome() {
  elTop().innerHTML = `<div class="tb-title">🧳 Valise<span class="tb-sub">Tes listes de voyage</span></div>`;
  const trips = state.trips.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  let html = `<div class="hero"><h1>Prêt à partir ?</h1><p>Crée une liste personnalisée selon ta destination et la météo.</p></div>`;

  if (!trips.length) {
    html += `<div class="empty"><div class="big">🏝️</div><p>Aucune liste pour l’instant.<br>Appuie sur le bouton <b>+</b> pour créer ton premier voyage.</p></div>`;
  } else {
    html += trips.map(t => {
      const total = t.items.length;
      const done = t.items.filter(i => i.checked).length;
      const pct = total ? Math.round(done / total * 100) : 0;
      return `<div class="card trip-card" data-open="${t.id}">
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
function newWizard() {
  wizard = {
    step: 0,
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
  };
}
const WSTEPS = 3;

function renderWizard() {
  const w = wizard;
  elTop().innerHTML = `<button class="tb-back" id="w-back">‹</button>
    <div class="tb-title">Nouveau voyage<span class="tb-sub">Étape ${w.step + 1} sur ${WSTEPS}</span></div>`;

  let body = `<div class="steps">` +
    Array.from({ length: WSTEPS }, (_, i) => `<i class="${i <= w.step ? 'done' : ''}"></i>`).join('') +
    `</div>`;

  if (w.step === 0) body += stepDestination(w);
  if (w.step === 1) body += stepPeople(w);
  if (w.step === 2) body += stepTypeStyle(w);

  // Barre d'action
  const isLast = w.step === WSTEPS - 1;
  const nextLabel = isLast ? '🧳 Générer ma liste' : 'Continuer';
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
function renderTrip() {
  const t = state.trips.find(x => x.id === route.tripId);
  if (!t) { route = { name: 'home' }; return render(); }

  const total = t.items.length;
  const done = t.items.filter(i => i.checked).length;
  const pct = total ? Math.round(done / total * 100) : 0;

  elTop().innerHTML = `<button class="tb-back" id="t-back">‹</button>
    <div class="tb-title">${esc(t.name)}<span class="tb-sub">${esc(humanRange(t.startDate, t.endDate))}</span></div>
    <button class="tb-action" id="t-menu">⋯</button>`;

  const wv = t.weather ? weatherView(t.weather) : null;

  let html = '';
  if (wv) {
    html += `<div class="weather ${wv.cls}">
      <div class="w-ico">${wv.ico}</div>
      <div class="w-body"><div class="w-t">${esc(wv.title)}</div><div class="w-d">${esc(wv.desc)}</div></div>
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
    html += `<div class="cat-title">${esc(cat)} <span class="cat-n">${d}/${list.length}</span></div>`;
    html += list.map(i => `<div class="item ${i.checked ? 'done' : ''}" data-item="${i.id}">
      <div class="chk" data-toggle="${i.id}">✓</div>
      <div class="lbl">${esc(i.label)}${i.why ? `<span class="why">${esc(i.why)}</span>` : ''}</div>
      <button class="del" data-del="${i.id}" aria-label="Supprimer">✕</button>
    </div>`).join('');
  });

  elView().innerHTML = html;
}

/* -------------------------------------------------------------------------
   7. ÉVÉNEMENTS (délégation)
   ------------------------------------------------------------------------- */
function go(name, tripId) { route = { name, tripId: tripId || null }; render(); }

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-open],[data-geo],[data-type],[data-style],[data-adj],[data-toggle],[data-del],#fab-new,#w-back,#w-next,#w-prev,#geo-search,#geo-clear,#t-back,#t-menu,#add-btn');
  if (!el) return;

  // --- Accueil ---
  if (el.id === 'fab-new') { newWizard(); return go('wizard'); }
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

  // --- Checklist ---
  if (el.id === 't-back') return go('home');
  if (el.id === 't-menu') return openTripMenu();
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
  elTop().innerHTML = `<div class="tb-title">Préparation…</div>`;
  elView().innerHTML = `<div class="card"><div class="spinner"></div><p class="center-msg">On récupère la météo et on prépare ta liste…</p></div>`;

  let weather = null;
  try {
    weather = await getWeather(w.place.lat, w.place.lon, w.startDate, w.endDate);
  } catch (e) {
    weather = { error: true };
  }
  const wv = weatherView(weather);

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
    weather,
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
    <button class="btn btn-block" id="m-uncheck">↺ Tout décocher (${done})</button>
    <button class="btn btn-block mt" id="m-regen">🔄 Régénérer la liste</button>
    <button class="btn btn-block mt btn-danger" id="m-del">🗑️ Supprimer ce voyage</button>
    <button class="btn btn-ghost btn-block mt" id="m-close">Fermer</button>`);

  const bind = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  bind('m-close', closeSheet);
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
    try { t.weather = await getWeather(t.lat, t.lon, t.startDate, t.endDate); }
    catch (e) { t.weather = { error: true }; }
    const wv = weatherView(t.weather);
    t.items = generateItems(t, wv.flags);
    save(); renderTrip(); toast('Liste régénérée');
  });
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
   10. DÉMARRAGE
   ------------------------------------------------------------------------- */
load();
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
