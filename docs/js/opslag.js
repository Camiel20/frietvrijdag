// Eén ingang voor alle opslag. Twee uitvoeringen met dezelfde functies:
//  - Firestore (echt, gedeeld met collega's) — datamodel en beveiliging: zie firestore.rules
//  - demo (localStorage, alleen deze browser) zolang firebase-config.js leeg is.
//
// Belangrijk: de token uit de persoonlijke link staat nergens leesbaar. Collega's zien elkaars
// naam (deelnemers/{id}) en bestelling (bestellingen/{id}), nooit elkaars token.
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.14.1/';
export const DEMO = !firebaseConfig.apiKey;

export function maakToken() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const opDatum = (a, b) => (a.datum < b.datum ? 1 : -1);
const opNaam = (a, b) => a.naam.localeCompare(b.naam, 'nl');
const nieuweRonde = (datum, door) => ({
  datum, open: true, geopendDoor: door, betaler: null, tikkie: '', bonTekst: '', bonTotaal: null, notities: '',
});

// --------------------------------------------------------------------------- Firestore

async function firestore() {
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-firestore.js'), import(FB + 'firebase-auth.js'),
  ]);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const auth = au.getAuth(app);
  const d = (...pad) => fs.doc(db, ...pad);
  const lijst = (snap) => snap.docs.map((x) => ({ id: x.id, ...x.data() }));
  const eersteGebruiker = new Promise((ok) => { const stop = au.onAuthStateChanged(auth, (u) => { stop(); ok(u); }); });

  return {
    // ---- collega
    /** Koppelt deze browser aan de link. -> {id, naam, actief} of null als de link niet (meer) geldig is. */
    async koppel(token) {
      const user = (await eersteGebruiker) || (await au.signInAnonymously(auth)).user;
      const t = await fs.getDoc(d('tokens', token));
      if (!t.exists()) return null;
      const id = t.data().deelnemer;
      const k = await fs.getDoc(d('koppelingen', user.uid));
      if (!k.exists() || k.data().token !== token) await fs.setDoc(d('koppelingen', user.uid), { token, deelnemer: id });
      try {
        const p = await fs.getDoc(d('deelnemers', id));
        return p.exists() && p.data().actief ? { id, ...p.data() } : null;
      } catch { return null; } // uitgezet: de regels weigeren dan het lezen
    },
    async deelnemers() { return lijst(await fs.getDocs(fs.collection(db, 'deelnemers'))).sort(opNaam); },
    async ronde(datum) { const s = await fs.getDoc(d('rondes', datum)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    volgRonde(datum, cb) {
      return fs.onSnapshot(d('rondes', datum), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null), (e) => console.error(e));
    },
    async bestellingen(datum) { return lijst(await fs.getDocs(fs.collection(db, 'rondes', datum, 'bestellingen'))); },
    volgBestellingen(datum, cb) {
      return fs.onSnapshot(fs.collection(db, 'rondes', datum, 'bestellingen'), (s) => cb(lijst(s)), (e) => console.error(e));
    },
    async openRonde(datum, ik) {
      const ref = d('rondes', datum);
      await fs.runTransaction(db, async (tx) => { if (!(await tx.get(ref)).exists()) tx.set(ref, nieuweRonde(datum, ik)); });
    },
    bewaarRegels(datum, id, regels) {
      return fs.setDoc(d('rondes', datum, 'bestellingen', id), { regels, bijgewerkt: fs.serverTimestamp() }, { merge: true });
    },
    zetBetaald(datum, id, betaald) { return fs.updateDoc(d('rondes', datum, 'bestellingen', id), { betaald }); },
    zetOntvangen(datum, id, ontvangen) { return fs.updateDoc(d('rondes', datum, 'bestellingen', id), { ontvangen }); },
    draai(datum, betaler, ik) {
      return fs.updateDoc(d('rondes', datum), { betaler, gedraaidDoor: ik, gedraaidOp: fs.serverTimestamp(), open: false });
    },
    /** Alleen de betaler: {tikkie} en/of {bonTekst, bonTotaal}. */
    zetBetalerVelden(datum, velden) { return fs.updateDoc(d('rondes', datum), velden); },

    // ---- beheer
    gebruiker(cb) { return au.onAuthStateChanged(auth, cb); },
    login() { return au.signInWithPopup(auth, new au.GoogleAuthProvider()); },
    logout() { return au.signOut(auth); },
    async isBeheerder(uid) {
      try { return (await fs.getDoc(d('beheer', uid))).exists(); } catch { return false; }
    },
    async rondes() { return lijst(await fs.getDocs(fs.collection(db, 'rondes'))).sort(opDatum); },
    async maakRonde(datum) {
      const ref = d('rondes', datum);
      if (!(await fs.getDoc(ref)).exists()) await fs.setDoc(ref, nieuweRonde(datum, null));
    },
    wijzigRonde(datum, velden) { return fs.updateDoc(d('rondes', datum), velden); },
    async verwijderRonde(datum) {
      // Eerst de bestellingen: Firestore ruimt een subcollectie niet vanzelf op.
      const best = await fs.getDocs(fs.collection(db, 'rondes', datum, 'bestellingen'));
      const batch = fs.writeBatch(db);
      best.docs.forEach((b) => batch.delete(b.ref));
      batch.delete(d('rondes', datum));
      await batch.commit();
    },
    zetBestelling(datum, id, velden) { return fs.setDoc(d('rondes', datum, 'bestellingen', id), velden, { merge: true }); },
    async deelnemersMetLinks() {
      const [ps, ts] = await Promise.all([fs.getDocs(fs.collection(db, 'deelnemers')), fs.getDocs(fs.collection(db, 'tokens'))]);
      const tok = new Map(ts.docs.map((t) => [t.data().deelnemer, t.id]));
      return lijst(ps).map((p) => ({ ...p, token: tok.get(p.id) || null })).sort(opNaam);
    },
    async voegDeelnemerToe(naam) {
      const ref = fs.doc(fs.collection(db, 'deelnemers'));
      const batch = fs.writeBatch(db);
      batch.set(ref, { naam, actief: true });
      batch.set(d('tokens', maakToken()), { deelnemer: ref.id });
      await batch.commit();
    },
    zetActief(id, actief) { return fs.updateDoc(d('deelnemers', id), { actief }); },
    hernoem(id, naam) { return fs.updateDoc(d('deelnemers', id), { naam }); },
    async nieuweLink(id) {
      const oud = await fs.getDocs(fs.query(fs.collection(db, 'tokens'), fs.where('deelnemer', '==', id)));
      const batch = fs.writeBatch(db);
      oud.docs.forEach((t) => batch.delete(t.ref));
      batch.set(d('tokens', maakToken()), { deelnemer: id });
      await batch.commit();
    },
  };
}

