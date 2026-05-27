/**
 * SOLENVER - Servidor local SIPS
 * Exposa el scraper de Total Energies com a API HTTP local
 * Executa: node server.js
 * Escolta a: http://localhost:3333/sips
 */
const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const AdmZip = require('adm-zip');

require('dotenv').config();
const app  = express();
const PORT = process.env.PORT || 3333;
const DOWNLOADS = path.join(__dirname, 'downloads');
const DIES_MES   = [31,28,31,30,31,30,31,31,30,31,30,31];
const MES_CLAUS  = ['gen','feb','mar','abr','mai','jun','jul','ago','set','oct','nov','des'];

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// Converteix valor Wh del fitxer SIPS (pot tenir coma com a milers o decimal) → kWh
function parseWh(val) {
  if (!val) return 0;
  const s = String(val).trim();
  // Detectar si la coma és separador de milers: "208,003" (3 dígits exactes après la coma sense punt)
  // vs decimal: "208,50" (menys de 3 dígits, o 2 dígits)
  const milers = /^[\d.]+,\d{3}$/.test(s);  // ex: "208,003" o "1.208,003"
  let num;
  if (milers) {
    // Coma = milers → eliminar comes i punts de milers
    num = parseFloat(s.replace(/\./g, '').replace(/,/g, ''));
  } else {
    // Coma = decimal → format europeu estàndard
    num = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  return (isNaN(num) ? 0 : num) / 1000; // Wh → kWh
}

// ── Parseja HTML-XLS de SIPS ───────────────────────────────────────
function parseSipsHtml(html) {
  // Extreu files de la taula HTML
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(html)) !== null) {
    const cells = [];
    const tdRe2 = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let tdMatch;
    while ((tdMatch = tdRe2.exec(trMatch[1])) !== null) {
      cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
    }
    if (cells.some(c => c)) rows.push(cells);
  }
  if (rows.length < 2) throw new Error('No s\'han trobat dades al fitxer SIPS');

  const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, ''));
  console.log('[SIPS] Headers detectats:', headers);
  console.log('[SIPS] Primera fila de dades:', rows[1]);

  // Detectar columnes P1-P6 per nom (permissiu)
  const pCols = [1,2,3,4,5,6].map(n => headers.findIndex(h => h.includes('p'+n)));
  const [hasP1Col, hasP2Col, hasP3Col, hasP4Col, hasP5Col, hasP6Col] = pCols;

  if (hasP1Col === -1) throw new Error('No s\'han trobat columnes P1/P2/P3. Headers: ' + headers.join(', '));

  // Quants períodes té realment el fitxer?
  const N = pCols.filter(i => i !== -1).length || 3;

  // ── FORMAT B prioritari: Dades anuals amb columnes consumo_anual_p1..p6 ──
  const iPAnual = [1,2,3,4,5,6].map(n =>
    headers.findIndex(h => h.includes('anual') && h.includes('p'+n)));
  const iP1anual = iPAnual[0];

  if (iP1anual !== -1 && rows[1]) {
    const data = rows[1];
    const pa = iPAnual.map((idx, n) => {
      const fallbackIdx = iP1anual + n;
      const i = idx >= 0 ? idx : (fallbackIdx < data.length ? fallbackIdx : -1);
      return i >= 0 ? (parseFloat((data[i]||'0').replace(',','.')) || 0) : 0;
    });
    const total = pa.reduce((s,v)=>s+v, 0);
    console.log('[SIPS] Format B detectat → P1-P'+N+':', pa, 'Total:', total);
    const mensual = {};
    MES_CLAUS.forEach((k, i) => {
      const ratio = DIES_MES[i] / 365;
      mensual[k] = {};
      pa.forEach((v, n) => { mensual[k]['p'+(n+1)] = Math.round(v * ratio); });
    });
    const is6P = N >= 4 && pa.slice(3).some(v => v > 0);
    return { consumos: mensual, consum_anual: Math.round(total),
             tariff_type: is6P ? '3td' : '2td', num_periodes: is6P ? 6 : 3 };
  }

  // ── FORMAT A: Períodes de facturació ──
  let iDateStart = headers.findIndex(h => h.match(/fecha_inicio|data_inici|fecha.*inicio|inici|inicio/));
  let iDateEnd   = headers.findIndex(h => h.match(/fecha_fin|data_fi|fecha.*fin|fi$|fin$/));

  if (iDateStart === -1 || iDateEnd === -1) {
    const isDate = v => v && /^\d{4}-\d{2}-\d{2}/.test(v.trim());
    const dateColIdxs = rows[1].slice(0, 3).map((v, i) => isDate(v) ? i : -1).filter(i => i !== -1);
    console.log('[SIPS] Columnes dates (primeres 3):', dateColIdxs);
    if (dateColIdxs.length >= 2) {
      iDateStart = dateColIdxs[0];
      iDateEnd   = dateColIdxs[1];
    }
  }

  console.log('[SIPS] Format A → iDateStart:', iDateStart, 'iDateEnd:', iDateEnd, 'P1-P'+N+':', pCols);

  if (iDateStart !== -1 && iDateEnd !== -1) {
    const validCols = pCols.map((idx, n) => ({ n: n+1, idx })).filter(c => c.idx !== -1);
    const periodes = rows.slice(1).map(r => {
      const obj = { inici: new Date(r[iDateStart]), fi: new Date(r[iDateEnd]) };
      validCols.forEach(c => { obj['p'+c.n] = parseWh(r[c.idx]); });
      return obj;
    }).filter(p => {
      if (isNaN(p.inici) || isNaN(p.fi)) return false;
      return validCols.some(c => (p['p'+c.n] || 0) > 0);
    });

    console.log('[SIPS] Total períodes vàlids:', periodes.length);

    const ara   = new Date();
    const limit = new Date(ara.getFullYear() - 1, ara.getMonth() - 1, 1);
    const recents = periodes.filter(p => p.fi >= limit);
    console.log('[SIPS] Períodes usats:', recents.length, '(des de', limit.toISOString().substring(0,10), ')');

    const mensual = {};
    MES_CLAUS.forEach(k => {
      mensual[k] = {};
      validCols.forEach(c => { mensual[k]['p'+c.n] = 0; });
    });

    recents.forEach(p => {
      const dies_periode = Math.round((p.fi - p.inici) / 86400000);
      if (dies_periode <= 0) return;
      for (let d = new Date(p.inici); d < p.fi; d.setDate(d.getDate() + 1)) {
        const key = MES_CLAUS[d.getMonth()];
        validCols.forEach(c => { mensual[key]['p'+c.n] += (p['p'+c.n] || 0) / dies_periode; });
      }
    });

    MES_CLAUS.forEach(k => {
      validCols.forEach(c => { mensual[k]['p'+c.n] = Math.round(mensual[k]['p'+c.n]); });
    });

    const consumAnual = MES_CLAUS.reduce((s,k) =>
      s + validCols.reduce((t,c) => t + (mensual[k]['p'+c.n]||0), 0), 0);
    const is6P = N >= 4 && recents.some(p => validCols.slice(3).some(c => (p['p'+c.n]||0) > 0));
    console.log('[SIPS] Resultat mensual:', JSON.stringify(mensual));
    return { consumos: mensual, consum_anual: consumAnual,
             tariff_type: is6P ? '3td' : '2td', num_periodes: is6P ? 6 : 3 };
  }

  throw new Error('Format de fitxer SIPS no reconegut');
}

