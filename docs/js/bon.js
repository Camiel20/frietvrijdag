// Kassabon-tekst (uit OCR) omzetten naar regels en vergelijken met de bestellingen.
// Verdeelt niets: verschillen worden alleen gemeld.

const BEDRAG_RE = /(-?)\s*€?\s*(\d{1,4}[.,]\d{2})\s*(?:EUR)?\s*$/i;
const AANTAL_RE = /^\s*(\d{1,2})\s*(?:[xX×*]\s*)?(?=\D)/;
// Hele woorden, anders valt 'pin' over 'pindasaus' en 'tel' over 'kotelet'.
const TOTAAL_RE = /\b(te betalen|totaal|total)\b/i;
const OVERSLAAN_RE = /\b(sub ?totaal|subtotal|btw|b\.t\.w|pin|contant|wisselgeld|retour|terug|maestro|visa|mastercard|v ?pay|kaart|bancontact|betaald|fooi|kvk|tel|bon ?nr|tafel|transactie|terminal|auth|datum|tijd)\b/i;
// Veelvoorkomende OCR-fouten: een 1 wordt l, I, | of Ll; een 0 wordt O.
const OCR_AANTAL_RE = /^[lIi|!L]{1,2}(?=\s+[A-Za-z])/;
const OCR_BEDRAG_RE = /([0-9OolI]{1,4}[.,][0-9OolI]{2})\s*(?:EUR)?\s*$/;