// --------------------------------------------------------------------------- demo (localStorage)
// Bootst de belangrijkste regels na, zodat je in de demo ziet wat wel en niet mag.

function demo() {
  const SLEUTEL = 'frietvrijdag-demo-2';
  const st = () => {
    let s; try { s = JSON.parse(localStorage.getItem(SLEUTEL)) || {}; } catch { s = {}; }
    s.deelnemers ??= {}; s.tokens ??= {}; s.rondes ??= {}; s.bestellingen ??= {};
    return s;
  };
  const kijkers = new Set();
  const schrijf = (s) => { localStorage.setItem(SLEUTEL, JSON.stringify(s)); kijkers.forEach((f) => f()); };
  window.addEventListener('storage', (e) => { if (e.key === SLEUTEL) kijkers.forEach((f) => f()); });
  const volg = (f) => { kijkers.add(f); f(); return () => kijkers.delete(f); };
  const best = (s, datum) => (s.bestellingen[datum] ??= {});
  const weiger = (w) => { throw Object.assign(new Error('Niet toegestaan: ' + w), { code: 'permission-denied' }); };
  let ik = null;

  return {
    async koppel(token) {
      const id = st().tokens[token];
      const p = id && st().deelnemers[id];
      ik = p?.actief ? id : null;
      return ik ? { id, ...p } : null;
    },
    async deelnemers() { return Object.entries(st().deelnemers).map(([id, v]) => ({ id, ...v })).sort(opNaam); },
    async ronde(datum) { const r = st().rondes[datum]; return r ? { id: datum, ...r } : null; },
    volgRonde(datum, cb) { return volg(() => { const r = st().rondes[datum]; cb(r ? { id: datum, ...r } : null); }); },
    async bestellingen(datum) { return Object.entries(st().bestellingen[datum] || {}).map(([id, v]) => ({ id, ...v })); },
    volgBestellingen(datum, cb) {
      return volg(() => cb(Object.entries(st().bestellingen[datum] || {}).map(([id, v]) => ({ id, ...v }))));
    },
    async openRonde(datum, door) { const s = st(); s.rondes[datum] ??= nieuweRonde(datum, door); schrijf(s); },
    async bewaarRegels(datum, id, regels) {
      const s = st();
      if (!s.rondes[datum]?.open) weiger('ronde is gesloten');
      if (id !== ik) weiger('niet je eigen bestelling');
      const b = best(s, datum); b[id] = { ...b[id], regels, bijgewerkt: new Date().toISOString() };
      schrijf(s);
    },
    async zetBetaald(datum, id, betaald) {
      const s = st(); if (id !== ik) weiger('niet je eigen bestelling');
      best(s, datum)[id].betaald = betaald; schrijf(s);
    },
    async zetOntvangen(datum, id, ontvangen) {
      const s = st(); if (s.rondes[datum].betaler !== ik || id === ik) weiger('alleen de betaler bevestigt');
      best(s, datum)[id].ontvangen = ontvangen; schrijf(s);
    },
    async draai(datum, betaler, door) {
      const s = st(); const r = s.rondes[datum];
      if (r.betaler) weiger('er is al gedraaid');
      if (!(s.bestellingen[datum]?.[betaler]?.regels?.length)) weiger('betaler heeft niet besteld');
      Object.assign(r, { betaler, gedraaidDoor: door, gedraaidOp: new Date().toISOString(), open: false });
      schrijf(s);
    },
    async zetBetalerVelden(datum, velden) {
      const s = st(); if (s.rondes[datum].betaler !== ik) weiger('alleen de betaler');
      Object.assign(s.rondes[datum], velden); schrijf(s);
    },
    gebruiker(cb) { setTimeout(() => cb({ uid: 'demo', displayName: 'Demo-beheerder' })); return () => {}; },
    async login() {}, async logout() {},
    async isBeheerder() { return true; },
    async rondes() { return Object.values(st().rondes).map((r) => ({ id: r.datum, ...r })).sort(opDatum); },
    async maakRonde(datum) { const s = st(); s.rondes[datum] ??= nieuweRonde(datum, null); schrijf(s); },
    async wijzigRonde(datum, velden) { const s = st(); Object.assign(s.rondes[datum], velden); schrijf(s); },
    async verwijderRonde(datum) { const s = st(); delete s.rondes[datum]; delete s.bestellingen[datum]; schrijf(s); },
    async zetBestelling(datum, id, velden) { const s = st(); const b = best(s, datum); b[id] = { ...b[id], ...velden }; schrijf(s); },
    async deelnemersMetLinks() {
      const s = st(); const tok = new Map(Object.entries(s.tokens).map(([t, id]) => [id, t]));
      return Object.entries(s.deelnemers).map(([id, v]) => ({ id, ...v, token: tok.get(id) || null })).sort(opNaam);
    },
    async voegDeelnemerToe(naam) {
      const s = st(); const id = 'p' + maakToken().slice(0, 10);
      s.deelnemers[id] = { naam, actief: true }; s.tokens[maakToken()] = id; schrijf(s);
    },
    async zetActief(id, actief) { const s = st(); s.deelnemers[id].actief = actief; schrijf(s); },
    async hernoem(id, naam) { const s = st(); s.deelnemers[id].naam = naam; schrijf(s); },
    async nieuweLink(id) {
      const s = st(); for (const [t, v] of Object.entries(s.tokens)) if (v === id) delete s.tokens[t];
      s.tokens[maakToken()] = id; schrijf(s);
    },
  };
}

export const opslag = DEMO ? demo() : await firestore();

// --------------------------------------------------------------------------- hulpjes

export async function laadMenu() {
  const r = await fetch('menu.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('menu.json niet gevonden');
  return r.json();
}

/** Link die een collega krijgt. De token staat achter # zodat hij niet in serverlogs komt. */
export function bestelLink(token, datum) {
  const basis = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  return `${basis}#t=${token}${datum ? '&d=' + datum : ''}`;
}

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
