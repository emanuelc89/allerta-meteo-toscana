"""
Scarica il Bollettino di criticita' del Dipartimento della Protezione Civile
ed estrae le allerte delle 26 zone della Toscana per oggi e domani.

Fonte: https://github.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica
Il DPC ripubblica ogni giorno (di norma entro le 16) un GeoJSON nazionale con,
per ogni zona di allerta, il livello di criticita' per rischio idraulico,
temporali e idrogeologico.

Lo script produce docs/data/allerte.json, un file leggero che la pagina web legge
per colorare la mappa. Non serve alcun database ne' alcun server.
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

# --- Configurazione ------------------------------------------------------

REPO = "pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica"
BASE_RAW = f"https://raw.githubusercontent.com/{REPO}/master/files/geojson"
API_COMMITS = f"https://api.github.com/repos/{REPO}/commits"

# Cartella di output: docs/data/ accanto a questo script (che sta in scripts/)
QUI = Path(__file__).resolve().parent
OUT_DIR = QUI.parent / "docs" / "data"

# I comuni toscani, per riconoscere le zone di allerta della Toscana.
# Elenco caricato da docs/data/comuni_toscana.json (generato una volta sola).
COMUNI_FILE = OUT_DIR / "comuni_toscana.json"


# Da stringa del bollettino a livello sintetico usato dalla pagina.
def livello_da_testo(testo: str) -> str:
    t = (testo or "").upper()
    if "ROSSA" in t:
        return "rossa"
    if "ARANCIONE" in t:
        return "arancione"
    if "GIALLA" in t:
        return "gialla"
    return "verde"  # "NESSUNA ALLERTA" o campo mancante


def scarica_json(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers={"User-Agent": "allerta-meteo-toscana"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def trova_ultimo_prefisso() -> str:
    """
    Restituisce il prefisso 'AAAAMMGG_HHMM' del bollettino piu' recente.
    Prova prima l'ultimo commit via API; se non disponibile, ricava la data
    di oggi (fuso italiano) e cerca l'orario provando i file.
    """
    # Tentativo 1: leggo i nomi file dall'ultimo commit
    try:
        commits = scarica_json(f"{API_COMMITS}?per_page=10")
        for c in commits:
            msg = c.get("commit", {}).get("message", "")
            m = re.search(r"(\d{8}_\d{4})", msg)
            if m:
                return m.group(1)
    except Exception:
        pass

    # Tentativo 2: uso la data odierna italiana e cerco l'orario per tentativi
    oggi = datetime.now(timezone(timedelta(hours=2)))
    for giorni in range(0, 3):  # oggi, ieri, l'altroieri
        g = (oggi - timedelta(days=giorni)).strftime("%Y%m%d")
        for hh in range(17, 11, -1):
            for mm in range(59, -1, -1):
                pref = f"{g}_{hh:02d}{mm:02d}"
                url = f"{BASE_RAW}/{pref}_today.json"
                try:
                    req = urllib.request.Request(url, method="HEAD",
                                                 headers={"User-Agent": "allerta-meteo-toscana"})
                    urllib.request.urlopen(req, timeout=10)
                    return pref
                except Exception:
                    continue
    raise RuntimeError("Nessun bollettino trovato negli ultimi giorni.")


def carica_comuni_toscani() -> set:
    if COMUNI_FILE.exists():
        return set(json.loads(COMUNI_FILE.read_text(encoding="utf-8")))
    # Fallback: scarico l'elenco ISTAT e filtro la Toscana, poi salvo in cache
    url = "https://raw.githubusercontent.com/matteocontrini/comuni-json/master/comuni.json"
    comuni_it = scarica_json(url)
    toscani = sorted({c["nome"] for c in comuni_it if c["regione"]["nome"] == "Toscana"})
    COMUNI_FILE.parent.mkdir(parents=True, exist_ok=True)
    COMUNI_FILE.write_text(json.dumps(toscani, ensure_ascii=False), encoding="utf-8")
    return set(toscani)


def estrai_zone(bollettino: dict, comuni_toscani: set) -> dict:
    """Da un GeoJSON nazionale ricava {nome_zona: {mappa, idraulico, temporali, idrogeologico}}."""
    risultato = {}
    for f in bollettino.get("features", []):
        p = f.get("properties", {})
        comuni = p.get("Comuni", [])
        if not any(c in comuni_toscani for c in comuni):
            continue
        risultato[p["Nome zona"]] = {
            "mappa": livello_da_testo(p.get("Rappresentata nella mappa")),
            "idraulico": livello_da_testo(p.get("Per rischio idraulico")),
            "temporali": livello_da_testo(p.get("Per rischio temporali")),
            "idrogeologico": livello_da_testo(p.get("Per rischio idrogeologico")),
        }
    return risultato


def main():
    comuni_toscani = carica_comuni_toscani()
    prefisso = trova_ultimo_prefisso()
    data_str = prefisso[:8]
    ora_str = prefisso[9:]
    emesso = f"{data_str[6:8]}/{data_str[4:6]}/{data_str[0:4]} {ora_str[0:2]}:{ora_str[2:4]}"

    oggi = scarica_json(f"{BASE_RAW}/{prefisso}_today.json")
    domani = scarica_json(f"{BASE_RAW}/{prefisso}_tomorrow.json")

    dati = {
        "aggiornato": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "emesso": emesso,
        "fonte": "Dipartimento della Protezione Civile",
        "oggi": estrai_zone(oggi, comuni_toscani),
        "domani": estrai_zone(domani, comuni_toscani),
    }

    n = len(dati["oggi"])
    if n < 20:
        print(f"ATTENZIONE: trovate solo {n} zone toscane (attese 26).", file=sys.stderr)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "allerte.json"
    out.write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK - bollettino {emesso} - {n} zone - scritto {out}")


if __name__ == "__main__":
    main()