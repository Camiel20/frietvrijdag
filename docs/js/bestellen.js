// Bestelpagina voor collega's: index.html#t=<persoonlijke token>[&d=<vrijdag>]
//
// Verloop van een vrijdag:
//  1. Iemand opent de bestelling (één per vrijdag).
//  2. Iedereen kiest zijn friet; het wordt vanzelf bewaard.
//  3. Iemand draait aan het rad: de bestelling sluit en het rad kiest wie de rekening betaalt
//     (alleen wie besteld heeft staat erop). Iedereen ziet het rad draaien.
//  4. De betaler bestelt, zet zijn Tikkie-link erin en kan de bon uitlezen.
//  5. Ieder ziet zijn bedrag, betaalt via de link en vinkt "Ik heb betaald" aan;
//     de betaler vinkt per persoon "Ontvangen" aan.
import { DEMO, bestelLink, el, laadMenu, opslag } from './opslag.js';
import { besteldeRegels, bestellijst, euro, leesBon, totaalVan, vergelijk } from './bon.js';
import { datumTekst, komendeVrijdag, vorigeVrijdagen } from './datum.js';
import { maakRad } from './rad.js';
import { bonPaneel } from './bonui.js';

const app = document.getElementById('app');
const statusEl = document.getElementById('opslagstatus');
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('t');
const vrijdag = komendeVrijdag();
const datum = params.get('d') || vrijdag;
const MAX_REGELS = 30, MAX_AANTAL = 20;
const GEZIEN = 'frietvrijdag-rad-gezien-';

let ik, menu, ronde = null, bestellingen = [], regels = [];
const namen = new Map();
let mandGeladen = false, rondeGeladen = false, bestellingenGeladen = false;
let rad = null, radSleutel = '', radBezig = false;
let bewaarTimer = null, bewaren = Promise.resolve();
let tikkieVeld = null, bonEl = null, bonOpen = null, overzichtOpen = false;

const voornaam = (n) => String(n || '').split(' ')[0];
const naamVan = (id) => namen.get(id)?.naam || 'iemand';
const regelsVan = (b) => b?.regels || [];
const mijn = () => bestellingen.find((b) => b.id === ik.id);
const kandidaten = () => bestellingen.filter((b) => regelsVan(b).length)
  .map((b) => ({ id: b.id, naam: naamVan(b.id) })).sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
const metNamen = (lijst) => lijst.map((b) => ({ ...b, naam: naamVan(b.id) }));

function bericht(titel, tekst) {
  app.replaceChildren(el('section', { class: 'panel narrow' }, el('h1', {}, titel), el('p', { class: 'muted' }, tekst)));
}

function zetStatus(tekst, soort = '') {
  statusEl.textContent = tekst;
  statusEl.className = 'opslagstatus ' + soort;
}

function fout(e) {
  console.error(e);
  const dicht = /permission|toegestaan/i.test(String(e?.code || e?.message));
  alert(dicht ? 'Dat mag (nu) niet meer. Vernieuw de pagina.' : 'Dat lukte niet. Controleer je internet en probeer opnieuw.');
}

async function kopieer(tekst, knop) {
  try { await navigator.clipboard.writeText(tekst); } catch { prompt('Kopieer:', tekst); return; }
  if (knop) { const oud = knop.textContent; knop.textContent = 'Gekopieerd ✓'; setTimeout(() => (knop.textContent = oud), 1500); }
}

// ---------------------------------------------------------------- opslaan (automatisch, kort na elke wijziging)

function plan() {
  zetStatus('Opslaan…');
  clearTimeout(bewaarTimer);
  bewaarTimer = setTimeout(bewaarNu, 600);
}

function bewaarNu() {
  clearTimeout(bewaarTimer);
  bewaarTimer = null;
  const kopie = regels.map((r) => ({ ...r }));
  bewaren = bewaren.then(() => opslag.bewaarRegels(datum, ik.id, kopie))
    .then(() => zetStatus('✓ Opgeslagen', 'ok'))
    .catch((e) => {
      const dicht = /permission|toegestaan/i.test(String(e?.code || e?.message));
      zetStatus(dicht ? 'Niet opgeslagen: de bestelling is gesloten' : 'Niet opgeslagen — probeer opnieuw', 'fout');
      console.error(e);
    });
  return bewaren;
}

