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
import { EN, TAAL, t, wisselTaal } from './taal.js';

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
let rad = null, radSleutel = '', radBezig = false, draaiVragen = false;
let bewaarTimer = null, bewaren = Promise.resolve();
let tikkieVeld = null, bonEl = null, bonOpen = null, overzichtOpen = false;

const voornaam = (n) => String(n || '').split(' ')[0];
const naamVan = (id) => namen.get(id)?.naam || t('iemand', 'someone');
const dag = (d) => datumTekst(d, false, TAAL);
const link = (d) => bestelLink(token, d, TAAL);
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
  alert(dicht ? t('Dat mag (nu) niet meer. Vernieuw de pagina.', 'That is no longer allowed. Please refresh the page.')
    : t('Dat lukte niet. Controleer je internet en probeer opnieuw.', 'That didn’t work. Check your internet connection and try again.'));
}

async function kopieer(tekst, knop) {
  try { await navigator.clipboard.writeText(tekst); } catch { prompt(t('Kopieer:', 'Copy:'), tekst); return; }
  if (knop) { const oud = knop.textContent; knop.textContent = t('Gekopieerd ✓', 'Copied ✓'); setTimeout(() => (knop.textContent = oud), 1500); }
}

// ---------------------------------------------------------------- opslaan (automatisch, kort na elke wijziging)

function plan() {
  zetStatus(t('Opslaan…', 'Saving…'));
  clearTimeout(bewaarTimer);
  bewaarTimer = setTimeout(bewaarNu, 600);
}

