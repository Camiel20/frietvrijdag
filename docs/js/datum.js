// Datums als 'YYYY-MM-DD' in lokale (Nederlandse) tijd.

export function isoDatum(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Vandaag als het vrijdag is, anders de eerstvolgende vrijdag. */
export function komendeVrijdag(nu = new Date()) {
  const d = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate());
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return isoDatum(d);
}

/** De n vrijdagen vóór de gegeven vrijdag, nieuwste eerst. */
export function vorigeVrijdagen(vrijdag, n) {
  const [j, m, d] = vrijdag.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => isoDatum(new Date(j, m - 1, d - 7 * (i + 1))));
}

export function datumTekst(iso, jaar = false) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL',
    { weekday: 'long', day: 'numeric', month: 'long', ...(jaar ? { year: 'numeric' } : {}) });
}
