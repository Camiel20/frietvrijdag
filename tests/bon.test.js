import { test } from 'node:test';
import assert from 'node:assert/strict';
import { besteldeRegels, bestellijst, euro, leesBon, parseEuro, totaalVan, vergelijk } from '../docs/js/bon.js';

const BON = `CAFETARIA DE POSTHOORN
Tel 0413-123456
2 x Friet mayonaise      6,00
1 Frikandel speciaal     3,00
Pindasaus                1,30
1x Red Bull            € 2,85
Subtotaal               13,15
BTW 9%                   1,09
Totaal                  13,15
PIN                     13,15`;

const kort = (r) => r.map((l) => [l.aantal, l.naam, l.cents]);

test('bedragen', () => {
  assert.equal(parseEuro('3,50'), 350);
  assert.equal(parseEuro('€ 1.234,50'), 123450);
  assert.equal(parseEuro('1,234.50'), 123450);
  assert.equal(parseEuro('2.85'), 285);
  assert.throws(() => parseEuro('abc'));
  assert.equal(euro(123450), '€ 1.234,50');
  assert.equal(euro(-50), '-€ 0,50');
});

test('bon lezen', () => {
  const { regels, totaal } = leesBon(BON);
  assert.equal(totaal, 1315);
  assert.deepEqual(kort(regels), [[2, 'Friet mayonaise', 300], [1, 'Frikandel speciaal', 300], [1, 'Pindasaus', 130], [1, 'Red Bull', 285]]);
});

test('OCR-fouten zoals Tesseract ze maakt', () => {
  const { regels, totaal } = leesBon('l Frikandel speciaal 3,00\nLl Friet speciaal 3,60\nI Red Bull 2,8S\nCola 2,O0\nTotaal 1l,4O');
  assert.deepEqual(kort(regels), [[1, 'Frikandel speciaal', 300], [1, 'Friet speciaal', 360], [1, 'Cola', 200]]);
  assert.equal(totaal, 1140);
});

test('vergelijken meldt verschillen', () => {
  const { regels, totaal } = leesBon(BON);
  const besteld = [
    { naam: 'Friet mayonaise', aantal: 1, cents: 300 }, { naam: 'Friet mayonaise', aantal: 1, cents: 300 },
    { naam: 'Frikandel speciaal', aantal: 1, cents: 280 }, { naam: 'Red Bull', aantal: 1, cents: 285 },
    { naam: 'Broodje kroket', aantal: 1, cents: 300 },
  ];
  const m = vergelijk(besteld, regels, totaal, 1465).map((x) => x.tekst);
  assert.ok(m.some((t) => t.includes('verschil')), m);
  assert.ok(m.some((t) => t.includes('Pindasaus') && t.includes('niet besteld')), m);
  assert.ok(m.some((t) => t.includes('Frikandel speciaal') && t.includes('bonprijs')), m);
  assert.ok(m.some((t) => t.includes('Broodje kroket') && t.includes('niet op de bon')), m);
  assert.ok(!m.some((t) => t.includes('Friet mayonaise')), m);
});

test('gelijk = geen meldingen', () => {
  const { regels, totaal } = leesBon('2 Friet mayo 6,00\nTotaal 6,00');
  assert.deepEqual(vergelijk([{ naam: 'Friet mayonaise', aantal: 2, cents: 300 }], regels, totaal, 600), []);
});

test('bestellijst telt op per product en opmerking', () => {
  const lijst = bestellijst([
    { naam: 'Anna Test', regels: [{ naam: 'Frikandel', aantal: 1, cents: 230, opmerking: '' }, { naam: 'Friet mayonaise', aantal: 1, cents: 300 }] },
    { naam: 'Kees', regels: [{ naam: 'Frikandel', aantal: 2, cents: 230, opmerking: '' }, { naam: 'Frikandel', aantal: 1, cents: 230, opmerking: 'speciaal' }] },
  ]);
  assert.deepEqual(lijst.map((x) => [x.aantal, x.naam, x.opmerking, x.wie.join(',')]), [
    [1, 'Friet mayonaise', '', 'Anna'], [3, 'Frikandel', '', 'Anna,Kees'], [1, 'Frikandel', 'speciaal', 'Kees']]);
  assert.equal(totaalVan([{ cents: 230, aantal: 3 }]), 690);
});

test('combi uit het menu telt op de bon als losse onderdelen', () => {
  const delen = [{ naam: 'Los Broodje', cents: 110 }, { naam: 'Bourgondische kroket', cents: 270 }];
  const besteld = besteldeRegels([{ regels: [{ naam: 'Broodje Bourgondische kroket', cents: 380, delen, aantal: 2 }] }]);
  assert.deepEqual(besteld, [{ naam: 'Los Broodje', aantal: 2, cents: 110 }, { naam: 'Bourgondische kroket', aantal: 2, cents: 270 }]);
  const { regels, totaal } = leesBon('2 Los Broodje 2,20\n2 Bourgondische kroket 5,40\nTotaal 7,60');
  assert.deepEqual(vergelijk(besteld, regels, totaal, 760), []);
  // prijs met de hand gecorrigeerd: dan niet meer splitsen
  assert.deepEqual(besteldeRegels([{ regels: [{ naam: 'Broodje Bourgondische kroket', cents: 400, delen, aantal: 1 }] }]),
    [{ naam: 'Broodje Bourgondische kroket', aantal: 1, cents: 400 }]);
});