function bewaarNu() {
  clearTimeout(bewaarTimer);
  bewaarTimer = null;
  const kopie = regels.map((r) => ({ ...r }));
  bewaren = bewaren.then(() => opslag.bewaarRegels(datum, ik.id, kopie))
    .then(() => zetStatus(t('✓ Opgeslagen', '✓ Saved'), 'ok'))
    .catch((e) => {
      const dicht = /permission|toegestaan/i.test(String(e?.code || e?.message));
      zetStatus(dicht ? t('Niet opgeslagen: de bestelling is gesloten', 'Not saved: the order is closed')
        : t('Niet opgeslagen — probeer opnieuw', 'Not saved — please try again'), 'fout');
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
  // Tijdens de draai niets hertekenen: dat zou het rad-canvas uit beeld halen. Bij de draaier komen er
  // twee updates binnen (lokaal + bevestiging van de server); speelDraai tekent na afloop zelf opnieuw.
  if (radBezig) return;

  if (!ronde) {
    if (datum !== vrijdag) return sec.replaceChildren(el('section', { class: 'panel' }, el('p', { class: 'muted' }, t('Op deze vrijdag was er geen friet-bestelling.', 'There was no fries order on this Friday.'))));
    return sec.replaceChildren(el('section', { class: 'panel openen' },
      el('h2', {}, t(`Nog geen friet voor ${dag(datum)}`, `No fries yet for ${dag(datum)}`)),
      el('p', { class: 'muted' }, t('Zin in friet? Open de bestelling; daarna kan iedereen via zijn eigen link meedoen.',
        'Fancy fries? Open the order; then everyone can join using their own link.')),
      el('button', { class: 'groot', onclick: async (e) => {
        e.target.disabled = true;
        try { await opslag.openRonde(datum, ik.id); } catch (x) { fout(x); e.target.disabled = false; }
      } }, t('🍟 Bestelling openen', '🍟 Open the order'))));
  }

  const k = kandidaten();
  const sleutel = k.map((x) => x.id).join(',');
  if (!rad || (sleutel !== radSleutel && !radBezig)) { rad = maakRad(k.map((x) => voornaam(x.naam))); radSleutel = sleutel; }
  const radBlok = el('div', { class: 'rad' }, el('div', { class: 'wijzer' }), rad.canvas);

  if (ronde.open) {
    const ikBesteld = regelsVan(mijn()).length > 0;
    rad.teken();
    return sec.replaceChildren(el('section', { class: 'panel radpaneel' },
      el('h2', {}, t('Wie betaalt er deze keer?', 'Who pays this time?')),
      el('p', { class: 'muted' }, t('Iedereen die besteld heeft, staat op het rad. Is iedereen klaar? Eén draai beslist wie de rekening betaalt.',
        'Everyone who ordered is on the wheel. Is everyone ready? One spin decides who pays the bill.')),
      radBlok,
      // Eerst een waarschuwing in de pagina (geen confirm(): die toont niet elke in-app-browser, en hij is snel weggeklikt).
      draaiVragen && ikBesteld && k.length ? el('div', { class: 'waarschuwing', role: 'alert' },
        el('strong', {}, t('⚠️ Hierna is de bestelling gesloten', '⚠️ This closes the order')),
        el('p', {}, t('Na het draaien kan niemand meer iets bestellen of wijzigen. Heeft iedereen besteld?',
          'After spinning, nobody can order or change anything. Has everyone ordered?')),
        el('p', {}, el('small', {}, t(`Op het rad (${k.length}): `, `On the wheel (${k.length}): `) + k.map((x) => voornaam(x.naam)).join(', '))),
        el('button', { class: 'groot', onclick: draai }, t('🎡 Ja, draai en sluit de bestelling', '🎡 Yes, spin and close the order')),
        el('button', { class: 'secondary groot', onclick: () => { draaiVragen = false; rondeSectie(); } }, t('Nee, nog even wachten', 'No, wait a bit')))
        : el('button', { class: 'groot', disabled: !ikBesteld || !k.length, onclick: () => { draaiVragen = true; rondeSectie(); } }, t('🎡 Draai aan het rad', '🎡 Spin the wheel')),
      !ikBesteld ? el('p', { class: 'muted klein' }, t('Bestel eerst zelf iets; dan kun je ook draaien.', 'Order something yourself first; then you can spin too.')) : null,
      el('p', { class: 'muted klein' }, t('Na het draaien sluit de bestelling.', 'Spinning closes the order.')
        + (ronde.geopendDoor ? ' ' + t(`Geopend door ${voornaam(naamVan(ronde.geopendDoor))}.`, `Opened by ${voornaam(naamVan(ronde.geopendDoor))}.`) : ''))));
  }

  if (!ronde.betaler) {
    return sec.replaceChildren(el('section', { class: 'panel' }, el('h2', {}, t('De bestelling is gesloten', 'The order is closed')),
      el('p', { class: 'muted' }, t('Er is (nog) niet aan het rad gedraaid.', 'The wheel has not been spun (yet).'))));
  }

  // --- er is gedraaid
  const winnaar = k.findIndex((x) => x.id === ronde.betaler);
  const ikBetaal = ronde.betaler === ik.id;
  // Per persoon onthouden of je de draai al zag (niet per browser: anders mist een tweede link in dezelfde browser hem).
  const gezienSleutel = `${GEZIEN}${datum}-${ik.id}`;
  let gezien = false;
  try { gezien = localStorage.getItem(gezienSleutel) === '1'; } catch { /* privé-venster */ }
  if (!gezien && winnaar >= 0) return speelDraai(winnaar, gezienSleutel);
  if (winnaar >= 0) rad.zetOp(winnaar);

  const uitslag = el('section', { class: 'panel radpaneel' },
    el('h2', { class: 'uitslag' }, ikBetaal ? t('🎉 Jij betaalt deze keer!', '🎉 You’re paying this time!')
      : t(`${naamVan(ronde.betaler)} betaalt deze keer`, `${naamVan(ronde.betaler)} pays this time`)),
    radBlok,
    el('p', { class: 'muted klein' }, `${t('Gedraaid door', 'Spun by')} ${ronde.gedraaidDoor === ik.id ? t('jou', 'you') : voornaam(naamVan(ronde.gedraaidDoor))}.`),
    winnaar >= 0 ? el('button', { class: 'secondary', onclick: () => speelDraai(winnaar, gezienSleutel) }, t('↻ Nog een keer zien', '↻ Watch again')) : null);

  sec.replaceChildren(uitslag, ...(ikBetaal ? betalerBlokken() : deelnemerBlokken()));
}

/** Speelt de draai af: rad in beeld, ~6 seconden draaien, dan de uitslag. */
function speelDraai(winnaar, gezienSleutel) {
  const sec = document.getElementById('ronde');
  radBezig = true;
  sec.replaceChildren(el('section', { class: 'panel radpaneel draait' },
    el('h2', {}, t('Het rad draait…', 'The wheel is spinning…')),
    el('div', { class: 'rad' }, el('div', { class: 'wijzer' }), rad.canvas)));
  sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  rad.draaiNaar(winnaar, 6000).then(() => {
    try { localStorage.setItem(gezienSleutel, '1'); } catch { /* geen opslag: dan draait hij de volgende keer weer */ }
    radBezig = false;
    rondeSectie();
    sec.querySelector('.uitslag')?.classList.add('feest');
  });
}

async function draai(e) {
  draaiVragen = false;
  if (e?.target) e.target.disabled = true;
  if (bewaarTimer) await bewaarNu();
  const k = kandidaten();
  if (!k.length) return;
  const i = crypto.getRandomValues(new Uint32Array(1))[0] % k.length;
  try { await opslag.draai(datum, k[i].id, ik.id); } catch (x) { fout(x); rondeSectie(); }
}

function betaalOverzicht(alsBetaler) {
  const anderen = metNamen(bestellingen.filter((b) => regelsVan(b).length && b.id !== ronde.betaler))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  if (!anderen.length) return el('p', { class: 'muted' }, t('Niemand anders heeft besteld.', 'Nobody else ordered.'));
  return el('div', {}, anderen.map((b) => el('div', { class: 'person betaalrij' },
    el('div', {}, el('strong', {}, b.naam), el('small', {}, euro(totaalVan(b.regels)))),
    el('div', { class: 'actions' },
      b.ontvangen ? el('span', { class: 'chip ok' }, t('✓ ontvangen', '✓ received'))
        : b.betaald ? el('span', { class: 'chip wacht' }, t('zegt: betaald', 'says: paid')) : el('span', { class: 'chip' }, t('nog niet', 'not yet')),
      alsBetaler ? el('button', { class: b.ontvangen ? 'paid' : 'secondary', onclick: () => opslag.zetOntvangen(datum, b.id, !b.ontvangen).catch(fout) },
        b.ontvangen ? t('Ontvangen ✓', 'Received ✓') : t('Ontvangen?', 'Received?')) : null))));
}

function betalerBlokken() {
  const lijst = bestellijst(metNamen(bestellingen));
  const lijstTekst = lijst.map((g) => `${g.aantal}x ${g.naam}${g.opmerking ? ` (${g.opmerking})` : ''}`).join('\n');
  const totaal = bestellingen.reduce((s, b) => s + totaalVan(b.regels), 0);
  const nogTeOntvangen = bestellingen.filter((b) => b.id !== ik.id && regelsVan(b).length && !b.ontvangen);
  const openBedrag = nogTeOntvangen.reduce((s, b) => s + totaalVan(b.regels), 0);

  if (!tikkieVeld) {
    tikkieVeld = el('input', { type: 'url', inputmode: 'url', placeholder: 'https://tikkie.me/pay/…', 'aria-label': t('Betaallink', 'Payment link') });
    tikkieVeld.value = ronde.tikkie || '';
  }
  const herinnering = () => {
    const wie = metNamen(nogTeOntvangen.filter((b) => !b.betaald)).map((b) => `${voornaam(b.naam)} ${euro(totaalVan(b.regels))}`);
    return t(`🍟 Friet van ${dag(datum)}: nog even betalen graag!`, `🍟 Fries of ${dag(datum)}: please pay when you can!`)
      + `\n${wie.join('\n')}${ronde.tikkie ? `\n\n${t('Betalen', 'Pay')}: ${ronde.tikkie}` : ''}`;
  };

  if (!bonEl) {
    bonEl = bonPaneel({ tekst: ronde.bonTekst || '', opslaan: (tekst, bonTotaal) => opslag.zetBetalerVelden(datum, { bonTekst: tekst, bonTotaal }), en: EN });
  }
  const bon = leesBon(ronde.bonTekst);
  const meldingen = (ronde.bonTotaal != null || ronde.bonTekst)
    ? vergelijk(besteldeRegels(bestellingen), bon.regels, ronde.bonTotaal ?? null, totaal, TAAL) : null;

  return [
    el('section', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, t('Bestellen bij De Posthoorn', 'Ordering at De Posthoorn')),
        el('button', { class: 'secondary', onclick: (e) => kopieer(lijstTekst, e.target) }, t('Kopieer', 'Copy'))),
      lijst.map((g) => el('div', { class: 'line' },
        el('div', {}, el('strong', {}, `${g.aantal} × ${g.naam}`), g.opmerking ? el('small', {}, g.opmerking) : null),
        el('small', { class: 'who' }, g.wie.join(', ')))),
      el('div', { class: 'sum' }, el('span', {}, t('Totaal (menuprijzen)', 'Total (menu prices)')), el('strong', {}, euro(totaal)))),
    el('section', { class: 'panel' },
      el('h2', {}, t('Jouw betaallink', 'Your payment link')),
      el('p', { class: 'muted' }, t('Maak een Tikkie (of ander betaalverzoek) zonder vast bedrag en plak de link hier. Ieder ziet hieronder in de app hoeveel hij jou moet betalen.',
        'Create a Tikkie (or another payment request) without a fixed amount and paste the link here. Everyone sees in the app how much they owe you.')),
      el('form', { class: 'inline', onsubmit: async (e) => {
        e.preventDefault();
        const v = tikkieVeld.value.trim();
        if (v && !/^https:\/\/\S+$/.test(v)) return alert(t('Plak een link die met https:// begint.', 'Paste a link that starts with https://.'));
        try { tikkieVeld.blur(); await opslag.zetBetalerVelden(datum, { tikkie: v }); zetStatus(t('✓ Betaallink opgeslagen', '✓ Payment link saved'), 'ok'); } catch (x) { fout(x); }
      } }, tikkieVeld, el('button', {}, t('Opslaan', 'Save')))),
    el('section', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, t('Wie heeft betaald?', 'Who has paid?')),
        nogTeOntvangen.some((b) => !b.betaald) ? el('button', { class: 'secondary', onclick: (e) => kopieer(herinnering(), e.target) }, t('Kopieer herinnering', 'Copy reminder')) : null),
      el('p', { class: 'muted' }, t('Vink "Ontvangen" aan zodra het geld op je rekening staat.', 'Tick "Received" once the money is in your account.')),
      betaalOverzicht(true),
      el('div', { class: 'sum' }, el('span', {}, t('Nog te ontvangen', 'Still to receive')), el('strong', {}, euro(openBedrag))),
      el('p', { class: 'muted klein' }, t(`Jouw eigen deel: ${euro(totaalVan(regelsVan(mijn())))} (hoef je niet over te maken).`,
        `Your own share: ${euro(totaalVan(regelsVan(mijn())))} (no need to transfer it).`))),
    el('section', { class: 'panel' },
      el('details', { open: (bonOpen ??= !!ronde.bonTekst) || undefined, ontoggle: (e) => { bonOpen = e.target.open; } }, el('summary', {}, el('h2', { class: 'inline-h2' }, t('Bon uitlezen en controleren', 'Read and check the receipt'))),
        meldingen === null ? null : meldingen.length
          ? el('ul', { class: 'meldingen' }, meldingen.map((m) => el('li', { class: 'm-' + m.soort }, m.tekst)))
          : el('p', { class: 'notice ok' }, t('Bon en bestellingen komen overeen.', 'Receipt and orders match.')),
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
      el('h2', {}, t(`Jij betaalt ${betaler} ${euro(bedrag)}`, `You pay ${betaler} ${euro(bedrag)}`)),
      ronde.tikkie
        ? el('a', { class: 'button groot', href: ronde.tikkie, target: '_blank', rel: 'noopener noreferrer' }, t(`Betalen via de link van ${betaler}`, `Pay via ${betaler}’s link`))
        : el('p', { class: 'muted' }, t(`${betaler} zet de betaallink er zo in.`, `${betaler} will add the payment link shortly.`)),
      el('button', { class: (m.betaald ? 'paid' : 'secondary') + ' groot', onclick: () => opslag.zetBetaald(datum, ik.id, !m.betaald).catch(fout) },
        m.betaald ? t('✓ Ik heb betaald', '✓ I have paid') : t('Ik heb betaald', 'I have paid')),
      el('p', { class: 'muted klein' }, m.ontvangen ? t(`✓ ${betaler} heeft het ontvangen. Klaar!`, `✓ ${betaler} has received it. All done!`)
        : m.betaald ? t(`Wacht op bevestiging van ${betaler}.`, `Waiting for ${betaler} to confirm.`)
          : t(`Betaald? Vink het aan; ${betaler} bevestigt het daarna.`, `Paid? Tick it; ${betaler} will confirm afterwards.`))));
  } else {
    blokken.push(el('section', { class: 'panel' }, el('p', { class: 'muted' }, t('Je deed deze keer niet mee.', 'You didn’t join this time.'))));
  }
  blokken.push(el('section', { class: 'panel' }, el('details', { open: overzichtOpen || undefined, ontoggle: (e) => { overzichtOpen = e.target.open; } }, el('summary', {}, t('Wie heeft er al betaald?', 'Who has paid already?')), betaalOverzicht(false))));
  return blokken;
}

