"""
Scrittura dei file JSON "solo se cambiati".

Ogni commit su main fa partire un deploy di GitHub Pages. Se i file dati
cambiano a ogni run anche quando il bollettino e' identico (bastava il campo
"aggiornato" con l'ora del run), i deploy si accavallano e si annullano a
vicenda, e la pagina pubblicata resta indietro proprio quando c'e' una
modifica vera. Qui si confrontano i dati nuovi con quelli gia' su disco
ignorando i campi "di servizio": se il resto e' identico il file non viene
toccato, cosi' `git diff --staged --quiet` nel workflow non trova nulla da
committare.

Conseguenza voluta: "aggiornato" nei JSON pubblicati e' l'istante dell'ultima
MODIFICA dei dati, non dell'ultimo controllo.
"""

import json
from pathlib import Path

CAMPI_DI_SERVIZIO = ("aggiornato",)


def _senza_campi_di_servizio(dati, campi):
    if isinstance(dati, dict):
        return {k: v for k, v in dati.items() if k not in campi}
    return dati


def scrivi_se_cambiato(percorso, dati, campi_ignorati=CAMPI_DI_SERVIZIO, indent=1):
    """
    Scrive `dati` in `percorso` solo se differiscono dal contenuto attuale,
    confrontati senza i campi di servizio (di default solo "aggiornato").
    Restituisce True se il file e' stato (ri)scritto, False se era identico.
    """
    percorso = Path(percorso)
    if percorso.exists():
        try:
            attuali = json.loads(percorso.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            attuali = None
        if attuali is not None and (
            _senza_campi_di_servizio(attuali, campi_ignorati)
            == _senza_campi_di_servizio(dati, campi_ignorati)
        ):
            return False

    percorso.parent.mkdir(parents=True, exist_ok=True)
    percorso.write_text(json.dumps(dati, ensure_ascii=False, indent=indent), encoding="utf-8")
    return True
