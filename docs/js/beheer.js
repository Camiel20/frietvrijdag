// Beheerpagina: beheer.html (inloggen met Google; alleen wie in beheer/{uid} staat)
// Dagelijks loopt alles via de bestelpagina; hier beheer je de vaste lijst en grijp je in als het nodig is.
//   #               rondes
//   #r=<datum>      één ronde: bestellijst, betaler, betalingen, regels, bon-controle
//   #bon=<datum>    bon uitlezen
//   #deelnemers     vaste lijst collega's + hun links
import { DEMO, bestelLink, el, laadMenu, opslag } from './opslag.js';
import { besteldeRegels, bestellijst, euro, leesBon, parseEuro, totaalVan, vergelijk } from './bon.js';
import { datumTekst, komendeVrijdag } from './datum.js';
import { bonPaneel } from './bonui.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
let opruimen = [];
let menuCache = null;
const menu = async () => (menuCache ??= await laadMenu());

function toon(...kids) { app.replaceChildren(...kids); }
function fout(e) { console.error(e); alert('Dat lukte niet: ' + (e?.message || e)); }

async function kopieer(tekst, knop) {
  try { await navigator.clipboard.writeText(tekst); } catch { prompt('Kopieer:', tekst); return; }
  if (knop) { const oud = knop.textContent; knop.textContent = 'Gekopieerd ✓'; setTimeout(() => (knop.textContent = oud), 1500); }
}

async function namenMap() {
  return new Map((await opslag.deelnemers()).map((d) => [d.id, d]));
}

// ================================================================ rondes

async function rondesScherm() {
  const [rondes, namen] = await Promise.all([opslag.rondes(), namenMap()]);
  const naam = (id) => namen.get(id)?.naam || '—';
  const datum = el('input', { type: 'date', value: komendeVrijdag(), required: true });
  toon(
    el('div', { class: 'heading' }, el('div', {}, el('h1', {}, 'Bestelrondes'),
      el('p', { class: 'muted' }, 'Collega\'s openen zelf een ronde via hun link (één per vrijdag). Hier kun je er ook een aanmaken.'))),
    el('section', { class: 'panel' }, el('h2', {}, 'Ronde aanmaken'),
      el('form', { class: 'inline', onsubmit: async (e) => {
        e.preventDefault();
        try { await opslag.maakRonde(datum.value); location.hash = 'r=' + datum.value; } catch (x) { fout(x); }
      } }, datum, el('button', {}, 'Aanmaken / openen'))),
    el('section', { class: 'panel' }, el('h2', {}, 'Historie'),
      rondes.length ? el('div', { class: 'stack' }, rondes.map((r) => el('a', { class: 'week', href: '#r=' + r.datum },
        el('strong', {}, datumTekst(r.datum, true)),
        el('span', {}, r.open ? 'Open' : r.betaler ? `${naam(r.betaler)} betaalde` : 'Gesloten'),
        el('span', {}, 'Openen →')))) : el('p', { class: 'muted' }, 'Nog geen rondes.')));
}

// ================================================================ één ronde

async function rondeScherm(datum) {
  const namen = await namenMap();
  let ronde = null, bestellingen = [];
  const teken = () => { if (ronde) tekenRonde(ronde, bestellingen, namen); };
  opruimen.push(opslag.volgRonde(datum, (r) => { ronde = r; if (!r) toon(el('p', {}, 'Ronde niet gevonden.')); else teken(); }));
  opruimen.push(opslag.volgBestellingen(datum, (b) => { bestellingen = b; teken(); }));
}