// ---------------------------------------------------------------- 2. bestellen

function voegToe(p) {
  const bestaand = regels.find((r) => r.id === p.id && !r.opmerking);
  if (bestaand) bestaand.aantal = Math.min(MAX_AANTAL, bestaand.aantal + 1);
  else if (regels.length >= MAX_REGELS) return alert(t('Dat zijn wel heel veel regels.', 'That’s an awful lot of lines.'));
  else regels.push({ id: p.id, naam: p.naam, cents: p.cents, ...(p.statiegeld ? { statiegeld: p.statiegeld } : {}), ...(p.delen ? { delen: p.delen } : {}), aantal: 1, opmerking: '' });
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
  const kids = [el('h2', {}, t('Jouw bestelling', 'Your order'))];
  if (!lijst.length) kids.push(el('p', { class: 'muted' }, open ? t('Nog niets gekozen. Tik hieronder op + bij wat je wilt.', 'Nothing chosen yet. Tap + below next to what you want.')
    : t('Je hebt niets besteld.', 'You didn’t order anything.')));
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
        el('input', { class: 'opm', value: r.opmerking, placeholder: t('+ opmerking (bv. zonder ui)', '+ note (e.g. no onion)'), maxlength: 80, 'aria-label': t('Opmerking bij ', 'Note for ') + r.naam,
          oninput: (e) => { r.opmerking = e.target.value; plan(); } })),
      el('div', { class: 'stepper' },
        el('button', { class: 'secondary rond', 'aria-label': t('Eén minder', 'One less'), onclick: () => wijzig(-1) }, r.aantal === 1 ? '🗑' : '−'),
        el('span', { class: 'aantal' }, r.aantal),
        el('button', { class: 'secondary rond', 'aria-label': t('Eén meer', 'One more'), disabled: r.aantal >= MAX_AANTAL, onclick: () => wijzig(1) }, '+')),
      el('strong', { class: 'bedrag' }, euro((r.cents + (r.statiegeld || 0)) * r.aantal))));
  });
  kids.push(el('div', { class: 'sum' }, el('span', {}, t('Jouw totaal', 'Your total')), el('strong', {}, euro(totaalVan(lijst)))));
  if (lijst.some((r) => r.statiegeld)) kids.push(el('p', { class: 'muted klein' }, t('Inclusief statiegeld op blikjes/flesjes.', 'Including deposit on cans/bottles.')));
  mand.replaceChildren(...kids);
}

