"""
Test del lettore del bollettino CFR. Si lancia con:  python scripts/test_cfr_toscana.py
Solo libreria standard. Usa la pagina reale salvata in scripts/test_data/.
"""

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cfr_toscana as cfr  # noqa: E402

QUI = Path(__file__).resolve().parent
HTML_REALE = (QUI / "test_data" / "cfr_2026-11-11.html").read_text(encoding="utf-8")

EMISSIONE = datetime(2026, 11, 11, 13, 4)


def legenda(livelli_per_sigla):
    """Costruisce una table_legend con le 26 zone (verde se non indicato)."""
    celle = "".join(
        f'<img src="supports/images/bollettini/simboli_fax/criticita{livelli_per_sigla.get(s, 0)}.gif"><b>{s}-{n}</b><br>'
        for s, n in cfr.ZONE_CFR.items()
    )
    return f'<table class="table_legend"><tr><td>{celle}</td></tr></table>'


def pagina(emissione="Emissione di <b>Mercoledí, 11 Novembre 2026</b>, ore <b>13.04</b>", legenda_html="", righe_html=None):
    rischi = "" if righe_html is None else (
        '<table class="table table-bordered table_risks"><tr><th>Z</th><th>R</th><th>T</th><th>C</th></tr>'
        + righe_html + "</table>"
    )
    return f"<html><body><div>{emissione}</div>{legenda_html}{rischi}</body></html>"


def riga(zone, rischio, tempi, livello, colore=None):
    stile = f' style="background-color:{colore}"' if colore else ""
    return f"<tr{stile}><td><b>{zone}</b></td><td>{rischio}</td><td>{tempi}</td><td><b>{livello}</b></td></tr>"


class TestPaginaReale(unittest.TestCase):
    def setUp(self):
        self.b = cfr.leggi_bollettino_cfr(HTML_REALE)

    def test_emissione(self):
        self.assertEqual(self.b["emissione"], EMISSIONE)

    def test_due_giorni_con_26_zone(self):
        self.assertEqual(sorted(self.b["per_data"]), ["2026-11-11", "2026-11-12"])
        for zone in self.b["per_data"].values():
            self.assertEqual(len(zone), 26)
            self.assertEqual(set(zone), set(cfr.ZONE_CFR.values()))

    def test_oggi(self):
        oggi = self.b["per_data"]["2026-11-11"]
        self.assertEqual(oggi["Lunigiana"]["pioggia"], "arancione")
        self.assertEqual(oggi["Lunigiana"]["idraulico"], "gialla")
        self.assertEqual(oggi["Lunigiana"]["idrogeologico"], "arancione")
        self.assertEqual(oggi["Reno"]["idraulico"], "verde")
        self.assertEqual(oggi["Arno-Firenze"]["pioggia"], "verde")   # i temporali su A3 iniziano domani alle 9
        self.assertEqual(oggi["Serchio-Costa"]["idraulico"], "verde")  # S3 reticolo principale solo domani

    def test_domani(self):
        domani = self.b["per_data"]["2026-11-12"]
        for z in ("Lunigiana", "Reno", "Serchio-Garfagnana-Lima"):
            self.assertEqual(domani[z]["pioggia"], "rossa", z)
            self.assertEqual(domani[z]["idrogeologico"], "rossa", z)
        for z in ("Bisenzio e Ombrone Pt", "Serchio-Lucca", "Serchio-Costa", "Versilia"):
            self.assertEqual(domani[z]["pioggia"], "arancione", z)
        self.assertEqual(domani["Arno-Firenze"]["pioggia"], "gialla")
        self.assertEqual(domani["Arno-Firenze"]["temporali"], "gialla")
        self.assertEqual(domani["Versilia"]["idraulico"], "verde")

    def test_nessun_altro_rischio(self):
        for zone in self.b["per_data"].values():
            for z in zone.values():
                self.assertNotIn("altri_rischi", z)
                self.assertIsNone(z["caldo"])


