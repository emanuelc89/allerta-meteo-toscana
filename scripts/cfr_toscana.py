"""
Lettura del Bollettino di Valutazione delle Criticita' del Centro Funzionale
Regionale della Toscana (https://www.cfr.toscana.it/index.php?IDS=2&IDSS=76).

Il CFR non pubblica un formato strutturato (niente JSON/XML/RSS): si legge la
pagina HTML. La pagina contiene pero' DUE rappresentazioni indipendenti dello
stesso bollettino, e questo modulo le usa entrambe:

1) la tabella riepilogativa (class="table_legend"): per ognuna delle 26 zone
   un'icona criticita0..3.gif = livello massimo su tutto il periodo di validita';
2) la tabella dei rischi (class="table_risks"): una riga per ogni combinazione
   zone / rischio / finestra temporale / colore. Da qui si ricava il livello
   per zona e per giorno (oggi e domani), con la stessa semantica del
   bollettino nazionale DPC (massimo giornaliero per zona).

Se le due rappresentazioni non coincidono, o se un formato non viene
riconosciuto, si solleva ErroreBollettinoCFR: chi chiama torna al DPC.
Meglio nessun dato regionale che un dato regionale sbagliato.

Solo libreria standard, Python >= 3.9.
"""

import re
from datetime import datetime, timedelta
from html import unescape

URL_CFR_CRITICITA = "https://www.cfr.toscana.it/index.php?IDS=2&IDSS=76"

# Sigla usata dal CFR -> nome zona cosi' come compare nel bollettino DPC
# (sono le chiavi di docs/data/allerte.json e di docs/zone.geojson).
ZONE_CFR = {
    "A1": "Arno-Casentino",
    "A2": "Arno-Valdarno Sup.",
    "A3": "Arno-Firenze",
    "A4": "Valdarno Inf.",
    "A5": "Valdelsa-Valdera",
    "A6": "Arno-Costa",
    "B": "Bisenzio e Ombrone Pt",
    "C": "Valdichiana",
    "E1": "Etruria",
    "E2": "Etruria-Costa Nord",
    "E3": "Etruria-Costa Sud",
    "F1": "Fiora e Albegna",
    "F2": "Fiora e Albegna-Costa e Giglio",
    "I": "Isole",
    "L": "Lunigiana",
    "M": "Mugello-Val di Sieve",
    "O1": "Ombrone Gr-Alto",
    "O2": "Ombrone Gr-Medio",
    "O3": "Ombrone Gr-Costa",
    "R1": "Reno",
    "R2": "Romagna-Toscana",
    "S1": "Serchio-Garfagnana-Lima",
    "S2": "Serchio-Lucca",
    "S3": "Serchio-Costa",
    "T": "Valtiberina",
    "V": "Versilia",
}

MESI_ITALIANI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}

LIVELLO_DA_ICONA = {"0": "verde", "1": "gialla", "2": "arancione", "3": "rossa"}
LIVELLO_DA_TESTO = {"VERDE": "verde", "GIALLO": "gialla", "ARANCIONE": "arancione", "ROSSO": "rossa"}
LIVELLO_DA_COLORE = {"#ffff00": "gialla", "#ffa500": "arancione", "#ff0000": "rossa"}
ORDINE = {"verde": 0, "gialla": 1, "arancione": 2, "rossa": 3}

# Le tre categorie mostrate dal sito (come nel DPC) + le altre del CFR.
CATEGORIE_PIOGGIA = ("idraulico", "temporali", "idrogeologico")
CATEGORIE_ALTRE = ("vento", "mareggiate", "neve", "ghiaccio")

# Nomi dei giorni, accettati anche con l'accento acuto che il CFR usa spesso
# ("Mercoledí", "Martedí"): \w in Python copre le lettere accentate.
_RE_DATA_ORA = re.compile(
    r"(\d{1,2})[.:](\d{2})\s+(?:di\s+)?(?:[^\W\d_]+\s*,?\s*)?(\d{1,2})\s+([^\W\d_]+)\s+(\d{4})",
    re.IGNORECASE,
)
_RE_EMISSIONE = re.compile(
    r"Emissione\s+di\s+(?:[^\W\d_]+\s*,?\s*)?(\d{1,2})\s+([^\W\d_]+)\s+(\d{4})\s*,?\s*ore\s+(\d{1,2})[.:](\d{2})",
    re.IGNORECASE,
)


class ErroreBollettinoCFR(Exception):
    """La pagina del CFR non e' leggibile in modo affidabile."""


def peggiore(*livelli):
    return max(livelli, key=lambda l: ORDINE.get(l, 0))


def _testo(frammento_html):
    """HTML -> testo piano: <br> e tag diventano spazi, entita' decodificate."""
    t = re.sub(r"<br\s*/?>", " ", frammento_html, flags=re.IGNORECASE)
    t = re.sub(r"<[^>]+>", " ", t)
    t = unescape(t).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def _data_da_pezzi(giorno, mese_nome, anno, ora="0", minuto="0"):
    mese = MESI_ITALIANI.get(mese_nome.lower())
    if not mese:
        raise ErroreBollettinoCFR(f"mese '{mese_nome}' non riconosciuto")
    try:
        return datetime(int(anno), mese, int(giorno), int(ora), int(minuto))
    except ValueError as e:
        raise ErroreBollettinoCFR(f"data non valida ({giorno} {mese_nome} {anno} {ora}:{minuto}): {e}")


