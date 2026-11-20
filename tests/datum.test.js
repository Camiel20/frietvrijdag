import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draaienVanaf, komendeVrijdag, vorigeVrijdagen } from '../docs/js/datum.js';

test('komende vrijdag', () => {
  assert.equal(komendeVrijdag(new Date(2026, 10, 13, 18, 0)), '2026-11-13'); // vrijdagavond = vandaag
  assert.equal(komendeVrijdag(new Date(2026, 10, 14, 9, 0)), '2026-11-20');  // zaterdag = volgende week
  assert.equal(komendeVrijdag(new Date(2026, 10, 9, 9, 0)), '2026-11-13');   // maandag
  assert.equal(komendeVrijdag(new Date(2026, 11, 28, 9, 0)), '2027-01-01');  // over de jaargrens
});

test('vorige vrijdagen', () => {
  assert.deepEqual(vorigeVrijdagen('2026-11-13', 3), ['2026-11-06', '2026-10-30', '2026-10-23']);
});

test('draaien kan vanaf 12:00 Nederlandse tijd', () => {
  assert.equal(draaienVanaf('2026-11-20').toISOString(), '2026-11-20T11:00:00.000Z'); // wintertijd
  assert.equal(draaienVanaf('2026-07-03').toISOString(), '2026-07-03T10:00:00.000Z'); // zomertijd
  assert.equal(draaienVanaf('2026-03-27').toISOString(), '2026-03-27T11:00:00.000Z'); // vlak voor de omschakeling (29-3)
  assert.equal(draaienVanaf('2026-04-03').toISOString(), '2026-04-03T10:00:00.000Z');
  assert.equal(draaienVanaf('2026-10-23').toISOString(), '2026-10-23T10:00:00.000Z'); // vlak voor de omschakeling (25-10)
  assert.equal(draaienVanaf('2026-10-30').toISOString(), '2026-10-30T11:00:00.000Z');
});

// Dezelfde formule als isZomertijd() in firestore.rules (dayOfWeek: 1 = maandag … 7 = zondag),
// naast draaienVanaf() gelegd voor elke vrijdag in tien jaar.
test('zomertijd-formule van de regels klopt', () => {
  const dow = (j, m, d) => new Date(Date.UTC(j, m - 1, d)).getUTCDay() || 7;
  const isZomertijd = (j, m, d) => (m > 3 && m < 10)
    || (m === 3 && d > 31 - (dow(j, 3, 31) % 7))
    || (m === 10 && d < 31 - (dow(j, 10, 31) % 7));
  for (let dag = new Date(Date.UTC(2026, 0, 2)); dag.getUTCFullYear() < 2036; dag.setUTCDate(dag.getUTCDate() + 7)) {
    const [j, m, d] = [dag.getUTCFullYear(), dag.getUTCMonth() + 1, dag.getUTCDate()];
    const iso = dag.toISOString().slice(0, 10);
    assert.equal(Date.UTC(j, m - 1, d, isZomertijd(j, m, d) ? 10 : 11), draaienVanaf(iso).getTime(), iso);
  }
});
