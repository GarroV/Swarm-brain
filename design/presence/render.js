// Один глиф (фрагмент SVG 64×64 с классами b/k/l/e) — три стиля оформления, все в синем неоне.
(function () {
  let uid = 0;
  // Только синий спектр: циан → лазурь → кобальт → холодный индиго.
  const hue = (id) => 182 + ((id * 37) % 64);

  function fret(r, n) {
    // Ступенчатый меандр по окружности: зубцы между радиусами r и r-2.4.
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.5) / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
      const p = (a, rr) => `${(32 + rr * Math.cos(a)).toFixed(2)},${(32 + rr * Math.sin(a)).toFixed(2)}`;
      pts.push(p(a0, r), p(a1, r), p(a1, r - 2.4), p(a2, r - 2.4));
    }
    return `<polygon class="fret" points="${pts.join(" ")}"/>`;
  }

  function frame(v, n) {
    if (v === "a") {
      return `<radialGradient id="bg${n}" cx=".5" cy=".42" r=".6"><stop class="s1" offset="0"/><stop class="s2" offset="1"/></radialGradient>` +
        `<circle cx="32" cy="32" r="32" fill="url(#bg${n})"/>` +
        `<circle class="fr1" cx="32" cy="32" r="29.2"/>`;
    }
    if (v === "b") {
      return `<circle class="bg" cx="32" cy="32" r="32"/>` + fret(30.4, 28);
    }
    return `<linearGradient id="bg${n}" x1="0" y1="0" x2="0" y2="1"><stop class="s1" offset="0"/><stop class="s2" offset="1"/></linearGradient>` +
      `<circle cx="32" cy="32" r="32" fill="url(#bg${n})"/>` +
      `<circle class="fr1" cx="32" cy="32" r="28.8"/>`;
  }

  function avatar(g, v) {
    const n = ++uid;
    const body = v === "a"
      ? `<g class="glow">${g.svg}</g><g class="g">${g.svg}</g>`
      : `<g class="g">${g.svg}</g>`;
    return `<svg viewBox="0 0 64 64" class="av v-${v}" style="--h:${hue(g.id)}" role="img" aria-label="${g.name}">` +
      `<defs><clipPath id="cp${n}"><circle cx="32" cy="32" r="32"/></clipPath></defs>` +
      `<g clip-path="url(#cp${n})">${frame(v, n)}${body}</g>` +
      `<circle class="ring" cx="32" cy="32" r="31.3"/></svg>`;
  }

  globalThis.PresenceAvatar = { avatar, hue };
})();
