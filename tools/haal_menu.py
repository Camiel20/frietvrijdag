"""Haalt het menu van De Posthoorn op en schrijft docs/menu.json.

Alleen standaardbibliotheek, zodat de GitHub Action niets hoeft te installeren.
De site heeft geen API, maar zet alle producten als kaartjes in de HTML:
<h2>Categorie</h2> ... <div data-id="566335" class="product-card-content js-product-card-content">
met daarin js-product-card-name en js-product-card-price.

Gebruik:  python tools/haal_menu.py [uitvoerbestand]
Faalt (exit 1) bij te weinig producten; het oude menu blijft dan staan.
"""
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = 'https://deposthoorn.ultimatumapp.com/'
UIT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / 'docs' / 'menu.json'
OVERSLAAN = {'populaire gerechten', 'contact', 'afrekenen', 'bedankt voor je bestelling!'}
MINIMAAL = 50

# Combinaties die De Posthoorn niet als eigen product heeft, maar wel los verkoopt.
# Prijs = som van de onderdelen (actuele menuprijzen); ontbreekt een onderdeel, dan valt de combi weg.
# (naam, categorie waarin hij komt, [namen van de onderdelen])
COMBIS = [
    ('Broodje Bourgondische kroket', 'Broodjes', ['Los Broodje', 'Bourgondische kroket']),
]

KOP_RE = re.compile(r'<h2\b[^>]*>(.*?)</h2>', re.S | re.I)
KAART_RE = re.compile(r'<div\b[^>]*\bclass="[^"]*\bjs-product-card-content\b[^"]*"[^>]*>', re.I)
NAAM_RE = re.compile(r'class="[^"]*\bjs-product-card-name\b[^"]*"[^>]*>(.*?)</div>', re.S | re.I)
PRIJS_RE = re.compile(r'class="[^"]*\bjs-product-card-price\b[^"]*"[^>]*>(.*?)</(?:span|div)>', re.S | re.I)
BEDRAG_RE = re.compile(r'(\d+)[,.](\d{2})')


def tekst(s):
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', html.unescape(s)).strip()


def attr(tag, naam):
    # De site schrijft soms `data-deposit_amount = 0.15` (spaties, geen aanhalingstekens).
    m = re.search(r'\b' + re.escape(naam) + r'''\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))''', tag)
    return next((g for g in m.groups() if g is not None), None) if m else None


def centen(s):
    bedragen = BEDRAG_RE.findall(s or '')
    if not bedragen:
        return None
    euro, ct = bedragen[-1]  # bij een actie staat de oude prijs eerst, de geldende laatst
    return int(euro) * 100 + int(ct)


def parse(pagina):
    # Koppen en kaartjes in documentvolgorde, zodat elk kaartje de laatste kop erboven krijgt.
    gebeurtenissen = [(m.start(), 'kop', m) for m in KOP_RE.finditer(pagina)]
    gebeurtenissen += [(m.start(), 'kaart', m) for m in KAART_RE.finditer(pagina)]
    gebeurtenissen.sort(key=lambda g: g[0])
    starts = [g[0] for g in gebeurtenissen if g[1] == 'kaart'] + [len(pagina)]

    categorieen, gezien, huidig = [], set(), None
    kaart_nr = 0
    for pos, soort, m in gebeurtenissen:
        if soort == 'kop':
            naam = tekst(m.group(1))
            huidig = None if naam.lower() in OVERSLAAN else {'naam': naam, 'producten': []}
            if huidig:
                categorieen.append(huidig)
            continue
        stuk = pagina[pos:starts[kaart_nr + 1]]
        kaart_nr += 1
        if huidig is None:
            continue
        pid = attr(m.group(0), 'data-id')
        naam_m, prijs_m = NAAM_RE.search(stuk), PRIJS_RE.search(stuk)
        if not pid or pid in gezien or not naam_m or not prijs_m:
            continue
        cents = centen(tekst(prijs_m.group(1)))
        if cents is None:
            continue
        gezien.add(pid)
        product = {'id': pid, 'naam': tekst(naam_m.group(1)), 'cents': cents}
        statiegeld = attr(m.group(0), 'data-deposit_amount')
        if statiegeld:
            product['statiegeld'] = round(float(statiegeld) * 100)
        huidig['producten'].append(product)
    return [c for c in categorieen if c['producten']]


def voeg_combis_toe(categorieen):
    """Zet de COMBIS als product in hun categorie, met de onderdelen erbij (voor de bon-controle)."""
    op_naam = {}
    for c in categorieen:
        for p in c['producten']:
            op_naam.setdefault(p['naam'].lower(), p)
    for naam, categorie, onderdelen in COMBIS:
        delen = [op_naam.get(o.lower()) for o in onderdelen]
        doel = next((c for c in categorieen if c['naam'].lower() == categorie.lower()), None)
        if doel is None or not all(delen) or any(p.get('statiegeld') for p in delen):
            print(f'Combi "{naam}" overgeslagen: onderdeel of categorie niet gevonden.', file=sys.stderr)
            continue
        if any(p['naam'].lower() == naam.lower() for p in doel['producten']):
            continue  # De Posthoorn heeft hem inmiddels zelf
        doel['producten'].append({
            'id': 'combi-' + '-'.join(p['id'] for p in delen),
            'naam': naam,
            'cents': sum(p['cents'] for p in delen),
            'delen': [{'naam': p['naam'], 'cents': p['cents']} for p in delen],
        })
    return categorieen


def main():
    req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0 (compatible; frietvrijdag-menu/1.0)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        pagina = r.read().decode('utf-8', 'replace')
    categorieen = voeg_combis_toe(parse(pagina))
    aantal = sum(len(c['producten']) for c in categorieen)
    if aantal < MINIMAAL:
        print(f'Maar {aantal} producten gevonden; menu.json blijft ongewijzigd.', file=sys.stderr)
        return 1

    nieuw = {'bron': URL, 'categorieen': categorieen}
    if UIT.exists():
        oud = json.loads(UIT.read_text(encoding='utf-8'))
        if oud.get('categorieen') == categorieen:
            print(f'{aantal} producten, niets veranderd.')
            return 0
    nieuw['bijgewerkt'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    UIT.parent.mkdir(parents=True, exist_ok=True)
    UIT.write_text(json.dumps(nieuw, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{aantal} producten in {len(categorieen)} categorieën geschreven naar {UIT}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
