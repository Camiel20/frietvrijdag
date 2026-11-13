// Rad van fortuin op een canvas. Iedereen tekent dezelfde volgorde (op naam gesorteerd),
// zodat het rad bij elke collega op dezelfde naam stopt.

const KLEUREN = ['#f4b400', '#e8710a', '#d93025', '#c2185b', '#8e24aa', '#3949ab', '#1e88e5', '#00897b', '#43a047', '#7cb342'];
const TWEE_PI = Math.PI * 2;

export function maakRad(namen) {
  const px = 300;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px * dpr;
  canvas.className = 'rad-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Rad met: ' + namen.join(', '));
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  let hoek = 0;
  const n = Math.max(1, namen.length);
  const stuk = TWEE_PI / n;

  function teken() {
    const c = px / 2, r = c - 6;
    ctx.clearRect(0, 0, px, px);
    if (!namen.length) {
      ctx.fillStyle = '#e6ebe3'; ctx.beginPath(); ctx.arc(c, c, r, 0, TWEE_PI); ctx.fill();
      ctx.fillStyle = '#738075'; ctx.font = '600 15px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Nog niemand besteld', c, c + 5);
      return;
    }
    namen.forEach((naam, i) => {
      const a0 = hoek + i * stuk;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, r, a0, a0 + stuk); ctx.closePath();
      ctx.fillStyle = KLEUREN[(i + (n % KLEUREN.length === 1 && i === n - 1 ? 1 : 0)) % KLEUREN.length];
      ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save();
      const midden = a0 + stuk / 2;
      const links = Math.cos(midden) < 0; // op de linkerhelft de tekst omdraaien, anders staat hij op zijn kop
      ctx.translate(c, c); ctx.rotate(links ? midden + Math.PI : midden);
      ctx.fillStyle = '#fff'; ctx.textAlign = links ? 'left' : 'right'; ctx.textBaseline = 'middle';
      ctx.font = `700 ${n > 10 ? 12 : 15}px system-ui, sans-serif`;
      const tekst = naam.length > 14 ? naam.slice(0, 13) + '…' : naam;
      ctx.fillText(tekst, links ? -(r - 12) : r - 12, 0);
      ctx.restore();
    });
    ctx.beginPath(); ctx.arc(c, c, 22, 0, TWEE_PI); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.font = '22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🍟', c, c + 1);
  }

  /** Hoek waarbij het midden van vak i precies onder de wijzer (bovenaan) staat. */
  const doelVoor = (i) => -Math.PI / 2 - (i * stuk + stuk / 2);

  function zetOp(i) { hoek = doelVoor(i); teken(); }

  function draaiNaar(i, ms = 5200) {
    // Een klein willekeurig stukje binnen het vak, zodat hij niet altijd exact in het midden stopt.
    let doel = doelVoor(i) + (Math.random() - 0.5) * stuk * 0.6;
    const start = hoek;
    while (doel < start + 6 * TWEE_PI) doel += TWEE_PI;
    const t0 = performance.now();
    return new Promise((klaar) => {
      const stap = (t) => {
        const p = Math.min(1, (t - t0) / ms);
        hoek = start + (doel - start) * (1 - Math.pow(1 - p, 4)); // ease-out
        teken();
        if (p < 1) requestAnimationFrame(stap); else klaar();
      };
      requestAnimationFrame(stap);
    });
  }

  teken();
  return { canvas, teken, zetOp, draaiNaar };
}
