import { test } from 'node:test';
import assert from 'node:assert/strict';
import { komendeVrijdag, vorigeVrijdagen } from '../docs/js/datum.js';

test('komende vrijdag', () => {
  assert.equal(komendeVrijdag(new Date(2026, 10, 13, 18, 0)), '2026-11-13'); // vrijdagavond = vandaag
  assert.equal(komendeVrijdag(new Date(2026, 10, 14, 9, 0)), '2026-11-20');  // zaterdag = volgende week
  assert.equal(komendeVrijdag(new Date(2026, 10, 9, 9, 0)), '2026-11-13');   // maandag
  assert.equal(komendeVrijdag(new Date(2026, 11, 28, 9, 0)), '2027-01-01');  // over de jaargrens
});

test('vorige vrijdagen', () => {
  assert.deepEqual(vorigeVrijdagen('2026-11-13', 3), ['2026-11-06', '2026-10-30', '2026-10-23']);
});
