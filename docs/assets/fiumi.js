/* Mappa fluviale: stazioni idrometriche, scheda di dettaglio, filtri e preferiti */
(function () {
  'use strict';

  var A = window.AMT, esc = A.esc;

  // Categorie semplificate per chi legge: dalla piu' grave alla normale.
  var CATEGORIE = {
    oltre2: { etichetta: 'Oltre la soglia di criticità', breve: 'Oltre soglia 2', classe: 'rossa', colore: '#e2433a' },
    oltre1: { etichetta: 'Oltre la soglia di attenzione', breve: 'Oltre soglia 1', classe: 'arancione', colore: '#f28a22' },
    vicino: { etichetta: 'Vicino alla soglia di attenzione', breve: 'Vicino alla soglia', classe: 'gialla', colore: '#f5c22b' },
    normale: { etichetta: 'Sotto le soglie', breve: 'Nella norma', classe: 'verde', colore: '#3f9a5f' },
    nessuna: { etichetta: 'Senza soglie ufficiali', breve: 'Senza soglie', classe: '', colore: '#9aa4b2' }
  };
  var ORDINE = ['oltre2', 'oltre1', 'vicino', 'normale', 'nessuna'];
  var DA_STATO = {
    sopra_soglia2: 'oltre2', in_avvicinamento_soglia2: 'oltre1', sopra_soglia1: 'oltre1',
    in_avvicinamento_soglia1: 'vicino', normale: 'normale'
  };
  var FRECCE = { 'in aumento': '↑', 'in diminuzione': '↓', 'stabile': '→' };
  var ICONE = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    avviso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 22 20H2z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>',
    onda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 8c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>',
    stella: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>',
    chiudi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>'
  };

  // ---------- Stato ----------
  var stazioni = [], perId = {}, marker = {};
  var aggiornato = null;
  var filtro = { categoria: null, zona: '', testo: '', soloPreferiti: false };
  var posizione = null, markerPosizione = null;
  var selezionata = null;
  var primaVolta = true;
  var preferiti = leggiPreferiti();

  function leggiPreferiti() {
    try { return JSON.parse(localStorage.getItem('fiumi_preferiti') || '[]') || []; } catch (e) { return []; }
  }
  function salvaPreferiti() {
    try { localStorage.setItem('fiumi_preferiti', JSON.stringify(preferiti)); } catch (e) { /* storage non disponibile */ }
    var n = preferiti.filter(function (id) { return perId[id]; }).length;
    document.getElementById('conta-preferiti').textContent = n ? n : '';
  }
  function ePreferita(id) { return preferiti.indexOf(id) !== -1; }

  function categoria(s) {
    if (s.stato && DA_STATO[s.stato]) return DA_STATO[s.stato];
    return 'nessuna';
  }
  function fmt(v, cifre) { return v == null ? '—' : v.toFixed(cifre == null ? 2 : cifre); }
  function fmtDelta(v) {
    if (v == null) return '—';
    if (Math.abs(v) < 0.005) return '0,00 m';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2).replace('.', ',') + ' m';
  }
  function m(v) { return v == null ? '—' : v.toFixed(2).replace('.', ',') + ' m'; }
  function normalizza(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  // ---------- Mappa ----------
  var mappa = L.map('mappa', { scrollWheelZoom: false }).setView([43.45, 11.1], 8);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(mappa);
  mappa.on('click', function () { mappa.scrollWheelZoom.enable(); });
  mappa.on('mouseout', function () { mappa.scrollWheelZoom.disable(); });
  var gruppo = L.featureGroup().addTo(mappa);

  var Legenda = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      var div = L.DomUtil.create('div', 'legenda-mappa');
      div.innerHTML = ORDINE.map(function (k) {
        return '<span><i class="pallino-liv" style="background:' + CATEGORIE[k].colore + '"></i>' + CATEGORIE[k].breve + '</span>';
      }).join('');
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  mappa.addControl(new Legenda());

  function stileMarker(s) {
    var cat = categoria(s);
    var critico = cat === 'oltre2' || cat === 'oltre1' || cat === 'vicino';
    var sel = selezionata === s.id;
    return {
      radius: sel ? 10 : critico ? 8.5 : 6,
      weight: sel ? 4 : ePreferita(s.id) ? 3 : 1.5,
      color: sel ? A.varCss('--titolo') : ePreferita(s.id) ? '#d99a00' : '#fff',
      fillColor: CATEGORIE[cat].colore,
      fillOpacity: 0.95
    };
  }

  // ---------- Livello rispetto alle soglie ----------
  function scala(s) {
    var valori = [s.livello, s.soglia1, s.soglia2];
    (s.storico || []).forEach(function (p) { valori.push(p[1]); });
    valori = valori.filter(function (v) { return v != null; });
    if (!valori.length || (s.soglia1 == null && s.soglia2 == null)) return null;
    var lo = Math.min.apply(null, valori), hi = Math.max.apply(null, valori);
    var r = (hi - lo) || 1;
    lo -= r * 0.1; hi += r * 0.15;
    return { lo: lo, hi: hi, pos: function (v) { return Math.max(0, Math.min(1, (v - lo) / (hi - lo))); } };
  }

  function indicatore(s) {
    var sc = scala(s);
    if (!sc || s.livello == null) return '';
    var tratti = [], tacche = [];
    var s1 = s.soglia1, s2 = s.soglia2;
    var verde = 'var(--liv-verde)', arancio = 'var(--liv-arancione)', rosso = 'var(--liv-rossa)';
    var punti = [sc.lo];
    if (s1 != null) punti.push(s1);
    if (s2 != null && (s1 == null || s2 > s1)) punti.push(s2);
    punti.push(sc.hi);
    var coloriTratti = s1 != null ? [verde, arancio, rosso] : [verde, rosso];
    for (var i = 0; i < punti.length - 1; i++) {
      tratti.push('<span class="tratto" style="width:' + ((sc.pos(punti[i + 1]) - sc.pos(punti[i])) * 100).toFixed(2) + '%;background:' + coloriTratti[i] + '"></span>');
    }
    if (s1 != null) tacche.push('<span class="tacca" style="left:' + (sc.pos(s1) * 100).toFixed(2) + '%">Soglia 1<br>' + m(s1) + '</span>');
    if (s2 != null) tacche.push('<span class="tacca" style="left:' + (sc.pos(s2) * 100).toFixed(2) + '%">Soglia 2<br>' + m(s2) + '</span>');
    return '<div class="indicatore" role="img" aria-label="Livello ' + m(s.livello) + (s1 != null ? ', soglia di attenzione ' + m(s1) : '') +
      (s2 != null ? ', soglia di criticità ' + m(s2) : '') + '"><div class="barra">' + tratti.join('') +
      '<span class="cursore" style="left:' + (sc.pos(s.livello) * 100).toFixed(2) + '%"></span></div>' +
      '<div class="tacche">' + tacche.join('') + '</div></div>';
  }

  function miniBarra(s) {
    var sc = scala(s);
    if (!sc || s.livello == null) return '';
    return '<span class="mini-barra" aria-hidden="true"><i style="width:' + Math.max(4, sc.pos(s.livello) * 100).toFixed(0) +
      '%;background:' + CATEGORIE[categoria(s)].colore + '"></i></span>';
  }

  function frase(s) {
    if (s.livello == null) return 'Lettura del livello non disponibile al momento.';
    var parti = [];
    if (s.soglia2 != null && s.livello >= s.soglia2) {
      parti.push('Il livello è <strong>' + m(s.livello - s.soglia2) + ' sopra la soglia di criticità</strong>.');
    } else if (s.soglia1 != null && s.livello >= s.soglia1) {
      parti.push('Il livello è <strong>' + m(s.livello - s.soglia1) + ' sopra la soglia di attenzione</strong>' +
        (s.soglia2 != null ? ', ' + m(s.soglia2 - s.livello) + ' sotto quella di criticità' : '') + '.');
    } else if (s.soglia1 != null) {
      parti.push('Il livello è <strong>' + m(s.soglia1 - s.livello) + ' sotto la soglia di attenzione</strong>.');
    } else if (s.soglia2 != null) {
      parti.push('Il livello è <strong>' + m(s.soglia2 - s.livello) + ' sotto la soglia di criticità</strong>.');
    } else {
      parti.push('Per questa stazione non sono definite soglie ufficiali.');
    }
    if (s.tendenza === 'in aumento') parti.push('È <strong>in aumento</strong>' + (s.delta_1h != null ? ' (' + fmtDelta(s.delta_1h) + ' nell\'ultima ora)' : '') + '.');
    else if (s.tendenza === 'in diminuzione') parti.push('È in diminuzione' + (s.delta_1h != null ? ' (' + fmtDelta(s.delta_1h) + ' nell\'ultima ora)' : '') + '.');
    else if (s.tendenza === 'stabile') parti.push('È stabile.');
    return parti.join(' ');
  }

  function grafico(s) {
    var punti = (s.storico || []).filter(function (p) { return p[1] != null && !isNaN(Date.parse(p[0])); });
    if (punti.length < 2) return '';
    var W = 320, H = 120, pad = 6;
    var val = punti.map(function (p) { return p[1]; });
    var lo = Math.min.apply(null, val), hi = Math.max.apply(null, val);
    var r = Math.max(hi - lo, 0.1);
    // Mostra la soglia 1 solo se e' abbastanza vicina da non schiacciare il grafico.
    var mostraS1 = s.soglia1 != null && s.soglia1 > hi && (s.soglia1 - hi) <= Math.max(0.6, r * 2);
    if (mostraS1) hi = s.soglia1;
    lo -= r * 0.15; hi += r * 0.15;
    var t0 = Date.parse(punti[0][0]), t1 = Date.parse(punti[punti.length - 1][0]);
    var x = function (t) { return pad + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - pad * 2); };
    var y = function (v) { return H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2); };
    var linea = punti.map(function (p) { return x(Date.parse(p[0])).toFixed(1) + ',' + y(p[1]).toFixed(1); });
    var colore = CATEGORIE[categoria(s)].colore;
    var ultimo = punti[punti.length - 1];
    var idGrad = 'g' + String(s.id).replace(/\W/g, '');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Andamento del livello: da ' + m(punti[0][1]) + ' a ' + m(ultimo[1]) + '">' +
      '<defs><linearGradient id="' + idGrad + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + colore + '" stop-opacity=".35"/><stop offset="1" stop-color="' + colore + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="M' + linea[0] + ' L' + linea.join(' L') + ' L' + x(t1).toFixed(1) + ',' + (H - pad) + ' L' + x(t0).toFixed(1) + ',' + (H - pad) + ' Z" fill="url(#' + idGrad + ')"/>' +
      (mostraS1 ? '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + y(s.soglia1).toFixed(1) + '" y2="' + y(s.soglia1).toFixed(1) + '" stroke="var(--liv-arancione)" stroke-width="1.2" stroke-dasharray="4 4"/>' +
        '<text x="' + (W - pad) + '" y="' + (y(s.soglia1) - 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--liv-arancione-testo)">soglia 1</text>' : '') +
      '<polyline points="' + linea.join(' ') + '" fill="none" stroke="' + colore + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + x(t1).toFixed(1) + '" cy="' + y(ultimo[1]).toFixed(1) + '" r="4" fill="' + colore + '" stroke="var(--superficie)" stroke-width="2"/></svg>';
    var ore = Math.round((t1 - t0) / 3600000);
    return '<div class="grafico"><div class="etichetta-sezione" style="margin-bottom:6px">Andamento' + (ore > 1 ? ' nelle ultime ' + ore + ' ore' : ore === 1 ? ' nell\'ultima ora' : '') + '</div>' + svg +
      '<div class="didascalia num"><span>' + esc(A.formattaIstante(punti[0][0]) || '') + '</span><span>min ' + m(Math.min.apply(null, val)) +
      ' · max ' + m(Math.max.apply(null, val)) + '</span><span>' + esc(A.formattaIstante(ultimo[0], false) || '') + '</span></div></div>';
  }

  // ---------- Scheda stazione ----------
  function mostraScheda(id, opzioni) {
    opzioni = opzioni || {};
    var s = perId[id];
    var el = document.getElementById('scheda');
    if (!s) { el.hidden = true; return; }
    var precedente = selezionata;
    selezionata = id;
    if (precedente && marker[precedente] && perId[precedente]) marker[precedente].setStyle(stileMarker(perId[precedente]));
    if (marker[id]) { marker[id].setStyle(stileMarker(s)); marker[id].bringToFront(); }

    var cat = categoria(s);
    var pref = ePreferita(id);
    el.innerHTML =
      '<div class="scheda-testa"><div style="min-width:0">' +
        '<h2 id="scheda-nome" tabindex="-1">' + esc(s.fiume) + '</h2>' +
        '<div class="luogo">' + esc(s.stazione) + (s.provincia ? ' (' + esc(s.provincia) + ')' : '') + (s.zona_nome ? ' · zona ' + esc(s.zona_nome) : '') + '</div>' +
      '</div><div style="display:flex;gap:4px">' +
        '<button type="button" class="btn btn-icona btn-fantasma stella" data-azione="preferito" aria-pressed="' + pref + '" aria-label="' + (pref ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti') + '" title="' + (pref ? 'Rimuovi dai preferiti' : 'Salva tra i preferiti') + '">' + ICONE.stella + '</button>' +
        '<button type="button" class="btn btn-icona btn-fantasma" data-azione="chiudi" aria-label="Chiudi scheda" title="Chiudi">' + ICONE.chiudi + '</button>' +
      '</div></div>' +
      '<div class="livello-grande"><span class="valore">' + (s.livello != null ? s.livello.toFixed(2).replace('.', ',') : '—') + '</span><span class="unita">m ' + (FRECCE[s.tendenza] || '') + '</span>' +
        '<span class="badge ' + CATEGORIE[cat].classe + '">' + CATEGORIE[cat].etichetta + '</span></div>' +
      '<p class="frase">' + frase(s) + '</p>' +
      indicatore(s) +
      '<div class="cifre">' +
        '<div class="cifra"><div class="k">Ultima ora</div><div class="v">' + fmtDelta(s.delta_1h) + '</div></div>' +
        '<div class="cifra"><div class="k">Ultime 3 ore</div><div class="v">' + fmtDelta(s.delta_3h) + '</div></div>' +
        '<div class="cifra"><div class="k">' + (s.portata != null ? 'Portata' : 'Ultime 6 ore') + '</div><div class="v">' +
          (s.portata != null ? fmt(s.portata).replace('.', ',') + ' m³/s' : fmtDelta(s.delta_6h)) + '</div></div>' +
      '</div>' +
      grafico(s) +
      '<p class="nota" style="font-size:.76rem;color:var(--testo-tenue);margin-top:10px">' +
        (s.orario_lettura ? 'Ultima lettura: ' + esc(s.orario_lettura) + '. ' : '') + 'Dato in tempo reale non validato (fonte CFR).</p>' +
      '<div class="azioni-scheda">' +
        '<button type="button" class="btn btn-piccolo" data-azione="condividi">' + ICONE.link + 'Copia link</button>' +
        '<a class="btn btn-piccolo" href="https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro" target="_blank" rel="noopener">Vedi sul sito del CFR</a>' +
      '</div>';
    el.hidden = false;
    if (el.scrollTop) el.scrollTop = 0;

    if (opzioni.vola && marker[id]) {
      mappa.flyTo(marker[id].getLatLng(), Math.max(mappa.getZoom(), 11), { duration: A.animazioniRidotte() ? 0 : 0.7 });
    }
    aggiornaCorrenteElenco();
    scriviHash();
    if (opzioni.scorri && window.matchMedia && window.matchMedia('(max-width: 980px)').matches) {
      el.scrollIntoView({ behavior: A.animazioniRidotte() ? 'auto' : 'smooth', block: 'start' });
    }
    if (opzioni.focus) document.getElementById('scheda-nome').focus({ preventScroll: !opzioni.scorri });
  }

  function chiudiScheda() {
    var prima = selezionata;
    selezionata = null;
    document.getElementById('scheda').hidden = true;
    if (prima && marker[prima] && perId[prima]) marker[prima].setStyle(stileMarker(perId[prima]));
    aggiornaCorrenteElenco();
    scriviHash();
    var voce = prima && document.querySelector('.voce[data-id="' + CSS.escape(prima) + '"]');
    if (voce) voce.focus({ preventScroll: true });
  }

  document.getElementById('scheda').addEventListener('click', function (e) {
    var b = e.target.closest('[data-azione]');
    if (!b) return;
    var azione = b.getAttribute('data-azione');
    if (azione === 'chiudi') chiudiScheda();
    else if (azione === 'preferito') {
      var id = selezionata;
      if (ePreferita(id)) { preferiti = preferiti.filter(function (x) { return x !== id; }); A.toast('Rimossa dai preferiti'); }
      else { preferiti.push(id); A.toast('Salvata tra i preferiti'); }
      salvaPreferiti();
      mostraScheda(id);
      render();
    } else if (azione === 'condividi') {
      scriviHash();
      var url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () { A.toast('Link copiato negli appunti'); }, function () { A.toast(url, 5000); });
      } else A.toast(url, 5000);
    }
  });

  // ---------- Filtri ----------
  function visibile(s) {
    if (filtro.categoria && categoria(s) !== filtro.categoria) return false;
    if (filtro.zona && s.zona_nome !== filtro.zona) return false;
    if (filtro.soloPreferiti && !ePreferita(s.id)) return false;
    if (filtro.testo) {
      var t = normalizza(s.fiume + ' ' + s.stazione + ' ' + (s.zona_nome || '') + ' ' + (s.provincia || ''));
      if (t.indexOf(filtro.testo) === -1) return false;
    }
    return true;
  }

  function renderRiepilogo() {
    var conta = { oltre2: 0, oltre1: 0, vicino: 0, normale: 0, nessuna: 0 };
    stazioni.forEach(function (s) { conta[categoria(s)]++; });
    var peggiore = ORDINE.filter(function (k) { return k !== 'nessuna' && conta[k]; })[0] || 'normale';
    var conSoglia = stazioni.length - conta.nessuna;

    var el = document.getElementById('stato-generale');
    el.className = 'stato-generale ' + CATEGORIE[peggiore].classe;
    document.getElementById('stato-icona').innerHTML = peggiore === 'normale' ? ICONE.ok : ICONE.avviso;
    var titolo, testo;
    if (peggiore === 'normale') {
      titolo = 'Tutti i fiumi sono sotto le soglie';
      testo = conSoglia + ' stazioni con soglie ufficiali, nessuna vicina ai livelli di attenzione.';
    } else {
      var critiche = conta.oltre2 + conta.oltre1;
      titolo = critiche
        ? critiche + (critiche === 1 ? ' stazione oltre soglia' : ' stazioni oltre soglia')
        : conta.vicino + (conta.vicino === 1 ? ' stazione vicina alla soglia' : ' stazioni vicine alla soglia');
      testo = 'Le altre ' + conta.normale + ' stazioni con soglia sono nella norma. Tocca un riquadro per vederle sulla mappa.';
    }
    document.getElementById('stato-titolo').textContent = titolo;
    document.getElementById('stato-testo').textContent = testo + (aggiornato ? ' Aggiornato ' + A.formattaIstante(aggiornato) + '.' : '');

    document.getElementById('tessere').innerHTML = ['oltre2', 'oltre1', 'vicino', 'normale'].map(function (k) {
      return '<button type="button" class="tessera" data-categoria="' + k + '" style="--c:' + CATEGORIE[k].colore + '" aria-pressed="' + (filtro.categoria === k) + '"' +
        (conta[k] ? '' : ' disabled') + '><span class="n">' + conta[k] + '</span><span class="e">' + CATEGORIE[k].etichetta + '</span></button>';
    }).join('');
  }

  function renderFiltroAttivo() {
    var parti = [];
    var chip = function (testo, chiave) {
      return '<button type="button" class="chip" data-togli="' + chiave + '">' + esc(testo) + ' <span aria-hidden="true">×</span><span class="sr-only">rimuovi filtro</span></button>';
    };
    if (filtro.categoria) parti.push(chip(CATEGORIE[filtro.categoria].etichetta, 'categoria'));
    if (filtro.zona) parti.push(chip('Zona ' + filtro.zona, 'zona'));
    if (filtro.testo) parti.push(chip('«' + document.getElementById('cerca').value.trim() + '»', 'testo'));
    if (filtro.soloPreferiti) parti.push(chip('Solo preferiti', 'preferiti'));
    if (posizione) parti.push(chip('Ordinate per distanza', 'posizione'));
    document.getElementById('filtro-attivo').innerHTML = parti.length
      ? '<span>Filtri attivi:</span>' + parti.join('') + (parti.length > 1 ? '<button type="button" class="btn btn-piccolo btn-fantasma" data-togli="tutto">Azzera tutto</button>' : '')
      : '';
  }

  function togliFiltro(chiave) {
    if (chiave === 'categoria' || chiave === 'tutto') filtro.categoria = null;
    if (chiave === 'zona' || chiave === 'tutto') { filtro.zona = ''; document.getElementById('filtro-zona').value = ''; }
    if (chiave === 'testo' || chiave === 'tutto') { filtro.testo = ''; document.getElementById('cerca').value = ''; }
    if (chiave === 'preferiti' || chiave === 'tutto') filtro.soloPreferiti = false;
    if (chiave === 'posizione' || chiave === 'tutto') impostaPosizione(null);
    aggiornaPulsanti();
    render();
    adattaVista();
  }

  document.getElementById('filtro-attivo').addEventListener('click', function (e) {
    var b = e.target.closest('[data-togli]');
    if (b) togliFiltro(b.getAttribute('data-togli'));
  });

  function aggiornaPulsanti() {
    document.getElementById('bottone-preferiti').setAttribute('aria-pressed', String(filtro.soloPreferiti));
    document.getElementById('bottone-vicino').setAttribute('aria-pressed', String(!!posizione));
  }

  function adattaVista() {
    var b = gruppo.getLayers().length ? gruppo.getBounds() : null;
    if (posizione) {
      var p = L.latLng(posizione.lat, posizione.lng);
      b = b ? b.extend(p) : L.latLngBounds(p, p);
    }
    if (b && b.isValid()) mappa.flyToBounds(b.pad(0.15), { maxZoom: 12, duration: A.animazioniRidotte() ? 0 : 0.6 });
  }

  document.getElementById('tessere').addEventListener('click', function (e) {
    var b = e.target.closest('.tessera');
    if (!b || b.disabled) return;
    var k = b.getAttribute('data-categoria');
    filtro.categoria = filtro.categoria === k ? null : k;
    render();
    adattaVista();
  });

  var timerRicerca = null;
  document.getElementById('cerca').addEventListener('input', function () {
    var valore = this.value;
    clearTimeout(timerRicerca);
    timerRicerca = setTimeout(function () {
      filtro.testo = normalizza(valore.trim());
      render();
      if (filtro.testo) adattaVista();
    }, 200);
  });

  document.getElementById('filtro-zona').addEventListener('change', function () {
    filtro.zona = this.value;
    render();
    adattaVista();
  });

  document.getElementById('bottone-preferiti').addEventListener('click', function () {
    filtro.soloPreferiti = !filtro.soloPreferiti;
    aggiornaPulsanti();
    render();
    if (filtro.soloPreferiti && gruppo.getLayers().length) adattaVista();
  });

  // ---------- Vicino a me ----------
  function distanzaKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function impostaPosizione(p) {
    posizione = p;
    if (markerPosizione) { mappa.removeLayer(markerPosizione); markerPosizione = null; }
    if (p) {
      markerPosizione = L.circleMarker([p.lat, p.lng], { radius: 8, weight: 3, color: '#fff', fillColor: '#2b4cb3', fillOpacity: 1 })
        .bindTooltip('Tu sei qui').addTo(mappa);
    }
    aggiornaPulsanti();
  }
  var bottoneVicino = document.getElementById('bottone-vicino');
  if (!('geolocation' in navigator)) bottoneVicino.hidden = true;
  bottoneVicino.addEventListener('click', function () {
    if (posizione) { togliFiltro('posizione'); return; }
    bottoneVicino.disabled = true;
    bottoneVicino.classList.add('gira');
    navigator.geolocation.getCurrentPosition(function (pos) {
      bottoneVicino.disabled = false;
      bottoneVicino.classList.remove('gira');
      impostaPosizione({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      render();
      var prima = stazioni.filter(visibile).sort(function (a, b) { return distanzaKm(posizione, a) - distanzaKm(posizione, b); })[0];
      if (prima) {
        A.toast('Stazione più vicina: ' + prima.fiume + ' – ' + prima.stazione + ' (' + distanzaKm(posizione, prima).toFixed(1).replace('.', ',') + ' km)', 4000);
        mappa.flyToBounds(L.latLngBounds([posizione.lat, posizione.lng], [prima.lat, prima.lng]).pad(0.8), { maxZoom: 12, duration: A.animazioniRidotte() ? 0 : 0.7 });
      }
    }, function (err) {
      bottoneVicino.disabled = false;
      bottoneVicino.classList.remove('gira');
      A.toast(err.code === 1 ? 'Permesso di posizione negato.' : 'Posizione non disponibile.');
    }, { timeout: 10000, maximumAge: 600000 });
  });

  // ---------- Disegno di mappa ed elenco ----------
  function vicinanza(s) {
    // Distanza in metri dalla prima soglia disponibile; differenza e non rapporto,
    // perche' alcune stazioni hanno soglie negative.
    var soglia = s.soglia1 != null ? s.soglia1 : s.soglia2;
    if (s.livello == null || soglia == null) return -Infinity;
    return s.livello - soglia;
  }

  function voceHtml(s) {
    var cat = categoria(s);
    var sotto = posizione
      ? distanzaKm(posizione, s).toFixed(1).replace('.', ',') + ' km · ' + CATEGORIE[cat].breve
      : CATEGORIE[cat].breve + (s.zona_nome ? ' · ' + s.zona_nome : '');
    return '<li><button type="button" class="voce" data-id="' + esc(s.id) + '"' + (selezionata === s.id ? ' aria-current="true"' : '') + '>' +
      '<span class="pallino-liv" style="background:' + CATEGORIE[cat].colore + '"></span>' +
      '<span style="min-width:0"><span class="nome">' + (ePreferita(s.id) ? '<span style="color:#d99a00" aria-label="preferita">★</span> ' : '') +
      esc(s.fiume) + ' <span>– ' + esc(s.stazione) + '</span></span>' +
      '<span class="sotto-voce">' + esc(sotto) + '</span></span>' +
      '<span class="liv">' + m(s.livello) + ' ' + (FRECCE[s.tendenza] || '') + miniBarra(s) + '</span>' +
      '</button></li>';
  }

  function render() {
    renderRiepilogo();
    renderFiltroAttivo();
    gruppo.clearLayers();
    var visibili = stazioni.filter(visibile);
    visibili.forEach(function (s) {
      var mk = marker[s.id];
      if (!mk) return;
      mk.setStyle(stileMarker(s));
      gruppo.addLayer(mk);
    });
    // Porta in primo piano le stazioni critiche, poi la selezionata.
    visibili.forEach(function (s) { var c = categoria(s); if (c !== 'normale' && c !== 'nessuna' && marker[s.id]) marker[s.id].bringToFront(); });
    if (selezionata && marker[selezionata] && gruppo.hasLayer(marker[selezionata])) marker[selezionata].bringToFront();

    document.getElementById('elenco-conta').textContent = visibili.length + (visibili.length === 1 ? ' stazione' : ' stazioni');
    var corpo = document.getElementById('elenco-corpo');
    if (!visibili.length) {
      corpo.innerHTML = filtro.soloPreferiti && !preferiti.length
        ? '<div class="elenco-vuoto"><span>Non hai ancora stazioni preferite.</span><span>Apri una stazione e tocca la stella ' + '★' + ' per ritrovarla subito qui.</span></div>'
        : '<div class="elenco-vuoto"><span>Nessuna stazione corrisponde ai filtri.</span><button type="button" class="btn btn-piccolo" data-togli="tutto">Azzera i filtri</button></div>';
      return;
    }

    var html = '';
    if (posizione) {
      html = '<ul>' + visibili.slice().sort(function (a, b) { return distanzaKm(posizione, a) - distanzaKm(posizione, b); }).map(voceHtml).join('') + '</ul>';
    } else {
      var pref = filtro.soloPreferiti ? [] : visibili.filter(function (s) { return ePreferita(s.id); });
      if (pref.length) html += '<div class="gruppo-titolo">I tuoi preferiti</div><ul>' + pref.map(voceHtml).join('') + '</ul>';
      ORDINE.forEach(function (k) {
        var del = visibili.filter(function (s) { return categoria(s) === k; }).sort(function (a, b) {
          return ((vicinanza(b) - vicinanza(a)) || 0) || a.fiume.localeCompare(b.fiume, 'it');
        });
        if (del.length) html += '<div class="gruppo-titolo">' + CATEGORIE[k].etichetta + ' · ' + del.length + '</div><ul>' + del.map(voceHtml).join('') + '</ul>';
      });
    }
    corpo.innerHTML = html;
  }

  function aggiornaCorrenteElenco() {
    Array.prototype.forEach.call(document.querySelectorAll('.voce'), function (v) {
      if (v.getAttribute('data-id') === selezionata) v.setAttribute('aria-current', 'true');
      else v.removeAttribute('aria-current');
    });
  }

  document.getElementById('elenco-corpo').addEventListener('click', function (e) {
    var t = e.target.closest('[data-togli]');
    if (t) { togliFiltro(t.getAttribute('data-togli')); return; }
    var b = e.target.closest('.voce');
    if (b) mostraScheda(b.getAttribute('data-id'), { vola: true, scorri: true, focus: true });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !selezionata) return;
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    chiudiScheda();
  });

  // ---------- Link condivisibile (#stazione=ID) ----------
  function scriviHash() {
    var nuovo = selezionata ? '#stazione=' + encodeURIComponent(selezionata) : location.pathname + location.search;
    try { history.replaceState(null, '', nuovo); } catch (e) { /* ignorato */ }
  }
  function leggiHash() {
    var mt = /stazione=([^&]+)/.exec(location.hash);
    if (!mt) return null;
    try { return decodeURIComponent(mt[1]); } catch (e) { return null; }
  }

  // ---------- Dati ----------
  function daIdrometria(dati) {
    var lista = [];
    Object.keys(dati.zone || {}).forEach(function (z) { (dati.zone[z] || []).forEach(function (s) { lista.push(s); }); });
    return lista;
  }

  function popolaZone() {
    var sel = document.getElementById('filtro-zona');
    var zone = {};
    stazioni.forEach(function (s) { if (s.zona_nome) zone[s.zona_nome] = (zone[s.zona_nome] || 0) + 1; });
    var attuale = sel.value;
    sel.innerHTML = '<option value="">Tutte le zone</option>' + Object.keys(zone).sort(function (a, b) { return a.localeCompare(b, 'it'); })
      .map(function (z) { return '<option value="' + esc(z) + '">' + esc(z) + ' (' + zone[z] + ')</option>'; }).join('');
    sel.value = attuale;
  }

  function mostraStato(html) {
    var el = document.getElementById('mappa-stato');
    if (html == null) { el.hidden = true; return; }
    el.innerHTML = html; el.hidden = false;
  }

  function applica(lista, quando) {
    aggiornato = quando || null;
    stazioni = lista.filter(function (s) { return s.lat != null && s.lng != null; });
    perId = {};
    var nuovi = {};
    stazioni.forEach(function (s) {
      perId[s.id] = s;
      var mk = marker[s.id] || L.circleMarker([s.lat, s.lng]);
      mk.setLatLng([s.lat, s.lng]);
      var tt = '<strong>' + esc(s.fiume) + '</strong> – ' + esc(s.stazione) + '<br><span class="tt-liv">' + m(s.livello) + ' ' + (FRECCE[s.tendenza] || '') + ' · ' + CATEGORIE[categoria(s)].breve + '</span>';
      if (mk.getTooltip()) mk.setTooltipContent(tt); else mk.bindTooltip(tt, { direction: 'top', offset: [0, -6] });
      if (!mk._ascoltaClic) {
        mk.on('click', function () { mostraScheda(this._idStazione, { scorri: true }); });
        mk._ascoltaClic = true;
      }
      mk._idStazione = s.id;
      nuovi[s.id] = mk;
    });
    marker = nuovi;
    popolaZone();
    salvaPreferiti();
    render();
    mostraStato(null);
    document.getElementById('aggiornato').textContent = aggiornato ? 'Dati aggiornati ' + A.formattaIstante(aggiornato) + ' (' + A.fraQuanto(aggiornato) + ')' : '';

    if (primaVolta) {
      primaVolta = false;
      var dalLink = leggiHash();
      if (dalLink && perId[dalLink]) {
        mostraScheda(dalLink, {});
        mappa.setView(marker[dalLink].getLatLng(), 11);
      } else if (gruppo.getLayers().length) {
        mappa.fitBounds(gruppo.getBounds().pad(0.05));
      }
    } else if (selezionata) {
      if (perId[selezionata]) mostraScheda(selezionata); else chiudiScheda();
    }
  }

  var inCorso = false;
  function caricaDati(daBottone) {
    if (inCorso) return;
    inCorso = true;
    var bottone = document.getElementById('bottone-aggiorna');
    if (daBottone) { bottone.disabled = true; bottone.classList.add('gira'); }
    // idrometria.json ha anche storico e variazioni; se manca si ripiega sul file ridotto.
    A.caricaJson('data/idrometria.json', { senzaCache: true, timeout: 25000 })
      .then(function (d) { applica(daIdrometria(d), d.aggiornato); })
      .catch(function () {
        return A.caricaJson('data/idrometria_mappa.json', { senzaCache: true })
          .then(function (d) { applica(d.stazioni || [], d.aggiornato); });
      })
      .then(function () { if (daBottone) A.toast('Dati aggiornati'); })
      .catch(function (err) {
        if (!stazioni.length) {
          mostraStato('<div class="stato-errore" role="alert"><strong>Stazioni non caricate</strong><span>Errore: ' + esc(err.message) +
            '</span><button class="btn btn-piccolo" type="button" id="riprova">Riprova</button></div>');
          document.getElementById('riprova').addEventListener('click', function () { caricaDati(true); });
          document.getElementById('stato-titolo').textContent = 'Dati non disponibili';
          document.getElementById('stato-testo').textContent = 'Non è stato possibile caricare i livelli. Riprova tra qualche minuto.';
          document.getElementById('stato-icona').innerHTML = ICONE.avviso;
        } else if (daBottone) {
          A.toast('Aggiornamento non riuscito, riprova più tardi');
        }
      })
      .finally(function () {
        inCorso = false;
        if (daBottone) { bottone.disabled = false; bottone.classList.remove('gira'); }
      });
  }

  function aggiornaTiles() {
    document.getElementById('mappa').classList.toggle('scuro-tiles', A.temaScuro());
    Object.keys(marker).forEach(function (id) { if (perId[id]) marker[id].setStyle(stileMarker(perId[id])); });
  }
  A.quandoCambiaTema(aggiornaTiles);
  A.inizializzaTema();
  aggiornaTiles();

  document.getElementById('bottone-aggiorna').addEventListener('click', function () { caricaDati(true); });
  caricaDati(false);
  setInterval(function () { if (!document.hidden) caricaDati(false); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) caricaDati(false); });
  if (window.innerWidth < 420) document.getElementById('cerca').setAttribute('placeholder', 'Cerca fiume o località…');
})();
