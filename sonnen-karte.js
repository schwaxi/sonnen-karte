// sonnen-karte v1.0.1
// Einzeln installierbares Modul (Home Assistant Marketplace / HACS, Kategorie Dashboard).
window.customCards = window.customCards || [];
window.customCardFeatures = window.customCardFeatures || [];
// Eigener Block: Namen bleiben lokal, auch wenn mehrere Karten zusammen geladen werden.
{
// ---------------------------------------------------------------------------
// Sonnen-Karte: Tagesbogen der Sonne mit Daemmerung, Aufgang, Mittag, Untergang und aktueller Position.
// Die Zeiten werden aus dem Standort von Home Assistant berechnet (Formeln wie SunCalc).
//
//   type: custom:sonnen-karte

const TYPE10 = "sonnen-karte";
const SONNE = (() => {
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397, J0 = 0.0009;
  const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const dekl = (l) => Math.asin(Math.sin(e) * Math.sin(l));
  const rekt = (l) => Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l));
  const anomalie = (d) => rad * (357.5291 + 0.98560028 * d);
  const laenge = (M) => M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  function hoehe(datum, lat, lng) {
    const lw = rad * -lng, phi = rad * lat, d = toDays(datum), L = laenge(anomalie(d));
    const H = rad * (280.16 + 360.9856235 * d) - lw - rekt(L), dec = dekl(L);
    return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
  }
  function zeiten(datum, lat, lng) {
    const lw = rad * -lng, phi = rad * lat, d = toDays(datum);
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n, M = anomalie(ds), L = laenge(M), dec = dekl(L);
    const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const paar = (h) => {
      const x = (Math.sin(h * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (x < -1 || x > 1) return [null, null];
      const w = Math.acos(x), a = J0 + (w + lw) / (2 * Math.PI) + n;
      const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)];
    };
    const [auf, unter] = paar(-0.833), [daemm, daemmEnde] = paar(-6);
    return { mittag: fromJulian(Jnoon), auf, unter, daemm, daemmEnde };
  }
  return { hoehe, zeiten };
})();

class SonnenKarte extends HTMLElement {
  setConfig(c) { this._config = { ...(c || {}) }; this._render(); }

  set hass(hass) {
    const erst = !this._hass;
    this._hass = hass;
    if (erst || Date.now() - (this._gezeichnet || 0) > 60000) this._zeichnen();
  }

