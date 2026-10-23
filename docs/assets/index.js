/* Pagina principale: mappa delle zone di allerta, pannello di dettaglio, filtri */
(function () {
  'use strict';

  var A = window.AMT;
  var esc = A.esc;

  var LIVELLI = ['verde', 'gialla', 'arancione', 'rossa'];
  var ORDINE_PIOGGIA = { verde: 0, gialla: 1, arancione: 2, rossa: 3 };
  var ETICHETTE_PIOGGIA = { verde: 'Nessuna allerta', gialla: 'Allerta gialla', arancione: 'Allerta arancione', rossa: 'Allerta rossa' };
  var ETICHETTE_BREVI = { verde: 'Nessuna', gialla: 'Gialla', arancione: 'Arancione', rossa: 'Rossa' };
  var ETICHETTE_CALDO = { 0: 'Nessun rischio', 1: 'Pre-allerta', 2: 'Rischio elevato', 3: 'Ondata di calore' };
  var CLASSE_CALDO = { 0: 'verde', 1: 'gialla', 2: 'arancione', 3: 'rossa' };
  var URL_REGIONE = 'https://www.regione.toscana.it/allertameteo';
  var URL_WORKER = 'https://triggeridrometria.lmnc89.workers.dev';

  var ETICHETTE_STATO_FIUME = {
    sopra_soglia2: 'sopra soglia 2 (criticità)',
    in_avvicinamento_soglia2: 'in avvicinamento alla soglia di criticità',
    sopra_soglia1: 'sopra soglia 1 (attenzione)',
    in_avvicinamento_soglia1: 'in avvicinamento alla soglia di attenzione',
    normale: 'sotto le soglie'
  };
  var CLASSE_STATO_FIUME = {
    sopra_soglia2: 'rossa', in_avvicinamento_soglia2: 'arancione',
    sopra_soglia1: 'arancione', in_avvicinamento_soglia1: 'gialla', normale: 'verde'
  };
  var ICONE_TENDENZA_FIUME = { 'in aumento': '↑', 'in diminuzione': '↓', 'stabile': '→' };

  var ICONA_FRECCIA = '<svg class="freccia" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
  var ICONA_ONDA = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="vertical-align:-2px" aria-hidden="true"><path d="M3 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 13c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>';

  // ---------- Stato ----------
  var allerte = null, previsioni = null, idrometria = null, geo = null;
  var erroreAllerte = null;
  var giorno = 'oggi';
  var filtroLivello = null;
  var layerZone = null, layerPerNome = {}, iconeAttive = [];
  var nomeSelezionato = null, comuneCercato = null;
  var indiceComuni = [];
  var testoVocaleCorrente = '';
  var colori = {};

  // ---------- Mappa ----------
  var mappa = L.map('mappa', { scrollWheelZoom: false, zoomSnap: 0.25, attributionControl: true });
  mappa.attributionControl.setPrefix(false);
  mappa.attributionControl.addAttribution('Zone di allerta: DPC · Regione Toscana');

  var ControlloVista = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      var div = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-vista');
      var a = L.DomUtil.create('a', '', div);
      a.href = '#';
      a.title = 'Mostra tutta la Toscana';
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', 'Mostra tutta la Toscana');
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
      L.DomEvent.on(a, 'click', function (e) { L.DomEvent.preventDefault(e); vistaIntera(); });
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  mappa.addControl(new ControlloVista());

  function vistaIntera() {
    if (layerZone) mappa.flyToBounds(layerZone.getBounds().pad(0.04), { duration: A.animazioniRidotte() ? 0 : 0.6 });
  }

  function aggiornaColori() {
    colori = {
      verde: A.varCss('--liv-verde-mappa'),
      gialla: A.varCss('--liv-gialla'),
      arancione: A.varCss('--liv-arancione'),
      rossa: A.varCss('--liv-rossa'),
      nd: A.varCss('--liv-nd'),
      bordo: A.varCss('--mappa-bordo-zona'),
      selezione: A.varCss('--titolo'),
      caldoStimato: A.varCss('--caldo-stimato')
    };
  }

  // ---------- Dati per giorno ----------

  // Data (YYYY-MM-DD, ora italiana) mostrata dalla scheda attiva.
  function isoGiorno(g) { return A.isoOggiRoma((g || giorno) === 'oggi' ? 0 : 1); }

  // Le chiavi "oggi"/"domani" del JSON si riferiscono al giorno in cui e' girato lo
  // script: se la pagina viene aperta dopo mezzanotte senza un nuovo aggiornamento,
  // "oggi" del file e' in realta' ieri. Si usano quindi le date esplicite.
  function zonePerGiorno(g) {
    if (!allerte) return null;
    var target = isoGiorno(g);
    if (allerte.data_oggi || allerte.data_domani) {
      if (allerte.data_oggi === target) return allerte.oggi || null;
      if (allerte.data_domani === target) return allerte.domani || null;
      return null;
    }
    return allerte[g || giorno] || null;
  }

  function datiZona(nomeZona) {
    var zone = zonePerGiorno();
    return zone ? zone[nomeZona] || null : null;
  }

  function normalizza(s) {
    return String(s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // LaMMA indica i giorni per nome ("Venerdì"): si cerca quello che corrisponde alla
  // data della scheda, invece di prendere alla cieca il primo o il secondo elemento.
  function indicePrevisione(giorni, iso) {
    var nome = normalizza(A.formattaGiornoIso(iso, { weekday: 'long' }));
    for (var i = 0; i < giorni.length; i++) {
      if (normalizza(giorni[i].data_descr) === nome) return i;
    }
    return -1;
  }

  function previsioneZona(nomeZona, iso) {
    if (!previsioni || !previsioni.zone) return null;
    var dati = previsioni.zone[nomeZona];
    if (!dati || !dati.giorni || !dati.giorni.length) return null;
    var i = indicePrevisione(dati.giorni, iso || isoGiorno());
    return i >= 0 ? dati.giorni[i] : null;
  }

  function fiumiCritici(nomeZona) {
    if (!idrometria || !idrometria.zone || !idrometria.zone[nomeZona]) return 0;
    return idrometria.zone[nomeZona].filter(function (s) {
      return s.stato && s.stato !== 'normale' && s.stato !== 'in_avvicinamento_soglia1';
    }).length;
  }

  function nomiZone() {
    if (geo) return geo.features.map(function (f) { return f.properties.nome; });
    var z = zonePerGiorno();
    return z ? Object.keys(z) : [];
  }

  // ---------- Stile della mappa ----------
  function stileZona(feat) {
    var nome = feat.properties.nome;
    var d = datiZona(nome);
    var liv = d ? d.pioggia : null;
    var selezionata = nome === nomeSelezionato;
    var attenuata = filtroLivello && liv !== filtroLivello;
    return {
      color: selezionata ? colori.selezione : colori.bordo,
      weight: selezionata ? 3 : 1.2,
      fillColor: liv ? colori[liv] : colori.nd,
      fillOpacity: attenuata ? 0.18 : 0.95,
      opacity: 1
    };
  }

  function contenutoTooltip(nome) {
    var d = datiZona(nome);
    var html = '<div class="tt-titolo">' + esc(nome) + '</div><div class="tt-riga">';
    if (d) {
      html += '<span class="badge ' + d.pioggia + '">' + esc(ETICHETTE_PIOGGIA[d.pioggia]) + '</span>';
      if (d.caldo && d.caldo.livello >= 1) {
        html += '<span class="badge ' + CLASSE_CALDO[d.caldo.livello] + '">Caldo: ' + esc(ETICHETTE_CALDO[d.caldo.livello]) + '</span>';
      } else {
        var st = previsioneZona(nome);
        if (st && st.caldo_stimato) html += '<span class="badge caldo">Caldo stimato' + (st.max != null ? ' ' + esc(st.max) + '°' : '') + '</span>';
      }
    } else {
      html += '<span class="badge">Dato non disponibile</span>';
    }
    var nf = fiumiCritici(nome);
    if (nf && giorno === 'oggi') html += '<span class="badge arancione">' + nf + (nf === 1 ? ' fiume' : ' fiumi') + ' oltre soglia</span>';
    return html + '</div>';
  }

  function svgGoccia(colore) {
    return L.divIcon({
      className: 'icona-mappa',
      html: '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 2C12 2 5 11 5 15.5C5 19.6 8.1 22 12 22C15.9 22 19 19.6 19 15.5C19 11 12 2 12 2Z" fill="' + colore + '" stroke="#fff" stroke-width="1.6"/></svg>',
      iconSize: [22, 22], iconAnchor: [11, 20]
    });
  }

  function svgTermometro(colore) {
    return L.divIcon({
      className: 'icona-mappa',
      html: '<svg width="18" height="26" viewBox="0 0 18 26"><rect x="6" y="2" width="6" height="14" rx="3" fill="#fff" stroke="' + colore + '" stroke-width="1.6"/>' +
            '<circle cx="9" cy="20" r="5.5" fill="' + colore + '" stroke="#fff" stroke-width="1.4"/><rect x="7.3" y="8" width="3.4" height="10" fill="' + colore + '"/></svg>',
      iconSize: [18, 26], iconAnchor: [9, 24]
    });
  }

  function disegnaIcone() {
    iconeAttive.forEach(function (m) { mappa.removeLayer(m); });
    iconeAttive = [];
    if (!layerZone) return;
    var coloriCaldo = { 1: colori.gialla, 2: colori.arancione, 3: colori.rossa };

    layerZone.eachLayer(function (ly) {
      var nome = ly.feature.properties.nome;
      var d = datiZona(nome);
      if (!d) return;
      if (filtroLivello && d.pioggia !== filtroLivello) return;
      var centro = ly.getBounds().getCenter();
      var conGoccia = d.pioggia && d.pioggia !== 'verde';

      if (conGoccia) {
        iconeAttive.push(L.marker(centro, { icon: svgGoccia(colori[d.pioggia]), interactive: false, keyboard: false }).addTo(mappa));
      }
      var coloreTerm = null;
      if (d.caldo && d.caldo.livello >= 1) coloreTerm = coloriCaldo[d.caldo.livello];
      else {
        var st = previsioneZona(nome);
        if (st && st.caldo_stimato) coloreTerm = colori.caldoStimato;
      }
      if (coloreTerm) {
        var punto = L.latLng(centro.lat, centro.lng + (conGoccia ? 0.06 : 0));
        iconeAttive.push(L.marker(punto, { icon: svgTermometro(coloreTerm), interactive: false, keyboard: false }).addTo(mappa));
      }
    });
  }

  function ridisegnaMappa() {
    if (!layerZone) return;
    layerZone.eachLayer(function (ly) {
      ly.setStyle(stileZona(ly.feature));
      ly.setTooltipContent(contenutoTooltip(ly.feature.properties.nome));
    });
    if (nomeSelezionato && layerPerNome[nomeSelezionato]) layerPerNome[nomeSelezionato].bringToFront();
    disegnaIcone();
  }

  function mostraStatoMappa(html) {
    var el = document.getElementById('mappa-stato');
    if (html == null) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = html;
    el.hidden = false;
  }

  function caricaMappa() {
    mostraStatoMappa('<span class="caricamento-testo"><span class="rotella"></span>Caricamento della mappa…</span>');
    return A.caricaJson('zone.geojson', { timeout: 20000 })
      .then(function (g) {
        geo = g;
        if (layerZone) mappa.removeLayer(layerZone);
        layerPerNome = {};
        layerZone = L.geoJSON(geo, {
          style: stileZona,
          onEachFeature: function (feat, ly) {
            var nome = feat.properties.nome;
            layerPerNome[nome] = ly;
            ly.bindTooltip(contenutoTooltip(nome), { sticky: true, direction: 'top', offset: [0, -8], opacity: 1 });
            ly.on('mouseover', function () {
              if (nome !== nomeSelezionato) ly.setStyle({ weight: 2.6, color: colori.selezione });
              ly.bringToFront();
              if (nomeSelezionato && layerPerNome[nomeSelezionato] && nome !== nomeSelezionato) layerPerNome[nomeSelezionato].bringToFront();
            });
            ly.on('mouseout', function () { ly.setStyle(stileZona(feat)); });
            ly.on('click', function () {
              seleziona(nome, null, { daMappa: true });
            });
          }
        }).addTo(mappa);
        mappa.invalidateSize();
        mappa.fitBounds(layerZone.getBounds().pad(0.04));
        mostraStatoMappa(null);
        costruisciIndiceComuni();
        popolaSelectIscrizione();
        disegnaIcone();
        aggiornaTutto();
        applicaHash();
      })
      .catch(function (err) {
        var suggerimento = location.protocol === 'file:'
          ? '<span>Hai aperto il file col doppio clic: avvia un mini-server nella cartella <code>docs</code> con <code>python -m http.server 8000</code> e apri <code>localhost:8000</code>.</span>'
          : '<span>Controlla la connessione e riprova.</span>';
        mostraStatoMappa('<div class="stato-errore" role="alert"><strong>La mappa non si è caricata</strong>' +
          '<span>Errore: ' + esc(err.message) + '</span>' + suggerimento +
          '<button class="btn btn-piccolo" type="button" id="riprova-mappa">Riprova</button></div>');
        document.getElementById('riprova-mappa').addEventListener('click', caricaMappa);
        renderElencoZone();
      });
  }

  // ---------- Selezione ----------
  function seleziona(nome, comune, opzioni) {
    opzioni = opzioni || {};
    var precedente = nomeSelezionato;
    nomeSelezionato = nome;
    comuneCercato = comune || null;
    if (precedente && layerPerNome[precedente]) layerPerNome[precedente].setStyle(stileZona(layerPerNome[precedente].feature));
    var ly = layerPerNome[nome];
    if (ly) {
      ly.setStyle(stileZona(ly.feature));
      ly.bringToFront();
      if (opzioni.zoom) mappa.flyToBounds(ly.getBounds().pad(0.5), { duration: A.animazioniRidotte() ? 0 : 0.6, maxZoom: 10 });
    }
    mostraDettaglio(nome);
    renderElencoZone();
    scriviHash();
    if (comune) sincronizzaSelectIscrizione(nome, comune);

    // Su schermi stretti il pannello sta sotto la mappa: portalo in vista.
    if (opzioni.daMappa && window.matchMedia && window.matchMedia('(max-width: 980px)').matches) {
      document.getElementById('pannello').scrollIntoView({ behavior: A.animazioniRidotte() ? 'auto' : 'smooth', block: 'start' });
    }
    if (opzioni.focus) document.getElementById('pan-nome').focus({ preventScroll: true });
  }

  function deseleziona() {
    var precedente = nomeSelezionato;
    nomeSelezionato = null;
    comuneCercato = null;
    if (precedente && layerPerNome[precedente]) layerPerNome[precedente].setStyle(stileZona(layerPerNome[precedente].feature));
    fermaVoce();
    document.getElementById('pan-dett').hidden = true;
    document.getElementById('pan-vuoto').hidden = false;
    renderElencoZone();
    scriviHash();
    var voce = precedente && document.querySelector('.zona-voce[data-zona="' + CSS.escape(precedente) + '"]');
    if (voce) voce.focus();
  }

  // ---------- Elenco zone (anche alternativa accessibile alla mappa) ----------
  function renderElencoZone() {
    var ul = document.getElementById('elenco-zone');
    var nomi = nomiZone();
    if (!nomi.length) {
      ul.innerHTML = allerte || erroreAllerte || geo ? '<li class="elenco-vuoto">Nessuna zona disponibile.</li>' : ul.innerHTML;
      return;
    }
    var voci = nomi.map(function (n) {
      var d = datiZona(n);
      return { nome: n, d: d, ordine: d ? ORDINE_PIOGGIA[d.pioggia] : -1 };
    }).filter(function (v) {
      return !filtroLivello || (v.d && v.d.pioggia === filtroLivello);
    }).sort(function (a, b) {
      return (b.ordine - a.ordine) || a.nome.localeCompare(b.nome, 'it');
    });

    document.getElementById('elenco-conta').textContent =
      voci.length + (voci.length === 1 ? ' zona' : ' zone') + (filtroLivello ? ' · filtro attivo' : '');

    if (!voci.length) {
      ul.innerHTML = '<li class="elenco-vuoto">Nessuna zona con questo livello.</li>';
      return;
    }
    ul.innerHTML = voci.map(function (v) {
      var liv = v.d ? v.d.pioggia : null;
      var extra = [];
      if (v.d && v.d.caldo && v.d.caldo.livello >= 1) extra.push('&#127777;&#65039; ' + esc(ETICHETTE_CALDO[v.d.caldo.livello]));
      else {
        var st = previsioneZona(v.nome);
        if (st && st.caldo_stimato) extra.push('&#127777;&#65039; caldo stimato');
      }
      var nf = giorno === 'oggi' ? fiumiCritici(v.nome) : 0;
      if (nf) extra.push('&#127754; ' + nf + (nf === 1 ? ' fiume' : ' fiumi') + ' oltre soglia');
      return '<li><button type="button" class="zona-voce" data-zona="' + esc(v.nome) + '"' +
        (v.nome === nomeSelezionato ? ' aria-current="true"' : '') + '>' +
        '<span class="pallino-liv" style="background:var(--liv-' + (liv === 'verde' ? 'verde' : liv || 'nd') + ')"></span>' +
        '<span><span class="nome">' + esc(v.nome) + '</span><span class="sotto"><span>' +
        esc(liv ? ETICHETTE_PIOGGIA[liv] : 'Dato non disponibile') + '</span>' +
        extra.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</span></span>' +
        ICONA_FRECCIA + '</button></li>';
    }).join('');
  }

  document.getElementById('elenco-zone').addEventListener('click', function (e) {
    var b = e.target.closest('.zona-voce');
    if (!b) return;
    seleziona(b.getAttribute('data-zona'), null, { zoom: true, focus: true });
  });
  document.getElementById('bottone-indietro').addEventListener('click', deseleziona);

  // ---------- Filtri per livello ----------
  function renderFiltri() {
    var el = document.getElementById('filtri');
    var zone = zonePerGiorno();
    var conteggi = { verde: 0, gialla: 0, arancione: 0, rossa: 0 };
    var totale = 0;
    if (zone) Object.keys(zone).forEach(function (n) { if (conteggi[zone[n].pioggia] != null) { conteggi[zone[n].pioggia]++; totale++; } });
    if (filtroLivello && !conteggi[filtroLivello]) filtroLivello = null;

    var html = '<button type="button" class="chip" data-livello="" aria-pressed="' + (!filtroLivello) + '">Tutte <span class="conta">' + totale + '</span></button>';
    html += LIVELLI.map(function (l) {
      var colore = l === 'verde' ? 'var(--liv-verde)' : 'var(--liv-' + l + ')';
      return '<button type="button" class="chip" data-livello="' + l + '" aria-pressed="' + (filtroLivello === l) + '"' +
        (conteggi[l] ? '' : ' disabled') + '><span class="pallino-liv" style="background:' + colore + '"></span>' +
        ETICHETTE_BREVI[l] + ' <span class="conta">' + conteggi[l] + '</span></button>';
    }).join('');
    el.innerHTML = html;
  }

  document.getElementById('filtri').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b || b.disabled) return;
    var l = b.getAttribute('data-livello') || null;
    filtroLivello = filtroLivello === l ? null : l;
    renderFiltri();
    renderElencoZone();
    ridisegnaMappa();
    if (filtroLivello && layerZone) {
      var bounds = null;
      layerZone.eachLayer(function (ly) {
        var d = datiZona(ly.feature.properties.nome);
        if (d && d.pioggia === filtroLivello) bounds = bounds ? bounds.extend(ly.getBounds()) : L.latLngBounds(ly.getBounds().getSouthWest(), ly.getBounds().getNorthEast());
      });
      if (bounds) mappa.flyToBounds(bounds.pad(0.15), { duration: A.animazioniRidotte() ? 0 : 0.6, maxZoom: 9.5 });
    }
  });

  // ---------- Pannello di dettaglio ----------
  function badgeRischio(liv) {
    if (!liv) return '<span class="badge">Dato non disponibile</span>';
    return '<span class="badge ' + liv + '">' + esc(ETICHETTE_PIOGGIA[liv]) + '</span>';
  }

  function animaNumero(elemento, valoreFinale, suffisso) {
    if (!elemento) return;
    suffisso = suffisso || '';
    if (valoreFinale == null) { elemento.textContent = '—'; return; }
    if (A.animazioniRidotte()) { elemento.textContent = valoreFinale + suffisso; return; }
    var inizio = null, durata = 550;
    function passo(t) {
      if (!inizio) inizio = t;
      var p = Math.min((t - inizio) / durata, 1);
      var e = 1 - Math.pow(1 - p, 3);
      elemento.textContent = Math.round(valoreFinale * e) + suffisso;
      if (p < 1) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
  }

  function mostraPrevisioni(nomeZona) {
    var box = document.getElementById('box-previsioni');
    var dati = previsioni && previsioni.zone ? previsioni.zone[nomeZona] : null;
    if (!dati || !dati.giorni || !dati.giorni.length) { box.hidden = true; return; }
    var attivo = indicePrevisione(dati.giorni, isoGiorno());

    var fmtH = function (v) { return v != null ? v + '°' : '—'; };
    document.getElementById('previsioni-contenuto').innerHTML = dati.giorni.map(function (g, i) {
      var titoloHumidex = 'Humidex notte: ' + fmtH(g.humidex_notte) + (g.humidex_notte_etichetta ? ' (' + g.humidex_notte_etichetta + ')' : '') +
        ' · giorno: ' + fmtH(g.humidex_giorno) + (g.humidex_giorno_etichetta ? ' (' + g.humidex_giorno_etichetta + ')' : '');
      return '<div class="prev-giorno' + (i === attivo ? ' attivo' : '') + '">' +
        '<div class="g-nome">' + esc((g.data_descr || '').slice(0, 3)) + '</div>' +
        (g.icona_url ? '<img src="' + esc(g.icona_url) + '" alt="" loading="lazy" width="40" height="40" onerror="this.style.visibility=\'hidden\'">' : '') +
        '<div class="g-descr">' + esc(g.descrizione || '') + '</div>' +
        '<div class="g-temp"><span id="pv-max-' + i + '">—</span> <span class="min">' + (g.min != null ? esc(g.min) + '°' : '') + '</span></div>' +
        '<div class="g-humidex" title="' + esc(titoloHumidex) + '">' + ICONA_ONDA +
        ' <b id="pv-hn-' + i + '">—</b>/<b id="pv-hg-' + i + '">—</b><span class="sr-only">' + esc(titoloHumidex) + '</span></div>' +
        '</div>';
    }).join('');
    dati.giorni.forEach(function (g, i) {
      animaNumero(document.getElementById('pv-max-' + i), g.max, '°');
      animaNumero(document.getElementById('pv-hn-' + i), g.humidex_notte, '°');
      animaNumero(document.getElementById('pv-hg-' + i), g.humidex_giorno, '°');
    });
    document.getElementById('previsioni-comune').innerHTML =
      'Previsioni LaMMA per ' + esc(dati.comune) + ', comune più popoloso della zona' +
      (dati.aggiornamento ? ' · aggiornate ' + esc(dati.aggiornamento) : '') + '.<br>' + ICONA_ONDA +
      ' notte/giorno = Humidex medio (temperatura percepita con l\'umidità): indicatore calcolato, non un dato ufficiale.';
    box.hidden = false;
  }

  function svgSparkline(punti) {
    if (!punti || punti.length < 2) return '';
    var valori = punti.map(function (p) { return p[1]; });
    var minV = Math.min.apply(null, valori), maxV = Math.max.apply(null, valori);
    var span = (maxV - minV) || 1;
    var w = 64, h = 22;
    var coord = punti.map(function (p, i) {
      return ((i / (punti.length - 1)) * w).toFixed(1) + ',' + (h - ((p[1] - minV) / span) * (h - 4) - 2).toFixed(1);
    }).join(' ');
    var titolo = 'Ultime letture: min ' + minV.toFixed(2) + ' m, max ' + maxV.toFixed(2) + ' m';
    return '<svg class="fiume-sparkline" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + titolo + '"><title>' + titolo + '</title>' +
      '<polyline points="' + coord + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function mostraIdrometria(nomeZona) {
    var box = document.getElementById('box-idrometria');
    // I livelli sono misure in tempo reale: non hanno senso nella scheda "domani".
    if (giorno === 'domani' || !idrometria || !idrometria.zone) { box.hidden = true; return; }
    var stazioni = idrometria.zone[nomeZona];
    if (!stazioni || !stazioni.length) { box.hidden = true; return; }

    var ordinate = stazioni.slice().sort(function (a, b) {
      var o = ['sopra_soglia2', 'in_avvicinamento_soglia2', 'sopra_soglia1', 'in_avvicinamento_soglia1', 'normale'];
      var ia = a.stato ? o.indexOf(a.stato) : 9, ib = b.stato ? o.indexOf(b.stato) : 9;
      return ia - ib;
    });
    document.getElementById('idrometria-contenuto').innerHTML = ordinate.map(function (s) {
      var classe = s.stato ? CLASSE_STATO_FIUME[s.stato] : null;
      var colore = classe ? 'var(--liv-' + classe + '-testo)' : 'var(--testo-tenue)';
      var etichetta = s.stato ? ETICHETTE_STATO_FIUME[s.stato] : 'nessuna soglia definita';
      var soglie = (s.soglia1 != null || s.soglia2 != null)
        ? ' · soglie ' + (s.soglia1 != null ? s.soglia1.toFixed(2) : '?') + ' / ' + (s.soglia2 != null ? s.soglia2.toFixed(2) : '?') + ' m'
        : '';
      return '<div class="fiume-riga"><div>' +
          '<div class="fiume-nome">' + esc(s.fiume) + ' <span>– ' + esc(s.stazione) + '</span></div>' +
          '<div class="fiume-info" style="color:' + colore + '">' + esc(etichetta) + '<span style="color:var(--testo-tenue)">' + soglie +
          (s.orario_lettura ? ' · lettura ' + esc(s.orario_lettura) : '') + '</span></div>' +
        '</div><div class="fiume-dati" style="color:' + colore + '">' + svgSparkline(s.storico) +
          '<div class="fiume-livello">' + (s.livello != null ? s.livello.toFixed(2) + ' m' : '—') + ' ' +
          '<span aria-label="' + esc(s.tendenza || '') + '">' + (ICONE_TENDENZA_FIUME[s.tendenza] || '') + '</span></div>' +
          (s.portata != null ? '<div class="fiume-portata">' + s.portata.toFixed(2) + ' m³/s</div>' : '') +
        '</div></div>';
    }).join('');

    var d = datiZona(nomeZona);
    document.getElementById('idro-collegamento').innerHTML = (d && d.pioggia && d.pioggia !== 'verde')
      ? '<div class="fiume-collegamento">&#128167; ' + esc(ETICHETTE_PIOGGIA[d.pioggia]) + ' per questa zona: tieni d\'occhio l\'andamento dei fiumi.</div>'
      : '';
    var quando = idrometria.aggiornato ? A.formattaIstante(idrometria.aggiornato) : null;
    document.getElementById('idrometria-nota').textContent =
      'Fonte: Centro Funzionale Regionale, dati in tempo reale non validati' + (quando ? ' · aggiornati ' + quando : '') + '.';
    box.hidden = false;
  }

  function mostraCaldo(nomeZona, d) {
    var box = document.getElementById('caldo-contenuto');
    var zonaCoperta = allerte && allerte.caldo_zona_coperta;
    var pallino = function (c) { return '<span class="badge ' + c + '">'; };
    if (nomeZona === zonaCoperta) {
      if (d && d.caldo) {
        box.innerHTML = '<div class="riga-rischio"><span>Bollettino ufficiale (Firenze)</span>' +
          pallino(CLASSE_CALDO[d.caldo.livello]) + esc(d.caldo.etichetta || ETICHETTE_CALDO[d.caldo.livello]) + ' · liv. ' + esc(d.caldo.livello) + '</span></div>';
        return;
      }
      if (allerte && allerte.caldo_stagione_attiva === false) {
        box.innerHTML = '<p class="nota" style="margin:0">Bollettino caldo fuori stagione (attivo indicativamente da fine maggio a metà settembre).</p>';
        return;
      }
      box.innerHTML = '<p class="nota" style="margin:0">Il bollettino ufficiale per Firenze non è disponibile per questa giornata.</p>';
      return;
    }
    var st = previsioneZona(nomeZona);
    if (st && st.caldo_stimato) {
      box.innerHTML = '<div class="riga-rischio"><span>Stima: ' + (st.max != null ? esc(st.max) + '° max' : 'n/d') +
        (st.humidex_giorno_etichetta ? ', ' + esc(st.humidex_giorno_etichetta) : '') + '</span>' +
        '<span class="badge caldo">Caldo stimato</span></div>' +
        '<p class="nota">Il bollettino ufficiale ministeriale copre solo Firenze. Questa è una stima calcolata da temperatura e Humidex sui dati LaMMA, non un bollettino ufficiale.</p>';
    } else {
      box.innerHTML = '<p class="nota" style="margin:0">Il bollettino ufficiale ministeriale copre solo la città di Firenze. Nessuna stima di rischio caldo per questa zona.</p>';
    }
  }

  function comuniZona(nomeZona) {
    var ly = layerPerNome[nomeZona];
    return ly && ly.feature.properties.comuni ? ly.feature.properties.comuni : [];
  }

  function mostraDettaglio(nomeZona) {
    document.getElementById('pan-vuoto').hidden = true;
    var pannello = document.getElementById('pan-dett');
    pannello.hidden = false;
    document.getElementById('pan-nome').textContent = nomeZona;

    var d = datiZona(nomeZona);
    var badge = d ? badgeRischio(d.pioggia) : '<span class="badge">Bollettino non disponibile</span>';
    if (d && d.caldo && d.caldo.livello >= 1) badge += '<span class="badge ' + CLASSE_CALDO[d.caldo.livello] + '">Caldo: ' + esc(ETICHETTE_CALDO[d.caldo.livello]) + '</span>';
    document.getElementById('pan-livello').innerHTML = badge;

    var comuni = comuniZona(nomeZona);
    document.getElementById('pan-comuni').innerHTML = comuni.length
      ? esc(comuni.length + ' comuni, tra cui ' + comuni.slice(0, 3).join(', ') + (comuni.length > 3 ? '…' : '')) +
        (comuni.length > 3 ? '<details><summary>Mostra tutti i comuni</summary><p>' + esc(comuni.join(', ')) + '</p></details>' : '')
      : '';

    var elTrovato = document.getElementById('comune-trovato');
    if (comuneCercato) {
      elTrovato.textContent = '📍 ' + comuneCercato + ' fa parte di questa zona di allerta';
      elTrovato.hidden = false;
    } else {
      elTrovato.hidden = true;
    }

    var testoGiorno = giorno === 'oggi' ? '· oggi' : '· domani';
    document.getElementById('pan-titolo-giorno-p').textContent = testoGiorno;
    document.getElementById('pan-titolo-giorno-c').textContent = testoGiorno;
    document.getElementById('r-idraulico').innerHTML = badgeRischio(d && d.idraulico);
    document.getElementById('r-temporali').innerHTML = badgeRischio(d && d.temporali);
    document.getElementById('r-idrogeologico').innerHTML = badgeRischio(d && d.idrogeologico);

    mostraCaldo(nomeZona, d);
    mostraIdrometria(nomeZona);
    mostraPrevisioni(nomeZona);

    fermaVoce();
    var boxVocale = document.getElementById('box-vocale');
    if (parlaDisponibile()) {
      testoVocaleCorrente = costruisciTestoVocale(nomeZona, d, previsioneZona(nomeZona), giorno === 'oggi' ? 'oggi' : 'domani');
      document.getElementById('testo-vocale').textContent = testoVocaleCorrente;
      boxVocale.hidden = false;
    } else {
      boxVocale.hidden = true;
    }
  }

  // ---------- Riassunto vocale ----------
  function parlaDisponibile() { return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; }

  function costruisciTestoVocale(nomeZona, d, prev, quandoTxt) {
    var frasi = ['Bollettino per ' + nomeZona + ', ' + quandoTxt + '.'];
    if (!d) {
      frasi.push('Dati non disponibili per questa zona.');
    } else {
      if (d.pioggia === 'verde') {
        frasi.push('Nessuna allerta per rischio idraulico, temporali o idrogeologico.');
      } else {
        var attivi = [];
        if (d.idraulico !== 'verde') attivi.push('idraulico');
        if (d.temporali !== 'verde') attivi.push('temporali');
        if (d.idrogeologico !== 'verde') attivi.push('idrogeologico');
        frasi.push(ETICHETTE_PIOGGIA[d.pioggia] + ' per rischio ' + (attivi.join(' e ') || 'idrogeologico') + '.');
      }
      if (d.caldo) {
        frasi.push('Bollettino caldo ufficiale del Ministero della Salute: ' + (d.caldo.etichetta || ETICHETTE_CALDO[d.caldo.livello]) + ', livello ' + d.caldo.livello + ' su 3.');
      } else if (prev && prev.caldo_stimato) {
        frasi.push('Attenzione al caldo: stima calcolata di ' + (prev.humidex_giorno_etichetta || 'disagio') +
          (prev.humidex_giorno != null ? ', humidex intorno ai ' + prev.humidex_giorno + ' gradi percepiti' : '') + '. Non è un bollettino ufficiale.');
      } else {
        frasi.push('Nessuna criticità da caldo prevista.');
      }
    }
    if (prev) {
      frasi.push('Le previsioni indicano ' + (prev.descrizione || 'cielo variabile') +
        (prev.max != null ? ', con temperatura massima di ' + prev.max + ' gradi' : '') +
        (prev.min != null ? ' e minima di ' + prev.min + ' gradi' : '') + '.');
    }
    return frasi.join(' ');
  }

  var bottoneVocale = document.getElementById('bottone-vocale');
  function fermaVoce() {
    if (parlaDisponibile() && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) window.speechSynthesis.cancel();
    bottoneVocale.innerHTML = '&#128266; Ascolta';
    bottoneVocale.setAttribute('aria-pressed', 'false');
  }
  if (parlaDisponibile()) {
    window.speechSynthesis.getVoices();
    bottoneVocale.addEventListener('click', function () {
      if (window.speechSynthesis.speaking) { fermaVoce(); return; }
      if (!testoVocaleCorrente) return;
      var u = new SpeechSynthesisUtterance(testoVocaleCorrente);
      u.lang = 'it-IT';
      var voceIt = window.speechSynthesis.getVoices().filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf('it') === 0; })[0];
      if (voceIt) u.voice = voceIt;
      u.onend = u.onerror = function () { bottoneVocale.innerHTML = '&#128266; Ascolta'; bottoneVocale.setAttribute('aria-pressed', 'false'); };
      bottoneVocale.innerHTML = '&#9209;&#65039; Interrompi';
      bottoneVocale.setAttribute('aria-pressed', 'true');
      window.speechSynthesis.speak(u);
    });
  }

  // ---------- Avvisi in cima ----------
  var ICONE_AVVISO = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    goccia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2s-7 9-7 13.5A7 7 0 0 0 12 22a7 7 0 0 0 7-6.5C19 11 12 2 12 2z"/></svg>',
    caldo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/></svg>',
    avviso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 22 20H2z"/><path d="M12 10v4"/><path d="M12 17h.01"/></svg>',
    attesa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>'
  };

  function avvisoHtml(classe, icona, titolo, testo, azioni) {
    return '<div class="avviso ' + classe + ' entra"><div class="bolla">' + ICONE_AVVISO[icona] + '</div><div>' +
      '<strong>' + titolo + '</strong><p>' + testo + '</p>' + (azioni ? '<div class="azioni-avviso">' + azioni + '</div>' : '') + '</div></div>';
  }
  var linkRegione = '<a href="' + URL_REGIONE + '">sito ufficiale della Regione</a>';

  function avvisiFreschezza() {
    if (!allerte) {
      if (!erroreAllerte) return '';
      return avvisoHtml('rossa', 'avviso', 'Dati non disponibili',
        'Non è stato possibile leggere l\'ultimo bollettino (' + esc(erroreAllerte) + '). Consulta il ' + linkRegione + '.',
        '<button class="btn btn-piccolo" type="button" data-azione="riprova">Riprova</button>');
    }
    var html = '';
    var ore = A.oreDa(allerte.aggiornato);
    if (ore !== null && ore > 36) {
      html += avvisoHtml('rossa', 'avviso', 'Aggiornamento automatico fermo',
        'Questa pagina non riceve nuovi dati da circa ' + Math.round(ore) + ' ore: le informazioni potrebbero non essere attuali. Fai riferimento al ' + linkRegione + '.');
    } else if (!zonePerGiorno('oggi')) {
      html += avvisoHtml('rossa', 'avviso', 'Nessun bollettino disponibile per oggi',
        'L\'ultimo bollettino caricato risale al ' + esc(allerte.emesso_pioggia || 'giorno precedente') +
        ' e non copre la giornata odierna. Fai riferimento al ' + linkRegione + '.');
    }
    if (allerte.cfr_bollettino_piu_recente) {
      html += avvisoHtml('info', 'info', 'C\'è un bollettino regionale più recente',
        'Il Centro Funzionale Regionale ha emesso un bollettino il ' + esc(allerte.cfr_bollettino_piu_recente) +
        ', successivo a quello nazionale mostrato qui. Consultalo sul <a href="https://www.cfr.toscana.it/">sito del CFR</a>.');
    }
    return html;
  }

  function aggiornaAvvisi() {
    var contenitore = document.getElementById('banner-riga');
    var quandoTxt = giorno === 'oggi' ? 'oggi' : 'domani';
    var html = avvisiFreschezza();
    var zone = zonePerGiorno();
    var logo = document.getElementById('logo-triangolo');

    if (!zone) {
      if (allerte && giorno === 'domani') {
        html += avvisoHtml('neutro', 'attesa', 'Previsione di domani non ancora pubblicata',
          'Il bollettino di criticità viene emesso di norma nel primo pomeriggio. La pagina si aggiorna da sola.');
      }
      logo.classList.remove('logo-attenzione');
      contenitore.innerHTML = html;
      return;
    }

    var peggiore = 'verde', zoneConPioggia = [], peggioreCaldo = 0, conCaldo = false;
    Object.keys(zone).forEach(function (n) {
      var d = zone[n];
      if (ORDINE_PIOGGIA[d.pioggia] > ORDINE_PIOGGIA[peggiore]) peggiore = d.pioggia;
      if (d.pioggia !== 'verde') zoneConPioggia.push(n);
      if (d.caldo) { conCaldo = true; if (d.caldo.livello > peggioreCaldo) peggioreCaldo = d.caldo.livello; }
    });
    logo.classList.toggle('logo-attenzione', peggiore !== 'verde' || peggioreCaldo > 0);

    var coda = allerte.emesso_pioggia ? ' Bollettino emesso il ' + esc(allerte.emesso_pioggia) + '.' : '';
    if (peggiore === 'verde') {
      html += avvisoHtml('verde', 'ok', 'Nessuna allerta ' + quandoTxt + ' in Toscana',
        'Nessun fenomeno significativo previsto sulle zone di allerta.' + coda);
    } else {
      zoneConPioggia.sort(function (a, b) { return ORDINE_PIOGGIA[zone[b].pioggia] - ORDINE_PIOGGIA[zone[a].pioggia]; });
      html += avvisoHtml(peggiore, 'goccia', esc(ETICHETTE_PIOGGIA[peggiore]) + ' ' + quandoTxt + ' in Toscana',
        zoneConPioggia.length + (zoneConPioggia.length === 1 ? ' zona interessata: ' : ' zone interessate: ') +
        esc(zoneConPioggia.slice(0, 4).join(', ')) + (zoneConPioggia.length > 4 ? '…' : '') + '.' + coda,
        '<button class="btn btn-piccolo" type="button" data-azione="filtra" data-livello="' + peggiore + '">Mostra sulla mappa</button>');
    }

    if (allerte.caldo_stagione_attiva === false) {
      html += avvisoHtml('neutro', 'caldo', 'Bollettino caldo non attivo',
        'Il Ministero della Salute pubblica il bollettino ondate di calore da fine maggio a metà settembre.');
    } else if (!conCaldo) {
      html += avvisoHtml('neutro', 'caldo', 'Bollettino caldo non disponibile per ' + quandoTxt,
        'Il dato ufficiale (solo città di Firenze, Ministero della Salute) non copre questa giornata.');
    } else if (peggioreCaldo === 0) {
      html += avvisoHtml('verde', 'ok', 'Nessuna allerta caldo ' + quandoTxt + ' a Firenze',
        'Dato ufficiale disponibile solo per la città di Firenze (Ministero della Salute).');
    } else {
      html += avvisoHtml(CLASSE_CALDO[peggioreCaldo], 'caldo', esc(ETICHETTE_CALDO[peggioreCaldo]) + ' a Firenze ' + quandoTxt,
        'Livello ' + peggioreCaldo + ' su 3 — dato ufficiale disponibile solo per la città di Firenze.');
    }
    contenitore.innerHTML = html;
  }

  document.getElementById('banner-riga').addEventListener('click', function (e) {
    var b = e.target.closest('[data-azione]');
    if (!b) return;
    if (b.getAttribute('data-azione') === 'riprova') ricaricaDati(true);
    if (b.getAttribute('data-azione') === 'filtra') {
      var chip = document.querySelector('#filtri .chip[data-livello="' + b.getAttribute('data-livello') + '"]');
      if (chip && chip.getAttribute('aria-pressed') !== 'true') chip.click();
      document.getElementById('titolo-mappa').scrollIntoView({ behavior: A.animazioniRidotte() ? 'auto' : 'smooth' });
    }
  });

  function aggiornaIntestazioni() {
    var iso = isoGiorno();
    var etichetta = A.formattaGiornoIso(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    document.getElementById('data-giorno').textContent = etichetta;
    document.getElementById('mappa-quando').textContent = (giorno === 'oggi' ? 'Oggi' : 'Domani') + ' · ' + etichetta;
    var el = document.getElementById('riga-controllo');
    if (allerte && allerte.aggiornato) {
      el.textContent = 'Controllato ' + A.fraQuanto(allerte.aggiornato);
      el.title = 'Ultimo controllo automatico dei bollettini: ' + (A.formattaIstante(allerte.aggiornato) || '');
    } else {
      el.textContent = '';
    }
  }

  function aggiornaTutto() {
    if (!Object.keys(colori).length) aggiornaColori();
    aggiornaIntestazioni();
    aggiornaAvvisi();
    renderFiltri();
    renderElencoZone();
    ridisegnaMappa();
    if (nomeSelezionato) mostraDettaglio(nomeSelezionato);
  }

  // ---------- Ricerca comuni ----------
  function costruisciIndiceComuni() {
    indiceComuni = [];
    var conteggio = {};
    geo.features.forEach(function (f) {
      (f.properties.comuni || []).forEach(function (c) { conteggio[c] = (conteggio[c] || 0) + 1; });
    });
    geo.features.forEach(function (f) {
      (f.properties.comuni || []).forEach(function (c) {
        indiceComuni.push({ comune: c, zona: f.properties.nome, chiave: normalizza(c), ambiguo: conteggio[c] > 1 });
      });
    });
    indiceComuni.sort(function (a, b) { return a.comune.localeCompare(b.comune, 'it') || a.zona.localeCompare(b.zona, 'it'); });
  }

  function cerca(testo) {
    var q = normalizza(testo);
    if (q.length < 2) return [];
    var inizio = [], dentro = [];
    indiceComuni.forEach(function (v) {
      var i = v.chiave.indexOf(q);
      if (i === 0) inizio.push(v); else if (i > 0) dentro.push(v);
    });
    return inizio.concat(dentro).slice(0, 8);
  }

  function evidenziaTesto(nome, testo) {
    var q = testo.trim().toLowerCase();
    var i = nome.toLowerCase().indexOf(q);
    if (!q || i < 0) return esc(nome);
    return esc(nome.slice(0, i)) + '<mark>' + esc(nome.slice(i, i + q.length)) + '</mark>' + esc(nome.slice(i + q.length));
  }

  var inputCerca = document.getElementById('cerca-comune');
  var listaRisultati = document.getElementById('risultati-ricerca');
  var risultatiCorrenti = [];
  var indiceEvidenziato = -1;

  function mostraRisultati(items, testo) {
    risultatiCorrenti = items;
    indiceEvidenziato = -1;
    inputCerca.removeAttribute('aria-activedescendant');
    if (!indiceComuni.length) {
      listaRisultati.innerHTML = '<li class="vuoto">Elenco dei comuni non ancora caricato…</li>';
    } else if (!items.length) {
      listaRisultati.innerHTML = '<li class="vuoto">Nessun comune trovato</li>';
    } else {
      listaRisultati.innerHTML = items.map(function (v, i) {
        var d = datiZona(v.zona);
        var liv = d ? d.pioggia : 'nd';
        return '<li role="option" id="ris-' + i + '" data-i="' + i + '" aria-selected="false"><span>' + evidenziaTesto(v.comune, testo) +
          '</span><span class="zona-nome"><span class="pallino-liv" style="background:var(--liv-' + liv + ')"></span>' + esc(v.zona) + '</span></li>';
      }).join('');
    }
    listaRisultati.hidden = false;
    inputCerca.setAttribute('aria-expanded', 'true');
  }

  function chiudiRisultati() {
    listaRisultati.hidden = true;
    inputCerca.setAttribute('aria-expanded', 'false');
    inputCerca.removeAttribute('aria-activedescendant');
    indiceEvidenziato = -1;
  }

  function evidenzia(i) {
    Array.prototype.forEach.call(listaRisultati.querySelectorAll('li[data-i]'), function (el, k) {
      el.setAttribute('aria-selected', k === i ? 'true' : 'false');
      if (k === i) el.scrollIntoView({ block: 'nearest' });
    });
    indiceEvidenziato = i;
    inputCerca.setAttribute('aria-activedescendant', 'ris-' + i);
  }

  function vaiAComune(voce) {
    if (!voce || !layerPerNome[voce.zona]) return;
    chiudiRisultati();
    inputCerca.value = voce.comune;
    seleziona(voce.zona, voce.comune, { zoom: true });
    inputCerca.blur();
  }

  inputCerca.addEventListener('input', function () {
    var testo = this.value.trim();
    if (testo.length < 2) { chiudiRisultati(); return; }
    mostraRisultati(cerca(testo), testo);
  });
  inputCerca.addEventListener('focus', function () {
    var testo = this.value.trim();
    if (testo.length >= 2) mostraRisultati(cerca(testo), testo);
  });
  inputCerca.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { chiudiRisultati(); return; }
    if (listaRisultati.hidden || !risultatiCorrenti.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); evidenzia((indiceEvidenziato + 1) % risultatiCorrenti.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); evidenzia((indiceEvidenziato - 1 + risultatiCorrenti.length) % risultatiCorrenti.length); }
    else if (e.key === 'Enter') { e.preventDefault(); vaiAComune(risultatiCorrenti[indiceEvidenziato >= 0 ? indiceEvidenziato : 0]); }
  });
  listaRisultati.addEventListener('mousedown', function (e) {
    var li = e.target.closest('li[data-i]');
    if (!li) return;
    e.preventDefault();
    vaiAComune(risultatiCorrenti[parseInt(li.getAttribute('data-i'), 10)]);
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.ricerca')) chiudiRisultati();
  });

  // ---------- Geolocalizzazione ----------
  function puntoInAnello(lng, lat, anello) {
    var dentro = false;
    for (var i = 0, j = anello.length - 1; i < anello.length; j = i++) {
      var xi = anello[i][0], yi = anello[i][1], xj = anello[j][0], yj = anello[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) dentro = !dentro;
    }
    return dentro;
  }
  function puntoInPoligono(lng, lat, poligono) {
    if (!puntoInAnello(lng, lat, poligono[0])) return false;
    for (var k = 1; k < poligono.length; k++) if (puntoInAnello(lng, lat, poligono[k])) return false;
    return true;
  }
  function zonaDaPunto(lat, lng) {
    if (!geo) return null;
    for (var i = 0; i < geo.features.length; i++) {
      var g = geo.features[i].geometry;
      var poligoni = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (var p = 0; p < poligoni.length; p++) if (puntoInPoligono(lng, lat, poligoni[p])) return geo.features[i].properties.nome;
    }
    return null;
  }

  var bottonePosizione = document.getElementById('bottone-posizione');
  if (!('geolocation' in navigator)) bottonePosizione.hidden = true;
  bottonePosizione.addEventListener('click', function () {
    if (!geo) { A.toast('La mappa non è ancora pronta.'); return; }
    bottonePosizione.disabled = true;
    bottonePosizione.classList.add('gira');
    navigator.geolocation.getCurrentPosition(function (pos) {
      bottonePosizione.disabled = false;
      bottonePosizione.classList.remove('gira');
      var zona = zonaDaPunto(pos.coords.latitude, pos.coords.longitude);
      if (!zona) { A.toast('La tua posizione sembra fuori dalle zone di allerta toscane.'); return; }
      seleziona(zona, null, { zoom: true });
      A.toast('Ti trovi nella zona ' + zona);
    }, function (err) {
      bottonePosizione.disabled = false;
      bottonePosizione.classList.remove('gira');
      A.toast(err.code === 1 ? 'Permesso di posizione negato.' : 'Posizione non disponibile.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });

  // ---------- Link condivisibile (#zona=…&giorno=…) ----------
  function scriviHash() {
    var parti = [];
    if (nomeSelezionato) parti.push('zona=' + encodeURIComponent(nomeSelezionato));
    if (giorno === 'domani') parti.push('giorno=domani');
    var nuovo = parti.length ? '#' + parti.join('&') : location.pathname + location.search;
    try { history.replaceState(null, '', nuovo); } catch (e) { /* file:// o sandbox */ }
  }
  function leggiHash() {
    var out = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (p) {
      var kv = p.split('=');
      if (kv[0]) {
        try { out[kv[0]] = decodeURIComponent(kv[1] || ''); } catch (e) { /* hash malformato */ }
      }
    });
    return out;
  }
  function applicaHash() {
    var h = leggiHash();
    if (h.giorno === 'domani' && giorno !== 'domani') impostaGiorno('domani', false);
    if (h.zona && layerPerNome[h.zona]) seleziona(h.zona, null, {});
  }
  document.getElementById('bottone-condividi').addEventListener('click', function () {
    scriviHash();
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { A.toast('Link copiato negli appunti'); }, function () { A.toast(url, 5000); });
    } else {
      A.toast(url, 5000);
    }
  });

  // ---------- Schede Oggi / Domani ----------
  var tabs = document.getElementById('tabs');
  function impostaGiorno(g, conFocus) {
    giorno = g;
    Array.prototype.forEach.call(tabs.querySelectorAll('[role="tab"]'), function (x) {
      var attivo = x.getAttribute('data-giorno') === g;
      x.setAttribute('aria-selected', attivo ? 'true' : 'false');
      x.tabIndex = attivo ? 0 : -1;
      if (attivo && conFocus) x.focus();
    });
    aggiornaTutto();
    scriviHash();
  }
  tabs.addEventListener('click', function (e) {
    var b = e.target.closest('[role="tab"]');
    if (b && b.getAttribute('data-giorno') !== giorno) impostaGiorno(b.getAttribute('data-giorno'), false);
  });
  tabs.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      impostaGiorno(giorno === 'oggi' ? 'domani' : 'oggi', true);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !nomeSelezionato) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    deseleziona();
  });

  // ---------- Caricamento e aggiornamento dei dati ----------
  var giornoCaricato = A.isoOggiRoma(0);

  function caricaAllerte(senzaCache) {
    return A.caricaJson('data/allerte.json', { senzaCache: senzaCache })
      .then(function (d) { allerte = d; erroreAllerte = null; })
      .catch(function (err) {
        console.warn('Allerte non caricate:', err.message);
        if (!allerte) erroreAllerte = err.message;
        throw err;
      });
  }
  function caricaPrevisioni(senzaCache) {
    return A.caricaJson('data/previsioni.json', { senzaCache: senzaCache })
      .then(function (d) { previsioni = d; })
      .catch(function (err) { console.warn('Previsioni non caricate:', err.message); });
  }
  function caricaIdrometria(senzaCache) {
    return A.caricaJson('data/idrometria.json', { senzaCache: senzaCache, timeout: 25000 })
      .then(function (d) { idrometria = d; })
      .catch(function (err) { console.warn('Idrometria non caricata:', err.message); });
  }

  var aggiornamentoInCorso = false;
  function ricaricaDati(daBottone) {
    if (aggiornamentoInCorso) return;
    aggiornamentoInCorso = true;
    var bottone = document.getElementById('bottone-aggiorna');
    if (daBottone) { bottone.disabled = true; bottone.classList.add('gira'); }
    var esitoAllerte = caricaAllerte(true).then(function () { return true; }, function () { return false; });
    Promise.all([esitoAllerte, caricaPrevisioni(true), caricaIdrometria(true)]).then(function (r) {
      giornoCaricato = A.isoOggiRoma(0);
      aggiornaTutto();
      if (daBottone) A.toast(r[0] ? 'Dati aggiornati' : 'Aggiornamento non riuscito, riprova più tardi');
    }).finally(function () {
      aggiornamentoInCorso = false;
      if (daBottone) { bottone.disabled = false; bottone.classList.remove('gira'); }
    });
  }
  document.getElementById('bottone-aggiorna').addEventListener('click', function () { ricaricaDati(true); });

  setInterval(function () {
    if (!document.hidden) ricaricaDati(false);
  }, 5 * 60 * 1000);
  // Aggiorna l'indicazione "controllato N min fa" e, a cavallo della mezzanotte, il giorno.
  setInterval(function () {
    if (A.isoOggiRoma(0) !== giornoCaricato) { giornoCaricato = A.isoOggiRoma(0); aggiornaTutto(); }
    else aggiornaIntestazioni();
  }, 60 * 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) ricaricaDati(false);
  });

  A.quandoCambiaTema(function () { aggiornaColori(); ridisegnaMappa(); });
  A.inizializzaTema();
  aggiornaColori();
  aggiornaIntestazioni();

  caricaMappa();
  caricaAllerte(false).catch(function () { /* gestito negli avvisi */ }).then(aggiornaTutto);
  caricaPrevisioni(false).then(aggiornaTutto);
  caricaIdrometria(false).then(aggiornaTutto);

  // ---------- Iscrizione agli avvisi ----------
  var selectIscrizione = document.getElementById('iscrizione-comune');

  // L'elenco viene costruito dalle zone della mappa: cosi' resta sempre allineato
  // e i comuni divisi tra due zone (es. Pistoia) compaiono una volta per ciascuna.
  function popolaSelectIscrizione() {
    var precedente = selectIscrizione.value;
    var html = '<option value="">Scegli il tuo comune…</option>';
    indiceComuni.forEach(function (v) {
      html += '<option value="' + esc(v.zona) + '" data-comune="' + esc(v.comune) + '">' +
        esc(v.comune) + (v.ambiguo ? ' (zona ' + esc(v.zona) + ')' : '') + '</option>';
    });
    selectIscrizione.innerHTML = html;
    if (precedente) selectIscrizione.value = precedente;
  }

  function sincronizzaSelectIscrizione(zona, comune) {
    var opzioni = selectIscrizione.options;
    for (var i = 0; i < opzioni.length; i++) {
      if (opzioni[i].value === zona && opzioni[i].getAttribute('data-comune') === comune) { selectIscrizione.selectedIndex = i; return; }
    }
  }

  document.getElementById('form-iscrizione').addEventListener('submit', function (e) {
    e.preventDefault();
    var campoEmail = document.getElementById('iscrizione-email');
    var esito = document.getElementById('iscrizione-esito');
    var bottone = document.getElementById('bottone-iscrizione');
    var zona = selectIscrizione.value;
    var email = campoEmail.value.trim();
    selectIscrizione.removeAttribute('aria-invalid');
    campoEmail.removeAttribute('aria-invalid');

    if (!zona) {
      esito.textContent = 'Scegli prima il tuo comune.';
      esito.className = 'esito errore';
      selectIscrizione.setAttribute('aria-invalid', 'true');
      selectIscrizione.focus();
      return;
    }
    if (!email || !campoEmail.checkValidity()) {
      esito.textContent = 'Scrivi un indirizzo email valido.';
      esito.className = 'esito errore';
      campoEmail.setAttribute('aria-invalid', 'true');
      campoEmail.focus();
      return;
    }

    bottone.disabled = true;
    bottone.textContent = 'Invio…';
    esito.textContent = '';
    esito.className = 'esito';

    fetch(URL_WORKER + '/iscrivi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, zona: zona })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (dati) { return { ok: r.ok, dati: dati || {} }; });
      })
      .then(function (ris) {
        if (ris.ok && ris.dati.ok) {
          esito.textContent = ris.dati.messaggio || 'Iscrizione registrata.';
          esito.className = 'esito ok';
          campoEmail.value = '';
        } else {
          esito.textContent = ris.dati.errore || 'Qualcosa non ha funzionato, riprova.';
          esito.className = 'esito errore';
        }
      })
      .catch(function () {
        esito.textContent = 'Impossibile contattare il servizio di iscrizione. Riprova più tardi.';
        esito.className = 'esito errore';
      })
      .finally(function () {
        bottone.disabled = false;
        bottone.textContent = 'Iscrivimi gratis';
      });
  });

  if (window.innerWidth < 400) inputCerca.setAttribute('placeholder', 'Cerca il tuo comune…');
})();