function menuSectie() {
  const sec = document.getElementById('menu');
  sec.hidden = !ronde?.open;
  if (sec.hidden || sec.childElementCount) return;
  const zoek = el('input', { type: 'search', id: 'zoek', placeholder: t('Zoek friet, snack, broodje…', 'Search fries, snacks, sandwiches…'), 'aria-label': t('Zoeken', 'Search'), oninput: filter });
  const chips = el('nav', { class: 'chips' }, menu.categorieen.map((c, i) =>
    el('a', { href: '#cat' + i, onclick: (e) => { e.preventDefault(); document.getElementById('cat' + i).scrollIntoView({ behavior: 'smooth' }); } }, c.naam)));
  const lijsten = menu.categorieen.map((c, i) => el('div', { class: 'categorie', id: 'cat' + i },
    el('h3', {}, c.naam),
    c.producten.map((p) => el('div', { class: 'product', 'data-zoek': (p.naam + ' ' + c.naam).toLowerCase() },
      el('div', {}, el('strong', {}, p.naam),
        el('span', { class: 'price' }, euro(p.cents), p.statiegeld ? el('small', {}, ` + ${euro(p.statiegeld)} ${t('statiegeld', 'deposit')}`) : null)),
      el('button', { class: 'rond plus', 'data-pid': p.id, 'aria-label': t(p.naam + ' toevoegen', 'Add ' + p.naam), onclick: () => voegToe(p) }, '+')))));
  const bijgewerkt = menu.bijgewerkt ? new Date(menu.bijgewerkt).toLocaleDateString(EN ? 'en-GB' : 'nl-NL', { day: 'numeric', month: 'long' }) : '?';
  sec.replaceChildren(el('section', { class: 'panel' }, el('h2', {}, t('Wat wil je?', 'What would you like?')),
    EN ? el('p', { class: 'muted klein' }, 'The menu is in Dutch, just like on the De Posthoorn website.') : null,
    zoek, chips, lijsten,
    el('p', { class: 'muted klein' }, t(`Menu en prijzen van de website van De Posthoorn, bijgewerkt ${bijgewerkt}.`, `Menu and prices from the De Posthoorn website, updated ${bijgewerkt}.`))));
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
    const naar = link(dt);
    if (r.betaler !== ik.id && regelsVan(m).length && !m.ontvangen) {
      const wat = m.betaald ? t('betaald, wacht op bevestiging', 'paid, awaiting confirmation') : t('nog betalen', 'still to pay');
      items.push(el('a', { class: 'week', href: naar }, el('strong', {}, dag(dt)),
        el('span', {}, `${wat}: ${euro(totaalVan(m.regels))} ${t('aan', 'to')} ${voornaam(naamVan(r.betaler))}`),
        el('span', {}, t('Bekijken →', 'View →'))));
    }
    const teBevestigen = r.betaler === ik.id ? bs.filter((b) => b.id !== ik.id && regelsVan(b).length && !b.ontvangen) : [];
    if (teBevestigen.length) {
      const n = teBevestigen.length;
      items.push(el('a', { class: 'week', href: naar }, el('strong', {}, dag(dt)),
        el('span', {}, t(`jij betaalde: nog ${n} ${n === 1 ? 'betaling' : 'betalingen'} te bevestigen`, `you paid: ${n} ${n === 1 ? 'payment' : 'payments'} left to confirm`)),
        el('span', {}, t('Bekijken →', 'View →'))));
    }
  }
  const sec = document.getElementById('eerder');
  sec.replaceChildren(...(items.length ? [el('section', { class: 'panel' }, el('h2', {}, t('Nog openstaand', 'Still open')), el('div', { class: 'stack' }, items))] : []));
}

