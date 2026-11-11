"""
Scarica i dati idrometrici in tempo reale (livelli, portate, soglie ufficiali
di attenzione e criticita', tendenza) dalla rete di monitoraggio del Centro
Funzionale Regionale della Toscana, e li raggruppa per le 26 zone di allerta
ufficiali (la stessa sigla e' gia' presente nel dato sorgente).

Fonte: https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro

Produce docs/data/idrometria.json (stato attuale, raggruppato per zona),
docs/data/idrometria_mappa.json (elenco piatto con coordinate, per la mappa
fluviale), e aggiorna docs/data/idrometria_storico.json (storico completo,
uso interno) e docs/data/coordinate_idrometri.json (cache delle coordinate).
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrittura import scrivi_se_cambiato  # noqa: E402

URL_STAZIONI = "https://www.cfr.toscana.it/monitoraggio/stazioni.php?type=idro"
URL_COORDINATE = (
    "https://geo.sir.toscana.it/geoserver/geo/ows?service=WFS&version=1.0.0"
    "&request=GetFeature&typeName=geo:cf_idrometri&outputFormat=application/json&srsName=EPSG:4326"
)
TIMEOUT = 20
FUSO_ITALIA = ZoneInfo("Europe/Rome")

QUI = Path(__file__).resolve().parent
OUT_DIR = QUI.parent / "docs" / "data"
FILE_STORICO = OUT_DIR / "idrometria_storico.json"
FILE_COORDINATE = OUT_DIR / "coordinate_idrometri.json"

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


def scarica_json(url, timeout=TIMEOUT):
    return json.loads(scarica_html(url, timeout))


def carica_coordinate_stazioni():
    if FILE_COORDINATE.exists():
        try:
            return json.loads(FILE_COORDINATE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    log("  > prima volta: scarico le coordinate delle stazioni dal registro SIR...")
    dati = scarica_json(URL_COORDINATE)
    coordinate = {}
    for feat in dati.get("features", []):
        geom = feat.get("geometry")
        props = feat.get("properties", {})
        id_st = props.get("id_stazione")
        if not id_st or not geom or geom.get("type") != "Point":
            continue
        lng, lat = geom["coordinates"][0], geom["coordinates"][1]
        coordinate[id_st] = [lat, lng]

    FILE_COORDINATE.parent.mkdir(parents=True, exist_ok=True)
    FILE_COORDINATE.write_text(json.dumps(coordinate, ensure_ascii=False), encoding="utf-8")
    return coordinate


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


def istante_lettura(orario_lettura, adesso):
    """
    "11/11 15.10" (ora italiana, senza anno) -> ISO con fuso. L'anno e' quello
    corrente, salvo a cavallo di Capodanno (una lettura "31/12" vista il 1/1 e'
    dell'anno prima). Se il formato non si riconosce restituisce None.
    """
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})\s+(\d{1,2})[.:](\d{2})\s*$", orario_lettura or "")
    if not m:
        return None
    giorno, mese, ora, minuto = (int(x) for x in m.groups())
    adesso_it = adesso.astimezone(FUSO_ITALIA)
    for anno in (adesso_it.year, adesso_it.year - 1):
        try:
            t = datetime(anno, mese, giorno, ora, minuto, tzinfo=FUSO_ITALIA)
        except ValueError:
            continue
        if t <= adesso_it + timedelta(hours=1):
            return t.isoformat(timespec="seconds")
    return None


def aggiorna_storico(stazioni, adesso):
    """
    Un punto per ogni NUOVA lettura della stazione (l'orario e' quello della
    misura, non del run): se la stazione non ha ancora trasmesso una lettura
    nuova dall'ultimo giro, non si aggiunge nulla. Cosi' il file cambia solo
    quando arrivano dati davvero nuovi (di norma ogni 15 minuti).
    """
    storico = {}
    if FILE_STORICO.exists():
        try:
            storico = json.loads(FILE_STORICO.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            storico = {}

    limite = adesso - timedelta(hours=ORE_STORICO_DA_TENERE)
    adesso_iso = adesso.isoformat(timespec="seconds")
    nuove_letture = 0

    for s in stazioni:
        if s["livello"] is None:
            continue
        quando = istante_lettura(s.get("orario_lettura"), adesso) or adesso_iso
        punti = storico.get(s["id"], [])
        if punti:
            # Confronto come istanti, non come stringhe: i punti vecchi sono in
            # UTC (+00:00), quelli nuovi in ora italiana (+01:00/+02:00).
            ultimo = datetime.fromisoformat(punti[-1][0])
            if datetime.fromisoformat(quando) <= ultimo:
                continue  # stessa lettura gia' registrata, o piu' vecchia dell'ultima
        punti.append([quando, s["livello"]])
        nuove_letture += 1
        storico[s["id"]] = [p for p in punti if datetime.fromisoformat(p[0]) >= limite]

    id_attuali = {s["id"] for s in stazioni}
    storico = {k: v for k, v in storico.items() if k in id_attuali}

    if scrivi_se_cambiato(FILE_STORICO, storico, campi_ignorati=(), indent=None):
        log(f"  > storico: {nuove_letture} nuove letture registrate")
    else:
        log("  > storico: nessuna lettura nuova")
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

    coordinate = carica_coordinate_stazioni()
    con_coordinate = 0
    for s in stazioni:
        coord = coordinate.get(s["id"])
        if coord:
            s["lat"], s["lng"] = coord
            con_coordinate += 1
        else:
            s["lat"], s["lng"] = None, None
    log(f"  > {con_coordinate}/{len(stazioni)} stazioni con coordinate note")

    adesso_dt = datetime.now(timezone.utc)
    adesso = adesso_dt.isoformat(timespec="seconds")
    storico = aggiorna_storico(stazioni, adesso_dt)

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

    out = OUT_DIR / "idrometria.json"
    cambiato = scrivi_se_cambiato(out, dati)

    campi_mappa = ("id", "fiume", "stazione", "zona_nome", "lat", "lng",
                   "livello", "soglia1", "soglia2", "portata", "tendenza", "stato")
    dati_mappa = {
        "aggiornato": adesso,
        "fonte": "Centro Funzionale Regionale della Toscana (dati non validati)",
        "stazioni": [
            {k: s[k] for k in campi_mappa}
            for s in stazioni if s.get("lat") is not None
        ],
    }
    out_mappa = OUT_DIR / "idrometria_mappa.json"
    cambiato = scrivi_se_cambiato(out_mappa, dati_mappa, indent=None) or cambiato

    esito = "dati cambiati, file riscritti" if cambiato else "nessuna differenza, file lasciati com'erano"
    log(f"OK - {len(stazioni)} stazioni, {zone_coperte}/26 zone - {esito} ({out}, {out_mappa})")

    if zone_coperte < 15:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"ERRORE: {type(e).__name__}: {e}")
        sys.exit(1)