class TestCasiLimite(unittest.TestCase):
    def test_nessuna_criticita(self):
        b = cfr.leggi_bollettino_cfr(pagina(legenda_html=legenda({})))
        for zone in b["per_data"].values():
            self.assertTrue(all(z["pioggia"] == "verde" for z in zone.values()))

    def test_riepilogo_colorato_ma_senza_righe(self):
        with self.assertRaises(cfr.ErroreBollettinoCFR):
            cfr.leggi_bollettino_cfr(pagina(legenda_html=legenda({"L": 2})))

    def test_righe_non_coerenti_con_riepilogo(self):
        html = pagina(legenda_html=legenda({"L": 1}), righe_html=riga(
            "L", "IDRAULICO RETICOLO PRINCIPALE",
            "dalle ore 00.00 di Giovedì, 12 Novembre 2026 alle ore 23.59 di Giovedì, 12 Novembre 2026", "ARANCIONE"))
        with self.assertRaises(cfr.ErroreBollettinoCFR):
            cfr.leggi_bollettino_cfr(html)

    def test_colore_riga_discordante(self):
        html = pagina(legenda_html=legenda({"L": 1}), righe_html=riga(
            "L", "IDRAULICO RETICOLO PRINCIPALE",
            "in corso fino alle ore 23.59 di Mercoledí, 11 Novembre 2026", "GIALLO", colore="#ff0000"))
        with self.assertRaises(cfr.ErroreBollettinoCFR):
            cfr.leggi_bollettino_cfr(html)

    def test_tempi_senza_di_e_fino(self):
        # formato visto nei PDF: "fino alle ore 09.00 Sabato, 10 Gennaio 2026"
        inizio, fine = cfr._interpreta_tempi("fino alle ore 09.00 Sabato, 10 Gennaio 2026", datetime(2026, 1, 9, 12, 29))
        self.assertEqual(inizio, datetime(2026, 1, 9, 0, 0))
        self.assertEqual(fine, datetime(2026, 1, 10, 9, 0))

    def test_tempi_solo_inizio(self):
        inizio, fine = cfr._interpreta_tempi("dalle ore 18.00 di Giovedì, 12 Novembre 2026", EMISSIONE)
        self.assertEqual(inizio, datetime(2026, 11, 12, 18, 0))
        self.assertEqual(fine, datetime(2026, 11, 13, 0, 0))

    def test_tempi_ignoti(self):
        with self.assertRaises(cfr.ErroreBollettinoCFR):
            cfr._interpreta_tempi("per tutta la durata dell'evento", EMISSIONE)

    def test_finestra_che_finisce_a_mezzanotte_non_tocca_il_giorno_dopo(self):
        html = pagina(legenda_html=legenda({"V": 1}), righe_html=riga(
            "V", "RISCHIO VENTO",
            "dalle ore 12.00 di Mercoledí, 11 Novembre 2026 alle ore 00.00 di Giovedì, 12 Novembre 2026", "GIALLO"))
        b = cfr.leggi_bollettino_cfr(html)
        self.assertEqual(b["per_data"]["2026-11-11"]["Versilia"]["altri_rischi"], {"vento": "gialla"})
        self.assertEqual(b["per_data"]["2026-11-11"]["Versilia"]["pioggia"], "verde")
        self.assertEqual(b["per_data"]["2026-11-11"]["Versilia"]["massimo"], "gialla")
        self.assertNotIn("altri_rischi", b["per_data"]["2026-11-12"]["Versilia"])

    def test_sigla_sconosciuta(self):
        html = pagina(legenda_html=legenda({}), righe_html=riga(
            "Z9", "RISCHIO VENTO", "in corso fino alle ore 23.59 di Mercoledí, 11 Novembre 2026", "GIALLO"))
        with self.assertRaises(cfr.ErroreBollettinoCFR):
            cfr.leggi_bollettino_cfr(html)

    def test_pagina_senza_emissione(self):
        with self.assertRaises(cfr.ErroreBollettinoCFR):
            cfr.leggi_bollettino_cfr("<html><body>manutenzione</body></html>")


if __name__ == "__main__":
    unittest.main(verbosity=2)