window.addEventListener('pagehide', () => { if (bewaarTimer) bewaarNu(); });
// Andere link in hetzelfde tabblad (alleen het deel na # verschilt): opnieuw laden, anders blijft de vorige persoon actief.
window.addEventListener('hashchange', async () => { if (bewaarTimer) await bewaarNu(); location.reload(); });

// ---------------------------------------------------------------- 1. ronde openen / 3. rad / 4-5. betalen

function rondeSectie() {
  const sec = document.getElementById('ronde');
  // Niet hertekenen terwijl iemand in de Tikkie-link of de bon typt.
  if (sec.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;

  if (!ronde) {
    if (datum !== vrijdag) return sec.replaceChildren(el('section', { class: 'panel' }, el('p', { class: 'muted' }, 'Op deze vrijdag was er geen friet-bestelling.')));
    return sec.replaceChildren(el('section', { class: 'panel openen' },
      el('h2', {}, `Nog geen friet voor ${datumTekst(datum)}`),
      el('p', { class: 'muted' }, 'Zin in friet? Open de bestelling; daarna kan iedereen via zijn eigen link meedoen.'),
      el('button', { class: 'groot', onclick: async (e) => {
        e.target.disabled = true;
        try { await opslag.openRonde(datum, ik.id); } catch (x) { fout(x); e.target.disabled = false; }
      } }, '🍟 Bestelling openen')));
  }

  const k = kandidaten();
  const sleutel = k.map((x) => x.id).join(',');
  if (!rad || (sleutel !== radSleutel && !radBezig)) { rad = maakRad(k.map((x) => voornaam(x.naam))); radSleutel = sleutel; }
  const radBlok = el('div', { class: 'rad' }, el('div', { class: 'wijzer' }), rad.canvas);

  if (ronde.open) {
    const ikBesteld = regelsVan(mijn()).length > 0;
    rad.teken();
    return sec.replaceChildren(el('section', { class: 'panel radpaneel' },
      el('h2', {}, 'Wie betaalt er deze keer?'),
      el('p', { class: 'muted' }, 'Iedereen die besteld heeft, staat op het rad. Is iedereen klaar? Eén draai beslist wie de rekening betaalt.'),
      radBlok,
      el('button', { class: 'groot', disabled: !ikBesteld || !k.length, onclick: draai }, '🎡 Draai aan het rad'),
      !ikBesteld ? el('p', { class: 'muted klein' }, 'Bestel eerst zelf iets; dan kun je ook draaien.') : null,
      el('p', { class: 'muted klein' }, `Na het draaien sluit de bestelling.${ronde.geopendDoor ? ` Geopend door ${voornaam(naamVan(ronde.geopendDoor))}.` : ''}`)));
  }

  if (!ronde.betaler) {
    return sec.replaceChildren(el('section', { class: 'panel' }, el('h2', {}, 'De bestelling is gesloten'),
      el('p', { class: 'muted' }, 'Er is (nog) niet aan het rad gedraaid.')));
  }

  // --- er is gedraaid
  const winnaar = k.findIndex((x) => x.id === ronde.betaler);
  const ikBetaal = ronde.betaler === ik.id;
  // Per persoon onthouden of je de draai al zag (niet per browser: anders mist een tweede link in dezelfde browser hem).
  const gezienSleutel = `${GEZIEN}${datum}-${ik.id}`;
  let gezien = false;
  try { gezien = localStorage.getItem(gezienSleutel) === '1'; } catch { /* privé-venster */ }
  if (!gezien && !radBezig && winnaar >= 0) return speelDraai(winnaar, gezienSleutel);
  if (radBezig) return;
  if (winnaar >= 0) rad.zetOp(winnaar);

  const uitslag = el('section', { class: 'panel radpaneel' },
    el('h2', { class: 'uitslag' }, ikBetaal ? '🎉 Jij betaalt deze keer!' : `${naamVan(ronde.betaler)} betaalt deze keer`),
    radBlok,
    el('p', { class: 'muted klein' }, `Gedraaid door ${ronde.gedraaidDoor === ik.id ? 'jou' : voornaam(naamVan(ronde.gedraaidDoor))}.`),
    winnaar >= 0 ? el('button', { class: 'secondary', onclick: () => speelDraai(winnaar, gezienSleutel) }, '↻ Nog een keer zien') : null);

  sec.replaceChildren(uitslag, ...(ikBetaal ? betalerBlokken() : deelnemerBlokken()));
}

/** Speelt de draai af: rad in beeld, ~6 seconden draaien, dan de uitslag. */
function speelDraai(winnaar, gezienSleutel) {
  const sec = document.getElementById('ronde');
  radBezig = true;
  sec.replaceChildren(el('section', { class: 'panel radpaneel draait' },
    el('h2', {}, 'Het rad draait…'),
    el('div', { class: 'rad' }, el('div', { class: 'wijzer' }), rad.canvas)));
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  rad.draaiNaar(winnaar, 6000).then(() => {
    try { localStorage.setItem(gezienSleutel, '1'); } catch { /* geen opslag: dan draait hij de volgende keer weer */ }
    radBezig = false;
    rondeSectie();
    sec.querySelector('.uitslag')?.classList.add('feest');
  });
}

async function draai() {
  if (!confirm('Is iedereen klaar? Na het draaien kan niemand meer iets bestellen of wijzigen.')) return;
  if (bewaarTimer) await bewaarNu();
  const k = kandidaten();
  if (!k.length) return;
  const i = crypto.getRandomValues(new Uint32Array(1))[0] % k.length;
  try { await opslag.draai(datum, k[i].id, ik.id); } catch (x) { fout(x); }
}

function betaalOverzicht(alsBetaler) {
  const anderen = metNamen(bestellingen.filter((b) => regelsVan(b).length && b.id !== ronde.betaler))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  if (!anderen.length) return el('p', { class: 'muted' }, 'Niemand anders heeft besteld.');
  return el('div', {}, anderen.map((b) => el('div', { class: 'person betaalrij' },
    el('div', {}, el('strong', {}, b.naam), el('small', {}, euro(totaalVan(b.regels)))),
    el('div', { class: 'actions' },
      b.ontvangen ? el('span', { class: 'chip ok' }, '✓ ontvangen')
        : b.betaald ? el('span', { class: 'chip wacht' }, 'zegt: betaald') : el('span', { class: 'chip' }, 'nog niet'),
      alsBetaler ? el('button', { class: b.ontvangen ? 'paid' : 'secondary', onclick: () => opslag.zetOntvangen(datum, b.id, !b.ontvangen).catch(fout) },
        b.ontvangen ? 'Ontvangen ✓' : 'Ontvangen?') : null))));
}

function betalerBlokken() {
  const lijst = bestellijst(metNamen(bestellingen));
  const lijstTekst = lijst.map((g) => `${g.aantal}x ${g.naam}${g.opmerking ? ` (${g.opmerking})` : ''}`).join('\n');
  const totaal = bestellingen.reduce((s, b) => s + totaalVan(b.regels), 0);
  const nogTeOntvangen = bestellingen.filter((b) => b.id !== ik.id && regelsVan(b).length && !b.ontvangen);
  const openBedrag = nogTeOntvangen.reduce((s, b) => s + totaalVan(b.regels), 0);

  if (!tikkieVeld) {
    tikkieVeld = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://tikkie.me/pay/…', 'aria-label': 'Betaallink' });
    tikkieVeld.value = ronde.tikkie || '';
  }
  const herinnering = () => {
    const wie = metNamen(nogTeOntvangen.filter((b) => !b.betaald)).map((b) => `${voornaam(b.naam)} ${euro(totaalVan(b.regels))}`);
    return `🍟 Friet van ${datumTekst(datum)}: nog even betalen graag!\n${wie.join('\n')}${ronde.tikkie ? `\n\nBetalen: ${ronde.tikkie}` : ''}`;
  };

  if (!bonEl) {
    bonEl = bonPaneel({ tekst: ronde.bonTekst || '', opslaan: (tekst, bonTotaal) => opslag.zetBetalerVelden(datum, { bonTekst: tekst, bonTotaal }) });
  }
  const bon = leesBon(ronde.bonTekst);
  const meldingen = (ronde.bonTotaal != null || ronde.bonTekst)
    ? vergelijk(besteldeRegels(bestellingen), bon.regels, ronde.bonTotaal ?? null, totaal) : null;

  return [
    el('section', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Bestellen bij De Posthoorn'),
        el('button', { class: 'secondary', onclick: (e) => kopieer(lijstTekst, e.target) }, 'Kopieer')),
      lijst.map((g) => el('div', { class: 'line' },
        el('div', {}, el('strong', {}, `${g.aantal} × ${g.naam}`), g.opmerking ? el('small', {}, g.opmerking) : null),
        el('small', { class: 'who' }, g.wie.join(', ')))),
      el('div', { class: 'sum' }, el('span', {}, 'Totaal (menuprijzen)'), el('strong', {}, euro(totaal)))),
    el('section', { class: 'panel' },
      el('h2', {}, 'Jouw betaallink'),
      el('p', { class: 'muted' }, 'Maak een Tikkie of betaalverzoek en plak de link hier. Iedereen ziet bij die link zijn eigen bedrag.'),
      el('form', { class: 'inline', onsubmit: async (e) => {
        e.preventDefault();
        const v = tikkieVeld.value.trim();
        if (v && !/^https:\/\/\S+$/.test(v)) return alert('Plak een link die met https:// begint.');
        try { tikkieVeld.blur(); await opslag.zetBetalerVelden(datum, { tikkie: v }); zetStatus('✓ Betaallink opgeslagen', 'ok'); } catch (x) { fout(x); }
      } }, tikkieVeld, el('button', {}, 'Opslaan'))),
    el('section', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, 'Wie heeft betaald?'),
        nogTeOntvangen.some((b) => !b.betaald) ? el('button', { class: 'secondary', onclick: (e) => kopieer(herinnering(), e.target) }, 'Kopieer herinnering') : null),
      el('p', { class: 'muted' }, 'Vink "Ontvangen" aan zodra het geld op je rekening staat.'),
      betaalOverzicht(true),
      el('div', { class: 'sum' }, el('span', {}, 'Nog te ontvangen'), el('strong', {}, euro(openBedrag))),
      el('p', { class: 'muted klein' }, `Jouw eigen deel: ${euro(totaalVan(regelsVan(mijn())))} (hoef je niet over te maken).`)),
    el('section', { class: 'panel' },
      el('details', { open: (bonOpen ??= !!ronde.bonTekst) || undefined, ontoggle: (e) => { bonOpen = e.target.open; } }, el('summary', {}, el('h2', { class: 'inline-h2' }, 'Bon uitlezen en controleren')),
        meldingen === null ? null : meldingen.length
          ? el('ul', { class: 'meldingen' }, meldingen.map((m) => el('li', { class: 'm-' + m.soort }, m.tekst)))
          : el('p', { class: 'notice ok' }, 'Bon en bestellingen komen overeen.'),
        bonEl)),
  ];
}

