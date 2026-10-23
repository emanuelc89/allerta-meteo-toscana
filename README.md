# allerta-meteo-toscana

Sito statico (GitHub Pages, cartella `docs/`) con le allerte meteo per le 26 zone di allerta della Toscana,
i livelli idrometrici in tempo reale e le previsioni LaMMA.

## Struttura

- `docs/index.html` — bollettino per zone: mappa interattiva, filtri per livello, ricerca comune, dettaglio zona
- `docs/fiumi.html` — mappa fluviale con tutte le stazioni idrometriche
- `docs/assets/` — stile condiviso (tema chiaro/scuro), funzioni comuni e logica della pagina principale
- `docs/data/*.json` — dati generati dagli script, aggiornati dai workflow GitHub Actions
- `scripts/` — script Python (solo libreria standard, Python ≥ 3.9) che scaricano i dati ufficiali

## Avvio in locale

Non serve alcun build: basta un server statico.

```sh
cd docs
python -m http.server 8000
# apri http://localhost:8000
```

Per rigenerare i dati:

```sh
python scripts/fetch_allerte.py
python scripts/fetch_previsioni.py
python scripts/fetch_idrometria.py
```
