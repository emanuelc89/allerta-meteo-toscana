"""
Scarica le previsioni meteo a 3 giorni per un comune rappresentativo di
ciascuna delle 26 zone di allerta, dai dati aperti del Consorzio LaMMA
(servizio meteorologico ufficiale della Regione Toscana), e calcola
l'Humidex (temperatura percepita in base all'umidita') per le fasce
notturne e diurne di ciascun giorno.

Fonte: https://www.lamma.toscana.it/previ/ita/xml/comuni_web/dati/<comune>.xml
Un file XML per comune, aggiornato 2 volte al giorno (1 nel weekend).

Il comune rappresentativo di ogni zona e' quello piu' popoloso al suo
interno: e' una scelta dichiarata e verificabile, non arbitraria.

L'Humidex usa la formula ufficiale di Environment Canada (Masterton &
Richardson, 1979): e' un indicatore di percezione del caldo umido,
calcolato da noi sui dati LaMMA, non un bollettino ufficiale.

Produce docs/data/previsioni.json.
"""

import json
import math
import re
import sys
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BASE_LAMMA = "https://www.lamma.toscana.it/previ/ita/xml/comuni_web/dati"
BASE_ICONE = "https://www.lamma.toscana.it/previ/ita/xml/comuni_web/simboli_grandi"
TIMEOUT = 15
GIORNI_DA_MOSTRARE = 3

QUI = Path(__file__).resolve().parent
OUT_DIR = QUI.parent / "docs" / "data"

RAPPRESENTANTI = {
    "Arno-Casentino": "Bibbiena",
    "Arno-Costa": "Livorno",
    "Arno-Firenze": "Firenze",
    "Arno-Valdarno Sup.": "Montevarchi",
    "Bisenzio e Ombrone Pt": "Prato",
    "Etruria": "Campiglia Marittima",
    "Etruria-Costa Nord": "Piombino",
    "Etruria-Costa Sud": "Piombino",
    "Fiora e Albegna": "Manciano",
    "Fiora e Albegna-Costa e Giglio": "Orbetello",
    "Isole": "Portoferraio",
    "Lunigiana": "Aulla",
    "Mugello-Val di Sieve": "Pontassieve",
    "Ombrone Gr-Alto": "Siena",
    "Ombrone Gr-Costa": "Grosseto",
    "Ombrone Gr-Medio": "Montalcino",
    "Reno": "Pistoia",
    "Romagna-Toscana": "Firenzuola",
    "Serchio-Costa": "Viareggio",
    "Serchio-Garfagnana-Lima": "Montecatini-Terme",
    "Serchio-Lucca": "Lucca",
    "Valdarno Inf.": "Empoli",
    "Valdelsa-Valdera": "Poggibonsi",
    "Valdichiana": "Arezzo",
    "Valtiberina": "Sansepolcro",
    "Versilia": "Massa",
}


def log(msg):
    print(msg, flush=True)


def slug_comune(nome):
    s = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", s.lower())


