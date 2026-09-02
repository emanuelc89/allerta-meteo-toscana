"""
Scarica i dati idrometrici in tempo reale (livelli, portate, soglie ufficiali
di attenzione e criticita', tendenza) dalla rete di monitoraggio del Centro
Funzionale Regionale della Toscana, e li raggruppa per le 26 zone di allerta
ufficiali (la stessa sigla e' gia' presente nel dato sorgente).

Fonte: https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro

Produce docs/data/idrometria.json (stato attuale) e aggiorna
docs/data/idrometria_storico.json (storico completo, ultime ~72 ore, uso
interno per il calcolo del grafico: il file pubblico ne espone solo gli
ultimi punti, per restare leggero).
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

URL_STAZIONI = "https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro"
TIMEOUT = 20

QUI = Path(__file__).resolve().parent
OUT_DIR = QUI.parent / "docs" / "data"
FILE_STORICO = OUT_DIR / "idrometria_storico.json"

ORE_STORICO_DA_TENERE = 72
PUNTI_SPARKLINE_MAX = 30

ZONE = {
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

TENDENZA_ETICHETTA = {"\u2191": "in aumento", "\u2193": "in diminuzione", "": "stabile"}


def log(msg):
    print(msg, flush=True)


def scarica_html(url, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": "allerta-meteo-toscana"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace")


def numero(testo):
    testo = (testo or "").strip()
    if not testo:
        return None
    try:
        return float(testo)
    except ValueError:
        return None


def pulisci_nome_stazione(testo):
    return re.sub(r"\s*\((GPRS|RADIO)\)\s*$", "", testo or "").strip()


MARGINE_AVVICINAMENTO = 0.20


def stato_soglia(livello, soglia1, soglia2):
    """
    Restituisce lo stato del livello rispetto alle soglie UFFICIALI, con una
    fascia di preavviso ("in_avvicinamento_*") calcolata come una frazione
    della distanza ufficiale fra soglia1 e soglia2: niente di previsto o
    stimato, solo una lettura piu' sfumata dello stesso confronto di sempre.
    """
    if livello is None or (soglia1 is None and soglia2 is None):
        return None

    margine = None
    if soglia1 is not None and soglia2 is not None and soglia2 > soglia1:
        margine = (soglia2 - soglia1) * MARGINE_AVVICINAMENTO

    if soglia2 is not None and livello >= soglia2:
        return "sopra_soglia2"
    if soglia1 is not None and livello >= soglia1:
        if margine is not None and livello >= soglia2 - margine:
            return "in_avvicinamento_soglia2"
        return "sopra_soglia1"
    if soglia1 is not None and margine is not None and livello >= soglia1 - margine:
        return "in_avvicinamento_soglia1"
    return "normale"


def estrai_stazioni(html):
    righe = re.findall(r"= new Array\((.*?)\);", html)
    stazioni = []
    for riga in righe:
        campi = re.findall(r'"([^"]*)"', riga)
        if len(campi) < 14:
            continue

        soglia2 = numero(campi[6])
        soglia1 = numero(campi[7])
        livello = numero(campi[8])
        portata = numero(campi[9])
        tendenza_simbolo = campi[-1] if campi[-1] in ("\u2191", "\u2193") else ""

        stazioni.append({
            "id": campi[0],
            "fiume": campi[1],
            "stazione": pulisci_nome_stazione(campi[2]),
            "provincia": campi[3],
            "zona_codice": campi[5],
            "zona_nome": ZONE.get(campi[5]),
            "soglia1": soglia1,
            "soglia2": soglia2,
            "livello": livello,
            "portata": portata,
            "delta_1h": numero(campi[10]) if len(campi) > 10 else None,
            "delta_3h": numero(campi[11]) if len(campi) > 11 else None,
            "delta_6h": numero(campi[12]) if len(campi) > 12 else None,
            "orario_lettura": campi[13] if len(campi) > 13 else None,
            "tendenza": TENDENZA_ETICHETTA[tendenza_simbolo],
            "stato": stato_soglia(livello, soglia1, soglia2),
        })
    return stazioni


def raggruppa_per_zona(stazioni):
    per_zona = {}
    senza_zona = 0
    for s in stazioni:
        zona = s["zona_nome"]
        if not zona:
            senza_zona += 1
            continue
        per_zona.setdefault(zona, []).append(s)
    return per_zona, senza_zona


def aggiorna_storico(stazioni, adesso_iso):
    storico = {}
    if FILE_STORICO.exists():
        try:
            storico = json.loads(FILE_STORICO.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            storico = {}

    limite = datetime.now(timezone.utc) - timedelta(hours=ORE_STORICO_DA_TENERE)

    for s in stazioni:
        if s["livello"] is None:
            continue
        punti = storico.get(s["id"], [])
        punti.append([adesso_iso, s["livello"]])
        punti = [p for p in punti if datetime.fromisoformat(p[0]) >= limite]
        storico[s["id"]] = punti

    id_attuali = {s["id"] for s in stazioni}
    storico = {k: v for k, v in storico.items() if k in id_attuali}

    FILE_STORICO.write_text(json.dumps(storico, ensure_ascii=False), encoding="utf-8")
    return storico


def main():
    log("Scarico i dati idrometrici dal CFR...")
    html = scarica_html(URL_STAZIONI)

    stazioni = estrai_stazioni(html)
    log(f"  > estratte {len(stazioni)} stazioni")

    per_zona, senza_zona = raggruppa_per_zona(stazioni)
    if senza_zona:
        log(f"  > ATTENZIONE: {senza_zona} stazioni senza una zona di allerta riconosciuta (scartate)")

    zone_coperte = len(per_zona)
    log(f"  > {zone_coperte}/26 zone hanno almeno una stazione")

    adesso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    storico = aggiorna_storico(stazioni, adesso)

    for s in stazioni:
        s["storico"] = storico.get(s["id"], [])[-PUNTI_SPARKLINE_MAX:]

    per_zona, _ = raggruppa_per_zona(stazioni)

    dati = {
        "aggiornato": adesso,
        "fonte": "Centro Funzionale Regionale della Toscana (dati non validati)",
        "fonte_url": "https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro",
        "nota": "Livelli e portate acquisiti in tempo reale, non sottoposti a validazione ufficiale (fonte CFR).",
        "zone": per_zona,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / "idrometria.json"
    out.write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")

    log(f"OK - {len(stazioni)} stazioni, {zone_coperte}/26 zone - scritto {out}")

    if zone_coperte < 15:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERRORE: {type(e).__name__}: {e}")
        sys.exit(1)
