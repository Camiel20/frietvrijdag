// Leest het menu uit de HTML van De Posthoorn, met precies dezelfde regels als tools/haal_menu.py.
// Wijzig je hier iets, wijzig het daar ook (en andersom); tests/menu.test.js houdt ze gelijk.
// Geen DOM nodig, zodat het ook onder node (tests) draait.

export const BRON = 'https://deposthoorn.ultimatumapp.com/';
export const MINIMAAL = 50;
const OVERSLAAN = new Set(['populaire gerechten', 'contact', 'afrekenen', 'bedankt voor je bestelling!']);

// Combinaties die De Posthoorn niet als eigen product heeft, maar wel los verkoopt.
// [naam, categorie waarin hij komt, [namen van de onderdelen]]
export const COMBIS = [
  ['Broodje Bourgondische kroket', 'Broodjes', ['Los Broodje', 'Bourgondische kroket']],
  ['Broodje Bourgondische kroket met mosterd', 'Broodjes', ['Los Broodje', 'Bourgondische kroket', 'Mosterd']],
];

const KOP_RE = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
const KAART_RE = /<div\b[^>]*\bclass="[^"]*\bjs-product-card-content\b[^"]*"[^>]*>/gi;
const NAAM_RE = /class="[^"]*\bjs-product-card-name\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i;
const PRIJS_RE = /class="[^"]*\bjs-product-card-price\b[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/i;
const BEDRAG_RE = /(\d+)[,.](\d{2})/g;

const ENTITEITEN = {
  nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", times: '\u00d7', euro: '\u20ac',
  eacute: '\u00e9', egrave: '\u00e8', euml: '\u00eb', ecirc: '\u00ea', aacute: '\u00e1', agrave: '\u00e0',
  auml: '\u00e4', iuml: '\u00ef', ouml: '\u00f6', uuml: '\u00fc', ccedil: '\u00e7', ntilde: '\u00f1',
};

function ontsnap(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (heel, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return heel; }
    }
    return ENTITEITEN[e.toLowerCase()] ?? heel;
  });
}

function tekst(s) {
  return ontsnap(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attr(tag, naam) {
  // De site schrijft soms `data-deposit_amount = 0.15` (spaties, geen aanhalingstekens).
  const m = tag.match(new RegExp('\\b' + naam.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function centen(s) {
  const bedragen = [...(s || '').matchAll(BEDRAG_RE)];
  if (!bedragen.length) return null;
  const [, euro, ct] = bedragen[bedragen.length - 1]; // bij een actie staat de oude prijs eerst, de geldende laatst
  return Number(euro) * 100 + Number(ct);
}

export function parse(pagina) {
  // Koppen en kaartjes in documentvolgorde, zodat elk kaartje de laatste kop erboven krijgt.
  const gebeurtenissen = [
    ...[...pagina.matchAll(KOP_RE)].map((m) => [m.index, 'kop', m]),
    ...[...pagina.matchAll(KAART_RE)].map((m) => [m.index, 'kaart', m]),
  ].sort((a, b) => a[0] - b[0]);
  const starts = [...gebeurtenissen.filter((g) => g[1] === 'kaart').map((g) => g[0]), pagina.length];

  const categorieen = [], gezien = new Set();
  let huidig = null, kaartNr = 0;
  for (const [pos, soort, m] of gebeurtenissen) {
    if (soort === 'kop') {
      const naam = tekst(m[1]);
      huidig = OVERSLAAN.has(naam.toLowerCase()) ? null : { naam, producten: [] };
      if (huidig) categorieen.push(huidig);
      continue;
    }
    const stuk = pagina.slice(pos, starts[kaartNr + 1]);
    kaartNr += 1;
    if (!huidig) continue;
    const pid = attr(m[0], 'data-id');
    const naamM = stuk.match(NAAM_RE), prijsM = stuk.match(PRIJS_RE);
    if (!pid || gezien.has(pid) || !naamM || !prijsM) continue;
    const cents = centen(tekst(prijsM[1]));
    if (cents == null) continue;
    gezien.add(pid);
    const product = { id: pid, naam: tekst(naamM[1]), cents };
    const statiegeld = attr(m[0], 'data-deposit_amount');
    if (statiegeld) product.statiegeld = Math.round(parseFloat(statiegeld) * 100);
    huidig.producten.push(product);
  }
  return categorieen.filter((c) => c.producten.length);
}

/** Zet de COMBIS als product in hun categorie, met de onderdelen erbij (voor de bon-controle). */
export function voegCombisToe(categorieen) {
  const opNaam = new Map();
  for (const c of categorieen) for (const p of c.producten) if (!opNaam.has(p.naam.toLowerCase())) opNaam.set(p.naam.toLowerCase(), p);
  for (const [naam, categorie, onderdelen] of COMBIS) {
    const delen = onderdelen.map((o) => opNaam.get(o.toLowerCase()));
    const doel = categorieen.find((c) => c.naam.toLowerCase() === categorie.toLowerCase());
    if (!doel || !delen.every(Boolean) || delen.some((p) => p.statiegeld)) continue;
    if (doel.producten.some((p) => p.naam.toLowerCase() === naam.toLowerCase())) continue; // De Posthoorn heeft hem inmiddels zelf
    doel.producten.push({
      id: 'combi-' + delen.map((p) => p.id).join('-'),
      naam,
      cents: delen.reduce((s, p) => s + p.cents, 0),
      delen: delen.map((p) => ({ naam: p.naam, cents: p.cents })),
    });
  }
  return categorieen;
}

/** Het menu uit de pagina, of null als het er niet betrouwbaar uitziet (te weinig producten). */
export function menuUitPagina(pagina) {
  const categorieen = voegCombisToe(parse(pagina));
  const aantal = categorieen.reduce((s, c) => s + c.producten.length, 0);
  return aantal < MINIMAAL ? null : { bron: BRON, categorieen };
}
