/* =====================================================================
   PLANO DINÁMICO — render SVG data-driven de cámaras/evaporadores/forzadores
   Los forzadores GIRAN (CSS) según su estado. Es escalable: si agregás
   cámaras en la base, el plano se redibuja solo a partir de /api/plano.
   ===================================================================== */
(function (global) {
  const PAD = 16, CW = 380, CORR = 84;
  const FAN_R = 10, FAN_SP = 26;
  const TOPY = 34, BOTM = 30;     // separación de fans a la pared
  const GAP = 12;

  function tiene(c, pared) { return c.evaporadores.some(e => e.pared === pared); }
  // todas las cámaras comparten el mismo "espacio de cámara" (medida de referencia: Cámara 33)
  function alturaCam() { return 224; }

  function fanSVG(f) {
    // grupo forzador: hub + aspa (3 palas) + nº ; clase = estado
    const blades = [0, 120, 240].map(a =>
      `<ellipse class="pala" rx="${(FAN_R*0.62).toFixed(1)}" ry="${(FAN_R*0.22).toFixed(1)}" cx="${(FAN_R*0.52).toFixed(1)}" cy="0" transform="rotate(${a})"/>`
    ).join('');
    return `<g class="frz estado-${f.estado}" data-id="${f.id}" data-cam="${f.id.split('-')[1]}" tabindex="0" role="button" aria-label="Forzador ${f.n_global}, ${f.estado}">
      <circle class="halo" r="${FAN_R+4}"/>
      <circle class="aro" r="${FAN_R}"/>
      <g class="aspa">${blades}<circle class="hub" r="${(FAN_R*0.2).toFixed(1)}"/></g>
      <text class="fnum" y="${FAN_R+13}">${f.n_global}</text>
    </g>`;
  }

  function evapSVG(ev, cx, cy) {
    const n = ev.forzadores.length;
    const w = n * FAN_SP + 14;
    const x0 = cx - w / 2;
    let s = `<g class="evap"><rect x="${x0.toFixed(1)}" y="${(cy-17).toFixed(1)}" width="${w.toFixed(1)}" height="34" rx="6"/>`;
    s += `<text class="etag" x="${cx.toFixed(1)}" y="${(cy-23).toFixed(1)}">${ev.etiqueta}·${n}F</text>`;
    ev.forzadores.forEach((f, i) => {
      const fx = x0 + 7 + FAN_SP / 2 + i * FAN_SP;
      s += `<g transform="translate(${fx.toFixed(1)},${cy.toFixed(1)})">${fanSVG(f)}</g>`;
    });
    return s + '</g>';
  }

  function puertaSVG(wx, ycen, swing) {
    const op = 50, y0 = ycen - op / 2, y1 = ycen + op / 2;
    const s = swing === 'der' ? 1 : -1, hx = wx + s * op, sweep = swing === 'der' ? 1 : 0;
    return `<g class="puerta">
      <line class="gap" x1="${wx}" y1="${y0}" x2="${wx}" y2="${y1}"/>
      <line class="hoja" x1="${wx}" y1="${y1}" x2="${hx}" y2="${y1}"/>
      <path class="barrido" d="M ${hx} ${y1} A ${op} ${op} 0 0 ${sweep} ${wx} ${y0}"/>
    </g>`;
  }

  function camaraSVG(c, x0, y) {
    const w = CW, h = alturaCam(c);
    const soloT = tiene(c, 'T') && !tiene(c, 'B');
    const soloB = tiene(c, 'B') && !tiene(c, 'T');
    // en cámaras de una sola fila, el bloque de identificación se centra
    // en el espacio libre que deja esa fila dentro de la caja de 224px
    const lcy = soloT ? y + 137.5 : soloB ? y + 88.5 : y + h * 0.5;

    let s = `<g class="camara" data-cam="${c.num}">`;
    s += `<rect class="muro" x="${x0}" y="${y}" width="${w}" height="${h}" rx="4"/>`;
    // identidad
    s += `<circle class="cnum-bg" cx="${x0 + 64}" cy="${lcy}" r="27"/>`;
    s += `<text class="cnum" x="${x0 + 64}" y="${lcy + 8}">${c.num}</text>`;
    s += `<text class="clbl" x="${x0 + 64}" y="${soloB ? lcy - 44 : lcy + 44}">CÁMARA</text>`;
    s += `<g class="ctot"><rect x="${x0 + 110}" y="${lcy - 25}" width="116" height="50" rx="6"/>` +
         `<text class="ctotn" x="${x0 + 168}" y="${lcy + 3}">${c.total} F.</text>` +
         `<text class="ctotl" x="${x0 + 168}" y="${lcy + 20}">forzadores</text></g>`;
    s += `<text class="cprog" x="${x0 + w - 12}" y="${lcy - 30}" data-prog="${c.num}"></text>`;
    // evaporadores por pared
    const ts = c.evaporadores.filter(e => e.pared === 'T');
    const bs = c.evaporadores.filter(e => e.pared === 'B');
    ts.forEach((ev, i) => { const cx = x0 + (w / ts.length) * (i + 0.5); s += evapSVG(ev, cx, y + TOPY); });
    bs.forEach((ev, i) => { const cx = x0 + (w / bs.length) * (i + 0.5); s += evapSVG(ev, cx, y + h - BOTM); });
    s += '</g>';
    return { svg: s, h };
  }

  function construirPlanoSVG(camaras) {
    const izq = camaras.filter(c => c.col === 'L');
    const der = camaras.filter(c => c.col === 'R');
    const xL = PAD, xCorr = PAD + CW, xR = PAD + CW + CORR;

    let body = '', yL = PAD + 8, yR = PAD + 8;
    izq.forEach(c => { const r = camaraSVG(c, xL, yL); body += r.svg; body += puertaSVG(xL + CW, yL + r.h * 0.5, 'izq'); yL += r.h + GAP; });
    der.forEach(c => { const r = camaraSVG(c, xR, yR); body += r.svg; body += puertaSVG(xR, yR + r.h * 0.5, 'der'); yR += r.h + GAP; });

    const planB = Math.max(yL, yR) - GAP;
    const W = PAD + CW + CORR + CW + PAD;
    const H = planB + PAD;
    // pasillo
    const corr = `<rect class="pasillo" x="${xCorr}" y="${PAD + 8}" width="${CORR}" height="${planB - PAD - 8}" rx="3"/>` +
      `<text class="pasillo-lbl" x="${xCorr + CORR / 2}" y="${(PAD + 8 + (planB - PAD - 8) / 2)}" transform="rotate(-90 ${xCorr + CORR / 2} ${(PAD + 8 + (planB - PAD - 8) / 2)})">PASILLO CENTRAL</text>`;

    // degradés sutiles (dan profundidad sin usar color de estado)
    const defs = `<defs>
      <linearGradient id="gMuro" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1d2733"/><stop offset="1" stop-color="#11161d"/>
      </linearGradient>
      <linearGradient id="gEvap" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2c3848"/><stop offset="1" stop-color="#1d2530"/>
      </linearGradient>
      <radialGradient id="gNum" cx="35%" cy="32%" r="75%">
        <stop offset="0" stop-color="#243040"/><stop offset="1" stop-color="#0d1116"/>
      </radialGradient>
      <linearGradient id="gPasillo" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#090c10"/><stop offset="0.5" stop-color="#161d26"/><stop offset="1" stop-color="#090c10"/>
      </linearGradient>
      <radialGradient id="gFan" cx="35%" cy="30%" r="75%">
        <stop offset="0" stop-color="#313e4d"/><stop offset="1" stop-color="#1b222b"/>
      </radialGradient>
    </defs>`;

    return {
      svg: `<svg id="planoSVG" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMin meet">${defs}${corr}${body}</svg>`,
      width: W, height: H
    };
  }

  global.PlanoForzadores = { construirPlanoSVG };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module !== 'undefined') module.exports = (typeof window !== 'undefined' ? window : globalThis).PlanoForzadores;
