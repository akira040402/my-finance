// Grafik SVG sederhana (pengganti Recharts). Responsif lewat viewBox; warna lewat CSS.
import { esc, icon } from './dom.js';
import { formatRupiah } from '../core/money.js';

const W = 640;

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

const short = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace('.0', '')} M`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} jt`;
  if (a >= 1e3) return `${Math.round(n / 1e3)} rb`;
  return String(Math.round(n));
};

/** Grafik batang berkelompok. series: [{ name, color, values[] }], labels: string[] */
export function barChart({ labels, series, height = 240, ariaLabel = 'Grafik batang' }) {
  if (!labels.length) return emptyChart();
  const H = height;
  const pad = { t: 16, r: 12, b: 34, l: 52 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const maxVal = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const groupW = innerW / labels.length;
  const barW = Math.max(2, Math.min(18, (groupW * 0.7) / series.length));
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = pad.t + innerH - innerH * f;
      return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>
              <text class="axis" x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${short(maxVal * f)}</text>`;
    })
    .join('');
  const bars = labels
    .map((lab, i) => {
      const gx = pad.l + i * groupW + groupW / 2;
      const inner = series
        .map((s, si) => {
          const v = s.values[i] || 0;
          const h = (v / maxVal) * innerH;
          const x = gx - (series.length * barW) / 2 + si * barW;
          const y = pad.t + innerH - h;
          return v > 0
            ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${s.color}"><title>${esc(s.name)} ${esc(lab)}: ${esc(formatRupiah(v))}</title></rect>`
            : '';
        })
        .join('');
      const showLabel = labels.length <= 14 || i % Math.ceil(labels.length / 12) === 0;
      return `${inner}${showLabel ? `<text class="axis" x="${gx.toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(lab)}</text>` : ''}`;
    })
    .join('');
  const legend = series.map((s) => `<span class="legend-item"><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg><figcaption class="legend">${legend}</figcaption></figure>`;
}

/** Grafik garis. points: [{ label, value }] */
export function lineChart({ points, color = 'var(--navy)', height = 240, ariaLabel = 'Grafik garis' }) {
  if (points.length < 2) return emptyChart('Belum cukup data untuk grafik garis.');
  const H = height;
  const pad = { t: 16, r: 16, b: 34, l: 60 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const vals = points.map((p) => p.value);
  let min = Math.min(0, ...vals);
  let max = Math.max(0, ...vals);
  if (max === min) max = min + 1;
  const xFor = (i) => pad.l + (i / (points.length - 1)) * innerW;
  const yFor = (v) => pad.t + innerH - ((v - min) / (max - min)) * innerH;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${xFor(points.length - 1).toFixed(1)},${yFor(min).toFixed(1)} L${xFor(0).toFixed(1)},${yFor(min).toFixed(1)} Z`;
  const ticks = [0, 0.5, 1]
    .map((f) => {
      const v = min + (max - min) * f;
      const y = yFor(v);
      return `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}"/>
              <text class="axis" x="${pad.l - 6}" y="${y + 4}" text-anchor="end">${short(v)}</text>`;
    })
    .join('');
  const xLabels = [0, Math.floor((points.length - 1) / 2), points.length - 1]
    .map((i) => `<text class="axis" x="${xFor(i).toFixed(1)}" y="${H - 10}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${esc(points[i].label)}</text>`)
    .join('');
  const dots = points.length <= 40
    ? points.map((p, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.value).toFixed(1)}" r="3" fill="${color}"><title>${esc(p.label)}: ${esc(formatRupiah(p.value))}</title></circle>`).join('')
    : '';
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}" preserveAspectRatio="xMidYMid meet">
    ${ticks}<path d="${area}" fill="${color}" opacity=".08"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>${dots}${xLabels}</svg></figure>`;
}

/** Batang horizontal berbasis HTML (lebar selalu pas di layar kecil). */
export function hBars(items, { total = null } = {}) {
  if (!items.length) return emptyChart('Belum ada data pengeluaran pada periode ini.');
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<ul class="hbars">${items
    .map((it) => {
      const pct = Math.max(2, (it.value / max) * 100);
      const share = total ? ` · ${Math.round((it.value / total) * 100)}%` : '';
      return `<li><div class="hbar-head"><span>${esc(it.label)}</span><strong>${esc(formatRupiah(it.value))}${share}</strong></div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${pct.toFixed(1)}%;background:${it.color || 'var(--expense)'}"></div></div></li>`;
    })
    .join('')}</ul>`;
}

export function emptyChart(text = 'Belum ada data untuk ditampilkan.') {
  return `<div class="empty-chart">${icon('chart')}<p>${esc(text)}</p></div>`;
}
