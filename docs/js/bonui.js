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
 * @param {{tekst: string, opslaan: (tekst: string, totaal: number|null) => Promise<void>, en?: boolean}} opties
 *   en: Engelse teksten (bestelpagina in het Engels); beheer laat hem weg.
 * @returns {HTMLElement}
 */
export function bonPaneel({ tekst: begin = '', opslaan, en = false }) {
  const t = (nl, eng) => (en ? eng : nl);
  const status = el('p', { class: 'muted bonstatus' }, t('Recht van boven, goed licht, hele bon in beeld. De foto blijft op dit apparaat.',
    'Straight from above, good light, whole receipt in view. The photo stays on this device.'));
  const voortgang = el('progress', { max: 1, value: 0, hidden: true });
  const tekst = el('textarea', { rows: 12, spellcheck: 'false', class: 'mono', 'aria-label': t('Tekst van de bon', 'Receipt text') });
  tekst.value = begin;
  const totaalVeld = el('input', { inputmode: 'decimal', placeholder: t('uit de tekst', 'from the text') });
  const voorbeeld = el('div', { class: 'bonvoorbeeld' });

  const ververs = () => {
    const { regels, totaal } = leesBon(tekst.value);
    voorbeeld.replaceChildren(
      ...(regels.length ? regels.map((r) => el('div', { class: 'line' },
        el('div', {}, el('strong', {}, `${r.aantal} × ${r.naam}`), el('small', {}, t('per stuk ', 'each ') + euro(r.cents))),
        el('strong', {}, euro(r.regelCents)))) : [el('p', { class: 'muted' }, t('Nog geen productregels herkend.', 'No product lines recognised yet.'))]),
      el('div', { class: 'sum' }, el('span', {}, t('Som regels', 'Sum of lines')), el('strong', {}, euro(regels.reduce((s, r) => s + r.regelCents, 0)))),
      el('div', { class: 'sum' }, el('span', {}, t('Totaal op bon', 'Receipt total')), el('strong', {}, totaal != null ? euro(totaal) : t('niet gevonden', 'not found'))));
  };
  tekst.addEventListener('input', ververs);

  const foto = el('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: async (e) => {
    const bestand = e.target.files[0];
    if (!bestand) return;
    voortgang.hidden = false; voortgang.value = 0; status.textContent = t('Foto laden…', 'Loading photo…');
    let worker;
    try {
      // createImageBitmap zet een telefoonfoto meteen rechtop (EXIF-draaiing).
      const bitmap = await createImageBitmap(bestand, { imageOrientation: 'from-image' });
      const canvas = bewerkFoto(bitmap);
      bitmap.close();
      const T = await laadTesseract();
      worker = await T.createWorker('nld', 1, { logger: (m) => {
        if (m.status === 'recognizing text') { voortgang.value = m.progress; status.textContent = `${t('Lezen…', 'Reading…')} ${Math.round(m.progress * 100)}%`; }
        else status.textContent = m.status + '…';
      } });
      const { data } = await worker.recognize(canvas);
      tekst.value = data.text.trim();
      status.textContent = t('Klaar. Kijk de tekst na en sla op.', 'Done. Check the text and save.');
      ververs();
    } catch (x) {
      console.error(x);
      status.textContent = t(`Uitlezen mislukt (${x.message || x}). Typ de bon dan over.`, `Reading failed (${x.message || x}). Please type the receipt instead.`);
    } finally {
      voortgang.hidden = true;
      worker?.terminate();
    }
  } });

  const knopTekst = t('Bon opslaan en vergelijken', 'Save and compare receipt');
  const knop = el('button', {}, knopTekst);
  const formulier = el('form', { onsubmit: async (e) => {
    e.preventDefault();
    let bonTotaal = leesBon(tekst.value).totaal;
    if (totaalVeld.value.trim()) {
      try { bonTotaal = parseEuro(totaalVeld.value); } catch { return alert(t('Ongeldig totaalbedrag.', 'Invalid total amount.')); }
    }
    knop.disabled = true;
    try { await opslaan(tekst.value.slice(0, 20000), bonTotaal); knop.textContent = t('Opgeslagen ✓', 'Saved ✓'); }
    catch (x) { console.error(x); alert(t('Opslaan lukte niet: ', 'Saving failed: ') + (x.message || x)); }
    finally { knop.disabled = false; setTimeout(() => (knop.textContent = knopTekst), 1800); }
  } },
  tekst,
  el('label', {}, t('Totaal van de bon (€) ', 'Receipt total (€) '), el('span', { class: 'muted' }, t('— leeg = uit de tekst', '— empty = from the text')), totaalVeld),
  knop);

  ververs();
  return el('div', { class: 'bonpaneel' },
    el('label', {}, t('1. Foto van de kassabon', '1. Photo of the receipt'), foto), status, voortgang,
    el('p', { class: 'muted' }, t('2. Verbeter wat verkeerd gelezen is. Een productregel eindigt met een bedrag (', '2. Fix anything read wrongly. A product line ends with an amount ('),
      el('code', {}, '2 Friet mayonaise 6,00'), t('); de totaalregel heet ', '); the total line is called '), el('code', {}, 'Totaal'), t(' of ', ' or '), el('code', {}, 'Te betalen'), '.'),
    el('div', { class: 'bon-kolommen' }, formulier, el('div', {}, el('h3', {}, t('Herkend', 'Recognised')), voorbeeld)));
}
