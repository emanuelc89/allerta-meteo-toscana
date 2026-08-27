"""
Scarica due bollettini ufficiali e produce docs/data/allerte.json:

1) PIOGGIA - Dipartimento della Protezione Civile
   https://github.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica
2) CALDO - Ministero della Salute, bollettino ondate di calore
   https://github.com/ondata/ondate-calore (estrazione a cura di onData)
   Copre 27 citta' italiane; in Toscana SOLO Firenze.

Usa solo due domini: api.github.com (per scoprire l'ultimo aggiornamento)
e raw.githubusercontent.com (per i dati veri e propri).

Ogni passaggio stampa un messaggio, cosi' se qualcosa si blocca si vede
subito QUALE richiesta e' in corso, invece di un cursore muto.
"""

import csv
import gzip
import io
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

REPO_DPC = "pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica"
BASE_RAW_DPC = f"https://raw.githubusercontent.com/{REPO_DPC}/master/files/geojson"
API_COMMITS_DPC = f"https://api.github.com/repos/{REPO_DPC}/commits"

URL_CALORE_CSV = "https://raw.githubusercontent.com/ondata/ondate-calore/main/data/ondate-calore_latest.csv"
CITTA_CALORE_TOSCANA = "FIRENZE"
ZONA_CALORE_TOSCANA = "Arno-Firenze"
TIMEOUT = 15

QUI = Path(__file__).resolve().parent
OUT_DIR = QUI.parent / "docs" / "data"
COMUNI_FILE = OUT_DIR / "comuni_toscana.json"

ETICHETTE_CALDO = {0: "Nessun rischio", 1: "Pre-allerta", 2: "Rischio elevato", 3: "Ondata di calore"}


def log(msg):
    print(msg, flush=True)


def livello_da_testo(testo):
    t = (testo or "").upper()
    if "ROSSA" in t:
        return "rossa"
    if "ARANCIONE" in t:
        return "arancione"
    if "GIALLA" in t:
        return "gialla"
    return "verde"


ORDINE_PIOGGIA = {"verde": 0, "gialla": 1, "arancione": 2, "rossa": 3}


def peggiore(*livelli):
    return max(livelli, key=lambda l: ORDINE_PIOGGIA.get(l, 0))