function deelnemerBlokken() {
  const m = mijn();
  const betaler = voornaam(naamVan(ronde.betaler));
  const blokken = [];
  if (regelsVan(m).length) {
    const bedrag = totaalVan(m.regels);
    blokken.push(el('section', { class: 'panel betalen' },
      el('h2', {}, `Jij betaalt ${betaler} ${euro(bedrag)}`),
      ronde.tikkie
        ? el('a', { class: 'button groot', href: ronde.tikkie, target: '_blank', rel: 'noopener noreferrer' }, `Betalen via de link van ${betaler}`)
        : el('p', { class: 'muted' }, `${betaler} zet de betaallink er zo in.`),
      el('button', { class: (m.betaald ? 'paid' : 'secondary') + ' groot', onclick: () => opslag.zetBetaald(datum, ik.id, !m.betaald).catch(fout) },
        m.betaald ? '✓ Ik heb betaald' : 'Ik heb betaald'),
      el('p', { class: 'muted klein' }, m.ontvangen ? `✓ ${betaler} heeft het ontvangen. Klaar!`
        : m.betaald ? `Wacht op bevestiging van ${betaler}.` : `Betaald? Vink het aan; ${betaler} bevestigt het daarna.`)));
  } else {
    blokken.push(el('section', { class: 'panel' }, el('p', { class: 'muted' }, 'Je deed deze keer niet mee.')));
  }
  blokken.push(el('section', { class: 'panel' }, el('details', { open: overzichtOpen || undefined, ontoggle: (e) => { overzichtOpen = e.target.open; } }, el('summary', {}, 'Wie heeft er al betaald?'), betaalOverzicht(false))));
  return blokken;
}

