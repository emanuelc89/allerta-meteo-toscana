/* Funzioni condivise da index.html e fiumi.html */
(function () {
  'use strict';

  var FUSO = 'Europe/Rome';

  // Escape dei testi che arrivano dai dati (CFR, LaMMA, DPC) prima di metterli in innerHTML.
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // fetch JSON con timeout e un nuovo tentativo: su reti mobili lente una singola
  // richiesta appesa bloccava la pagina in "caricamento" per sempre.
  function caricaJson(url, opzioni) {
    opzioni = opzioni || {};
    var timeoutMs = opzioni.timeout || 15000;
    var tentativi = opzioni.tentativi == null ? 1 : opzioni.tentativi;
    var finale = opzioni.senzaCache ? url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now() : url;

    function prova(rimasti) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
      return fetch(finale, { signal: ctrl ? ctrl.signal : undefined, cache: opzioni.senzaCache ? 'no-store' : 'default' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') err = new Error('tempo scaduto');
          if (rimasti > 0) {
            return new Promise(function (ok) { setTimeout(ok, 1200); }).then(function () { return prova(rimasti - 1); });
          }
          throw err;
        })
        .finally(function () { if (timer) clearTimeout(timer); });
    }
    return prova(tentativi);
  }

  // Data di oggi (YYYY-MM-DD) nel fuso italiano, indipendente dal fuso del dispositivo.
  function isoOggiRoma(spostamentoGiorni) {
    var t = Date.now() + (spostamentoGiorni || 0) * 86400000;
    var parti = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
    return parti; // en-CA produce gia' YYYY-MM-DD
  }

  function isoPiuGiorni(iso, n) {
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n, 12));
    return d.toISOString().slice(0, 10);
  }

  // Una data YYYY-MM-DD (senza ora) va interpretata a mezzogiorno UTC, cosi' il
  // giorno della settimana non "scivola" a seconda del fuso del dispositivo.
  function dataDaIso(iso) {
    var p = String(iso).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  }

  function maiuscola(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  function formattaGiornoIso(iso, opzioni) {
    return maiuscola(dataDaIso(iso).toLocaleDateString('it-IT', Object.assign({ timeZone: 'UTC' }, opzioni || {
      weekday: 'long', day: 'numeric', month: 'long'
    })));
  }

  function formattaIstante(isoString, conGiorno) {
    var d = new Date(isoString);
    if (isNaN(d)) return null;
    var ora = d.toLocaleTimeString('it-IT', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
    if (conGiorno === false) return ora;
    var giornoD = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(d);
    var oggi = isoOggiRoma(0);
    var ieri = isoOggiRoma(-1);
    if (giornoD === oggi) return 'oggi alle ' + ora;
    if (giornoD === ieri) return 'ieri alle ' + ora;
    return d.toLocaleDateString('it-IT', { timeZone: FUSO, day: 'numeric', month: 'long' }) + ' alle ' + ora;
  }

  function oreDa(isoString) {
    if (!isoString) return null;
    var t = Date.parse(isoString);
    if (isNaN(t)) return null;
    return (Date.now() - t) / 3600000;
  }

  function fraQuanto(isoString) {
    var ore = oreDa(isoString);
    if (ore == null) return '';
    var min = Math.round(ore * 60);
    if (min < 1) return 'pochi secondi fa';
    if (min < 60) return min + ' min fa';
    var h = Math.round(ore);
    if (h < 48) return h + (h === 1 ? ' ora fa' : ' ore fa');
    return Math.round(h / 24) + ' giorni fa';
  }

  function animazioniRidotte() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ---------- Tema chiaro / scuro ----------
  var ORDINE_TEMI = ['auto', 'light', 'dark'];
  var ETICHETTE_TEMI = { auto: 'Tema automatico', light: 'Tema chiaro', dark: 'Tema scuro' };
  var ICONE_TEMI = {
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
  };
  var ascoltatoriTema = [];

  function temaSalvato() {
    try { return localStorage.getItem('tema') || 'auto'; } catch (e) { return 'auto'; }
  }
  function applicaTema(tema) {
    if (tema === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', tema);
    try { localStorage.setItem('tema', tema); } catch (e) { /* storage non disponibile */ }
    var b = document.getElementById('bottone-tema');
    if (b) {
      b.innerHTML = ICONE_TEMI[tema];
      b.setAttribute('aria-label', ETICHETTE_TEMI[tema] + ' (clic per cambiare)');
      b.title = ETICHETTE_TEMI[tema];
    }
    ascoltatoriTema.forEach(function (f) { f(); });
  }
  function temaScuro() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function quandoCambiaTema(f) { ascoltatoriTema.push(f); }

  function inizializzaTema() {
    applicaTema(temaSalvato());
    var b = document.getElementById('bottone-tema');
    if (b) b.addEventListener('click', function () {
      var attuale = temaSalvato();
      var prossimo = ORDINE_TEMI[(ORDINE_TEMI.indexOf(attuale) + 1) % ORDINE_TEMI.length];
      applicaTema(prossimo);
      toast(ETICHETTE_TEMI[prossimo]);
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var f = function () { if (temaSalvato() === 'auto') ascoltatoriTema.forEach(function (g) { g(); }); };
      if (mq.addEventListener) mq.addEventListener('change', f); else if (mq.addListener) mq.addListener(f);
    }
  }

  function varCss(nome) {
    return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
  }

  // ---------- Toast ----------
  function toast(testo, durataMs) {
    var zona = document.getElementById('toast-zona');
    if (!zona) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = testo;
    zona.appendChild(el);
    setTimeout(function () {
      el.classList.add('esce');
      setTimeout(function () { el.remove(); }, 260);
    }, durataMs || 2600);
  }

  window.AMT = {
    FUSO: FUSO,
    esc: esc,
    caricaJson: caricaJson,
    isoOggiRoma: isoOggiRoma,
    isoPiuGiorni: isoPiuGiorni,
    dataDaIso: dataDaIso,
    formattaGiornoIso: formattaGiornoIso,
    formattaIstante: formattaIstante,
    oreDa: oreDa,
    fraQuanto: fraQuanto,
    maiuscola: maiuscola,
    animazioniRidotte: animazioniRidotte,
    inizializzaTema: inizializzaTema,
    temaScuro: temaScuro,
    quandoCambiaTema: quandoCambiaTema,
    varCss: varCss,
    toast: toast
  };
})();