def scarica_xml(url, timeout=TIMEOUT):
    req = urllib.request.Request(
        url, headers={"User-Agent": "allerta-meteo-toscana", "Accept-Encoding": "gzip"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        dati = r.read()
        if r.info().get("Content-Encoding") == "gzip":
            import gzip
            dati = gzip.decompress(dati)
        return dati


FASCE_NOTTE = {"notte", "notte2"}
FASCE_GIORNO = {"mattina", "mattina2", "pomeriggio", "pomeriggio2", "sera", "sera2"}


def punto_di_rugiada(temp_c, rh):
    """Formula di Magnus-Tetens (standard meteorologico pubblico)."""
    a, b = 17.27, 237.7
    alpha = (a * temp_c) / (b + temp_c) + math.log(rh / 100.0)
    return (b * alpha) / (a - alpha)


def humidex(temp_c, rh):
    """
    Formula Humidex ufficiale di Environment Canada (Masterton & Richardson, 1979):
    H = T + 0.5555 x (tensione di vapore al punto di rugiada - 10).
    E' un indicatore di percezione del caldo umido, non una previsione ufficiale.
    """
    if rh is None or rh <= 0:
        return temp_c
    td_k = punto_di_rugiada(temp_c, rh) + 273.15
    e = 6.11 * math.exp(5417.7530 * (1 / 273.16 - 1 / td_k))
    return temp_c + 0.5555 * (e - 10)


def etichetta_humidex(h):
    if h is None:
        return None
    if h < 30:
        return "nessun disagio"
    if h < 40:
        return "qualche disagio"
    if h < 45:
        return "disagio notevole"
    if h < 54:
        return "pericoloso"
    return "rischio di colpo di calore"


SOGLIA_HUMIDEX_ALLERTA = 40   # da qui in su: "disagio notevole" o peggio (Environment Canada)
SOGLIA_TEMPERATURA_SECCA = 35  # criterio esplicito per il caldo secco (bassa umidita')


def caldo_stimato(temp_max, humidex_giorno):
    """
    True se la zona merita il termometro sulla mappa, secondo uno di due criteri
    alternativi (basta che ne sia vero uno):
    - Humidex diurno >= 40 (disagio notevole o peggio, lato umido del grafico)
    - temperatura massima > 35 gradi (lato secco del grafico, dove l'Humidex
      da solo non scatterebbe perche' richiede umidita' alta)
    Non e' un bollettino ufficiale: e' una stima calcolata sui dati LaMMA.
    """
    if temp_max is not None and temp_max > SOGLIA_TEMPERATURA_SECCA:
        return True
    if humidex_giorno is not None and humidex_giorno >= SOGLIA_HUMIDEX_ALLERTA:
        return True
    return False


def estrai_previsioni(xml_bytes, max_giorni=GIORNI_DA_MOSTRARE):
    root = ET.fromstring(xml_bytes)
    aggiornamento = root.findtext("aggiornamento", default="")
    per_giorno = {}

    for prev in root.findall("previsione"):
        try:
            idday = int(prev.get("idday", "99"))
        except ValueError:
            continue
        if idday > max_giorni:
            continue

        ora = prev.get("ora")
        d = per_giorno.setdefault(idday, {
            "data_descr": prev.get("datadescr"), "_notte": [], "_giorno": [],
        })

        if ora == "giorno":
            simbolo = prev.find("simbolo")
            for t in prev.findall("temp"):
                if t.get("temp_type") == "min":
                    d["min"] = int(t.text) if t.text else None
                elif t.get("temp_type") == "max":
                    d["max"] = int(t.text) if t.text else None
            if simbolo is not None:
                d["descrizione"] = simbolo.get("descr")
                if simbolo.get("image_name"):
                    d["icona_url"] = BASE_ICONE + "/" + simbolo.get("image_name")
            continue

        temp_el = prev.find("temp")
        um_el = prev.find("um")
        if temp_el is None or um_el is None or not temp_el.text or not um_el.text:
            continue
        try:
            t = float(temp_el.text)
            rh = float(um_el.text)
        except ValueError:
            continue
        voce = {"temp": t, "um": rh, "humidex": humidex(t, rh)}
        if ora in FASCE_NOTTE:
            d["_notte"].append(voce)
        elif ora in FASCE_GIORNO:
            d["_giorno"].append(voce)

    def media(lista, chiave):
        vals = [v[chiave] for v in lista]
        return round(sum(vals) / len(vals)) if vals else None

    giorni = []
    for idday in sorted(per_giorno):
        d = per_giorno[idday]
        h_notte = media(d["_notte"], "humidex")
        h_giorno = media(d["_giorno"], "humidex")
        giorni.append({
            "giorno": idday,
            "data_descr": d.get("data_descr"),
            "min": d.get("min"),
            "max": d.get("max"),
            "descrizione": d.get("descrizione"),
            "icona_url": d.get("icona_url"),
            "umidita_notte": media(d["_notte"], "um"),
            "umidita_giorno": media(d["_giorno"], "um"),
            "humidex_notte": h_notte,
            "humidex_giorno": h_giorno,
            "humidex_notte_etichetta": etichetta_humidex(h_notte),
            "humidex_giorno_etichetta": etichetta_humidex(h_giorno),
            "caldo_stimato": caldo_stimato(d.get("max"), h_giorno),
        })

    return aggiornamento, giorni


def main():
    risultato = {}
    errori = 0

    for i, (zona, comune) in enumerate(sorted(RAPPRESENTANTI.items()), 1):
        slug = slug_comune(comune)
        url = f"{BASE_LAMMA}/{slug}.xml"
        try:
            xml_bytes = scarica_xml(url)
            aggiornamento, giorni = estrai_previsioni(xml_bytes)
            if len(giorni) < GIORNI_DA_MOSTRARE:
                log(f"  [{i}/26] {zona} ({comune}): solo {len(giorni)} giorni trovati")
            risultato[zona] = {
                "comune": comune,
                "aggiornamento": aggiornamento,
                "giorni": giorni,
            }
        except Exception as e:
            log(f"  [{i}/26] {zona} ({comune}) FALLITO: {e}")
            risultato[zona] = None
            errori += 1

    dati = {
        "fonte": "Consorzio LaMMA - Regione Toscana",
        "nota": "Previsione del comune piu' popoloso della zona. L'Humidex e' un indicatore calcolato, non un dato ufficiale.",
        "zone": risultato,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "previsioni.json"
    out.write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")

    ok = 26 - errori
    log(f"OK - previsioni scaricate per {ok}/26 zone ({errori} falliti) - scritto {out}")
    if errori > 5:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERRORE GENERALE: {type(e).__name__}: {e}")
        sys.exit(1)
