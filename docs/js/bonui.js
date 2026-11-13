// Bon uitlezen: foto → OCR in de browser (Tesseract.js) → tekst nakijken → opslaan.
// Gebruikt door de betaler (bestelpagina) en de beheerder.
import { el } from './opslag.js';
import { euro, leesBon, parseEuro } from './bon.js';

let tesseract = null;
function laadTesseract() {
  return (tesseract ??= new Promise((ok, nok) => {
    const s = el('script', { src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js' });
    s.onload = () => ok(window.Tesseract);
    s.onerror = () => { tesseract = null; nok(new Error('OCR-bibliotheek laadde niet')); };
    document.head.append(s);
  }));
}

// Foto naar ~1800 px breed, grijs en wat meer contrast: dat leest Tesseract beter.
function bewerkFoto(bitmap) {
  const c = document.createElement('canvas');
  const schaal = Math.min(3, 1800 / bitmap.width);
  c.width = Math.round(bitmap.width * schaal);
  c.height = Math.round(bitmap.height * schaal);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const g = Math.max(0, Math.min(255, (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2] - 128) * 1.5 + 140));
    p[i] = p[i + 1] = p[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/**
 * @param {{tekst: string, opslaan: (tekst: string, totaal: number|null) => Promise<void>}} opties
 * @returns {HTMLElement}
 */
export function bonPaneel({ tekst: begin = '', opslaan }) {
  const status = el('p', { class: 'muted bonstatus' }, 'Recht van boven, goed licht, hele bon in beeld. De foto blijft op dit apparaat.');
  const voortgang = el('progress', { max: 1, value: 0, hidden: true });
  const tekst = el('textarea', { rows: 12, spellcheck: 'false', class: 'mono', 'aria-label': 'Tekst van de bon' });
  tekst.value = begin;
  const totaalVeld = el('input', { inputmode: 'decimal', placeholder: 'uit de tekst' });
  const voorbeeld = el('div', { class: 'bonvoorbeeld' });

  const ververs = () => {
    const { regels, totaal } = leesBon(tekst.value);
    voorbeeld.replaceChildren(
      ...(regels.length ? regels.map((r) => el('div', { class: 'line' },
        el('div', {}, el('strong', {}, `${r.aantal} × ${r.naam}`), el('small', {}, 'per stuk ' + euro(r.cents))),
        el('strong', {}, euro(r.regelCents)))) : [el('p', { class: 'muted' }, 'Nog geen productregels herkend.')]),
      el('div', { class: 'sum' }, el('span', {}, 'Som regels'), el('strong', {}, euro(regels.reduce((s, r) => s + r.regelCents, 0)))),
      el('div', { class: 'sum' }, el('span', {}, 'Totaal op bon'), el('strong', {}, totaal != null ? euro(totaal) : 'niet gevonden')));
  };
  tekst.addEventListener('input', ververs);

  const foto = el('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: async (e) => {
    const bestand = e.target.files[0];
    if (!bestand) return;
    voortgang.hidden = false; voortgang.value = 0; status.textContent = 'Foto laden…';
    let worker;
    try {
      // createImageBitmap zet een telefoonfoto meteen rechtop (EXIF-draaiing).
      const bitmap = await createImageBitmap(bestand, { imageOrientation: 'from-image' });
      const canvas = bewerkFoto(bitmap);
      bitmap.close();
      const T = await laadTesseract();
      worker = await T.createWorker('nld', 1, { logger: (m) => {
        if (m.status === 'recognizing text') { voortgang.value = m.progress; status.textContent = `Lezen… ${Math.round(m.progress * 100)}%`; }
        else status.textContent = m.status + '…';
      } });
      const { data } = await worker.recognize(canvas);
      tekst.value = data.text.trim();
      status.textContent = 'Klaar. Kijk de tekst na en sla op.';
      ververs();
    } catch (x) {
      console.error(x);
      status.textContent = `Uitlezen mislukt (${x.message || x}). Typ de bon dan over.`;
    } finally {
      voortgang.hidden = true;
      worker?.terminate();
    }
  } });

  const knop = el('button', {}, 'Bon opslaan en vergelijken');
  const formulier = el('form', { onsubmit: async (e) => {
    e.preventDefault();
    let bonTotaal = leesBon(tekst.value).totaal;
    if (totaalVeld.value.trim()) {
      try { bonTotaal = parseEuro(totaalVeld.value); } catch { return alert('Ongeldig totaalbedrag.'); }
    }
    knop.disabled = true;
    try { await opslaan(tekst.value.slice(0, 20000), bonTotaal); knop.textContent = 'Opgeslagen ✓'; }
    catch (x) { console.error(x); alert('Opslaan lukte niet: ' + (x.message || x)); }
    finally { knop.disabled = false; setTimeout(() => (knop.textContent = 'Bon opslaan en vergelijken'), 1800); }
  } },
  tekst,
  el('label', {}, 'Totaal van de bon (€) ', el('span', { class: 'muted' }, '— leeg = uit de tekst'), totaalVeld),
  knop);

  ververs();
  return el('div', { class: 'bonpaneel' },
    el('label', {}, '1. Foto van de kassabon', foto), status, voortgang,
    el('p', { class: 'muted' }, '2. Verbeter wat verkeerd gelezen is. Een productregel eindigt met een bedrag (',
      el('code', {}, '2 Friet mayonaise 6,00'), '); de totaalregel heet ', el('code', {}, 'Totaal'), ' of ', el('code', {}, 'Te betalen'), '.'),
    el('div', { class: 'bon-kolommen' }, formulier, el('div', {}, el('h3', {}, 'Herkend'), voorbeeld)));
}
