import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { menuUitPagina, parse, voegCombisToe } from '../docs/js/menu.js';

// Een pagina in de opbouw van De Posthoorn, met de eigenaardigheden die we tegenkwamen.
const kaart = (id, naam, prijs, extra = '') =>
  `<div data-id="${id}" class="product-card-content js-product-card-content" ${extra}>
     <div class="product-card-name js-product-card-name">${naam}</div>
     <span class="js-product-card-price">${prijs}</span></div>`;

const vulling = Array.from({ length: 50 }, (_, i) => kaart(String(9000 + i), `Snack ${i}`, `&euro; 2,${String(i).padStart(2, '0')}`)).join('\n');

const PAGINA = `<html><body>
<h2>Populaire gerechten</h2>${kaart('1', 'Friet', '€ 3,00')}
<h2 class="x">Week Actie</h2>
${kaart('617100', 'Snack van de week: KaasKroket&nbsp;#Blokje', '<s>€ 2,75</s> € 2,25')}
<h2>Broodjes</h2>
${kaart('10', 'Los Broodje', '€ 0,90')}
${kaart('11', 'Bourgondische kroket', '€ 3,10')}
${kaart('11', 'Bourgondische kroket (dubbel)', '€ 9,99')}
<h2>Sauzen</h2>
${kaart('12', 'Mosterd', '€ 0,40')}
${kaart('13', 'Mayo &amp; ketchup', 'gratis')}
<h2>Drinken</h2>
${kaart('20', 'Cola', '€ 2,50', 'data-deposit_amount = 0.15')}
<h2>Snacks</h2>${vulling}
<h2>Contact</h2>${kaart('99', 'Niet meetellen', '€ 1,00')}
</body></html>`;

test('menu uit de pagina', () => {
  const cats = parse(PAGINA);
  assert.deepEqual(cats.map((c) => c.naam), ['Week Actie', 'Broodjes', 'Sauzen', 'Drinken', 'Snacks']);
  assert.deepEqual(cats[0].producten, [{ id: '617100', naam: 'Snack van de week: KaasKroket #Blokje', cents: 225 }]);
  assert.equal(cats[1].producten.length, 2, 'een dubbel data-id telt één keer');
  assert.deepEqual(cats[2].producten, [{ id: '12', naam: 'Mosterd', cents: 40 }], 'zonder prijs valt weg');
  assert.deepEqual(cats[3].producten, [{ id: '20', naam: 'Cola', cents: 250, statiegeld: 15 }]);
});

test('combi met de onderdelen', () => {
  const broodjes = voegCombisToe(parse(PAGINA)).find((c) => c.naam === 'Broodjes').producten;
  assert.deepEqual(broodjes.at(-1), {
    id: 'combi-10-11-12', naam: 'Broodje Bourgondische kroket met mosterd', cents: 440,
    delen: [{ naam: 'Los Broodje', cents: 90 }, { naam: 'Bourgondische kroket', cents: 310 }, { naam: 'Mosterd', cents: 40 }],
  });
});

test('te weinig producten: geen menu', () => {
  assert.equal(menuUitPagina(PAGINA.replace(vulling, '')), null);
  assert.ok(menuUitPagina(PAGINA));
});

// tools/haal_menu.py (de Action) en docs/js/menu.js (de browser) moeten hetzelfde menu geven.
const py = ['python3', 'python', 'py'].find((p) => spawnSync(p, ['--version']).status === 0);
test('zelfde menu als tools/haal_menu.py', { skip: !py && 'geen python gevonden' }, () => {
  const code = `import sys, json; sys.path.insert(0, 'tools'); import haal_menu as h
sys.stdout.reconfigure(encoding='utf-8')
print(json.dumps(h.voeg_combis_toe(h.parse(sys.stdin.read())), ensure_ascii=False))`;
  const r = spawnSync(py, ['-c', code], { input: PAGINA, encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), voegCombisToe(parse(PAGINA)));
});