function tekenRonde(ronde, bestellingen, namen) {
  // Niet hertekenen terwijl je in een formulier typt.
  const actiefVeld = document.activeElement;
  if (actiefVeld && app.contains(actiefVeld) && /INPUT|TEXTAREA|SELECT/.test(actiefVeld.tagName)) return;

  const datum = ronde.datum;
  const naam = (id) => namen.get(id)?.naam || '?';
  const actief = bestellingen.filter((b) => (b.regels || []).length).map((b) => ({ ...b, naam: naam(b.id) }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  const totaal = actief.reduce((s, b) => s + totaalVan(b.regels), 0);
  const ontvangen = actief.filter((b) => b.ontvangen || b.id === ronde.betaler).reduce((s, b) => s + totaalVan(b.regels), 0);
  const lijst = bestellijst(actief);
  const lijstTekst = lijst.map((g) => `${g.aantal}x ${g.naam}${g.opmerking ? ` (${g.opmerking})` : ''}`).join('\n');
  const bon = leesBon(ronde.bonTekst);
  const meldingen = vergelijk(besteldeRegels(actief), bon.regels, ronde.bonTotaal ?? null, totaal);
  const heeftBon = ronde.bonTotaal != null || ronde.bonTekst;

  const kop = el('div', { class: 'heading' },
    el('div', {}, el('p', { class: 'eyebrow' }, 'BESTELRONDE'), el('h1', {}, datumTekst(datum, true)),
      el('p', { class: 'muted' }, ronde.open ? 'Open: collega\'s kunnen bestellen.'
        : ronde.betaler ? `Gesloten. ${naam(ronde.betaler)} betaalt (gedraaid door ${naam(ronde.gedraaidDoor)}).` : 'Gesloten, nog niet gedraaid.'),
      ronde.tikkie ? el('p', { class: 'muted klein' }, 'Betaallink: ', el('a', { href: ronde.tikkie, target: '_blank', rel: 'noopener noreferrer' }, ronde.tikkie)) : null),
    el('div', { class: 'actions' },
      ronde.betaler ? el('button', { class: 'secondary', onclick: () => {
        if (!confirm('Rad terugzetten? De ronde gaat weer open en er moet opnieuw gedraaid worden.')) return;
        opslag.wijzigRonde(datum, { betaler: null, gedraaidDoor: null, gedraaidOp: null, open: true }).catch(fout);
      } }, 'Rad terugzetten') : el('button', { class: ronde.open ? 'danger' : 'secondary', onclick: () => opslag.wijzigRonde(datum, { open: !ronde.open }).catch(fout) },
        ronde.open ? 'Sluiten zonder rad' : 'Weer openen'),
      el('button', { class: 'danger', onclick: async (e) => {
        const n = bestellingen.length;
        if (!confirm(`Ronde van ${datumTekst(datum, true)} helemaal verwijderen?

`
          + `Dit haalt de ronde én ${n} bestelling${n === 1 ? '' : 'en'} weg (ook betaald/ontvangen). Dit kan niet ongedaan worden.

`
          + 'Daarna kan iemand voor deze vrijdag opnieuw een bestelling openen.')) return;
        e.target.disabled = true;
        try { await opslag.verwijderRonde(datum); location.hash = ''; } catch (err) { e.target.disabled = false; fout(err); }
      } }, '🗑 Ronde verwijderen'),
      el('a', { class: 'button secondary', href: '#' }, '← Rondes')));

  const stats = el('div', { class: 'stats' },
    el('section', {}, el('small', {}, 'Besteld'), el('strong', {}, euro(totaal))),
    el('section', {}, el('small', {}, 'Binnen (incl. betaler)'), el('strong', { class: 'green' }, euro(ontvangen))),
    el('section', {}, el('small', {}, 'Nog te ontvangen'), el('strong', {}, euro(totaal - ontvangen))),
    el('section', {}, el('small', {}, 'Kassabon'), ronde.bonTotaal == null ? el('strong', { class: 'muted-strong' }, 'nog niet')
      : el('strong', { class: ronde.bonTotaal === totaal ? 'green' : 'warn' }, euro(ronde.bonTotaal))));

  const lijstPaneel = el('section', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Bestellijst voor de frituur'),
      lijst.length ? el('button', { class: 'secondary', onclick: (e) => kopieer(lijstTekst, e.target) }, 'Kopieer') : null),
    lijst.length ? lijst.map((g) => el('div', { class: 'line' },
      el('div', {}, el('strong', {}, `${g.aantal} × ${g.naam}`), g.opmerking ? el('small', {}, g.opmerking) : null),
      el('small', { class: 'who' }, g.wie.join(', ')))) : el('p', { class: 'muted' }, 'Nog niemand heeft besteld.'));

  const personen = el('section', { class: 'panel' }, el('h2', {}, `Per persoon (${actief.length})`),
    el('p', { class: 'muted klein' }, '"Zegt betaald" zet de collega zelf; "Ontvangen" zet de betaler. Hier kun je beide corrigeren.'),
    actief.length ? actief.map((b) => el('div', { class: 'persoonblok' },
      el('div', { class: 'person' },
        el('div', {}, el('strong', {}, b.naam + (b.id === ronde.betaler ? ' 💳' : '')), el('small', {}, euro(totaalVan(b.regels)))),
        b.id === ronde.betaler ? el('span', { class: 'chip ok' }, 'betaalt de rekening') : el('div', { class: 'actions' },
          el('button', { class: b.betaald ? 'paid' : 'secondary', onclick: () => opslag.zetBestelling(datum, b.id, { betaald: !b.betaald }).catch(fout) },
            b.betaald ? '✓ Zegt betaald' : 'Zegt betaald?'),
          el('button', { class: b.ontvangen ? 'paid' : 'secondary', onclick: () => opslag.zetBestelling(datum, b.id, { ontvangen: !b.ontvangen }).catch(fout) },
            b.ontvangen ? '✓ Ontvangen' : 'Ontvangen?'))),
      b.regels.map((r, i) => el('div', { class: 'subregel' },
        el('span', {}, `${r.aantal} × ${r.naam}`, r.opmerking ? el('small', {}, ' — ' + r.opmerking) : null),
        el('span', {}, euro((r.cents + (r.statiegeld || 0)) * r.aantal),
          el('button', { class: 'tiny danger', 'aria-label': 'Regel weghalen', onclick: () => {
            if (!confirm(`${r.naam} weghalen bij ${b.naam}?`)) return;
            opslag.zetBestelling(datum, b.id, { regels: b.regels.filter((_, j) => j !== i) }).catch(fout);
          } }, '×')))))) : el('p', { class: 'muted' }, 'Nog geen bestellingen.'),
    toevoegForm(datum, namen, bestellingen));

  const controle = el('section', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Bon controleren'),
      el('a', { class: 'button', href: '#bon=' + datum }, heeftBon ? 'Bon opnieuw' : 'Bon uitlezen')),
    !heeftBon ? el('p', { class: 'muted' }, 'Nog geen bon. De betaler kan hem ook zelf uitlezen op zijn bestelpagina.')
      : meldingen.length ? [el('p', { class: 'muted' }, 'Verschillen tussen bon en bestellingen. Er wordt niets automatisch verdeeld.'),
        el('ul', { class: 'meldingen' }, meldingen.map((m) => el('li', { class: 'm-' + m.soort }, m.tekst)))]
        : el('p', { class: 'notice ok' }, 'Bon en bestellingen komen overeen.'));

  const notities = el('textarea', { rows: 3, placeholder: 'Alleen voor jou als beheerder' });
  notities.value = ronde.notities || '';
  const notitiePaneel = el('section', { class: 'panel' }, el('h2', {}, 'Notities'), notities,
    el('button', { onclick: (e) => opslag.wijzigRonde(datum, { notities: notities.value.slice(0, 1000) })
      .then(() => { e.target.textContent = 'Opgeslagen ✓'; setTimeout(() => (e.target.textContent = 'Opslaan'), 1500); }).catch(fout) }, 'Opslaan'));

  toon(kop, stats, el('div', { class: 'columns' }, el('div', {}, lijstPaneel, personen), el('div', {}, controle, notitiePaneel)));
}