def _scarica_bytes(url, timeout):
    """Scarica chiedendo la compressione gzip: sui bollettini DPC taglia i dati da
    trasferire di circa il 60%, utile su connessioni lente o reti filtrate."""
    req = urllib.request.Request(
        url, headers={"User-Agent": "allerta-meteo-toscana", "Accept-Encoding": "gzip"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        dati = r.read()
        if r.info().get("Content-Encoding") == "gzip":
            dati = gzip.decompress(dati)
        return dati


def scarica_json(url, timeout=TIMEOUT):
    return json.loads(_scarica_bytes(url, timeout).decode("utf-8"))


def scarica_testo(url, timeout=TIMEOUT):
    return _scarica_bytes(url, timeout).decode("utf-8")


def trova_ultimo_prefisso():
    log("  > interrogo l'elenco degli ultimi aggiornamenti (api.github.com)...")
    commits = scarica_json(f"{API_COMMITS_DPC}?per_page=5")
    log(f"  > trovati {len(commits)} aggiornamenti recenti, controllo il piu' recente...")

    for i, c in enumerate(commits, 1):
        sha = c["sha"]
        try:
            dettaglio = scarica_json(f"{API_COMMITS_DPC}/{sha}")
        except Exception as e:
            log(f"  > dettaglio aggiornamento {i}/{len(commits)} non raggiungibile ({e}), provo il successivo...")
            continue
        for file_info in dettaglio.get("files", []):
            m = re.search(r"(\d{8}_\d{4})", file_info.get("filename", ""))
            if m:
                return m.group(1)

    raise RuntimeError("Nessun bollettino trovato negli ultimi 5 aggiornamenti del repository DPC.")


def carica_comuni_toscani():
    if COMUNI_FILE.exists():
        return set(json.loads(COMUNI_FILE.read_text(encoding="utf-8")))
    log("  > prima volta: scarico l'elenco dei comuni toscani (solo ora, poi resta in cache)...")
    url = "https://raw.githubusercontent.com/matteocontrini/comuni-json/master/comuni.json"
    comuni_it = scarica_json(url)
    toscani = sorted({c["nome"] for c in comuni_it if c["regione"]["nome"] == "Toscana"})
    COMUNI_FILE.parent.mkdir(parents=True, exist_ok=True)
    COMUNI_FILE.write_text(json.dumps(toscani, ensure_ascii=False), encoding="utf-8")
    return set(toscani)


def estrai_zone_pioggia(bollettino, comuni_toscani):
    risultato = {}
    for f in bollettino.get("features", []):
        p = f.get("properties", {})
        comuni = p.get("Comuni", [])
        if not any(c in comuni_toscani for c in comuni):
            continue
        idraulico = livello_da_testo(p.get("Per rischio idraulico"))
        temporali = livello_da_testo(p.get("Per rischio temporali"))
        idrogeologico = livello_da_testo(p.get("Per rischio idrogeologico"))
        risultato[p["Nome zona"]] = {
            "pioggia": peggiore(idraulico, temporali, idrogeologico),
            "idraulico": idraulico,
            "temporali": temporali,
            "idrogeologico": idrogeologico,
            "caldo": None,
        }
    return risultato


def carica_caldo_firenze():
    log("Passo 4: bollettino caldo (Ministero della Salute, Firenze)...")
    try:
        testo = scarica_testo(URL_CALORE_CSV)
    except Exception as e:
        log(f"  > non raggiungibile ({e}), proseguo senza dati caldo.")
        return {}

    righe = {}
    lettore = csv.DictReader(io.StringIO(testo))
    for r in lettore:
        if r.get("citta", "").strip().upper() != CITTA_CALORE_TOSCANA:
            continue
        data = r.get("data", "").strip()
        m = re.search(r"(\d)", r.get("livello", ""))
        if not data or not m:
            continue
        liv = int(m.group(1))
        righe[data] = {"livello": liv, "etichetta": ETICHETTE_CALDO.get(liv, "Sconosciuto")}
    return righe


def main():
    log("Passo 1: comuni toscani...")
    comuni_toscani = carica_comuni_toscani()

    log("Passo 2: cerco l'ultimo bollettino pioggia (DPC)...")
    prefisso = trova_ultimo_prefisso()
    data_str, ora_str = prefisso[:8], prefisso[9:]
    data_emissione = date(int(data_str[0:4]), int(data_str[4:6]), int(data_str[6:8]))
    emesso_pioggia = f"{data_str[6:8]}/{data_str[4:6]}/{data_str[0:4]} {ora_str[0:2]}:{ora_str[2:4]}"
    log(f"  > trovato: bollettino emesso il {emesso_pioggia}")

    log("Passo 3: scarico i due giorni previsti dal bollettino...")
    bollettino_a = scarica_json(f"{BASE_RAW_DPC}/{prefisso}_today.json", timeout=45)
    bollettino_b = scarica_json(f"{BASE_RAW_DPC}/{prefisso}_tomorrow.json", timeout=45)

    # IMPORTANTE: nel bollettino DPC "_today" si riferisce al GIORNO DI EMISSIONE
    # e "_tomorrow" al giorno dopo. Siccome il bollettino esce nel pomeriggio,
    # la mattina l'ultimo disponibile e' quello di ieri: prendere "_today" come
    # "oggi" mostrerebbe i dati del giorno prima. Indicizzo quindi per data reale.
    per_data = {
        data_emissione.isoformat(): estrai_zone_pioggia(bollettino_a, comuni_toscani),
        (data_emissione + timedelta(days=1)).isoformat(): estrai_zone_pioggia(bollettino_b, comuni_toscani),
    }

    oggi_it = datetime.now(timezone(timedelta(hours=2))).date()
    domani_it = oggi_it + timedelta(days=1)

    zone_oggi = per_data.get(oggi_it.isoformat())
    zone_domani = per_data.get(domani_it.isoformat())

    if zone_oggi is None:
        log(f"  ATTENZIONE: il bollettino piu' recente ({emesso_pioggia}) non copre oggi.")
    if zone_domani is None:
        log("  > la previsione per domani non e' ancora stata pubblicata (esce nel pomeriggio).")

    caldo_per_data = carica_caldo_firenze()
    caldo_oggi = caldo_per_data.get(oggi_it.isoformat())
    caldo_domani = caldo_per_data.get(domani_it.isoformat())
    caldo_attivo = bool(caldo_per_data)

    if zone_oggi and ZONA_CALORE_TOSCANA in zone_oggi and caldo_oggi:
        zone_oggi[ZONA_CALORE_TOSCANA]["caldo"] = caldo_oggi
    if zone_domani and ZONA_CALORE_TOSCANA in zone_domani and caldo_domani:
        zone_domani[ZONA_CALORE_TOSCANA]["caldo"] = caldo_domani

    dati = {
        "aggiornato": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "emesso_pioggia": emesso_pioggia,
        "emesso_pioggia_data": data_emissione.isoformat(),
        "data_oggi": oggi_it.isoformat(),
        "data_domani": domani_it.isoformat(),
        "fonte_pioggia": "Dipartimento della Protezione Civile",
        "caldo_stagione_attiva": caldo_attivo,
        "caldo_citta_coperta": "Firenze",
        "caldo_zona_coperta": ZONA_CALORE_TOSCANA,
        "fonte_caldo": "Ministero della Salute (dati estratti da onData)",
        "oggi": zone_oggi,
        "domani": zone_domani,
    }

    n = len(zone_oggi) if zone_oggi else 0
    if zone_oggi is not None and n < 20:
        log(f"ATTENZIONE: trovate solo {n} zone toscane per oggi (attese 26).")

    log("Passo 5: salvo il file...")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "allerte.json"
    out.write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")

    msg_caldo = (
        f"caldo Firenze oggi: {ETICHETTE_CALDO.get(caldo_oggi['livello'])} (liv.{caldo_oggi['livello']})"
        if caldo_oggi else "caldo: fuori stagione o dato non disponibile"
    )
    stato_oggi = f"{n} zone" if zone_oggi else "OGGI NON COPERTO"
    stato_domani = "domani disponibile" if zone_domani else "domani non ancora pubblicato"
    log(f"OK - bollettino {emesso_pioggia} - {stato_oggi}, {stato_domani} - {msg_caldo} - scritto {out}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("")
        log(f"ERRORE: {type(e).__name__}: {e}")
        log("Se il problema persiste, potrebbe essere la rete (proxy, VPN, firewall) a bloccare la richiesta mostrata sopra.")
        sys.exit(1)