export function euro(c) {
  const teken = c < 0 ? '-' : '';
  const [heel, dec] = (Math.abs(c) / 100).toFixed(2).split('.');
  return `${teken}€ ${heel.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

/** '3,50' / '3.50' / '€ 1.234,50' / '1,234.50' -> centen. Gooit bij onzin. */
export function parseEuro(waarde) {
  let s = String(waarde ?? '').trim().replace(/€/g, '').replace(/\s/g, '');
  if (!s) throw new Error('leeg bedrag');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(',', '.');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`ongeldig bedrag: ${waarde}`);
  return Math.round(parseFloat(s) * 100);
}

export function normaliseer(naam) {
  return naam.toLowerCase()
    .replace(/mayonaise/g, 'mayo').replace(/satésaus|satesaus/g, 'sate')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function ocrHerstel(regel) {
  regel = regel.replace(OCR_AANTAL_RE, '1');
  const m = regel.match(OCR_BEDRAG_RE);
  if (m) {
    const goed = m[1].replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
    regel = regel.slice(0, m.index) + goed + regel.slice(m.index + m[1].length);
  }
  return regel;
}

/** -> { regels: [{aantal, naam, cents, regelCents}], totaal: centen|null } */
export function leesBon(tekst) {
  const regels = [];
  const totalen = {};
  for (const ruw of String(tekst || '').split(/\r?\n/)) {
    const regel = ocrHerstel(ruw.trim());
    if (!regel) continue;
    const m = regel.match(BEDRAG_RE);
    if (!m) continue;
    const bedrag = parseEuro(m[2]) * (m[1] ? -1 : 1);
    let label = regel.slice(0, m.index).replace(/^[\s.:\-\t]+|[\s.:\-\t]+$/g, '');
    const laag = label.toLowerCase();
    if (TOTAAL_RE.test(laag) && !laag.includes('sub')) {
      totalen[laag.includes('betalen') ? 'te betalen' : 'totaal'] = bedrag; // laatste wint
      continue;
    }
    if (!label || OVERSLAAN_RE.test(laag)) continue;
    let aantal = 1;
    const a = label.match(AANTAL_RE);
    if (a) {
      aantal = parseInt(a[1], 10);
      label = label.slice(a[0].length).replace(/^[\s.:\-]+|[\s.:\-]+$/g, '');
    }
    if (label.length < 2 || aantal < 1) continue;
    regels.push({ aantal, naam: label, cents: Math.round(bedrag / aantal), regelCents: bedrag });
  }
  const totaal = totalen['te betalen'] ?? totalen['totaal'] ?? null;
  return { regels, totaal };
}

function lijkt(a, b) {
  // Dice-coëfficiënt op letterparen: genoeg om "friet mayo" en "friet mayonaise" te koppelen.
  if (a === b) return 1;
  const paren = (s) => { const r = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); r.set(p, (r.get(p) || 0) + 1); } return r; };
  const pa = paren(a), pb = paren(b);
  let gedeeld = 0;
  for (const [p, n] of pa) gedeeld += Math.min(n, pb.get(p) || 0);
  const totaal = Math.max(1, a.length - 1) + Math.max(1, b.length - 1);
  return (2 * gedeeld) / totaal;
}

/**
 * Meldingen bij verschillen tussen bestellingen en bon.
 * besteld: [{naam, aantal, cents}] (per regel; wordt hier per product opgeteld)
 */
export function vergelijk(besteld, bonRegels, bonTotaal, besteldTotaal, taal = 'nl') {
  const t = (nl, en) => (taal === 'en' ? en : nl);
  const meldingen = [];
  if (bonTotaal != null && bonTotaal !== besteldTotaal) {
    meldingen.push({ soort: 'totaal', tekst: t(`Bon ${euro(bonTotaal)}, bestellingen ${euro(besteldTotaal)}: verschil ${euro(bonTotaal - besteldTotaal)}.`,
      `Receipt ${euro(bonTotaal)}, orders ${euro(besteldTotaal)}: difference ${euro(bonTotaal - besteldTotaal)}.`) });
  }
  if (!bonRegels.length) return meldingen;

  const optellen = (lijst) => {
    const r = new Map();
    for (const x of lijst) {
      const k = normaliseer(x.naam);
      const p = r.get(k) || { naam: x.naam, aantal: 0, cents: x.cents };
      p.aantal += x.aantal;
      r.set(k, p);
    }
    return r;
  };
  const producten = optellen(besteld);
  const bon = optellen(bonRegels);

  const open = new Set(producten.keys());
  for (const [bk, b] of bon) {
    let beste = null, score = 0;
    for (const ok of open) { const s = lijkt(bk, ok); if (s > score) { beste = ok; score = s; } }
    if (beste === null || score < 0.6) {
      meldingen.push({ soort: 'bon', tekst: t(`Op de bon, niet besteld: ${b.aantal} × ${b.naam} (${euro(b.cents)}).`,
        `On the receipt, not ordered: ${b.aantal} × ${b.naam} (${euro(b.cents)}).`) });
      continue;
    }
    open.delete(beste);
    const p = producten.get(beste);
    if (p.aantal !== b.aantal) meldingen.push({ soort: 'aantal', tekst: t(`${p.naam}: besteld ${p.aantal}, op de bon ${b.aantal}.`, `${p.naam}: ordered ${p.aantal}, on the receipt ${b.aantal}.`) });
    if (p.cents !== b.cents) meldingen.push({ soort: 'prijs', tekst: t(`${p.naam}: menuprijs ${euro(p.cents)}, bonprijs ${euro(b.cents)}.`, `${p.naam}: menu price ${euro(p.cents)}, receipt price ${euro(b.cents)}.`) });
  }
  for (const ok of [...open].sort()) {
    const p = producten.get(ok);
    meldingen.push({ soort: 'besteld', tekst: t(`Besteld, niet op de bon gevonden: ${p.aantal} × ${p.naam}.`, `Ordered, not found on the receipt: ${p.aantal} × ${p.naam}.`) });
  }
  return meldingen;
}

/** Bestellijst voor de frituur: per product + opmerking opgeteld. */
export function bestellijst(bestellingen) {
  const g = new Map();
  for (const b of bestellingen) {
    for (const r of b.regels || []) {
      const opm = (r.opmerking || '').trim();
      const k = `${r.naam}\u0000${opm}`;
      const x = g.get(k) || { naam: r.naam, opmerking: opm, aantal: 0, wie: [] };
      x.aantal += r.aantal;
      x.wie.push(String(b.naam || '').split(' ')[0]);
      g.set(k, x);
    }
  }
  return [...g.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl') || a.opmerking.localeCompare(b.opmerking, 'nl'));
}

/** Totaal van iemands regels, inclusief statiegeld. */
export function totaalVan(regels) {
  return (regels || []).reduce((s, r) => s + (r.cents + (r.statiegeld || 0)) * r.aantal, 0);
}

/** Alle bestelde regels plat, met statiegeld als eigen product (zo staat het meestal ook op de bon). */
export function besteldeRegels(bestellingen) {
  const uit = [];
  let statiegeld = 0, sgPrijs = 0;
  for (const b of bestellingen) {
    for (const r of b.regels || []) {
      uit.push({ naam: r.naam, aantal: r.aantal, cents: r.cents });
      if (r.statiegeld) { statiegeld += r.aantal; sgPrijs = r.statiegeld; }
    }
  }
  if (statiegeld) uit.push({ naam: 'Statiegeld', aantal: statiegeld, cents: sgPrijs });
  return uit;
}