function toevoegForm(datum, namen, bestellingen) {
  const wie = el('select', { required: true, 'aria-label': 'Voor wie' },
    el('option', { value: '' }, 'Voor wie…'),
    [...namen.values()].filter((d) => d.actief).sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))
      .map((d) => el('option', { value: d.id }, d.naam)));
  const product = el('input', { list: 'menulijst', placeholder: 'Product (typ om te zoeken)', required: true, 'aria-label': 'Product' });
  const prijs = el('input', { placeholder: 'prijs', inputmode: 'decimal', class: 'kort', 'aria-label': 'Prijs' });
  const aantal = el('input', { type: 'number', value: 1, min: 1, max: 20, class: 'kort', 'aria-label': 'Aantal' });
  const datalist = el('datalist', { id: 'menulijst' });
  const alle = async () => (await menu()).categorieen.flatMap((c) => c.producten);
  menu().then((m) => datalist.append(...m.categorieen.flatMap((c) => c.producten.map((p) => el('option', { value: p.naam }, euro(p.cents))))));
  product.addEventListener('change', async () => {
    const p = (await alle()).find((x) => x.naam === product.value);
    if (p) prijs.value = (p.cents / 100).toFixed(2).replace('.', ',');
  });
  return el('details', { class: 'toevoegen' }, el('summary', {}, 'Regel toevoegen voor iemand'),
    el('form', { class: 'toevoegrij', onsubmit: async (e) => {
      e.preventDefault();
      let cents;
      try { cents = parseEuro(prijs.value); } catch { return alert('Vul een geldige prijs in.'); }
      const p = (await alle()).find((x) => x.naam === product.value);
      const huidig = bestellingen.find((b) => b.id === wie.value)?.regels || [];
      const regel = { id: p?.id || 'hand', naam: product.value.trim().slice(0, 120), cents, aantal: Math.max(1, Math.min(20, +aantal.value || 1)), opmerking: '' };
      if (p?.statiegeld) regel.statiegeld = p.statiegeld;
      if (p?.delen) regel.delen = p.delen;
      try { document.activeElement?.blur(); await opslag.zetBestelling(datum, wie.value, { regels: [...huidig, regel] }); } catch (x) { fout(x); }
    } }, wie, product, datalist, prijs, aantal, el('button', {}, 'Toevoegen')));
}