// ---------------------------------------------------------------- start

function tekenAlles() {
  if (!rondeGeladen || !bestellingenGeladen) return;
  if (!mandGeladen && ronde) { regels = regelsVan(mijn()).map((r) => ({ ...r })); mandGeladen = true; }
  rondeSectie();
  mandSectie();
  menuSectie();
}

/** Taalknop rechtsboven en de vaste teksten onderaan in de gekozen taal. */
function taalInstellen() {
  document.querySelector('header').append(el('button', { class: 'secondary taalknop', title: t('Switch to English', 'Naar het Nederlands'), onclick: wisselTaal },
    EN ? 'NL' : 'EN'));
  if (!EN) return;
  const uitleg = document.getElementById('uitleglink');
  uitleg.textContent = '❓ How does it work?';
  uitleg.href = 'uitleg-en.html';
  document.getElementById('voettekst').textContent = 'Our own order list · not linked to De Posthoorn · prices from their website';
  app.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
}

async function start() {
  taalInstellen();
  if (DEMO) document.body.prepend(el('div', { class: 'demobalk' }, t('DEMO-modus: alles blijft in deze browser. Vul firebase-config.js in om echt te delen.',
    'DEMO mode: everything stays in this browser.')));
  if (!token) return bericht('FrietVrijdag', t('Open je persoonlijke bestellink. Die krijg je van degene die FrietVrijdag beheert.',
    'Open your personal order link. You get it from whoever runs FrietVrijdag.'));
  try {
    ik = await opslag.koppel(token);
    if (!ik) return bericht(t('Link werkt niet', 'Link doesn’t work'), t('Deze link is niet (meer) geldig. Vraag een nieuwe aan.', 'This link is not valid (any more). Ask for a new one.'));
    const [ds, m] = await Promise.all([opslag.deelnemers(), laadMenu()]);
    ds.forEach((d) => namen.set(d.id, d));
    menu = m;
  } catch (e) {
    console.error(e);
    return bericht(t('Er ging iets mis', 'Something went wrong'), t('Laden lukte niet. Controleer je internet en vernieuw de pagina.', 'Loading failed. Check your internet connection and refresh the page.'));
  }
  app.replaceChildren(
    el('div', { class: 'heading' }, el('div', {},
      el('p', { class: 'eyebrow' }, 'FRIETVRIJDAG · ' + dag(datum).toUpperCase()),
      el('h1', {}, `${t('Hoi', 'Hi')} ${voornaam(ik.naam)}`),
      datum !== vrijdag ? el('p', {}, el('a', { href: link() }, t('← Naar deze vrijdag', '← To this Friday'))) : null)),
    el('div', { id: 'eerder' }),
    el('div', { id: 'ronde' }),
    el('section', { class: 'panel', id: 'bestelling', hidden: true }),
    el('div', { id: 'menu', hidden: true }));
  opslag.volgRonde(datum, (r) => {
    const wasOpen = ronde?.open;
    ronde = r; rondeGeladen = true;
    if (wasOpen && r && !r.open && bewaarTimer) { clearTimeout(bewaarTimer); bewaarTimer = null; zetStatus(t('Bestelling is gesloten', 'The order is closed'), 'fout'); }
    tekenAlles();
  });
  opslag.volgBestellingen(datum, (b) => { bestellingen = b; bestellingenGeladen = true; tekenAlles(); });
  eerderSectie();
}

start();