def estrai_emissione(html):
    """datetime naive (ora italiana) della riga 'Emissione di ..., ore ...'."""
    m = _RE_EMISSIONE.search(_testo(html))
    if not m:
        raise ErroreBollettinoCFR("riga 'Emissione di ...' non trovata")
    giorno, mese_nome, anno, ora, minuto = m.groups()
    return _data_da_pezzi(giorno, mese_nome, anno, ora, minuto)


def _blocco_tabella(html, classe):
    m = re.search(
        r"<table[^>]*class=\"[^\"]*\b" + re.escape(classe) + r"\b[^\"]*\"[^>]*>(.*?)</table>",
        html, re.IGNORECASE | re.DOTALL,
    )
    return m.group(1) if m else None


def estrai_riepilogo(html):
    """Tabella riepilogativa: {sigla: livello} per tutte e 26 le zone."""
    blocco = _blocco_tabella(html, "table_legend")
    if blocco is None:
        raise ErroreBollettinoCFR("tabella riepilogativa (table_legend) non trovata")
    riepilogo = {}
    for icona, sigla in re.findall(
        r"criticita(\d)\.gif[^>]*>\s*<b>\s*([A-Z]\d?)\s*-", blocco, re.IGNORECASE
    ):
        if sigla in riepilogo:
            raise ErroreBollettinoCFR(f"zona {sigla} ripetuta nella tabella riepilogativa")
        riepilogo[sigla] = LIVELLO_DA_ICONA.get(icona)
    sconosciute = sorted(set(riepilogo) - set(ZONE_CFR))
    mancanti = sorted(set(ZONE_CFR) - set(riepilogo))
    if sconosciute or mancanti or None in riepilogo.values():
        raise ErroreBollettinoCFR(
            f"tabella riepilogativa incompleta: {len(riepilogo)} zone, "
            f"sconosciute={sconosciute}, mancanti={mancanti}"
        )
    return riepilogo


def _categoria(testo_rischio):
    t = testo_rischio.upper()
    if "TEMPORAL" in t:
        return "temporali"
    if "RETICOLO PRINCIPALE" in t:
        return "idraulico"
    if "IDROGEOLOGIC" in t or "RETICOLO MINORE" in t:
        return "idrogeologico"
    if "VENTO" in t:
        return "vento"
    if "MAREGGIAT" in t:
        return "mareggiate"
    if "NEVE" in t:
        return "neve"
    if "GHIACCIO" in t:
        return "ghiaccio"
    return "altro"


def _interpreta_tempi(testo, emissione):
    """
    Colonna TEMPI -> (inizio, fine) come datetime naive. Formati visti:
      "dalle ore 17.00 di Mercoledí, 11 Novembre 2026 alle ore 10.00 di Giovedì, 12 Novembre 2026"
      "in corso fino alle ore 23.59 di Mercoledí, 11 Novembre 2026"
      "fino alle ore 09.00 Sabato, 10 Gennaio 2026"   (versione senza "di")
    """
    t = testo.lower()
    date_trovate = [
        _data_da_pezzi(g, mn, a, h, mi) for (h, mi, g, mn, a) in _RE_DATA_ORA.findall(testo)
    ]
    inizio_validita = datetime.combine(emissione.date(), datetime.min.time())
    fine_validita = inizio_validita + timedelta(days=2)

    if "dalle" in t and len(date_trovate) == 2:
        inizio, fine = date_trovate
    elif "dalle" in t and "alle" not in t.replace("dalle", "") and len(date_trovate) == 1:
        inizio, fine = date_trovate[0], fine_validita
    elif "fino" in t and len(date_trovate) == 1:
        inizio, fine = inizio_validita, date_trovate[0]
    else:
        raise ErroreBollettinoCFR(f"formato TEMPI non riconosciuto: '{testo}'")

    if fine <= inizio:
        raise ErroreBollettinoCFR(f"finestra temporale vuota o invertita: '{testo}'")
    return inizio, fine