// ================================================================ bon uitlezen

async function bonScherm(datum) {
  const ronde = (await opslag.rondes()).find((r) => r.datum === datum);
  if (!ronde) return toon(el('p', {}, 'Ronde niet gevonden.'));
  toon(
    el('div', { class: 'heading' }, el('div', {}, el('p', { class: 'eyebrow' }, datumTekst(datum, true).toUpperCase()), el('h1', {}, 'Bon uitlezen')),
      el('a', { class: 'button secondary', href: '#r=' + datum }, '← Terug')),
    el('section', { class: 'panel' }, bonPaneel({
      tekst: ronde.bonTekst || '',
      opslaan: async (bonTekst, bonTotaal) => { await opslag.wijzigRonde(datum, { bonTekst, bonTotaal }); location.hash = 'r=' + datum; },
    })));
}

// ================================================================ deelnemers

/** Persoonlijk berichtje voor WhatsApp: eigen link + uitleg. taal 'en' = Engelse link, uitleg en tekst. */
function welkomBericht(d, taal = 'nl') {
  const voornaam = d.naam.split(' ')[0];
  const uitleg = new URL(taal === 'en' ? 'uitleg-en.html' : 'uitleg.html', location.href).href.split('#')[0];
  if (taal === 'en') {
    return `Hi ${voornaam}! 🍟 This is your own FrietVrijdag link:
${bestelLink(d.token, null, 'en')}

`
      + `Use it to order your fries on Friday; a wheel decides who pays. Add it to your home screen and don't share it (whoever has the link orders as you).
`
      + `How it works: ${uitleg}`;
  }
  return `Hoi ${voornaam}! 🍟 Dit is jouw eigen FrietVrijdag-link:
${bestelLink(d.token)}

`
    + `Hiermee bestel je op vrijdag je friet; het rad bepaalt wie betaalt. Zet hem op je beginscherm en deel hem niet (wie de link heeft, bestelt als jou).
`
    + `Zo werkt het: ${uitleg}`;
}

