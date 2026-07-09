# Valise — Listes de voyage à cocher

PWA installable (Android / iOS) qui génère une **liste de voyage personnalisée** selon
la destination, la météo prévue, les dates et les voyageurs. 100 % local, sans compte,
sans serveur. Même socle que l'appli Coffre : HTML/CSS/JS pur, aucun build.

## Ce qu'elle fait

- **Formulaire en 3 étapes** (mobile-first) : destination, dates, voyageurs (adultes +
  enfants avec âge), type(s) de voyage, style.
- **Météo réelle via Open-Meteo** (gratuit, sans clé API) :
  - prévision pour les 16 prochains jours ;
  - au-delà, bascule automatique sur les **moyennes de la même période l'an dernier**
    (API archive). Le bandeau indique honnêtement la source utilisée.
- **Génération intelligente de la liste** selon :
  - la destination (France ou étranger → passeport, adaptateur, assurance…) ;
  - la météo (chaud → short/casquette/crème ; froid → manteau/gants ; pluie →
    imperméable/parapluie) ;
  - la durée (quantités de vêtements calculées) ;
  - le type (plage, montagne, ville, roadtrip, camping, ski, rando, business) ;
  - les enfants selon leur âge (bébé → couches/biberons/poussette ; enfant → jouets ;
    ado → chargeur/écouteurs) ;
  - le style (budget, confort, luxe, aventure).
- **Checklist** : cocher/décocher, ajouter ses propres objets, supprimer, barre de
  progression, regroupement par catégorie.
- **Multi-listes** : autant de voyages qu'on veut, tout sauvegardé en localStorage.
- **Menu voyage** : tout décocher, régénérer la liste, supprimer.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page |
| `styles.css` | Style mobile-first, thème clair/sombre auto |
| `app.js` | Toute la logique (formulaire, météo, règles, checklist, stockage) |
| `manifest.webmanifest` | Déclaration PWA (installable) |
| `sw.js` | Service worker (fonctionne hors-ligne ; météo toujours au réseau) |
| `make_icons.py` | Génère les icônes PNG (Pillow) |
| `icons/` | Icônes de l'appli |

## Lancer en local

```bash
python -m http.server 5056 --directory voyage_app
# puis ouvrir http://localhost:5056
```

## API utilisées (Open-Meteo, sans clé)

- Géocodage : `https://geocoding-api.open-meteo.com/v1/search`
- Prévision : `https://api.open-meteo.com/v1/forecast`
- Historique : `https://archive-api.open-meteo.com/v1/archive`

Aucune donnée personnelle n'est envoyée : seules la latitude/longitude et les dates
partent aux serveurs météo. Les listes restent sur l'appareil.