def estrai_righe_rischi(html, emissione):
    """
    Tabella dei rischi -> lista di righe:
      {"zone": [sigle], "rischio": testo, "categoria": ..., "inizio": dt, "fine": dt, "livello": ...}
    Se la tabella manca del tutto restituisce [] (succede quando non c'e' alcuna
    criticita' prevista): sara' il confronto con il riepilogo a dire se e' plausibile.
    """
    blocco = _blocco_tabella(html, "table_risks")
    if blocco is None:
        return []

    righe = []
    for attributi_tr, contenuto_tr in re.findall(r"<tr([^>]*)>(.*?)</tr>", blocco, re.IGNORECASE | re.DOTALL):
        celle = re.findall(r"<td[^>]*>(.*?)</td>", contenuto_tr, re.IGNORECASE | re.DOTALL)
        if not celle:
            continue  # intestazione (<th>)
        if len(celle) != 4:
            raise ErroreBollettinoCFR(f"riga della tabella rischi con {len(celle)} celle invece di 4")

        testo_zone, testo_rischio, testo_tempi, testo_livello = (_testo(c) for c in celle)

        zone = [z for z in re.split(r"[,\s]+", testo_zone.upper()) if z]
        ignote = [z for z in zone if z not in ZONE_CFR]
        if not zone or ignote:
            raise ErroreBollettinoCFR(f"sigle zona non riconosciute: {ignote or testo_zone!r}")

        livello = LIVELLO_DA_TESTO.get(testo_livello.upper())
        if livello is None:
            raise ErroreBollettinoCFR(f"livello di criticita' non riconosciuto: '{testo_livello}'")

        # Seconda codifica dello stesso dato: il colore di sfondo della riga.
        m_colore = re.search(r"background-color\s*:\s*(#[0-9a-fA-F]{6})", attributi_tr)
        if m_colore:
            da_colore = LIVELLO_DA_COLORE.get(m_colore.group(1).lower())
            if da_colore and da_colore != livello:
                raise ErroreBollettinoCFR(
                    f"colore riga ({m_colore.group(1)} = {da_colore}) diverso dal testo ({livello})"
                )

        inizio, fine = _interpreta_tempi(testo_tempi, emissione)
        righe.append({
            "zone": zone,
            "rischio": testo_rischio,
            "categoria": _categoria(testo_rischio),
            "inizio": inizio,
            "fine": fine,
            "livello": livello,
        })
    return righe


def _zona_vuota():
    z = {c: "verde" for c in CATEGORIE_PIOGGIA + CATEGORIE_ALTRE}
    z["altro"] = "verde"
    return z


def calcola_per_giorno(righe, emissione):
    """
    {data_iso: {nome_zona_dpc: {...}}} per il giorno di emissione e il successivo.
    Una riga vale per un giorno se la sua finestra [inizio, fine) interseca quel giorno.
    """
    giorni = [emissione.date(), emissione.date() + timedelta(days=1)]
    grezzo = {g: {sigla: _zona_vuota() for sigla in ZONE_CFR} for g in giorni}

    for riga in righe:
        for g in giorni:
            inizio_g = datetime.combine(g, datetime.min.time())
            fine_g = inizio_g + timedelta(days=1)
            if not (riga["inizio"] < fine_g and riga["fine"] > inizio_g):
                continue
            for sigla in riga["zone"]:
                z = grezzo[g][sigla]
                z[riga["categoria"]] = peggiore(z[riga["categoria"]], riga["livello"])

    per_data = {}
    for g in giorni:
        zone_out = {}
        for sigla, z in grezzo[g].items():
            altri = {c: z[c] for c in CATEGORIE_ALTRE if z[c] != "verde"}
            if z["altro"] != "verde":
                altri["altro"] = z["altro"]
            voce = {
                "pioggia": peggiore(*(z[c] for c in CATEGORIE_PIOGGIA)),
                "idraulico": z["idraulico"],
                "temporali": z["temporali"],
                "idrogeologico": z["idrogeologico"],
                "caldo": None,
                "massimo": peggiore(*z.values()),
            }
            if altri:
                voce["altri_rischi"] = altri
            zone_out[ZONE_CFR[sigla]] = voce
        per_data[g.isoformat()] = zone_out
    return per_data


def verifica_coerenza(righe, riepilogo):
    """Il massimo per zona ricavato dalle righe deve coincidere con l'icona del riepilogo."""
    massimo = {sigla: "verde" for sigla in ZONE_CFR}
    for riga in righe:
        for sigla in riga["zone"]:
            massimo[sigla] = peggiore(massimo[sigla], riga["livello"])
    differenze = {
        sigla: (massimo[sigla], riepilogo[sigla])
        for sigla in ZONE_CFR if massimo[sigla] != riepilogo[sigla]
    }
    if differenze:
        raise ErroreBollettinoCFR(
            "tabella rischi e riepilogo non coincidono (zona: da righe / da riepilogo): "
            + ", ".join(f"{s}: {a}/{b}" for s, (a, b) in sorted(differenze.items()))
        )


def leggi_bollettino_cfr(html):
    """
    Punto d'ingresso. Restituisce:
      {"emissione": datetime, "per_data": {data_iso: {zona: {...}}}, "riepilogo": {sigla: livello}}
    oppure solleva ErroreBollettinoCFR.
    """
    emissione = estrai_emissione(html)
    riepilogo = estrai_riepilogo(html)
    righe = estrai_righe_rischi(html, emissione)
    verifica_coerenza(righe, riepilogo)
    return {
        "emissione": emissione,
        "per_data": calcola_per_giorno(righe, emissione),
        "riepilogo": riepilogo,
        "righe": righe,
    }