async function deelnemersScherm() {
  const lijst = await opslag.deelnemersMetLinks();
  const namen = el('textarea', { rows: 4, placeholder: 'Eén naam per regel' });
  const actief = lijst.filter((d) => d.actief && d.token);
  const alleLinks = actief.map((d) => `${d.naam}: ${bestelLink(d.token)}`).join('\n');
  toon(
    el('div', { class: 'heading' }, el('div', {}, el('h1', {}, 'Deelnemers'),
      el('p', { class: 'muted' }, 'De vaste lijst. Ieder heeft een eigen link: wie de link heeft, bestelt als die persoon. Stuur hem dus alleen naar die collega.'))),
    el('section', { class: 'panel' }, el('h2', {}, 'Collega\'s toevoegen'),
      el('form', { onsubmit: async (e) => {
        e.preventDefault();
        const bestaand = new Set(lijst.map((d) => d.naam.toLowerCase()));
        const nieuw = [...new Set(namen.value.split('\n').map((n) => n.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean))]
          .filter((n) => !bestaand.has(n.toLowerCase()));
        try { for (const n of nieuw) await opslag.voegDeelnemerToe(n); deelnemersScherm(); } catch (x) { fout(x); }
      } }, namen, el('button', {}, 'Toevoegen'))),
    el('section', { class: 'panel' },
      el('div', { class: 'panel-head' }, el('h2', {}, `Links (${actief.length} actief)`),
        actief.length ? el('button', { class: 'secondary', onclick: (e) => kopieer(alleLinks, e.target) }, 'Kopieer alle links') : null),
      lijst.length ? lijst.map((d) => el('div', { class: 'person' + (d.actief ? '' : ' inactive') },
        el('div', { class: 'grow' }, el('strong', {}, d.naam),
          d.actief && d.token ? el('input', { class: 'link-field', readonly: true, value: bestelLink(d.token), onclick: (e) => e.target.select() })
            : el('small', {}, d.actief ? 'geen link: maak een nieuwe' : 'uitgezet: link werkt niet')),
        el('div', { class: 'actions' },
          d.actief && d.token ? el('button', { class: 'secondary', onclick: (e) => kopieer(bestelLink(d.token), e.target) }, 'Kopieer') : null,
          d.actief && d.token ? el('button', { class: 'secondary', onclick: (e) => kopieer(welkomBericht(d), e.target) }, 'Kopieer bericht') : null,
          d.actief && d.token ? el('button', { class: 'secondary', title: 'Hetzelfde bericht in het Engels, met een link die de app in het Engels opent',
            onclick: (e) => kopieer(welkomBericht(d, 'en'), e.target) }, 'Bericht EN') : null,
          el('button', { class: 'secondary', onclick: async () => {
            const nieuw = prompt('Naam (voor- en achternaam):', d.naam)?.replace(/\s+/g, ' ').trim().slice(0, 80);
            if (!nieuw || nieuw === d.naam) return;
            try { await opslag.hernoem(d.id, nieuw); deelnemersScherm(); } catch (x) { fout(x); }
          } }, 'Naam'),
          el('button', { class: 'secondary', onclick: async () => {
            if (!confirm(`Nieuwe link voor ${d.naam}? De oude werkt dan niet meer.`)) return;
            try { await opslag.nieuweLink(d.id); deelnemersScherm(); } catch (x) { fout(x); }
          } }, 'Nieuwe link'),
          el('button', { class: d.actief ? 'danger' : 'secondary', onclick: async () => {
            try { await opslag.zetActief(d.id, !d.actief); deelnemersScherm(); } catch (x) { fout(x); }
          } }, d.actief ? 'Uitzetten' : 'Aanzetten')))) : el('p', { class: 'muted' }, 'Nog niemand. Voeg hierboven de vaste lijst toe.')));
}

// ================================================================ router + inloggen

async function route() {
  opruimen.forEach((f) => f());
  opruimen = [];
  const h = new URLSearchParams(location.hash.slice(1));
  try {
    if (h.has('r')) await rondeScherm(h.get('r'));
    else if (h.has('bon')) await bonScherm(h.get('bon'));
    else if (location.hash === '#deelnemers') await deelnemersScherm();
    else await rondesScherm();
  } catch (e) {
    console.error(e);
    toon(el('section', { class: 'panel' }, el('h2', {}, 'Er ging iets mis'), el('p', { class: 'muted' }, String(e.message || e))));
  }
  window.scrollTo(0, 0);
}

function zetNav(user) {
  nav.replaceChildren(...(user ? [
    el('a', { href: '#' }, 'Rondes'),
    el('a', { href: '#deelnemers' }, 'Deelnemers'),
    DEMO ? null : el('a', { href: '#', onclick: (e) => { e.preventDefault(); opslag.logout(); } }, 'Uitloggen'),
  ] : []).filter(Boolean));
}

if (DEMO) document.body.prepend(el('div', { class: 'demobalk' }, 'DEMO-modus: alles blijft in deze browser. Vul firebase-config.js in om echt te delen.'));

let gestart = false;
opslag.gebruiker(async (user) => {
  zetNav(null);
  if (!user || user.isAnonymous) {
    return toon(el('section', { class: 'panel narrow' }, el('h1', {}, 'Beheer'),
      el('p', { class: 'muted' }, 'Log in met het Google-account dat beheerder is.'),
      el('button', { onclick: () => opslag.login().catch(fout) }, 'Inloggen met Google')));
  }
  if (!(await opslag.isBeheerder(user.uid))) {
    const uid = el('code', {}, user.uid);
    return toon(el('section', { class: 'panel narrow' }, el('h1', {}, 'Nog geen beheerder'),
      el('p', {}, 'Je bent ingelogd, maar dit account staat nog niet op de lijst. Maak in de Firebase-console (Firestore) een document aan:'),
      el('p', {}, 'Collectie ', el('code', {}, 'beheer'), ', document-ID ', uid, ' (veld bijv. ', el('code', {}, 'naam'), ').'),
      el('button', { class: 'secondary', onclick: (e) => kopieer(user.uid, e.target) }, 'Kopieer ID'),
      el('p', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); opslag.logout(); } }, 'Uitloggen'))));
  }
  zetNav(user);
  if (!gestart) { gestart = true; window.addEventListener('hashchange', route); }
  route();
});