// ---------------------------------------------------------------- 2. bestellen

function voegToe(p) {
  const bestaand = regels.find((r) => r.id === p.id && !r.opmerking);
  if (bestaand) bestaand.aantal = Math.min(MAX_AANTAL, bestaand.aantal + 1);
  else if (regels.length >= MAX_REGELS) return alert('Dat zijn wel heel veel regels.');
  else regels.push({ id: p.id, naam: p.naam, cents: p.cents, ...(p.statiegeld ? { statiegeld: p.statiegeld } : {}), aantal: 1, opmerking: '' });
  mandSectie();
  plan();
  const knop = document.querySelector(`[data-pid="${p.id}"]`);
  if (knop) { knop.classList.add('tik'); setTimeout(() => knop.classList.remove('tik'), 350); }
}

function mandSectie() {
  const mand = document.getElementById('bestelling');
  mand.hidden = !ronde;
  if (!ronde) return;
  const open = ronde.open;
  const lijst = open ? regels : regelsVan(mijn());
  const kids = [el('h2', {}, 'Jouw bestelling')];
  if (!lijst.length) kids.push(el('p', { class: 'muted' }, open ? 'Nog niets gekozen. Tik hieronder op + bij wat je wilt.' : 'Je hebt niets besteld.'));
  lijst.forEach((r, i) => {
    if (!open) {
      kids.push(el('div', { class: 'line' },
        el('div', {}, el('strong', {}, `${r.aantal} × ${r.naam}`), r.opmerking ? el('small', {}, r.opmerking) : null),
        el('strong', {}, euro((r.cents + (r.statiegeld || 0)) * r.aantal))));
      return;
    }
    const wijzig = (d) => { r.aantal += d; if (r.aantal < 1) regels.splice(i, 1); mandSectie(); plan(); };
    kids.push(el('div', { class: 'mandregel' },
      el('div', { class: 'mandnaam' }, el('strong', {}, r.naam),
        el('input', { class: 'opm', value: r.opmerking, placeholder: '+ opmerking (bv. zonder ui)', maxlength: 80, 'aria-label': 'Opmerking bij ' + r.naam,
          oninput: (e) => { r.opmerking = e.target.value; plan(); } })),
      el('div', { class: 'stepper' },
        el('button', { class: 'secondary rond', 'aria-label': 'Eén minder', onclick: () => wijzig(-1) }, r.aantal === 1 ? '🗑' : '−'),
        el('span', { class: 'aantal' }, r.aantal),
        el('button', { class: 'secondary rond', 'aria-label': 'Eén meer', disabled: r.aantal >= MAX_AANTAL, onclick: () => wijzig(1) }, '+')),
      el('strong', { class: 'bedrag' }, euro((r.cents + (r.statiegeld || 0)) * r.aantal))));
  });
  kids.push(el('div', { class: 'sum' }, el('span', {}, 'Jouw totaal'), el('strong', {}, euro(totaalVan(lijst)))));
  if (lijst.some((r) => r.statiegeld)) kids.push(el('p', { class: 'muted klein' }, 'Inclusief statiegeld op blikjes/flesjes.'));
  mand.replaceChildren(...kids);
}