// ── GET /health ────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, port: PORT }));

// ── GET /casos-exit ────────────────────────────────────────────────
// Retorna les imatges de la carpeta Desktop/imatges exemple com a base64, per categoria
app.get('/casos-exit', (req, res) => {
  const fs   = require('fs');
  const path = require('path');
  const folder = 'C:\\Users\\SOLENVER-OF15\\Desktop\\imatges exemple';
  const categories = [
    { label: 'Autoconsum Domèstic',                    re: /autoconsum.domestic/i },
    { label: 'Autoconsum Industrial',                   re: /^industrial/i },
    { label: "Autoconsum Estacions Depuradores (EDAR)", re: /^edar/i },
    { label: "Instal·lacions Solars Aïllades",          re: /^aillada/i },
  ];
  try {
    const files = fs.readdirSync(folder).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).sort();
    const result = categories.map(cat => ({
      label: cat.label,
      images: files
        .filter(f => cat.re.test(f))
        .map(f => {
          const buf  = fs.readFileSync(path.join(folder, f));
          const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg';
          return `data:${mime};base64,${buf.toString('base64')}`;
        }),
    })).filter(c => c.images.length > 0);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /pdf ──────────────────────────────────────────────────────
// Rep { html, footer, header } i retorna un PDF binari generat amb Playwright
// Estratègia: portada (sense header/footer) + pàgines interiors (amb header/footer) → merge pdf-lib
app.post('/pdf', async (req, res) => {
  const { html, footer } = req.body;
  let header = req.body.header;
  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Falta el camp html' });
  }
  let browser;
  try {
    const { chromium } = require('playwright');
    const { PDFDocument } = require('pdf-lib');
    const executablePath = process.env.CHROMIUM_PATH || undefined;
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

    const hasFooter = footer && typeof footer === 'string' && footer.trim().length > 20;
    let hasHeader = header && typeof header === 'string' && header.trim().length > 20;

    // ── Convertir URLs externes del header a base64 (Playwright header template no pot carregar URLs externes) ──
    if (hasHeader) {
      const imgUrlRe = /src="(https?:\/\/[^"]+)"/g;
      let m;
      while ((m = imgUrlRe.exec(header)) !== null) {
        const imgUrl = m[1];
        try {
          const resp = await fetch(imgUrl, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (resp.ok) {
            const buf  = await resp.arrayBuffer();
            const mime = (resp.headers.get('content-type') || 'image/png').split(';')[0].trim();
            const b64  = Buffer.from(buf).toString('base64');
            header = header.replace(imgUrl, `data:${mime};base64,${b64}`);
            console.log('[PDF] Logo header convertit a base64, mime:', mime, 'bytes:', buf.byteLength);
          }
        } catch(e) { console.warn('[PDF] No s\'ha pogut convertir URL header a base64:', e.message); }
      }
    }

    // ── Separar portada de les pàgines interiors ──
    // El marcador <!-- §01 indica on comença la primera pàgina interior
    const splitIdx  = html.indexOf('<!-- §01');
    const bodyOpen  = html.indexOf('<body>');
    const bodyClose = html.lastIndexOf('</body>');

    let finalPdf;

    if (splitIdx !== -1 && bodyOpen !== -1 && bodyClose !== -1) {
      const portadaCssForce = `<style>
        html,body{height:297mm!important;max-height:297mm!important;overflow:hidden!important;margin:0!important;padding:0!important}
        .portada{height:297mm!important;max-height:297mm!important;overflow:hidden!important}
      </style>`;
      const headClose = html.indexOf('</head>');
      const baseHead = html.substring(0, bodyOpen + 6); // tot fins a <body> (inclòs)
      // head de portada: injecta CSS crític just abans de </head>
      const portadaHead = headClose !== -1
        ? html.substring(0, headClose) + portadaCssForce + html.substring(headClose, bodyOpen + 6)
        : baseHead;
      // Força body de portada a exactament 297mm — mai desbordarà a pàgina 2
      const portadaBody = '<body style="height:297mm;max-height:297mm;overflow:hidden;margin:0;padding:0">';
      const portadaHtml = portadaHead.replace('<body>', portadaBody) + html.substring(bodyOpen + 6, splitIdx) + '</body></html>';
      const innerHtml   = baseHead + html.substring(splitIdx, bodyClose) + '</body></html>';

      // Portada: PDF natiu, pageRanges:'1' garanteix 1 pàgina
      const p1 = await browser.newPage();
      await p1.setViewportSize({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await p1.setContent(portadaHtml, { waitUntil: 'networkidle' });

      // Injecta mapa satellite (Leaflet+ESRI) si portada-aerial té data-lat/lng
      try {
        const hasAerialCoords = await p1.$('[data-lat][data-lng].portada-aerial');
        if (hasAerialCoords) {
          await p1.addScriptTag({ url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
          await p1.addStyleTag({ url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' });
          await p1.evaluate(() => {
            const el = document.querySelector('.portada-aerial[data-lat]');
            const lat = parseFloat(el.dataset.lat);
            const lng = parseFloat(el.dataset.lng);
            el.style.cssText += ';position:relative;overflow:hidden';
            const mapDiv = document.createElement('div');
            mapDiv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0';
            el.appendChild(mapDiv);
            const map = L.map(mapDiv, { zoomControl:false, attributionControl:false, dragging:false });
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
              maxZoom: 21
            }).addTo(map);
            map.setView([lat, lng], 20);
            L.marker([lat, lng]).addTo(map);
          });
          await p1.waitForTimeout(3000); // espera tiles satellite
          console.log('[PDF] Mapa satellite Leaflet+ESRI injectat a portada-aerial');
        }
      } catch(e) { console.warn('[PDF] No s\'ha pogut injectar el mapa portada:', e.message); }

      // Reconstrueix la barra de KPIs com a element fix al fons de la pàgina
      // position:fixed+bottom:0 en PDF Playwright = fons de la pàgina, bypassa overflow:hidden i stacking
      try {
        const kpisDebug = await p1.evaluate(() => {
          const oldKpis = document.querySelector('.portada-kpis');
          if (!oldKpis) return { found: false };
          // Extreu les dades de cada kbox
          const items = Array.from(oldKpis.querySelectorAll('.kbox')).map(box => ({
            val: box.querySelector('.kval')?.textContent.trim() || '',
            lbl: box.querySelector('.klbl')?.textContent.trim() || ''
          }));
          oldKpis.remove();
          // Crea nova barra KPIs fixed al fons
          const bar = document.createElement('div');
          bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#fff;display:grid;grid-template-columns:repeat(4,1fr);padding:16px 20mm;gap:14px;box-shadow:0 -6px 28px rgba(0,0,0,0.25)';
          items.forEach(({val, lbl}) => {
            const box = document.createElement('div');
            box.style.cssText = 'padding:10px 14px;border-left:3px solid #22c55e;background:#f8fafc;border-radius:0 8px 8px 0';
            box.innerHTML = `<div style="font-size:18pt;font-weight:900;line-height:1.1;color:#1a5c2e;margin-bottom:4px">${val}</div><div style="font-size:8pt;color:#64748b;text-transform:uppercase;letter-spacing:0.9px;font-weight:600">${lbl}</div>`;
            bar.appendChild(box);
          });
          document.body.appendChild(bar);
          return { found: true, items: items.map(i => i.val + ' / ' + i.lbl) };
        });
        console.log('[PDF] portada-kpis rebuilt:', JSON.stringify(kpisDebug));
      } catch(e) { console.warn('[PDF] No s\'ha pogut reconstruir kpis:', e.message); }

      // Logo ja ve com a data URL incrustada a header_html des de preparar_current.js (logoSrc=base64)

      const coverBuf = await p1.pdf({
        format: 'A4',
        printBackground: true,
        pageRanges: '1',
        margin: { top: '0', right: '0', bottom: '0', left: '0' }
      });
      console.log(`[PDF] coverBuf generat`);
      await p1.close();

      // Pàgines interiors: amb header/footer i marges
      const p2 = await browser.newPage();
      await p2.setViewportSize({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await p2.setContent(innerHtml, { waitUntil: 'networkidle' });

      // Injecta mapa satellite Leaflet a la vista aèria interior si té data-lat/lng
      try {
        const hasInteriorMap = await p2.$('.vista-aeria[data-lat][data-lng]');
        if (hasInteriorMap) {
          await p2.addScriptTag({ url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
          await p2.addStyleTag({ url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' });
          await p2.evaluate(() => {
            const el = document.querySelector('.vista-aeria[data-lat][data-lng]');
            const lat = parseFloat(el.dataset.lat);
            const lng = parseFloat(el.dataset.lng);
            const mapDiv = document.createElement('div');
            mapDiv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:0';
            el.insertBefore(mapDiv, el.firstChild);
            const map = L.map(mapDiv, { zoomControl:false, attributionControl:false, dragging:false });
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
              maxZoom: 21
            }).addTo(map);
            map.setView([lat, lng], 20);
            L.marker([lat, lng]).addTo(map);
          });
          await p2.waitForTimeout(3000);
          console.log('[PDF] Mapa satellite Leaflet+ESRI injectat a vista-aeria interior');
        }
      } catch(e) { console.warn('[PDF] No s\'ha pogut injectar el mapa interior:', e.message); }

      const innerBuf = await p2.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: hasHeader || hasFooter,
        headerTemplate: hasHeader ? header : '<div style="font-size:1px"> </div>',
        footerTemplate: hasFooter ? footer : '<div style="font-size:1px"> </div>',
        margin: { top: '14mm', right: '0', bottom: '10mm', left: '0' }
      });
      await p2.close();

      // Merge portada + interiors
      const merged    = await PDFDocument.create();
      const coverDoc  = await PDFDocument.load(coverBuf);
      const innerDoc  = await PDFDocument.load(innerBuf);
      const cpCover   = await merged.copyPages(coverDoc, [0]); // sempre 1 pàgina de portada
      const cpInner   = await merged.copyPages(innerDoc, innerDoc.getPageIndices());
      cpCover.forEach(p => merged.addPage(p));
      cpInner.forEach(p => merged.addPage(p));
      finalPdf = Buffer.from(await merged.save());
      console.log(`[PDF] Merge OK: portada(${cpCover.length}) + interiors(${cpInner.length})`);

    } else {
      // Fallback: tot en un render (portada tindrà header)
      console.warn('[PDF] Marcador §01 no trobat, render complet sense split');
      const page = await browser.newPage();
      await page.setViewportSize({ width: 794, height: 1123, deviceScaleFactor: 2 });
      await page.setContent(html, { waitUntil: 'networkidle' });
      finalPdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: hasHeader || hasFooter,
        headerTemplate: hasHeader ? header : '<div style="font-size:1px"> </div>',
        footerTemplate: hasFooter ? footer : '<div style="font-size:1px"> </div>',
        margin: { top: '14mm', right: '0', bottom: '10mm', left: '0' }
      });
      await page.close();
    }

    await browser.close();
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="estudi.pdf"');
    res.send(finalPdf);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('[PDF ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /pvgis ─────────────────────────────────────────────────────
// Proxy per evitar problemes CORS del navegador amb l'API PVGIS
// Query params: lat, lng, angle (inclinació), aspect (acimut)
app.get('/pvgis', async (req, res) => {
  const { lat = 41.39, lng = 2.17, angle = 30, aspect = 0 } = req.query;
  const url = `https://re.jrc.ec.europa.eu/api/v5_3/PVcalc?lat=${lat}&lon=${lng}&peakpower=1&loss=19&angle=${angle}&aspect=${aspect}&outputformat=json`;
  try {
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      https.get(url, r => {
        let body = '';
        r.on('data', chunk => body += chunk);
        r.on('end', () => resolve(body));
      }).on('error', reject);
    });
    const json = JSON.parse(data);
    const monthly = (json.outputs?.monthly?.fixed || []).map(r => r.E_m);
    if (monthly.length !== 12) return res.status(502).json({ error: 'PVGIS no ha retornat 12 mesos' });
    res.json({ ok: true, monthly });
  } catch (err) {
    console.error('[PVGIS ERROR]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── POST /sips ─────────────────────────────────────────────────────
app.post('/sips', async (req, res) => {
  const cups = (req.body.cups || '').trim().toUpperCase();
  if (!cups || cups.length < 18) {
    return res.status(400).json({ success: false, error: 'CUPS invàlid' });
  }

  console.log(`[SIPS] Iniciant scraper per CUPS: ${cups}`);

  // Executar scraper
  const scraperPath = path.join(__dirname, 'scraper.js');
  await new Promise((resolve, reject) => {
    const proc = execFile('node', [scraperPath, cups], {
      cwd: __dirname,
      timeout: 120000,
      env: { ...process.env }
    }, (err, stdout, stderr) => {
      console.log('[SIPS stdout]', stdout);
      if (stderr) console.error('[SIPS stderr]', stderr);
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  }).catch(err => { throw new Error('Scraper error: ' + err.message); });

  // Llegir ZIP resultant
  const zipPath = path.join(DOWNLOADS, `${cups}.zip`);
  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP no trobat: ${zipPath}`);
  }

  const zip  = new AdmZip(zipPath);
  const entry = zip.getEntries().find(e => e.name.match(/\.(xls|xlsx|csv|html?)$/i));
  if (!entry) throw new Error('No s\'ha trobat cap fitxer de dades al ZIP');

  const content = entry.getData().toString('latin1');
  console.log(`[SIPS] Fitxer extret: ${entry.name} (${content.length} chars)`);

  const result = parseSipsHtml(content);
  console.log(`[SIPS] Consum anual: ${result.consum_anual} kWh`);

  res.json({ success: true, cups, ...result });
});

// ── Error handler ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[SIPS ERROR]', err.message);
  res.status(500).json({ success: false, error: err.message });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor SIPS escoltant a http://localhost:${PORT}`);
  console.log(`   POST /sips  { "cups": "ES0031..." }`);
});
