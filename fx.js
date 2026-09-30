/* ==========================================================================
   Valise — moteur visuel WebGL (fichier autonome, aucune dépendance).

   Une seule toile plein écran, derrière l'interface, qui dessine :
   1. un CIEL animé (nébuleuse, aurore, étoiles) qui reflète la météo du voyage
      (pluie, neige, soleil, nuages) ;
   2. un GLOBE holographique en points, continents compris, qui pivote vers la
      destination choisie ;
   3. les ARCS DE VOL depuis Paris vers chaque voyage, et une balise par destination ;
   4. des GERBES de particules quand on coche un objet.

   Règle de performance : le processeur ne calcule que quelques nombres par image
   (rotation, amortissements). Tout le reste est calculé par la carte graphique.
   Sans WebGL, ou si le téléphone demande de réduire les animations, l'appli garde
   un fond fixe et fonctionne à l'identique.

   API exposée : window.ValiseFX = { scene, focus, trips, mood, burst, celebrate, anchor }
   ========================================================================== */
(function () {
  'use strict';

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var noop = function () {};
  var API = { scene: noop, focus: noop, trips: noop, mood: noop, burst: noop, celebrate: noop, anchor: noop, ok: false };
  window.ValiseFX = API;
  if (reduce) return;

  var canvas = document.createElement('canvas');
  canvas.id = 'fx';
  canvas.setAttribute('aria-hidden', 'true');
  var gl = canvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  if (!gl) return;
  document.body.insertBefore(canvas, document.body.firstChild);
  document.documentElement.classList.add('has-fx');

  var MOBILE = Math.min(screen.width, screen.height) < 700;

  /* ------------------------------------------------------------------------
     1. CONTINENTS — contours simplifiés [lon, lat], rastérisés une seule fois
     en masque équirectangulaire 360×180. Le globe en points (1 point ≈ 1,5°)
     masque la simplification : on voit des continents, pas des approximations.
     ------------------------------------------------------------------------ */
  var LAND = [
    // Amérique du Nord
    [-168,66,-162,70,-156,71.3,-140,69.6,-128,70,-115,68.5,-95,72,-82,73,-80,63,-94,59,-92,57,-82,55,-79,51.5,-77,58,-72,61,-65,60,-61,56,-56,52,-60,47,-66,44.5,-70,42,-74,40.5,-76,35,-81,31,-80,25.5,-82,27,-85,30,-89,30,-94,29.5,-97,26,-97.5,22,-95,18.5,-91,18.5,-87,21.5,-88,16,-83.5,15,-83.5,11,-80,9,-77.5,8.5,-78,7,-81,7.5,-86,10.5,-88,13.5,-92,14.5,-96,15.7,-105,19.5,-106,23,-110,24,-112,29,-114.5,31.5,-112,25,-110,23,-115,28,-117,32.5,-121,34.5,-124,40,-124,46,-123,49,-128,51,-133,55,-136,58,-141,60,-148,60.5,-152,59,-158,56.5,-164,54.5,-158,58,-162,60,-165,62.5,-164,64.5],
    // Arctique canadien (grandes îles)
    [-120,72,-105,73,-90,74,-80,74,-70,72,-65,68,-75,65,-85,66,-90,69,-100,69,-115,70],
    [-110,76,-90,76,-80,77,-75,79,-70,82,-90,82,-105,79],
    // Groenland
    [-73,78,-60,82,-35,83.5,-20,82,-18,77,-22,70,-32,68,-40,65,-43,60,-49,62,-53,67,-55,71,-60,76],
    // Islande
    [-24,65.5,-22,66.4,-16,66.5,-13.5,65.2,-15,64.3,-19,63.4,-22.5,63.8],
    // Cuba
    [-85,21.8,-82,23.1,-77,21,-74.2,20.2,-77.5,19.9,-81,21.5],
    // Amérique du Sud
    [-77.5,8.5,-72,12,-66,10.7,-61,10.5,-57,6,-52,5,-50,1,-48,-1,-44,-2.5,-38,-4,-35,-6,-35,-9,-39,-14,-39,-18,-41,-22,-45,-23.5,-48.5,-26,-49,-29,-53,-33.5,-58,-34.5,-57,-38,-62,-39,-65,-42,-65,-47,-68,-50.5,-68.5,-53,-66,-55,-72,-54,-75,-50,-74,-44,-73.5,-37,-71.5,-30,-70.5,-18,-76,-14,-80,-6,-81,-2,-80,1,-78.5,2.5,-77.5,6],
    // Eurasie (Europe, Moyen-Orient, Asie), Méditerranée et mer Noire tracées en creux
    [-9,39,-9,43,-2,43.5,-1.5,46,-4.5,48.5,-1.5,49.5,1.5,50.9,4,51.5,7,53.5,8.5,55,8,57,10.5,57.7,10.5,54.5,14,54,19,54.5,21,56,24,57.5,28,60,23,60,21.5,61.5,22,65.5,25,65.5,21,63,17.5,61,19,59.5,16.5,56.5,13,55.5,11,58.5,5.5,59,5,62,12,65,15,68.5,20,70,26,71,31,70,40,67.5,44,68.5,54,68.5,60,69.5,69,73,73,68.5,80,72.5,90,75.5,104,77.7,113,73.5,130,71,140,72.5,150,71.5,160,69.5,170,70,180,69,180,65,178,64.5,172,60.5,163,59.8,162,57,156.5,51,156,57.5,163,62,160,61.5,152,59,143,59.3,135,54.5,140,53,141,48.5,138,45.5,133,42.8,129.5,41,129,35.5,126.5,34.5,126,37.5,125,39.5,121.5,39,122,40.5,118,39,121,37,122.5,37,119,35,121.8,31,122,29,119.5,25,114,22.3,110,21,108,21.5,106.5,19.5,108.5,15,109,11.5,105,8.6,104,10.5,100.5,13.5,99.5,10,101,6.8,103.5,4.5,104,1.3,101,2.5,98.5,8,98,16,94.5,17,94,21,91.5,22.5,87,21.5,86,20,80.3,15.5,80,10,77.5,8,76,10,73,17,72.5,21,69,22.5,67,24.8,61.5,25.2,57,25.8,56.3,27,51.5,27.8,48.5,30,47.8,29.5,50,26,51.5,24.2,56,24.5,56.5,26.3,59.8,22.5,57.5,19,55,17,52,15.8,45,13,43.3,12.7,42.8,15,39,21.5,35,28,34.2,27.8,32.5,30,35,32.5,36,34.7,36,36.5,32,36.2,28,36.8,26.2,39.4,29,41,28,42,28.5,43.5,30,45.5,33.5,44.5,36.5,45.2,38,47,39.5,43.5,41.5,41.5,36,41.5,31,41.2,29,41,26,40.7,23,40.5,24,38,22.5,36.5,21,38.5,19.5,40.5,19.5,42,16,43.5,13.7,45.6,12.3,45,12.5,44,14,42,16,41.4,18.5,40.2,16.5,39,16,38,15.6,40,14,40.8,12,41.8,10.5,43,8.8,44.4,6,43.1,3.2,43.3,3.2,42,0.5,40.8,-0.3,39.4,0.2,38.7,-0.7,37.6,-2,36.7,-5.3,36.1,-6.3,36.8,-7.5,37.2,-8.8,37],
    // Grande-Bretagne, Irlande
    [-5.7,50,1.4,51.2,1.7,52.7,0,53.5,-1.6,55.5,-2.1,57.7,-4,58.6,-5,58.6,-6.2,56.5,-5,55,-3,54.7,-3.1,53.3,-4.6,52.8,-4.3,51.6],
    [-6,52.2,-6.2,54,-7.5,55.3,-9.5,54.2,-10,52,-8.5,51.6],
    // Afrique
    [-5.9,35.8,-2,35.1,3,36.8,10,37.2,11,35,10,34,11.5,33,15.2,32.3,19,30.3,20,32,23,32.7,29,30.8,32.3,31.3,34.2,31.2,34.3,27.9,33,28,35.5,24,37.2,21,38.5,18,41.5,14.5,43.3,12.6,44,10.5,51,11.9,51,10.5,48.5,5,46,2,41.5,-1.8,39.3,-5,39.5,-8,40.5,-10.5,40.5,-15,37,-17.5,35,-20,35.5,-24,33,-25.8,32.5,-29,30,-31.5,27,-33.7,22.5,-34,20,-34.8,18.4,-34,18,-32,15,-26.5,14.5,-22,11.8,-17,13.5,-11.5,12,-5,9,-1,9.5,3.5,8.5,4.5,6,4.3,4.5,6.3,1.5,6.1,-2,4.8,-7.5,4.4,-10.5,6.3,-13.2,8.5,-15,11,-16.8,13,-17.4,14.7,-16.5,19.5,-17,21,-15,24.5,-13,27.5,-10,29.5,-9.8,31.5,-8.5,33.2,-6.8,34],
    // Madagascar
    [49.3,-12,50.5,-15.5,49.5,-17.5,47.2,-25,44.5,-24.5,43.3,-22,44.2,-19.5,44.2,-16.2,47,-15.5],
    // Japon
    [130,31.5,131.5,34,135,33.5,140,35,141,38.5,141.5,41.5,140,41.5,139.8,40,139,38,136.8,37.3,135.3,35.7,133,35.5,130.8,34],
    [140,42,141.5,45.5,145.5,43.3,143,42],
    // Asie du Sud-Est insulaire
    [95.3,5.5,98,4,104,-2,106,-5.8,104.5,-5.8,101,-2,98.5,1.5],
    [105.5,-6.8,114.5,-7.7,114.5,-8.7,106,-7.3],
    [109,1.5,111,-3,116,-4,117.5,0,119,5,116.8,7,115,5,110,1.8],
    [119.5,-5.5,120.5,0.5,124.8,1.5,121,-1,123,-5],
    [131,-1.5,135,-3.5,138,-1.5,144,-3.8,147.5,-6,150,-10.5,146,-8.5,143.5,-9,141,-9,138,-8.4,137.5,-5.5,132,-3],
    [120,18.5,122.2,18.5,122,14,124,12.5,126,9,126,6.5,122,7,123.5,10.5,121.5,13,120.5,14.5],
    [120.2,22,121.9,25.2,121.5,22.5],
    [79.8,9.8,81.8,7.5,81.2,6.2,80,6.5],
    // Australie, Tasmanie, Nouvelle-Zélande
    [113.5,-22,114,-26,115,-34,117.9,-35.1,123,-33.9,129,-31.6,131.5,-31.5,135.5,-34.7,138,-35.6,140,-38,143.5,-38.8,146.3,-39,150,-37.5,151.5,-33,153.5,-28.5,153,-25,149,-21,146,-18.5,145.3,-15,143.5,-14,142.5,-10.7,141.5,-13,141.5,-17,140.8,-17.5,139,-17,136.5,-15.5,137,-12.3,132.5,-11.4,130,-12,129.5,-15,125.5,-14.3,122.3,-17.5,121,-19.5,117,-20.7],
    [144.6,-40.7,148.3,-40.9,148,-43.2,146,-43.6],
    [172.7,-34.5,174.5,-36,178.5,-37.7,177,-39.5,175,-41.5,173,-40.5,174,-39],
    [172.7,-40.5,174.3,-41.7,173,-43.8,171,-45.9,169,-46.6,166.5,-46,168,-44],
    // Antarctique
    [-180,-90,180,-90,180,-72,120,-66,60,-67,0,-70,-58,-63,-65,-67,-75,-73,-120,-74,-180,-78]
  ];
  var LAKES = [
    [47,45,49.5,46.5,53,45.2,51,43,54,41,53.8,37.3,50,37,49,38.5,49.5,40.5,47.5,43], // Caspienne
    [-95,59,-92.5,57,-88,56.5,-82.3,55,-79.5,51.5,-78.5,56,-77,60,-78,62.5,-86,64,-94,61] // baie d'Hudson
  ];

  function landMask() {
    var c = document.createElement('canvas');
    c.width = 360; c.height = 180;
    var g = c.getContext('2d');
    function poly(p) {
      g.beginPath();
      for (var i = 0; i < p.length; i += 2) g[i ? 'lineTo' : 'moveTo'](p[i] + 180, 90 - p[i + 1]);
      g.closePath(); g.fill();
    }
    g.fillStyle = '#fff'; LAND.forEach(poly);
    g.fillStyle = '#000'; LAKES.forEach(poly);
    var d = g.getImageData(0, 0, 360, 180).data;
    return function (lat, lon) {
      var x = Math.min(359, Math.max(0, Math.floor(lon + 180)));
      var y = Math.min(179, Math.max(0, Math.floor(90 - lat)));
      return d[(y * 360 + x) * 4] > 127;
    };
  }

  /* ------------------------------------------------------------------------
     2. SHADERS
     ------------------------------------------------------------------------ */
  var NOISE = [
    'float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }',
    'float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }',
    'float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return v; }'
  ].join('\n');

  // Ciel : un triangle plein écran.
  var BG_VS = 'attribute vec2 aPos; varying vec2 vUv; void main(){ vUv=aPos*0.5+0.5; gl_Position=vec4(aPos,0.0,1.0); }';
  var BG_FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec2 uRes; uniform float uTime; uniform float uScroll;',
    'uniform vec3 uGlobe;',            // centre (px, origine en bas à gauche) + rayon (px)
    'uniform float uGlobeA;',          // présence du globe (0..1)
    'uniform vec4 uMood;',             // x pluie, y neige, z soleil, w nuages
    'uniform vec3 uTint;',             // teinte d'ambiance
    NOISE,
    'vec3 stars(vec2 uv, float scale, float t){',
    '  vec2 g = uv*scale; vec2 id = floor(g); vec2 f = fract(g)-0.5;',
    '  float h = hash(id); if(h < 0.93) return vec3(0.0);',
    '  vec2 o = vec2(hash(id+3.1), hash(id+7.7))-0.5;',
    '  float d = length(f - o*0.7);',
    '  float tw = 0.55+0.45*sin(t*(1.0+h*3.0)+h*40.0);',
    '  return vec3(0.75,0.9,1.0) * smoothstep(0.06,0.0,d) * tw * (h-0.93)*14.0;',
    '}',
    'void main(){',
    '  vec2 px = vUv*uRes; float asp = uRes.x/uRes.y;',
    '  vec2 uv = vec2(vUv.x*asp, vUv.y);',
    '  float t = uTime;',
    // fond nuit profonde
    '  vec3 col = mix(vec3(0.012,0.027,0.055), vec3(0.03,0.07,0.11), smoothstep(0.0,1.0,vUv.y));',
    // nébuleuse turquoise qui dérive
    '  vec2 q = uv*1.6 + vec2(t*0.012, uScroll*0.15);',
    '  float n = fbm(q + fbm(q*1.4 + t*0.02)*1.6);',
    '  col += uTint * pow(n, 2.6) * 0.55;',
    '  col += vec3(0.25,0.12,0.45) * pow(fbm(q*0.8 - 3.0 + t*0.01), 3.0) * 0.5;',
    // aurore en haut de l'écran
    '  float ay = vUv.y - 0.78 - 0.06*sin(uv.x*2.2 + t*0.25) - 0.05*fbm(vec2(uv.x*3.0, t*0.1));',
    '  float aur = exp(-ay*ay*90.0) * (0.55 + 0.45*fbm(vec2(uv.x*6.0 - t*0.15, t*0.05)));',
    '  float cur = smoothstep(0.35,1.0,fbm(vec2(uv.x*14.0 + t*0.2, vUv.y*2.0)));',
    '  col += mix(vec3(0.1,0.95,0.75), vec3(0.4,0.35,1.0), vUv.x) * aur * (0.18 + 0.35*cur) * (1.0 - uMood.w*0.7) * (1.0 - uMood.z*0.6);',
    // étoiles (atténuées par les nuages et le soleil)
    '  float starA = (1.0 - uMood.w*0.8) * (1.0 - uMood.z*0.85);',
    '  col += (stars(uv + vec2(0.0, uScroll*0.05), 70.0, t) + stars(uv*1.7 + 4.0 + vec2(0.0, uScroll*0.1), 70.0, t*1.3)*0.6) * starA;',
    // halo du globe : atmosphère lumineuse + disque sombre (corps de la planète)
    '  if(uGlobeA > 0.001){',
    '    float d = length(px - uGlobe.xy) / uGlobe.z;',
    '    float body = smoothstep(1.0, 0.97, d);',
    '    col = mix(col, col*0.35 + vec3(0.0,0.03,0.05), body*uGlobeA);',
    '    vec2 dir = normalize(px - uGlobe.xy + 0.0001);',
    '    float rim = exp(-abs(d-1.0)*26.0) * (0.75 + 0.25*dot(dir, normalize(vec2(-0.6,0.8))));',
    '    float outer = exp(-max(d-1.0,0.0)*3.2) * step(1.0,d);',
    '    col += uTint * (rim*0.42 + outer*0.13) * uGlobeA;',
    '    col += vec3(0.1,0.25,0.3) * smoothstep(1.0,0.0,d) * pow(max(dot(dir, vec2(-0.6,0.8)),0.0),2.0) * 0.12 * uGlobeA;',
    '  }',
    // soleil : rayons chauds venant du coin haut droit
    '  if(uMood.z > 0.001){',
    '    vec2 sp = vec2(asp*0.92, 1.08); vec2 sd = uv - sp; float sl = length(sd);',
    '    float ang = atan(sd.y, sd.x);',
    '    float rays = 0.55 + 0.45*sin(ang*18.0 + t*0.35) * sin(ang*7.0 - t*0.22);',
    '    vec3 sun = vec3(1.0,0.62,0.25) * (exp(-sl*2.4)*1.1 + rays*exp(-sl*1.3)*0.35) + vec3(1.0,0.85,0.55)*exp(-sl*9.0)*0.9;',
    '    col = mix(col, col + sun*0.65, uMood.z);',
    '    col += vec3(0.35,0.12,0.02) * (1.0-vUv.y) * 0.25 * uMood.z;',
    '  }',
    // nuages qui passent
    '  if(uMood.w > 0.001){',
    '    vec2 cq = uv*vec2(1.2,2.2) + vec2(t*0.03, 0.0);',
    '    float c = smoothstep(0.45, 0.85, fbm(cq + fbm(cq*2.0 - t*0.02)));',
    '    col = mix(col, vec3(0.32,0.38,0.46) * (0.6 + 0.6*fbm(cq*3.0)), c*0.55*uMood.w);',
    '  }',
    // pluie : trois couches de gouttes obliques
    '  if(uMood.x > 0.001){',
    '    float r = 0.0;',
    '    for(int k=0;k<3;k++){',
    '      float fk = float(k); float sc = 28.0 + fk*22.0;',
    '      vec2 ru = vec2(uv.x + uv.y*0.18, uv.y) * vec2(sc, sc*0.08);',
    '      float colId = floor(ru.x); float h = hash(vec2(colId, fk));',
    '      float y = fract(ru.y + t*(1.6 + h*0.9 + fk*0.5) + h*10.0);',
    '      float x = abs(fract(ru.x) - 0.5);',
    '      r += smoothstep(0.08, 0.0, x) * smoothstep(0.0, 0.05, y) * smoothstep(0.35, 0.05, y) * step(0.45, h) * (0.5 + fk*0.25);',
    '    }',
    '    col = mix(col, col*0.7 + vec3(0.02,0.04,0.07), uMood.x*0.6);',
    '    col += vec3(0.55,0.75,1.0) * r * 0.35 * uMood.x;',
    '  }',
    // neige : flocons qui tombent en ondulant
    '  if(uMood.y > 0.001){',
    '    float s = 0.0;',
    '    for(int k=0;k<3;k++){',
    '      float fk = float(k); float sc = 7.0 + fk*6.0;',
    '      vec2 su = uv*sc + vec2(sin(t*0.5 + fk + uv.y*3.0)*0.4, t*(0.35 + fk*0.15));',
    '      vec2 id = floor(su); vec2 f = fract(su) - 0.5; float h = hash(id + fk*13.0);',
    '      vec2 o = vec2(hash(id+1.3), hash(id+8.1)) - 0.5;',
    '      s += smoothstep(0.09 - fk*0.02, 0.0, length(f - o*0.6)) * step(0.35, h) * (1.0 - fk*0.25);',
    '    }',
    '    col += vec3(0.85,0.93,1.0) * s * 0.8 * uMood.y;',
    '    col += vec3(0.1,0.14,0.2) * uMood.y * 0.35;',
    '  }',
    // vignettage + grain de film
    '  float v = smoothstep(1.25, 0.35, length((vUv - 0.5)*vec2(asp*0.9, 1.0)));',
    '  col *= 0.55 + 0.45*v;',
    '  col += (hash(px + fract(t)*100.0) - 0.5) * 0.028;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // Transformation commune : sphère unité -> écran, avec perspective douce.
  var PROJ = [
    'uniform mat3 uRot; uniform vec3 uGlobe; uniform vec2 uRes; uniform float uDpr;',
    'const float CAM = 3.2;',
    'vec4 project(vec3 pos, out float persp, out float front){',
    '  vec3 p = uRot * pos;',
    '  persp = CAM / (CAM - p.z);',
    '  front = p.z;',
    '  vec2 s = uGlobe.xy + p.xy * persp * uGlobe.z * 0.94;',
    '  return vec4(s / uRes * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  // Points du globe (terre + océan).
  var DOT_VS = [
    'attribute vec3 aPos; attribute float aLand; attribute float aSeed;',
    'uniform float uTime; uniform float uGlobeA;',
    PROJ,
    'varying float vA; varying vec3 vCol;',
    'void main(){',
    '  float persp, front; gl_Position = project(aPos, persp, front);',
    '  float facing = smoothstep(-0.35, 0.45, front);',
    // balayage lumineux qui parcourt le globe de bas en haut
    '  float scan = exp(-pow(fract(aPos.y*0.25 - uTime*0.08)*4.0 - 2.0, 2.0)*6.0);',
    '  float tw = 0.75 + 0.25*sin(uTime*2.0 + aSeed*40.0);',
    '  vec3 land = mix(vec3(0.08,0.85,0.72), vec3(0.35,0.95,1.0), smoothstep(-0.2,0.9,aPos.y));',
    '  vCol = mix(vec3(0.12,0.35,0.55), land, aLand) + vec3(0.6,1.0,0.9)*scan*aLand*0.8;',
    '  vA = mix(0.05 + 0.1*facing, 0.12 + 0.95*facing*tw, aLand) * uGlobeA;',
    '  gl_PointSize = mix(1.1, 2.3, aLand) * persp * uDpr * clamp(uGlobe.z/(150.0*uDpr), 0.7, 1.6);',
    '}'
  ].join('\n');
  var DOT_FS = [
    'precision mediump float; varying float vA; varying vec3 vCol;',
    'void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c); if(d > 0.25) discard;',
    '  gl_FragColor = vec4(vCol * vA * smoothstep(0.25, 0.0, d), 1.0); }'
  ].join('\n');

  // Arcs de vol + balises : même programme, aType 0 = arc, 1 = balise.
  var ARC_VS = [
    'attribute vec3 aPos; attribute float aT; attribute float aType; attribute float aArc;',
    'uniform float uTime; uniform float uGlobeA; uniform float uFocus;',
    PROJ,
    'varying float vA; varying float vType; varying vec3 vCol;',
    'void main(){',
    '  float persp, front; gl_Position = project(aPos, persp, front);',
    '  float facing = smoothstep(-0.2, 0.3, front);',
    '  vType = aType;',
    '  float hi = step(abs(aArc - uFocus), 0.5);', // arc du voyage en cours mis en avant
    '  if(aType < 0.5){',
    // trainée : une comète parcourt l'arc en boucle
    '    float head = fract(uTime*0.22 + aArc*0.37);',
    '    float k = head - aT; if(k < 0.0) k += 1.0;',
    '    float comet = exp(-k*9.0);',
    '    vCol = mix(vec3(1.0,0.75,0.35), vec3(1.0,0.95,0.8), comet);',
    '    vA = (0.38 + comet*1.6) * facing * uGlobeA * (0.55 + 0.45*hi);',
    '    gl_PointSize = (1.8 + comet*3.2) * persp * uDpr;',
    '  } else {',
    '    float pulse = fract(uTime*0.6 + aArc*0.3);',
    '    vCol = mix(vec3(1.0,0.72,0.3), vec3(0.2,1.0,0.85), step(0.5, aT));', // aT = 1 : origine
    '    vA = facing * uGlobeA * (1.0 - pulse*0.3);',
    '    gl_PointSize = (14.0 + 16.0*pulse + hi*8.0) * persp * uDpr;',
    '    vA *= mix(1.0, 0.85, pulse);',
    '    vType = 1.0 + pulse;',
    '  }',
    '}'
  ].join('\n');
  var ARC_FS = [
    'precision mediump float; varying float vA; varying float vType; varying vec3 vCol;',
    'void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if(d > 0.5) discard;',
    '  float a;',
    '  if(vType < 0.5){ a = smoothstep(0.5, 0.0, d); }',
    '  else { float p = vType - 1.0;',
    '    float core = smoothstep(0.16, 0.08, d);',
    '    float ring = smoothstep(0.035, 0.0, abs(d - (0.18 + p*0.3))) * (1.0 - p);',
    '    a = core + ring*0.9 + smoothstep(0.5,0.0,d)*0.15; }',
    '  gl_FragColor = vec4(vCol * vA * a, 1.0); }'
  ].join('\n');

  // Gerbes de particules (coche d'un objet, liste terminée).
  var BURSTS = 8, PER_BURST = 42;
  var BURST_VS = [
    'attribute vec4 aP;', // x angle, y vitesse, z index de gerbe, w graine
    'uniform vec4 uB[' + BURSTS + '];', // x,y (px), instant de départ, puissance
    'uniform float uTime; uniform vec2 uRes; uniform float uDpr;',
    'varying float vA; varying vec3 vCol;',
    'void main(){',
    '  vec4 b = vec4(0.0); int idx = int(aP.z + 0.5);',
    '  for(int i=0;i<' + BURSTS + ';i++){ if(i == idx) b = uB[i]; }',
    '  float t = uTime - b.z; float life = 0.9 + aP.w*0.5;',
    '  if(t < 0.0 || t > life || b.w <= 0.0){ gl_Position = vec4(2.0,2.0,0.0,1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); return; }',
    '  float k = t/life; float e = 1.0 - pow(1.0 - min(t/0.55,1.0), 3.0);',
    '  vec2 dir = vec2(cos(aP.x), sin(aP.x));',
    '  vec2 p = b.xy + dir * aP.y * b.w * e * uDpr - vec2(0.0, 1.0)*k*k*60.0*b.w*uDpr;',
    '  gl_Position = vec4(p/uRes*2.0 - 1.0, 0.0, 1.0);',
    '  vA = (1.0 - k) * (1.0 - k);',
    '  vCol = aP.w < 0.33 ? vec3(0.2,1.0,0.85) : (aP.w < 0.66 ? vec3(1.0,0.78,0.3) : vec3(0.75,0.6,1.0));',
    '  gl_PointSize = (3.0 + aP.w*5.0) * uDpr * (1.0 - k*0.5) * (0.7 + b.w*0.3);',
    '}'
  ].join('\n');
  var BURST_FS = [
    'precision mediump float; varying float vA; varying vec3 vCol;',
    'void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if(d > 0.5) discard;',
    '  gl_FragColor = vec4(vCol * 1.4 * vA * smoothstep(0.5, 0.0, d), 1.0); }'
  ].join('\n');

  function compile(vs, fs) {
    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS), u = {};
    for (var i = 0; i < n; i++) {
      var name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    var na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES), a = {};
    for (var j = 0; j < na; j++) { var an = gl.getActiveAttrib(p, j).name; a[an] = gl.getAttribLocation(p, an); }
    return { p: p, u: u, a: a };
  }

  var bg, dots, arcs, bursts;
  try {
    bg = compile(BG_VS, BG_FS);
    dots = compile(DOT_VS, DOT_FS);
    arcs = compile(ARC_VS, ARC_FS);
    bursts = compile(BURST_VS, BURST_FS);
  } catch (e) {
    canvas.remove();
    document.documentElement.classList.remove('has-fx');
    return;
  }

  function buffer(data) {
    var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b;
  }

  var quad = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));

  /* Globe : points répartis uniformément (spirale de Fibonacci). */
  var N = MOBILE ? 9000 : 16000;
  var isLand = landMask();
  var globeData = new Float32Array(N * 5);
  var GOLD = Math.PI * (3 - Math.sqrt(5));
  for (var i = 0; i < N; i++) {
    var y = 1 - (i + 0.5) / N * 2, r = Math.sqrt(1 - y * y), th = GOLD * i;
    var x = Math.cos(th) * r, z = Math.sin(th) * r;
    var lat = Math.asin(y) * 180 / Math.PI, lon = Math.atan2(x, z) * 180 / Math.PI;
    var o = i * 5;
    globeData[o] = x; globeData[o + 1] = y; globeData[o + 2] = z;
    globeData[o + 3] = isLand(lat, lon) ? 1 : 0;
    globeData[o + 4] = Math.random();
  }
  var globeBuf = buffer(globeData);

  /* Gerbes : attributs figés, tout le mouvement est calculé dans le shader. */
  var bd = new Float32Array(BURSTS * PER_BURST * 4);
  for (var bi = 0; bi < BURSTS; bi++) for (var pi = 0; pi < PER_BURST; pi++) {
    var bo = (bi * PER_BURST + pi) * 4;
    bd[bo] = Math.random() * Math.PI * 2;
    bd[bo + 1] = 50 + Math.random() * 120;
    bd[bo + 2] = bi;
    bd[bo + 3] = Math.random();
  }
  var burstBuf = buffer(bd);
  var burstU = new Float32Array(BURSTS * 4), burstNext = 0;

  /* Arcs et balises : reconstruits seulement quand la liste des voyages change. */
  var ORIGIN = { lat: 48.85, lon: 2.35 }; // Paris
  var arcBuf = null, arcCount = 0, arcKey = '', arcIds = [];
  function toVec(lat, lon, alt) {
    var la = lat * Math.PI / 180, lo = lon * Math.PI / 180, rr = alt || 1;
    return [Math.cos(la) * Math.sin(lo) * rr, Math.sin(la) * rr, Math.cos(la) * Math.cos(lo) * rr];
  }
  function buildArcs(list) {
    var key = list.map(function (p) { return p.id + ':' + p.lat + ',' + p.lon; }).join('|');
    if (key === arcKey) return;
    arcKey = key; arcIds = list.map(function (p) { return p.id; });
    var out = [];
    function push(v, t, type, arc) { out.push(v[0], v[1], v[2], t, type, arc); }
    var a = toVec(ORIGIN.lat, ORIGIN.lon);
    list.forEach(function (p, idx) {
      var b = toVec(p.lat, p.lon);
      var dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      var ang = Math.acos(dot);
      if (ang > 0.02) {
        var steps = Math.max(24, Math.round(ang * 70)), s = Math.sin(ang);
        for (var k = 0; k <= steps; k++) {
          var t = k / steps, w1 = Math.sin((1 - t) * ang) / s, w2 = Math.sin(t * ang) / s;
          var alt = 1 + Math.sin(t * Math.PI) * Math.min(0.35, 0.06 + ang * 0.12);
          push([(a[0] * w1 + b[0] * w2) * alt, (a[1] * w1 + b[1] * w2) * alt, (a[2] * w1 + b[2] * w2) * alt], t, 0, idx);
        }
      }
      push(toVec(p.lat, p.lon, 1.005), 0, 1, idx);
    });
    if (list.length) push(toVec(ORIGIN.lat, ORIGIN.lon, 1.005), 1, 1, -5);
    arcCount = out.length / 6;
    if (arcBuf) gl.deleteBuffer(arcBuf);
    arcBuf = arcCount ? buffer(new Float32Array(out)) : null;
  }

  /* ------------------------------------------------------------------------
     3. ÉTAT ANIMÉ — valeurs cibles, amorties à chaque image
     ------------------------------------------------------------------------ */
  var S = {
    yaw: 0.6, pitch: 0.35, auto: true,
    tYaw: 0.6, tPitch: 0.35,
    gx: 0, gy: 0, gr: 0, ga: 0,          // globe à l'écran (px) et présence
    tgx: 0, tgy: 0, tgr: 0, tga: 0,
    mood: [0, 0, 0, 0], tMood: [0, 0, 0, 0],
    tint: [0.08, 0.75, 0.68], tTint: [0.08, 0.75, 0.68],
    focus: -9, px: 0, py: 0, tpx: 0, tpy: 0,
    anchor: null, anchorScroll: 0
  };
  var dpr = 1, W = 0, H = 0;
  function resize() {
    var cap = MOBILE ? 1.5 : 1.75;
    dpr = Math.min(window.devicePixelRatio || 1, cap) * quality;
    W = Math.round(innerWidth * dpr); H = Math.round(innerHeight * dpr);
    canvas.width = W; canvas.height = H;
    measure();
  }
  var quality = 1;

  // Position du globe : calée sur un élément de la page (data-globe), mesurée au rendu,
  // puis suivie au défilement sans relire le DOM à chaque image.
  function measure() {
    var el = S.anchor && document.body.contains(S.anchor) ? S.anchor : null;
    if (!el) { S.tga = 0; return; }
    var rc = el.getBoundingClientRect();
    var size = parseFloat(el.getAttribute('data-globe')) || 0.42;
    S.anchorScroll = scrollY;
    S.ax = (rc.left + rc.width / 2) * dpr;
    S.ay = (rc.top + rc.height / 2) * dpr;
    S.tgr = Math.min(rc.width * size * 1.2, rc.height * size) * dpr;
    S.tga = 1;
  }

  function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); }
  function angDamp(cur, target, lambda, dt) {
    var d = target - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
    return cur + d * (1 - Math.exp(-lambda * dt));
  }

  var rot = new Float32Array(9);
  function buildRot(yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // R = Rx(pitch) * Ry(yaw), rangé par colonnes pour GLSL
    rot[0] = cy; rot[1] = sp * sy; rot[2] = -cp * sy;
    rot[3] = 0; rot[4] = cp; rot[5] = sp;
    rot[6] = sy; rot[7] = -sp * cy; rot[8] = cp * cy;
  }

  /* ------------------------------------------------------------------------
     4. BOUCLE DE RENDU
     ------------------------------------------------------------------------ */
  var start = performance.now(), last = start, running = true, raf = 0;
  var slowFrames = 0, frames = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min((now - last) / 1000, 1 / 30);
    var rawDt = (now - last) / 1000;
    last = now;
    var time = (now - start) / 1000;

    // Qualité adaptative : si l'appareil peine durablement, on baisse la résolution interne.
    frames++;
    if (rawDt > 0.028 && rawDt < 0.2) slowFrames++;
    if (frames === 90) {
      if (slowFrames > 45 && quality > 0.55) { quality -= 0.2; resize(); }
      frames = 0; slowFrames = 0;
    }

    // Globe : rotation automatique ou recentrage sur la destination.
    if (S.auto) S.tYaw -= dt * 0.12;
    S.yaw = angDamp(S.yaw, S.tYaw, S.auto ? 6 : 2.4, dt);
    S.pitch = damp(S.pitch, S.tPitch, 2.4, dt);
    S.px = damp(S.px, S.tpx, 3, dt); S.py = damp(S.py, S.tpy, 3, dt);
    buildRot(S.yaw + S.px * 0.25, S.pitch + S.py * 0.15);

    var sc = (scrollY - S.anchorScroll) * dpr;
    S.tgx = S.ax || W / 2; S.tgy = H - ((S.ay || 0) - sc);
    if (S.gr === 0) { S.gx = S.tgx; S.gy = S.tgy; S.gr = S.tgr * 0.6; }
    S.gx = damp(S.gx, S.tgx, 10, dt); S.gy = damp(S.gy, S.tgy, 14, dt);
    S.gr = damp(S.gr, S.tgr, 4, dt); S.ga = damp(S.ga, S.tga, 4, dt);
    for (var m = 0; m < 4; m++) S.mood[m] = damp(S.mood[m], S.tMood[m], 1.8, dt);
    for (var c = 0; c < 3; c++) S.tint[c] = damp(S.tint[c], S.tTint[c], 1.5, dt);

    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);

    // Ciel
    gl.useProgram(bg.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(bg.a.aPos);
    gl.vertexAttribPointer(bg.a.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(bg.u.uRes, W, H);
    gl.uniform1f(bg.u.uTime, time);
    gl.uniform1f(bg.u.uScroll, scrollY / Math.max(1, innerHeight));
    gl.uniform3f(bg.u.uGlobe, S.gx, S.gy, S.gr);
    gl.uniform1f(bg.u.uGlobeA, S.ga);
    gl.uniform4f(bg.u.uMood, S.mood[0], S.mood[1], S.mood[2], S.mood[3]);
    gl.uniform3f(bg.u.uTint, S.tint[0], S.tint[1], S.tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(bg.a.aPos);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additif : la lumière s'ajoute, effet hologramme

    if (S.ga > 0.01 && S.gr > 2) {
      // Globe
      gl.useProgram(dots.p);
      gl.bindBuffer(gl.ARRAY_BUFFER, globeBuf);
      gl.enableVertexAttribArray(dots.a.aPos); gl.vertexAttribPointer(dots.a.aPos, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(dots.a.aLand); gl.vertexAttribPointer(dots.a.aLand, 1, gl.FLOAT, false, 20, 12);
      gl.enableVertexAttribArray(dots.a.aSeed); gl.vertexAttribPointer(dots.a.aSeed, 1, gl.FLOAT, false, 20, 16);
      gl.uniformMatrix3fv(dots.u.uRot, false, rot);
      gl.uniform3f(dots.u.uGlobe, S.gx, S.gy, S.gr);
      gl.uniform2f(dots.u.uRes, W, H);
      gl.uniform1f(dots.u.uDpr, dpr);
      gl.uniform1f(dots.u.uTime, time);
      gl.uniform1f(dots.u.uGlobeA, S.ga);
      gl.drawArrays(gl.POINTS, 0, N);
      gl.disableVertexAttribArray(dots.a.aPos); gl.disableVertexAttribArray(dots.a.aLand); gl.disableVertexAttribArray(dots.a.aSeed);

      // Arcs et balises
      if (arcBuf) {
        gl.useProgram(arcs.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, arcBuf);
        gl.enableVertexAttribArray(arcs.a.aPos); gl.vertexAttribPointer(arcs.a.aPos, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(arcs.a.aT); gl.vertexAttribPointer(arcs.a.aT, 1, gl.FLOAT, false, 24, 12);
        gl.enableVertexAttribArray(arcs.a.aType); gl.vertexAttribPointer(arcs.a.aType, 1, gl.FLOAT, false, 24, 16);
        gl.enableVertexAttribArray(arcs.a.aArc); gl.vertexAttribPointer(arcs.a.aArc, 1, gl.FLOAT, false, 24, 20);
        gl.uniformMatrix3fv(arcs.u.uRot, false, rot);
        gl.uniform3f(arcs.u.uGlobe, S.gx, S.gy, S.gr);
        gl.uniform2f(arcs.u.uRes, W, H);
        gl.uniform1f(arcs.u.uDpr, dpr);
        gl.uniform1f(arcs.u.uTime, time);
        gl.uniform1f(arcs.u.uGlobeA, S.ga);
        gl.uniform1f(arcs.u.uFocus, S.focus);
        gl.drawArrays(gl.POINTS, 0, arcCount);
        gl.disableVertexAttribArray(arcs.a.aPos); gl.disableVertexAttribArray(arcs.a.aT);
        gl.disableVertexAttribArray(arcs.a.aType); gl.disableVertexAttribArray(arcs.a.aArc);
      }
    }

    // Gerbes
    gl.useProgram(bursts.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, burstBuf);
    gl.enableVertexAttribArray(bursts.a.aP); gl.vertexAttribPointer(bursts.a.aP, 4, gl.FLOAT, false, 0, 0);
    gl.uniform4fv(bursts.u.uB, burstU);
    gl.uniform1f(bursts.u.uTime, time);
    gl.uniform2f(bursts.u.uRes, W, H);
    gl.uniform1f(bursts.u.uDpr, dpr);
    gl.drawArrays(gl.POINTS, 0, BURSTS * PER_BURST);
    gl.disableVertexAttribArray(bursts.a.aP);
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) { last = performance.now(); raf = requestAnimationFrame(frame); }
    else cancelAnimationFrame(raf);
  }
  document.addEventListener('visibilitychange', function () { setRunning(document.visibilityState === 'visible'); });
  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); setRunning(false); });

  var rzT = 0;
  addEventListener('resize', function () { clearTimeout(rzT); rzT = setTimeout(resize, 120); });
  // Parallaxe légère : le globe suit un peu le doigt / la souris.
  addEventListener('pointermove', function (e) {
    S.tpx = (e.clientX / innerWidth - 0.5) * 2;
    S.tpy = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  /* ------------------------------------------------------------------------
     5. API POUR L'APPLI
     ------------------------------------------------------------------------ */
  var TINTS = {
    home: [0.08, 0.75, 0.68],
    rain: [0.12, 0.4, 0.9],
    snow: [0.45, 0.7, 1.0],
    sun: [0.95, 0.55, 0.2],
    cloud: [0.25, 0.5, 0.65],
    mild: [0.1, 0.8, 0.7]
  };
  API.ok = true;
  API.anchor = function (el) { S.anchor = el || null; measure(); };
  API.scene = function (name) {
    S.focus = -9;
    if (name === 'home') { S.auto = true; S.tPitch = 0.35; API.mood('home'); }
  };
  API.focus = function (lat, lon, id) {
    if (lat == null || lon == null) { S.auto = true; S.tPitch = 0.35; S.focus = -9; return; }
    S.auto = false;
    S.tYaw = -lon * Math.PI / 180;
    S.tPitch = Math.max(-1.1, Math.min(1.1, lat * Math.PI / 180));
    var i = arcIds.indexOf(id); S.focus = i >= 0 ? i : -9;
  };
  API.trips = function (list) {
    buildArcs((list || []).filter(function (p) { return typeof p.lat === 'number' && typeof p.lon === 'number'; }));
  };
  // kind : home | rain | snow | sun | cloud | mild
  API.mood = function (kind) {
    var m = { rain: [1, 0, 0, 0.7], snow: [0, 1, 0, 0.35], sun: [0, 0, 1, 0], cloud: [0, 0, 0, 1], mild: [0, 0, 0.35, 0.3] }[kind] || [0, 0, 0, 0];
    S.tMood = m;
    S.tTint = TINTS[kind] || TINTS.home;
  };
  API.burst = function (x, y, power) {
    var i = burstNext; burstNext = (burstNext + 1) % BURSTS;
    burstU[i * 4] = x * dpr; burstU[i * 4 + 1] = H - y * dpr;
    burstU[i * 4 + 2] = (performance.now() - start) / 1000; burstU[i * 4 + 3] = power || 1;
  };
  API.celebrate = function () {
    for (var k = 0; k < BURSTS; k++) {
      (function (k) {
        setTimeout(function () {
          API.burst(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.2 + Math.random() * 0.5), 1.8 + Math.random());
        }, k * 110);
      })(k);
    }
  };

  resize();
  raf = requestAnimationFrame(frame);
})();