function menuSectie() {
  const sec = document.getElementById('menu');
  sec.hidden = !ronde?.open;
  if (sec.hidden || sec.childElementCount) return;
  const zoek = el('input', { type: 'search', id: 'zoek', placeholder: 'Zoek friet, snack, broodje…', 'aria-label': 'Zoeken', oninput: filter });
  const chips = el('nav', { class: 'chips' }, menu.categorieen.map((c, i) =>
    el('a', { href: '#cat' + i, onclick: (e) => { e.preventDefault(); document.getElementById('cat' + i).scrollIntoView({ behavior: 'smooth' }); } }, c.naam)));
  const lijsten = menu.categorieen.map((c, i) => el('div', { class: 'categorie', id: 'cat' + i },
    el('h3', {}, c.naam),
    c.producten.map((p) => el('div', { class: 'product', 'data-zoek': (p.naam + ' ' + c.naam).toLowerCase() },
      el('div', {}, el('strong', {}, p.naam),
        el('span', { class: 'price' }, euro(p.cents), p.statiegeld ? el('small', {}, ` + ${euro(p.statiegeld)} statiegeld`) : null)),
      el('button', { class: 'rond plus', 'data-pid': p.id, 'aria-label': p.naam + ' toevoegen', onclick: () => voegToe(p) }, '+')))));
  const bijgewerkt = menu.bijgewerkt ? new Date(menu.bijgewerkt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }) : '?';
  sec.replaceChildren(el('section', { class: 'panel' }, el('h2', {}, 'Wat wil je?'), zoek, chips, lijsten,
    el('p', { class: 'muted klein' }, `Menu en prijzen van de website van De Posthoorn, bijgewerkt ${bijgewerkt}.`)));
}