  connectedCallback() {
    if (!this._ro) this._ro = new ResizeObserver(() => this._zeichnen());
    this._ro.observe(this);
    this._takt = setInterval(() => this._zeichnen(), 60000);
  }
  disconnectedCallback() { this._ro?.disconnect(); clearInterval(this._takt); }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px 16px; box-sizing: border-box; }
        .grafik { width: 100%; }
        .werte { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px 12px; margin-top: 8px; }
        .w { display: flex; align-items: center; gap: 8px; }
        .w ha-icon { --mdc-icon-size: 22px; color: #ffb300; flex: none; }
        .w .l { font-size: 11px; color: var(--secondary-text-color); }
        .w .v { font-size: 15px; font-weight: 500; color: var(--primary-text-color); white-space: nowrap; }
        .fuss { font-size: 12px; color: var(--secondary-text-color); margin-top: 8px; }
      </style>
      <ha-card><div class="grafik"></div><div class="werte"></div><div class="fuss"></div></ha-card>`;
    this._zeichnen();
  }

  _zeichnen() {
    const r = this.shadowRoot;
    if (!r || !this._hass) return;
    this._gezeichnet = Date.now();
    const lat = this._hass.config?.latitude, lng = this._hass.config?.longitude;
    if (lat == null || lng == null) { r.querySelector(".fuss").textContent = "Kein Standort in Home Assistant eingetragen."; return; }
    const jetzt = new Date();
    const mitte = new Date(jetzt); mitte.setHours(12, 0, 0, 0);
    const gestern = new Date(mitte); gestern.setDate(gestern.getDate() - 1);
    const z = SONNE.zeiten(mitte, lat, lng), zg = SONNE.zeiten(gestern, lat, lng);
    const start = new Date(jetzt); start.setHours(0, 0, 0, 0);
    const minuten = (d) => (d - start) / 60000;
    const uhr = (d) => d ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : "–";
    const dauer = (m) => `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;

    // Grafik
    const W = Math.max(280, r.querySelector(".grafik").clientWidth || 360), H = 150, horizont = 104, links = 4, rechts = 4;
    const x = (min) => links + (min / 1440) * (W - links - rechts);
    const mittagHoehe = SONNE.hoehe(z.mittag, lat, lng);
    const skala = 84 / Math.max(mittagHoehe, 15);
    const y = (h) => horizont - h * skala;
    const punkte = [];
    for (let m = 0; m <= 1440; m += 10) punkte.push([x(m), Math.min(H - 6, y(SONNE.hoehe(new Date(start.getTime() + m * 60000), lat, lng)))]);
    const pfad = punkte.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
    const flaeche = `${pfad} L${x(1440)},${horizont} L${x(0)},${horizont} Z`;
    const band = (von, bis, farbe, op) => von && bis ? `<rect x="${x(minuten(von))}" y="0" width="${Math.max(0, x(minuten(bis)) - x(minuten(von)))}" height="${H}" fill="${farbe}" opacity="${op}"/>` : "";
    const hJetzt = SONNE.hoehe(jetzt, lat, lng), xJ = x(minuten(jetzt)), yJ = Math.min(H - 8, y(hJetzt));
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffca28" stop-opacity="0.55"/><stop offset="1" stop-color="#ffca28" stop-opacity="0.05"/></linearGradient>
        <clipPath id="ueber"><rect x="0" y="0" width="${W}" height="${horizont}"/></clipPath>
      </defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="#1a237e" opacity="0.18" rx="10"/>
      ${band(z.daemm, z.daemmEnde, "#5c6bc0", 0.18)}
      ${band(z.auf, z.unter, "#90caf9", 0.16)}
      <path d="${flaeche}" fill="url(#sg)" clip-path="url(#ueber)"/>
      <path d="${pfad}" fill="none" stroke="#ffb300" stroke-width="2" clip-path="url(#ueber)"/>
      <path d="${pfad}" fill="none" stroke="#ffb300" stroke-width="1.5" stroke-dasharray="3 4" opacity="0.4"/>
      <line x1="0" x2="${W}" y1="${horizont}" y2="${horizont}" stroke="var(--secondary-text-color)" stroke-width="1" opacity="0.6"/>`;
    for (const h of [0, 6, 12, 18, 24]) {
      svg += `<line x1="${x(h * 60)}" x2="${x(h * 60)}" y1="${horizont}" y2="${horizont + 5}" stroke="var(--secondary-text-color)"/>
        <text x="${Math.min(W - 12, Math.max(12, x(h * 60)))}" y="${H - 4}" font-size="11" text-anchor="middle" fill="var(--secondary-text-color)">${h}:00</text>`;
    }
    for (const [d, t] of [[z.auf, "Aufgang"], [z.unter, "Untergang"]]) if (d) {
      svg += `<line x1="${x(minuten(d))}" x2="${x(minuten(d))}" y1="${horizont - 6}" y2="${horizont + 6}" stroke="#ff7043" stroke-width="2"/>
        <text x="${x(minuten(d))}" y="${horizont + 20}" font-size="12" text-anchor="middle" fill="var(--primary-text-color)">${uhr(d)}</text>`;
    }
    if (z.mittag) svg += `<text x="${x(minuten(z.mittag))}" y="${Math.max(12, y(mittagHoehe) - 8)}" font-size="11" text-anchor="middle" fill="var(--secondary-text-color)">${uhr(z.mittag)} · ${Math.round(mittagHoehe)}°</text>`;
    svg += `<line x1="${xJ}" x2="${xJ}" y1="0" y2="${H - 16}" stroke="var(--primary-text-color)" stroke-width="1" opacity="0.25"/>
      <circle cx="${xJ}" cy="${yJ}" r="9" fill="${hJetzt > 0 ? "#ffd54f" : "#9e9e9e"}" stroke="${hJetzt > 0 ? "#ff8f00" : "#616161"}" stroke-width="2"/>
    </svg>`;
    r.querySelector(".grafik").innerHTML = svg;

    // Werte
    const laenge = z.auf && z.unter ? (z.unter - z.auf) / 60000 : null;
    const laengeG = zg.auf && zg.unter ? (zg.unter - zg.auf) / 60000 : null;
    const diff = laenge != null && laengeG != null ? Math.round(laenge - laengeG) : null;
    const eintraege = [
      ["mdi:weather-sunset-up", "Morgendämmerung", uhr(z.daemm)], ["mdi:weather-sunny", "Sonnenaufgang", uhr(z.auf)],
      ["mdi:white-balance-sunny", "Mittag (Höchststand)", `${uhr(z.mittag)} · ${Math.round(mittagHoehe)}°`],
      ["mdi:weather-sunset-down", "Sonnenuntergang", uhr(z.unter)], ["mdi:weather-night", "Abenddämmerung", uhr(z.daemmEnde)],
      ["mdi:timer-sand", "Tageslänge", laenge != null ? `${dauer(laenge)}${diff != null ? ` (${diff >= 0 ? "+" : "−"}${Math.abs(diff)} min)` : ""}` : "–"],
    ];
    r.querySelector(".werte").innerHTML = eintraege.map(([ic, l, v]) =>
      `<div class="w"><ha-icon icon="${ic}"></ha-icon><div><div class="l">${l}</div><div class="v">${v}</div></div></div>`).join("");
    const az = this._hass.states["sun.sun"]?.attributes?.azimuth;
    r.querySelector(".fuss").textContent = `Sonne jetzt: ${hJetzt > 0 ? "über" : "unter"} dem Horizont, Höhe ${Math.round(hJetzt)}°${az != null ? `, Richtung ${Math.round(az)}°` : ""}. Tageslänge-Änderung gegenüber gestern in Klammern.`;
  }

  getCardSize() { return 5; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
}

if (!customElements.get(TYPE10)) customElements.define(TYPE10, SonnenKarte);
if (!window.customCards.some((c) => c.type === TYPE10)) {
  window.customCards.push({ type: TYPE10, name: "Sonnen-Karte", description: "Sonnenbogen mit Dämmerung, Auf- und Untergang, Mittag und Tageslänge", preview: true });
}

// Eingabemaske (visueller Editor) und Startwerte
{
  const ids = (hass) => Object.keys(hass?.states ?? {});
  const finde = (hass, re, dom = "sensor.") => ids(hass).find((id) => id.startsWith(dom) && re.test(id)) || "";
  const ent = (domain, extra = {}) => ({ entity: { filter: { domain, ...extra } } });
  const nummer = (min, max, step = 1, unit) => ({ number: { min, max, step, mode: "box", ...(unit ? { unit_of_measurement: unit } : {}) } });
  const auswahl = (opts) => ({ select: { mode: "dropdown", options: opts.map(([value, label]) => ({ value, label })) } });
  const text = { text: {} };
  const formular = (schema, labels, hilfen = {}) => () => ({
    schema,
    computeLabel: (s) => labels[s.name] ?? s.name,
    computeHelper: (s) => hilfen[s.name],
  });
  const setze = (typ, form, stub) => {
    const K = customElements.get(typ);
    if (!K) return;
    if (form) K.getConfigForm = form;
    if (stub) K.getStubConfig = (hass) => Object.fromEntries(Object.entries(stub(hass)).filter(([, v]) => v !== ""));
  };
  setze("sonnen-karte", formular([], {}), () => ({}));
}
}

console.info("%c sonnen-karte %c v1.0.0 ", "color:#fff;background:#03a9f4;font-weight:700", "color:#03a9f4");
