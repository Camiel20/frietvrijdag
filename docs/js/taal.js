// Taal van de collega-pagina's: Nederlands (standaard) of Engels.
// Keuze via de link (#t=…&l=en) of de knop rechtsboven; onthouden in deze browser.
// Gebruik: t('Nederlands', 'English') — de twee teksten staan zo naast elkaar in de code.
// Beheer blijft Nederlands; bon.js en datum.js krijgen de taal als parameter (die draaien ook in node-tests).

const SLEUTEL = 'frietvrijdag-taal';

function bepaal() {
  const uitLink = new URLSearchParams(location.hash.slice(1)).get('l');
  if (uitLink === 'en' || uitLink === 'nl') {
    try { localStorage.setItem(SLEUTEL, uitLink); } catch { /* privé-venster: dan alleen via de link */ }
    return uitLink;
  }
  try { if (localStorage.getItem(SLEUTEL) === 'en') return 'en'; } catch { /* idem */ }
  return 'nl';
}

export const TAAL = bepaal();
export const EN = TAAL === 'en';
export const t = (nl, en) => (EN ? en : nl);
document.documentElement.lang = TAAL;

/** Wisselt NL/EN door het l-deel van de link te wijzigen (de bestelpagina herlaadt dan vanzelf). */
export function wisselTaal() {
  const p = new URLSearchParams(location.hash.slice(1));
  p.set('l', EN ? 'nl' : 'en');
  try { localStorage.setItem(SLEUTEL, EN ? 'nl' : 'en'); } catch { /* idem */ }
  location.hash = p.toString();
}