function filter() {
  const q = document.getElementById('zoek').value.toLowerCase().trim();
  for (const c of document.querySelectorAll('.categorie')) {
    let iets = false;
    for (const p of c.querySelectorAll('.product')) { p.hidden = !p.dataset.zoek.includes(q); iets ||= !p.hidden; }
    c.hidden = !iets;
  }
  document.querySelector('.chips').hidden = !!q;
}

// ---------------------------------------------------------------- eerdere vrijdagen met iets open

async function eerderSectie() {
  if (datum !== vrijdag) return;
  const items = [];
  for (const dt of vorigeVrijdagen(vrijdag, 4)) {
    const r = await opslag.ronde(dt).catch(() => null);
    if (!r?.betaler) continue;
    const bs = await opslag.bestellingen(dt).catch(() => []);
    const m = bs.find((b) => b.id === ik.id);
    const link = bestelLink(token, dt);
    if (r.betaler !== ik.id && regelsVan(m).length && !m.ontvangen) {
      items.push(el('a', { class: 'week', href: link }, el('strong', {}, datumTekst(dt)),
        el('span', {}, `${m.betaald ? 'betaald, wacht op bevestiging' : 'nog betalen'}: ${euro(totaalVan(m.regels))} aan ${voornaam(naamVan(r.betaler))}`),
        el('span', {}, 'Bekijken →')));
    }
    const teBevestigen = r.betaler === ik.id ? bs.filter((b) => b.id !== ik.id && regelsVan(b).length && !b.ontvangen) : [];
    if (teBevestigen.length) {
      items.push(el('a', { class: 'week', href: link }, el('strong', {}, datumTekst(dt)),
        el('span', {}, `jij betaalde: nog ${teBevestigen.length} ${teBevestigen.length === 1 ? 'betaling' : 'betalingen'} te bevestigen`),
        el('span', {}, 'Bekijken →')));
    }
  }
  const sec = document.getElementById('eerder');
  sec.replaceChildren(...(items.length ? [el('section', { class: 'panel' }, el('h2', {}, 'Nog openstaand'), el('div', { class: 'stack' }, items))] : []));
}

// ---------------------------------------------------------------- start

function tekenAlles() {
  if (!rondeGeladen || !bestellingenGeladen) return;
  if (!mandGeladen && ronde) { regels = regelsVan(mijn()).map((r) => ({ ...r })); mandGeladen = true; }
  rondeSectie();
  mandSectie();
  menuSectie();
}

async function start() {
  if (DEMO) document.body.prepend(el('div', { class: 'demobalk' }, 'DEMO-modus: alles blijft in deze browser. Vul firebase-config.js in om echt te delen.'));
  if (!token) return bericht('FrietVrijdag', 'Open je persoonlijke bestellink. Die krijg je van degene die FrietVrijdag beheert.');
  try {
    ik = await opslag.koppel(token);
    if (!ik) return bericht('Link werkt niet', 'Deze link is niet (meer) geldig. Vraag een nieuwe aan.');
    const [ds, m] = await Promise.all([opslag.deelnemers(), laadMenu()]);
    ds.forEach((d) => namen.set(d.id, d));
    menu = m;
  } catch (e) {
    console.error(e);
    return bericht('Er ging iets mis', 'Laden lukte niet. Controleer je internet en vernieuw de pagina.');
  }
  app.replaceChildren(
    el('div', { class: 'heading' }, el('div', {},
      el('p', { class: 'eyebrow' }, 'FRIETVRIJDAG · ' + datumTekst(datum).toUpperCase()),
      el('h1', {}, `Hoi ${voornaam(ik.naam)}`),
      datum !== vrijdag ? el('p', {}, el('a', { href: bestelLink(token) }, '← Naar deze vrijdag')) : null)),
    el('div', { id: 'eerder' }),
    el('div', { id: 'ronde' }),
    el('section', { class: 'panel', id: 'bestelling', hidden: true }),
    el('div', { id: 'menu', hidden: true }));
  opslag.volgRonde(datum, (r) => {
    const wasOpen = ronde?.open;
    ronde = r; rondeGeladen = true;
    if (wasOpen && r && !r.open && bewaarTimer) { clearTimeout(bewaarTimer); bewaarTimer = null; zetStatus('Bestelling is gesloten', 'fout'); }
    tekenAlles();
  });
  opslag.volgBestellingen(datum, (b) => { bestellingen = b; bestellingenGeladen = true; tekenAlles(); });
  eerderSectie();
}

start();
