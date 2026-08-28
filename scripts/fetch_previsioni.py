"""
Scarica le previsioni meteo a 3 giorni per un comune rappresentativo di
ciascuna delle 26 zone di allerta, dai dati aperti del Consorzio LaMMA
(servizio meteorologico ufficiale della Regione Toscana).

Fonte: https://www.lamma.toscana.it/previ/ita/xml/comuni_web/dati/<comune>.xml
Un file XML per comune, aggiornato 2 volte al giorno (1 nel weekend).

Il comune rappresentativo di ogni zona e' quello piu' popoloso al suo
interno: e' una scelta dichiarata e verificabile, non arbitraria. La
pagina la mostra sempre in chiaro ("Previsioni per <comune>") cosi' che
sia trasparente che si tratta di un solo punto della zona, non di una
media su tutto il territorio.

Produce docs/data/previsioni.json.
"""

import json
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


def estrai_previsioni(xml_bytes, max_giorni=GIORNI_DA_MOSTRARE):
    root = ET.fromstring(xml_bytes)
    aggiornamento = root.findtext("aggiornamento", default="")
    giorni = []
    for prev in root.findall("previsione"):
        if prev.get("ora") != "giorno":
            continue
        try:
            idday = int(prev.get("idday", "99"))
        except ValueError:
            continue
        if idday > max_giorni:
            continue

        simbolo = prev.find("simbolo")
        tmin = tmax = None
        for t in prev.findall("temp"):
            if t.get("temp_type") == "min":
                tmin = t.text
            elif t.get("temp_type") == "max":
                tmax = t.text

        giorni.append({
            "giorno": idday,
            "data_descr": prev.get("datadescr"),
            "min": int(tmin) if tmin not in (None, "") else None,
            "max": int(tmax) if tmax not in (None, "") else None,
            "descrizione": simbolo.get("descr") if simbolo is not None else None,
            "icona_url": (BASE_ICONE + "/" + simbolo.get("image_name"))
                         if simbolo is not None and simbolo.get("image_name") else None,
        })

    giorni.sort(key=lambda g: g["giorno"])
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
        "nota": "Previsione del comune piu' popoloso della zona, non media sull'intero territorio.",
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
