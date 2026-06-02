// ─── INPUTS ───
const raw = $('POST /solenver/generar-estudi').first().json;
const input = raw.body || raw;
const lang = (input.idioma || 'ca').toLowerCase();
const s = (ca, es) => lang === 'es' ? es : ca;
// Textos de l'agent IA (opcionals)
const informeIA = input.informe || {};
const kpis = (input.kpis && input.kpis.kwp) ? input.kpis : $('Calcular KPIs estudi').first().json;

// ─── COSTOS DES DEL SHEET ───
const costosRaw = $('Llegir costos PDF').all().map(i => i.json);
const C = Object.fromEntries(costosRaw.map(r => [r.clau, parseFloat(r.valor) || 0]));
const C_MO_BASE     = C.ma_obra_base      || 600;
const C_MO_MOD      = C.ma_obra_per_modul || 80;
const C_PROJECTE    = C.projecte_tecnic   || 550;
const C_CABLES_M    = C.cables_per_metre  || 4.50;  // EUR/metre cable DC+AC+MC4
const C_MARGE       = (() => { const m = parseFloat(input.marge_comercial) || parseFloat(input.economics?.marge_comercial); return m > 0 ? m : (C.marge || 0.35); })();

// BUG 1: Decodifica escape literals \uXXXX en textos IA (doble encoding UTF-8)
const decodeStr = (s) => {
  if (!s || typeof s !== 'string') return s;
  return s.replace(/\\u([0-9a-fA-F]{4})/g,
    (_, code) => String.fromCharCode(parseInt(code, 16)));
};

// BUG 2: Substitueix números KPI estimats per l'IA amb els valors calculats reals
const injectKpisText = (text) => {
  if (!text || typeof text !== 'string') return text;
  let t = text;
  if (kpis.retorn_anys != null)
    t = t.replace(/(\b(?:retorn|amortitz)[^\d]{0,30})(\d+)(\s*anys)/gi, `$1${kpis.retorn_anys}$3`);
  if (kpis.tir_pct != null)
    t = t.replace(/(TIR[^0-9]{0,15})(\d+[.,]?\d*)(\s*%)/gi, `$1${kpis.tir_pct}$3`);
  if (kpis.van_25anys != null)
    t = t.replace(/(VAN[^0-9]{0,15})(\d[\d.,]*)(\s*EUR)/gi, `$1${fmt(kpis.van_25anys)}$3`);
  if (kpis.estalvi_any1 != null)
    t = t.replace(/(estalvi[^0-9]{0,20})(\d[\d.,]*)(\s*EUR)/gi, `$1${fmt(kpis.estalvi_any1)}$3`);
  if (kpis.produccio_anual != null)
    t = t.replace(/(produirà\s+)(\d[\d.,]*)(\s*kWh)/gi, `$1${fmt(kpis.produccio_anual)}$3`);
  if (kpis.pct_autoconsum != null)
    t = t.replace(/(autoconsum[^0-9]{0,25})(\d+[.,]?\d*)(\s*%)/gi, `$1${fmt(kpis.pct_autoconsum,1)}$3`);
  if (kpis.cost_actual_anual != null)
    t = t.replace(/(cost energètic[^0-9]{0,30})(\d[\d.,]*)(\s*EUR)/gi, `$1${fmt(kpis.cost_actual_anual,0)}$3`);
  return t;
};
const modulsData       = $('Llegir catàleg PDF').all().map(i => i.json);
const inversorsData    = $('Llegir inversors PDF').all().map(i => i.json);
const muntAtgesData    = $('Llegir muntatges PDF').all().map(i => i.json);
const comercialsData   = $('Llegir comercials PDF').all().map(i => i.json);
const configData       = $('Llegir configuració').all().map(i => i.json);
const mantenimentsData = $('Llegir manteniments PDF').all().map(i => i.json);
const config = {};
configData.forEach(r => { if (r.clau) config[r.clau] = r.valor || ''; });
const driveUrl = (id) => id ? `https://lh3.googleusercontent.com/d/${id}=s0` : '';

// ─── LOOKUP CATÀLEG ───
const modul    = modulsData.find(r => r.id === input.modul_id) || modulsData[0] || {};
const inversor = inversorsData.find(r => r.id === input.inversor_id) || inversorsData[0] || {};
const muntatge = muntAtgesData.find(r => r.id === (input.muntatge_id || input.tipus_coberta)) || muntAtgesData[0] || {};
const comercial = comercialsData.find(c => c.id === input.comercial_id) || comercialsData[0] || {};

// ─── DADES BASE ───
const numModuls = parseInt(input.num_moduls || kpis.num_moduls || 10);
const today = new Date();
const dataStr = today.toLocaleDateString(lang === 'es' ? 'es-ES' : 'ca-ES', {day:'2-digit', month:'long', year:'numeric'});
const idEstudi = 'SLV-' + today.getFullYear() +
  String(today.getMonth()+1).padStart(2,'0') +
  String(today.getDate()).padStart(2,'0') + '-' +
  String(Math.floor(Math.random()*9000)+1000);

const fmt  = (v, d=0) => v != null ? parseFloat(v).toLocaleString('ca-ES', {maximumFractionDigits:d}) : '-';
const fmtE = v => fmt(v,0) + ' EUR';
const fmtK = v => fmt(v,0) + ' kWh';

// ─── CONSUMOS ───
// Suporta dos formats:
// Simple:   {gen: 700, feb: 650, ...} → només total mensual
// Complet:  {gen: {p1: 179, p2: 171, p3: 493}, feb: {...}, ...} → P1/P2/P3
const mesClaus = ['gen','feb','mar','abr','mai','jun','jul','ago','set','oct','nov','des'];
const mesNoms  = lang === 'es'
  ? ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  : ['Gener','Febrer','Març','Abril','Maig','Juny','Juliol','Agost','Setembre','Octubre','Novembre','Desembre'];
const consumosObj = input.consumos || {};
const _consumMensualTotal = kpis.mensual ? kpis.mensual.reduce((s,m) => s + (m.consum||0), 0) : 0;
const preuMig = kpis.preu_mig_kwh
  || (_consumMensualTotal > 0 && kpis.cost_actual_anual ? Math.round(kpis.cost_actual_anual / _consumMensualTotal * 10000) / 10000 : null)
  || 0.1287;
const preuExcVal  = kpis.preu_excedent || input.preu_excedent || 0.07;
const _tariffType = (kpis.tariff_type || input.tariff_type || input.tarifa || '2td').toLowerCase();
const numPeriodes = kpis.num_periodes || (_tariffType === '3td' || _tariffType.startsWith('6') ? 6 : 3);
const preusPer = [
  kpis.preu_p1 || input.preu_p1 || 0.2267,
  kpis.preu_p2 || input.preu_p2 || 0.1384,
  kpis.preu_p3 || input.preu_p3 || 0.0877,
  kpis.preu_p4 || input.preu_p4 || 0.060,
  kpis.preu_p5 || input.preu_p5 || 0.050,
  kpis.preu_p6 || input.preu_p6 || 0.040,
].slice(0, numPeriodes);

// Detectar si tenim períodes detallats
const primeraClau = mesClaus.find(k => consumosObj[k] !== undefined);
const tePeriodes = primeraClau && typeof consumosObj[primeraClau] === 'object' && consumosObj[primeraClau] !== null;

let totalConsum = 0, totalCost = 0;
const totalsPer = new Array(numPeriodes).fill(0);
const filesConsum = mesClaus.map((clau, i) => {
  const raw = consumosObj[clau];
  const pVals = new Array(numPeriodes).fill(0);
  let total = 0;
  if (tePeriodes && raw && typeof raw === 'object') {
    for (let n = 0; n < numPeriodes; n++) pVals[n] = parseFloat(raw['p'+(n+1)] || 0);
    total = pVals.reduce((a,b)=>a+b, 0);
  } else {
    total = parseFloat(raw || 0);
    // Distribució estimada per periodicitat típica
    pVals[0] = Math.round(total * 0.21);
    pVals[1] = Math.round(total * 0.22);
    pVals[2] = total - pVals[0] - pVals[1];
  }
  const cost = tePeriodes
    ? pVals.reduce((s, v, n) => s + v * preusPer[n], 0)
    : total * preuMig;
  totalConsum += total; totalCost += cost;
  pVals.forEach((v, n) => { totalsPer[n] += v; });
  return {m: mesNoms[i], pVals, total, cost};
});

const consumAnual = totalConsum > 0 ? totalConsum : (kpis.consum_anual || input.consum_anual || 0);
const costActual  = kpis.cost_actual_anual || (totalCost > 0 ? totalCost : consumAnual * preuMig);

// ─── HTML TAULA CONSUMS (adaptativa N períodes o simple) ───
const htmlTaulaConsums = tePeriodes
  ? `<table>
  <thead><tr><th>${s('Mes','Mes')}</th>${Array.from({length:numPeriodes},(_,n)=>`<th>P${n+1} (kWh)</th>`).join('')}<th>${s('Total (kWh)','Total (kWh)')}</th><th>${s('Cost (EUR)','Coste (EUR)')}</th></tr></thead>
  <tbody>
    ${filesConsum.map(r=>`<tr><td><strong>${r.m}</strong></td>${r.pVals.map(v=>`<td>${fmt(v)}</td>`).join('')}<td>${fmt(r.total)}</td><td>${fmt(r.cost,2)}</td></tr>`).join('\n    ')}
  </tbody>
  <tfoot><tr><td><strong>TOTAL</strong></td>${totalsPer.map(v=>`<td><strong>${fmt(v)}</strong></td>`).join('')}<td><strong>${fmt(consumAnual)}</strong></td><td><strong>${fmt(costActual,2)}</strong></td></tr></tfoot>
</table>`
  : `<table>
  <thead><tr><th>${s('Mes','Mes')}</th><th>${s('Consum (kWh)','Consumo (kWh)')}</th><th>${s('Cost estimat (EUR)','Coste estimado (EUR)')}</th></tr></thead>
  <tbody>
    ${filesConsum.map(r=>`<tr><td><strong>${r.m}</strong></td><td>${fmt(r.total)}</td><td>${fmt(r.cost,2)}</td></tr>`).join('\n    ')}
  </tbody>
  <tfoot><tr><td><strong>TOTAL</strong></td><td><strong>${fmt(consumAnual)}</strong></td><td><strong>${fmt(costActual,2)}</strong></td></tr></tfoot>
</table>`;

// ─── HTML TAULA PRODUCCIÓ ───
const mensual = kpis.mensual || [];
const htmlTaulaProduccio = `<table style="font-size:8pt">
  <thead style="display:table-row-group"><tr><th style="padding:3px 8px">${s('Mes','Mes')}</th><th style="padding:3px 8px">${s('Prod FV (kWh)','Prod. FV (kWh)')}</th><th style="padding:3px 8px">${s('Consum (kWh)','Consumo (kWh)')}</th><th style="padding:3px 8px">${s('Autoconsum (kWh)','Autoconsumo (kWh)')}</th><th style="padding:3px 8px">${s('Excedent (kWh)','Excedente (kWh)')}</th><th style="padding:3px 8px">${s('Xarxa (kWh)','Red (kWh)')}</th><th style="padding:3px 8px">${s('Estalvi (EUR)','Ahorro (EUR)')}</th></tr></thead>
  <tbody style="page-break-inside:avoid;break-inside:avoid">
    ${mensual.map(m=>`<tr><td style="padding:3px 8px"><strong>${m.mes}</strong></td><td style="padding:3px 8px">${m.produccio}</td><td style="padding:3px 8px">${m.consum}</td><td style="padding:3px 8px">${m.autoconsum}</td><td style="padding:3px 8px">${m.excedent}</td><td style="padding:3px 8px">${m.xarxa}</td><td style="padding:3px 8px">${m.estalvi}</td></tr>`).join('\n    ')}
  </tbody>
</table>`;

// ─── HTML TAULA MÒDUL ───
const htmlTaulaModul = `<table>
  <tbody>
    <tr><td style="width:50%;font-weight:600">${s('Fabricant','Fabricante')}</td><td>${modul.marca || 'JINKO SOLAR'}</td></tr>
    <tr><td style="font-weight:600">Model</td><td>${modul.model || 'Tiger Neo N-type'}</td></tr>
    <tr><td style="font-weight:600">${s('Potència màxima','Potencia máxima')}</td><td>${modul.potencia_wp || 510} Wp</td></tr>
    <tr><td style="font-weight:600">${s('Eficiència','Eficiencia')}</td><td>${modul.eficiencia || 22}%</td></tr>
    <tr><td style="font-weight:600">${s('Degradació','Degradación')}</td><td>0.40% ${s('anual','anual')}</td></tr>
    <tr><td style="font-weight:600">${s('Garantia','Garantía')}</td><td>${modul.garantia_anys || 25} ${s('anys','años')}</td></tr>
  </tbody>
</table>`;

// ─── HTML TAULA INVERSOR ───
const isTrifasic = (inversor.trifasic === true || String(inversor.trifasic).toUpperCase() === 'TRUE');
const htmlTaulaInversor = `<table>
  <tbody>
    <tr><td style="width:50%;font-weight:600">${s('Fabricant','Fabricante')}</td><td>${inversor.marca || 'HUAWEI'}</td></tr>
    <tr><td style="font-weight:600">Model</td><td>${inversor.model || 'SUN2000'}</td></tr>
    <tr><td style="font-weight:600">${s('Potència AC','Potencia AC')}</td><td>${inversor.potencia_kw || 6} kW</td></tr>
    <tr><td style="font-weight:600">${s('Connexió','Conexión')}</td><td>${isTrifasic ? s('Trifàsica','Trifásica') : s('Monofàsica','Monofásica')}</td></tr>
    <tr><td style="font-weight:600">${s('Garantia','Garantía')}</td><td>${inversor.garantia_anys || 10} ${s('anys','años')}</td></tr>
  </tbody>
</table>`;

// ─── HTML TAULA CASHFLOW ───
const cf = kpis.cashflow || [];
const htmlTaulaCashflow = `<table>
  <thead><tr><th>${s('Any','Año')}</th><th>${s('Estalvi anual (EUR)','Ahorro anual (EUR)')}</th><th>${s('Flux acumulat (EUR)','Flujo acumulado (EUR)')}</th><th>${s('Estat','Estado')}</th></tr></thead>
  <tbody>
    ${cf.filter(c=>c.any>0).map(c=>{
      const estalvi = Math.round((kpis.estalvi_any1||0)*Math.pow(1.015,c.any-1));
      const acum = c.flux_acumulat ?? c.acumulat ?? 0;
      const estat = acum < 0
        ? `<span style="color:#C62828">${s('En recuperació','En recuperación')}</span>`
        : `<span style="color:#2E7D32;font-weight:700">✓ ${s('Recuperat','Recuperado')}</span>`;
      return `<tr><td>${s('Any','Año')} ${c.any}</td><td>${fmt(estalvi,0)} EUR</td><td style="${acum<0?'color:#C62828':'color:#2E7D32;font-weight:600'}">${fmt(acum,0)} EUR</td><td>${estat}</td></tr>`;
    }).join('\n    ')}
  </tbody>
</table>`;

// ─── TARGETES MANTENIMENT ───
const mantId = input.manteniment_id || 'sense';
const kwpInstalat = kpis.kwp || (numModuls * (parseFloat(input.potencia_wp || 510) / 1000));
// ─── CÀLCUL PREU MANTENIMENT ──────────────────────────────────────────────────
// Sheets "manteniments" ha de tenir:
//   preu_base     → preu fix anual per instal·lacions ≤10 kWp (ex: 50, 150, 250)
//   preu_per_kwp  → preu per kWp si la instal·lació és >10 kWp (ex: 5, 15, 25)
// Fórmula: max(preu_base, preu_per_kwp × kWp)
//   Exemples: 6kWp bàsic → max(50, 5×6=30) = 50€
//             20kWp bàsic → max(50, 5×20=100) = 100€
const calcPreuMant = (m) => {
  const base   = parseFloat(m.preu_base)    || parseFloat(m.preu_kwp_any) * 10 || 0;
  const perKwp = parseFloat(m.preu_per_kwp) || parseFloat(m.preu_kwp_any)      || 0;
  return Math.round(Math.max(base, perKwp * kwpInstalat));
};

const plansActius = mantenimentsData.length > 0
  ? mantenimentsData.filter(m => (parseFloat(m.preu_base) || parseFloat(m.preu_kwp_any)) > 0)
  : [];

const senseSel = mantId === 'sense';
const senseCard = `<div class="mant-card" style="border:2px solid ${senseSel ? '#455a64' : '#cfd8dc'};border-radius:10px;padding:12px 14px;background:${senseSel ? '#eceff1' : '#fff'};display:flex;flex-direction:column">
  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#78909c;margin-bottom:4px">${s('Sense manteniment','Sin mantenimiento')}</div>
  <div style="font-size:24px;font-weight:800;color:#455a64;line-height:1">0<span style="font-size:12px;font-weight:400;color:#555"> €</span></div>
  <div style="font-size:10px;color:#aaa;margin:3px 0 8px">${s('Sense contracte','Sin contrato')}</div>
  <ul style="margin:0;padding-left:14px;font-size:10.5px;color:#666;line-height:1.65;flex:1">
    <li>${s('El client gestiona el manteniment autònomament','El cliente gestiona el mantenimiento autónomamente')}</li>
    <li>${s('Suport tècnic puntual de Solenver (pressupost a part)','Soporte técnico puntual de Solenver (presupuesto aparte)')}</li>
    <li>${s('Recomanem revisió anual per preservar la garantia','Recomendamos revisión anual para preservar la garantía')}</li>
  </ul>
  ${senseSel ? `<div style="margin-top:8px;font-size:10px;font-weight:700;color:#455a64;text-transform:uppercase">✓ ${s('Opció seleccionada','Opción seleccionada')}</div>` : ''}
</div>`;

const htmlMantCards = `
<div class="mant-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:12px 0;page-break-inside:auto">
  ${plansActius.map(m => {
    const costAny  = calcPreuMant(m);
    const perKwp   = parseFloat(m.preu_per_kwp) || parseFloat(m.preu_kwp_any) || 0;
    const preuBase = parseFloat(m.preu_base) || 0;
    const sel      = m.id === mantId;
    const serveis  = (m.serveis || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean);
    const labelPreu = kwpInstalat <= 10
      ? `${preuBase} € + IVA / ${s('any','año')}`
      : `${perKwp} €/kWp × ${fmt(kwpInstalat,2)} kWp`;
    return `<div class="mant-card${sel ? ' mant-selected' : ''}" style="border:2px solid ${sel ? '#1b5e20' : '#c8e6c9'};border-radius:10px;padding:12px 14px;background:${sel ? '#f1f8e9' : '#fff'};display:flex;flex-direction:column">
  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#4caf50;margin-bottom:4px">${m.nom}</div>
  <div style="font-size:24px;font-weight:800;color:#1b5e20;line-height:1">${fmt(costAny)}<span style="font-size:12px;font-weight:400;color:#555"> €</span></div>
  <div style="font-size:10px;color:#888;margin:3px 0 8px">${labelPreu}</div>
  <ul style="margin:0;padding-left:14px;font-size:10.5px;color:#333;line-height:1.65;flex:1">
    ${serveis.map(s => `<li>${s}</li>`).join('')}
  </ul>
  ${sel ? `<div style="margin-top:8px;font-size:10px;font-weight:700;color:#1b5e20;text-transform:uppercase">✓ ${s('Pla seleccionat','Plan seleccionado')}</div>` : ''}
</div>`;
  }).join('\n  ')}

</div>`;

const mantSeleccionat = mantenimentsData.find(m => m.id === mantId) || null;
const mantCostAnual   = mantSeleccionat ? calcPreuMant(mantSeleccionat) : (parseFloat(input.manteniment_anual) || 0);
const mantNom         = mantSeleccionat?.nom || (mantId === 'sense' ? s('Sense manteniment','Sin mantenimiento') : mantId);

// ─── COSTOS PER PLACA ───
const preuModul        = parseFloat(modul.preu || 71.50);
const preuInv          = parseFloat(inversor.preu || 793);
const preuMuntRaw      = parseFloat(muntatge.preu_base || 612);
const preuMuntPerPlaca = preuMuntRaw > 200 ? preuMuntRaw / numModuls : preuMuntRaw;
const costMuntatge     = preuMuntRaw > 200 ? preuMuntRaw : preuMuntRaw * numModuls;
const costMaObra       = C_MO_BASE + (C_MO_MOD * numModuls);
const projecte         = C_PROJECTE;
const metresCablejat   = parseFloat(input.metres_cablejat || 15);
const cables           = metresCablejat * C_CABLES_M;
const MARGE            = C_MARGE;

// Marge aplicat per línia (cada concepte × (1 + MARGE))
const r = (v) => Math.round(v * 100) / 100;
const tModuls    = r(numModuls * preuModul * (1 + MARGE));
const tInv       = r(preuInv * (1 + MARGE));
const tMuntatge  = r(costMuntatge * (1 + MARGE));
const tMaObra    = r(costMaObra * (1 + MARGE));
const tProjecte  = r(projecte * (1 + MARGE));
const tCables    = r(cables * (1 + MARGE));

const costSubtotalCataleg = Math.round(tModuls + tInv + tMuntatge + tMaObra + tProjecte + tCables);
const costInstalacioManual = parseFloat(input.economics?.cost_instalacio || input.cost_instalacio) || 0;
const costSubtotal = (costInstalacioManual > 0) ? Math.round(costInstalacioManual) : costSubtotalCataleg;
const ivaEur       = Math.round(costSubtotal * 0.21);
const costTotal    = costSubtotal + ivaEur;

const htmlTaulaPressupost = `<table>
  <thead><tr><th>${s('Concepte','Concepto')}</th><th>${s('Quantitat','Cantidad')}</th></tr></thead>
  <tbody>
    <tr><td>${s('Mòduls','Módulos')} ${modul.marca||'JINKO'} ${modul.model||'Tiger Neo'} ${modul.potencia_wp||510}Wp</td><td>${numModuls} u.</td></tr>
    <tr><td>Inversor ${inversor.marca||'HUAWEI'} ${inversor.model||'SUN2000'} ${inversor.potencia_kw||6}kW</td><td>1 u.</td></tr>
    <tr><td>${s('Muntatge','Montaje')} ${muntatge.nom||'Estructura'} ${s('(per placa)','(por placa)')}</td><td>${numModuls} u.</td></tr>
    <tr><td>${s("Mà d'obra i instal·lació","Mano de obra e instalación")}</td><td>1 lot</td></tr>
    <tr><td>${s('Projecte tècnic i legalització','Proyecto técnico y legalización')}</td><td>1 u.</td></tr>
    <tr><td>${s('Elements elèctrics de protecció i petit material','Elementos eléctricos de protección y pequeño material')}</td><td>1 lot</td></tr>
  </tbody>
  <tfoot>
    <tr class="press-total"><td><strong>${s('TOTAL SENSE IVA','TOTAL SIN IVA')}</strong></td><td><strong>${fmt(costSubtotal,2)} EUR</strong></td></tr>
    <tr style="background:#f0fdf4"><td style="color:#166534;font-weight:700">${s('TOTAL AMB IVA (21%)','TOTAL CON IVA (21%)')}</td><td style="font-weight:700;color:#166534">${fmt(costTotal,2)} EUR</td></tr>
  </tfoot>
</table>
<div style="margin-top:10px;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:8.5pt;color:#334155">
  <div style="font-weight:700;color:#0f172a;margin-bottom:6px">${s('Serveis complementaris (facturats a part)','Servicios complementarios (facturados aparte)')}</div>
  <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e2e8f0">
    <span>${s("Certificat d'Eficiència Energètica — estat inicial (abans de la instal·lació)","Certificado de Eficiencia Energética — estado inicial (antes de la instalación)")}</span>
    <span style="font-weight:600;white-space:nowrap;padding-left:16px">150,00 EUR + IVA</span>
  </div>
  <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e2e8f0">
    <span>${s("Certificat d'Eficiència Energètica — estat final (després de la instal·lació)","Certificado de Eficiencia Energética — estado final (después de la instalación)")}</span>
    <span style="font-weight:600;white-space:nowrap;padding-left:16px">150,00 EUR + IVA</span>
  </div>
  <div style="display:flex;justify-content:space-between;padding:6px 0 2px;font-weight:700;color:#0f172a">
    <span>${s('Total certificats energètics','Total certificados energéticos')}</span>
    <span style="white-space:nowrap;padding-left:16px">300,00 EUR + IVA</span>
  </div>
</div>`;

// ─── BLOC CONSUM FUTUR (equips nous previstos) ───
const equipsFutursInput = Array.isArray(input.equips_futurs) ? input.equips_futurs : [];
// Perfils del Sheets (enviats al payload) amb fallback hardcodat
const PERFILS_EQ_PDF_FB = {
  cooling_granja:     { nom: s('Cooling granja','Cooling granja'),              hores:[0,0,4,6,8,10,12,12,10,4,0,0]  },
  camara_frigorifica: { nom: s('Càmera frigorífica','Cámara frigorífica'),      hores:[6,6,7,8,10,12,14,14,11,8,6,6] },
  aerotermia_acs:     { nom: s('Aerotèrmia (ACS)','Aerotermia (ACS)'),          hores:[4,4,3,2,1,1,1,1,1,2,3,4]      },
  aerotermia_calef:   { nom: s('Aerotèrmia (calefacció)','Aerotermia (calefacción)'), hores:[8,7,5,2,0,0,0,0,0,2,5,8] },
  carregador_ve:      { nom: s('Carregador VE','Cargador VE'),                  hores:[2,2,2,2,2,2,2,2,2,2,2,2]      },
  bombament_reg:      { nom: s('Bomba de reg / piscina','Bomba de riego / piscina'), hores:[0,0,1,2,4,6,8,8,6,2,0,0] },
  compressor_fred:    { nom: s('Compressor / fred industrial','Compresor / frío industrial'), hores:[3,3,4,5,7,9,10,10,8,5,3,3] },
  altre:              { nom: s('Altre (hores uniformes)','Otro (horas uniformes)'), hores:[3,3,3,3,3,3,3,3,3,3,3,3] },
};
const perfilsEquipsPDF = {};
(Array.isArray(input.perfils_equips) ? input.perfils_equips : []).forEach(p => {
  if (p.id) perfilsEquipsPDF[p.id] = { nom: p.nom, hores: p.hores };
});
const getPerfilEqPDF = (id) => perfilsEquipsPDF[id] || PERFILS_EQ_PDF_FB[id] || PERFILS_EQ_PDF_FB['altre'];
const PERFILS_EQ_PDF = new Proxy({}, { get: (_, id) => getPerfilEqPDF(id) });
const diesMesPDF = [31,28,31,30,31,30,31,31,30,31,30,31];
let htmlConsumsBase = '';
if (equipsFutursInput.length > 0) {
  // Calcular delta mensual per cada equip
  const deltaMes = new Array(12).fill(0);
  // Base mensual per calcular % sobre consum
  const baseMensualPDF = mesClaus.map(clau => {
    const c = consumosObj[clau];
    return typeof c === 'object' ? (c.p1||0)+(c.p2||0)+(c.p3||0)+(c.p4||0)+(c.p5||0)+(c.p6||0) : parseFloat(c||0);
  });
  const equipLines = equipsFutursInput.map(eq => {
    let totalEq = 0;
    if (eq.mode === 'pct') {
      const ratio = (eq.pct||0)/100;
      for (let m=0; m<12; m++) { const ex = baseMensualPDF[m]*ratio; totalEq += ex; deltaMes[m] += ex; }
      const perfil = PERFILS_EQ_PDF[eq.tipus] || PERFILS_EQ_PDF['altre'];
      return `<tr><td>${perfil.nom}</td><td style="text-align:center" colspan="2">+${eq.pct}% ${s('consum','consumo')}</td><td style="text-align:right">${fmt(totalEq,0)} kWh</td></tr>`;
    } else {
      const perfil = PERFILS_EQ_PDF[eq.tipus] || PERFILS_EQ_PDF['altre'];
      for (let m=0; m<12; m++) { const ex = (eq.unitats||1)*(eq.kw_unit||0)*perfil.hores[m]*diesMesPDF[m]; totalEq += ex; deltaMes[m] += ex; }
      return `<tr><td>${perfil.nom}</td><td style="text-align:center">${eq.unitats||1} u.</td><td style="text-align:center">${eq.kw_unit||0} kW</td><td style="text-align:right">${fmt(totalEq,0)} kWh</td></tr>`;
    }
  }).join('\n');
  const totalDelta = deltaMes.reduce((a,b)=>a+b,0);
  const consumBase = input.consum_base_anual || consumAnual - totalDelta;
  const consumFutur = consumBase + totalDelta;
  const pctExtra = consumBase > 0 ? Math.round(totalDelta/consumBase*100) : 0;
  // Taula mensual base vs futur
  const filesMensuals = mesClaus.map((clau, i) => {
    const base = parseFloat((consumosObj[clau] && typeof consumosObj[clau]==='object')
      ? (consumosObj[clau].p1||0)+(consumosObj[clau].p2||0)+(consumosObj[clau].p3||0)+(consumosObj[clau].p4||0)+(consumosObj[clau].p5||0)+(consumosObj[clau].p6||0)
      : consumosObj[clau] || 0);
    const fut = base + deltaMes[i];
    return `<tr><td><strong>${mesNoms[i]}</strong></td><td style="text-align:right">${fmt(base,0)}</td><td style="text-align:right">${fmt(deltaMes[i],0)}</td><td style="text-align:right;font-weight:600;color:#1b5e20">${fmt(fut,0)}</td></tr>`;
  }).join('\n');
  htmlConsumsBase = `
<div style="page-break-inside:avoid;margin-top:10px;background:#f0f7ff;border-left:3px solid #2196f3;border-radius:0 6px 6px 0;padding:7px 12px">
  <div style="font-weight:700;font-size:9pt;color:#1565c0;margin-bottom:6px">&#9889; ${s('Escenari futur','Escenario futuro')} &mdash; ${fmt(consumBase,0)}&thinsp;kWh ${s('base','base')} &rarr; <strong>${fmt(consumFutur,0)}&thinsp;kWh</strong> (+${pctExtra}%)</div>
  <div style="display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:start">
    <table style="font-size:7.5pt">
      <thead><tr><th>${s('Equip','Equipo')}</th><th style="text-align:center">u.</th><th style="text-align:center">kW</th><th style="text-align:right">kWh/${s('any','año')}</th></tr></thead>
      <tbody>${equipLines}</tbody>
      <tfoot><tr style="font-weight:700;border-top:1px solid #90caf9"><td colspan="3">${s('Total addicional','Total adicional')}</td><td style="text-align:right">+${fmt(totalDelta,0)}&thinsp;kWh</td></tr></tfoot>
    </table>
    <table style="font-size:7.5pt">
      <thead><tr><th>${s('Mes','Mes')}</th><th style="text-align:right">${s('Base','Base')}</th><th style="text-align:right">+${s('Eq.','Eq.')}</th><th style="text-align:right;color:#1b5e20">${s('Futur','Futuro')}</th></tr></thead>
      <tbody>${filesMensuals}</tbody>
    </table>
  </div>
</div>`;
}

// ─── QUICKCHART V2 ───
const labelsM        = lang === 'es'
  ? ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  : ['Gen','Feb','Mar','Abr','Mai','Jun','Jul','Ago','Set','Oct','Nov','Des'];
const consumTotal    = mensual.map(m => m.consum || 0);
const prodTotal      = mensual.map(m => m.produccio || 0);
const costActualMens = mensual.map(m => m.cost_actual != null ? m.cost_actual : (m.estalvi||0) + (m.cost_xarxa||0) - (m.compensacio||0));
const costPVMens     = mensual.map(m => m.cost_pv    != null ? m.cost_pv     : (m.cost_xarxa||0) - (m.compensacio||0));
const consumAcum     = consumTotal.reduce((acc,v,i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);
const prodAcum       = prodTotal.reduce((acc,v,i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);
const cfVals         = kpis.cashflow ? kpis.cashflow.map(c => c.flux_acumulat ?? c.acumulat ?? 0) : [];
const cfLabels       = kpis.cashflow ? kpis.cashflow.map(c => s('Any ','Año ') + c.any) : [];
const lProdFV        = s('Producció FV (kWh)','Producción FV (kWh)');
const lAcumulat      = s('Acumulat (kWh)','Acumulado (kWh)');
const lProdVsConsum  = s('Produccio PV','Producción PV');
const lDemanda       = s('Demanda','Demanda');
const lCostActual    = s('Cost actual','Coste actual');
const lCostPV        = s('Cost amb PV','Coste con PV');
const lFluxAcum      = s('Flux acumulat (EUR)','Flujo acumulado (EUR)');
const lMensualKwh    = s('Mensual (kWh)','Mensual (kWh)');
const lAcumKwh       = s('Acumulat (kWh)','Acumulado (kWh)');
const axProdPV       = s('Produccio PV [kWh]','Producción PV [kWh]');
const axAcumPV       = s('Acumulat [kWh]','Acumulado [kWh]');
const axEnergia      = s('Energia [kWh]','Energía [kWh]');
const axCost         = s('Cost [EUR]','Coste [EUR]');

const urlGraficConsum = 'https://quickchart.io/chart?w=420&h=210&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: {
    labels: labelsM,
    datasets: [
      {
        type: 'bar',
        label: lMensualKwh,
        data: consumTotal,
        backgroundColor: 'rgba(39,174,96,0.92)',
        yAxisID: 'y-axis-0'
      },
      {
        type: 'line',
        label: lAcumKwh,
        data: consumAcum,
        borderColor: '#F57C00',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: '#F57C00',
        fill: false,
        yAxisID: 'y-axis-1'
      }
    ]
  },
  options: {
    legend: { position: 'top' },
    scales: {
      yAxes: [
        {
          id: 'y-axis-0',
          type: 'linear',
          position: 'left',
          ticks: { beginAtZero: true },
          scaleLabel: { display: true, labelString: s('Consum mensual [kWh]','Consumo mensual [kWh]') }
        },
        {
          id: 'y-axis-1',
          type: 'linear',
          position: 'right',
          ticks: { beginAtZero: true },
          scaleLabel: { display: true, labelString: s('Consum acumulat [kWh]','Consumo acumulado [kWh]') },
          gridLines: { drawOnChartArea: false }
        }
      ]
    }
  }
}));

const urlGraficPVProd = 'https://quickchart.io/chart?w=420&h=210&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: {
    labels: labelsM,
    datasets: [
      { type:'bar',  label: lProdFV, data: prodTotal,
        backgroundColor:'rgba(39,174,96,0.92)', yAxisID:'y-axis-0' },
      { type:'line', label: lAcumulat, data: prodAcum,
        borderColor:'#F57C00', backgroundColor:'transparent',
        pointRadius:3, borderWidth:2, yAxisID:'y-axis-1', lineTension:0.3 }
    ]
  },
  options: {
    legend: { position:'top' },
    scales: {
      yAxes: [
        { id:'y-axis-0', position:'left',  ticks:{ beginAtZero:true }, scaleLabel:{ display:true, labelString: axProdPV } },
        { id:'y-axis-1', position:'right', ticks:{ beginAtZero:true }, scaleLabel:{ display:true, labelString: axAcumPV }, gridLines:{ drawOnChartArea:false } }
      ]
    }
  }
}));

const urlGraficProdVsConsum = 'https://quickchart.io/chart?w=700&h=300&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: { labels: labelsM, datasets: [
    { label: lProdVsConsum, data: prodTotal,   backgroundColor:'rgba(39,174,96,0.92)' },
    { label: lDemanda,      data: consumTotal, backgroundColor:'rgba(231,76,60,0.9)' }
  ]},
  options: {
    legend: { position:'top' },
    scales: { yAxes: [{ ticks:{ beginAtZero:true }, scaleLabel:{ display:true, labelString: axEnergia } }] }
  }
}));

const urlGraficCostVsPV = 'https://quickchart.io/chart?w=420&h=210&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: { labels: labelsM, datasets: [
    { label: lCostActual, data: costActualMens, backgroundColor:'rgba(231,76,60,0.9)' },
    { label: lCostPV,     data: costPVMens,     backgroundColor:'rgba(39,174,96,0.92)' }
  ]},
  options: {
    legend: { position:'top' },
    scales: { yAxes: [{ ticks:{ beginAtZero:false }, scaleLabel:{ display:true, labelString: axCost } }] }
  }
}));

const urlGraficCashflow = 'https://quickchart.io/chart?w=420&h=210&c=' + encodeURIComponent(JSON.stringify({
  type: 'line',
  data: { labels: cfLabels, datasets: [{
    label: lFluxAcum, data: cfVals,
    borderColor:'rgba(39,174,96,1)', backgroundColor:'rgba(39,174,96,0.12)',
    fill: true, pointRadius: 2, lineTension: 0.1
  }]},
  options: {
    legend: { position:'top' },
    scales: { yAxes: [{ scaleLabel:{ display:true, labelString:'EUR' } }] }
  }
}));

// ─── VISTA AÈRIA (Google Maps Static API) ───
const lat = parseFloat(input.lat || input.latitud || 41.38);
const lng = parseFloat(input.lng || input.longitud || 2.17);
const MAPS_API_KEY = config['GOOGLE_MAPS_KEY'] || '';

// ─── IMATGES CORPORATIVES (des de Sheets configuracio) ───
const logoId = config['IMG_LOGO'] || '';

// Converteix una URL de Google Drive a base64 per evitar bloquejos Playwright
async function driveToBase64(id, mime) {
  if (!id) return null;
  const urls = [
    { url: `https://lh3.googleusercontent.com/d/${id}=s0`,                     timeout: 20000 },
    { url: `https://drive.google.com/uc?export=download&confirm=t&id=${id}`,   timeout: 30000 },
    { url: `https://drive.google.com/thumbnail?id=${id}&sz=w3200`,             timeout: 10000 },
  ];
  for (const { url, timeout } of urls) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
      if (!resp.ok) continue;
      const buf = await resp.arrayBuffer();
      if (buf.byteLength < 5000) continue;
      const ct = resp.headers.get('content-type') || '';
      if (ct.startsWith('text/html')) continue;
      const finalType = ct.startsWith('image/') ? ct : (mime || 'image/jpeg');
      return `data:${finalType};base64,` + Buffer.from(buf).toString('base64');
    } catch(e) { continue; }
  }
  return null;
}

const logoB64 = await driveToBase64(logoId, 'image/png');
const logoSrc = logoB64 || (logoId ? `https://lh3.googleusercontent.com/d/${logoId}` : '');
// CSS override injectat directament (no depèn de la versió del template a GitHub)
// IMPORTANT: kpis position:absolute bottom:0 z-index:3 per sobreposar-se a l'aerial (z-index:1)
const portadaCssOverride = `<style>
.portada{display:flex!important;flex-direction:column!important;height:297mm!important;max-height:297mm!important;overflow:hidden!important;position:relative!important}
.portada-top{flex-shrink:0!important;position:relative!important;z-index:2!important}
.portada-aerial{height:145mm!important;flex:none!important;min-height:0!important;position:relative!important;z-index:1!important}
.portada-kpis{position:absolute!important;bottom:0!important;left:0!important;right:0!important;z-index:3!important;display:grid!important;grid-template-columns:repeat(4,1fr)!important;background:#fff!important;padding:16px 20mm!important;gap:14px!important;box-shadow:0 -4px 24px rgba(0,0,0,0.25)!important}
</style>`;
const htmlLogo = logoSrc
  ? `${portadaCssOverride}<img src="${logoSrc}" class="plogo" style="max-height:65px;width:auto;display:block;margin-bottom:4px" alt="Solenver">`
  : `${portadaCssOverride}<span style="font-weight:800;font-size:22px;color:inherit;letter-spacing:2px">SOLENVER</span>`;

const nomEmpresaHeader   = config['NOM_EMPRESA']         || 'SOLENVER soluciones energéticas, SL';
const adrecaEmpresaHeader= config['ADRECA_EMPRESA']      || 'Carrer Marinada 37, Pol. Ind. Torrefarrera, Lleida';
const emailEmpresa       = config['EMAIL_EMPRESA']       || 'info@solenver.cat';
const telefonEmpresa     = (config['TELEFON_EMPRESA'] || '').replace(/#[A-Z!/]+.*/g, '').trim();
const webEmpresa         = config['WEB_EMPRESA']         || 'www.solenver.cat';
const coberturaEmpresa   = config['COBERTURA_EMPRESA']   || 'Catalunya i Aragó';
const certificacioEmpresa= config['CERTIFICACIO_EMPRESA']|| 'Instal·ladors REE Autoritzats';
const anysMantGratuit    = config['ANYS_MANT_GRATUIT']   || '2';
const validesaPressupost = config['VALIDESA_PRESSUPOST'] || '30';

const imgEmpresaId = config['IMG_EMPRESA'] || '';
const imgEmpresaB64 = await driveToBase64(imgEmpresaId, 'image/jpeg');
const imgEmpresaSrc = imgEmpresaB64 || (imgEmpresaId ? `https://lh3.googleusercontent.com/d/${imgEmpresaId}` : '');
const htmlImgEmpresa = imgEmpresaSrc
  ? `<div style="margin:14px 0;text-align:center"><img src="${imgEmpresaSrc}" style="max-width:90%;max-height:180px;border-radius:10px;object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.08)" alt="Equip Solenver"></div>`
  : '';

// ─── IMATGE I DESCRIPCIÓ MONITORITZACIÓ (per fabricant inversor) ───
const fabricantInversor = (inversor.fabricant || inversor.marca || inversor.model || '').toLowerCase();
let imgMonitoritzacio = '';
let descMonitoritzacioFabricant = '';
if (fabricantInversor.includes('huawei')) {
  imgMonitoritzacio = config['IMG_MONITORING_HUAWEI'] || '';
  descMonitoritzacioFabricant = lang === 'es'
    ? 'La instalación incorpora el sistema de monitorización FusionSolar de Huawei, accesible vía app móvil y portal web. Permite visualizar en tiempo real la producción solar, el consumo del hogar y la exportación a la red, con alertas automáticas ante cualquier anomalía de rendimiento.'
    : 'La instal·lació incorpora el sistema de monitorització FusionSolar de Huawei, accessible via app mòbil i portal web. Permet visualitzar en temps real la producció solar, el consum de la llar i l\'exportació a la xarxa, amb alertes automàtiques davant qualsevol anomalia de rendiment.';
} else if (fabricantInversor.includes('fronius')) {
  imgMonitoritzacio = config['IMG_MONITORING_FRONIUS'] || '';
  descMonitoritzacioFabricant = lang === 'es'
    ? 'El sistema Solar.web de Fronius ofrece monitorización en tiempo real accesible desde cualquier dispositivo. La plataforma registra todos los datos de producción y consumo, envía notificaciones ante incidencias y permite exportar históricos energéticos para un análisis detallado.'
    : 'El sistema Solar.web de Fronius ofereix monitorització en temps real accessible des de qualsevol dispositiu. La plataforma registra totes les dades de producció i consum, envia notificacions davant incidències i permet exportar historials energètics per a una anàlisi detallada.';
} else if (fabricantInversor.includes('sma')) {
  imgMonitoritzacio = config['IMG_MONITORING_SMA'] || '';
  descMonitoritzacioFabricant = lang === 'es'
    ? 'La solución Sunny Portal de SMA permite gestionar y monitorizar la instalación fotovoltaica desde su plataforma en línea o app móvil. Proporciona datos en tiempo real de producción y consumo, alertas de errores e informes energéticos automatizados.'
    : 'La solució Sunny Portal de SMA permet gestionar i monitoritzar la instal·lació fotovoltaica des de la seva plataforma en línia o app mòbil. Proporciona dades en temps real de producció i consum, alertes d\'errors i informes energètics automatitzats.';
} else if (fabricantInversor.includes('solaredge')) {
  imgMonitoritzacio = config['IMG_MONITORING_SOLAREDGE'] || '';
  descMonitoritzacioFabricant = lang === 'es'
    ? 'El sistema de monitorización SolarEdge proporciona visibilidad a nivel de módulo individual gracias a sus optimizadores de potencia. La app y el portal web muestran en tiempo real la producción de cada panel, facilitando la detección rápida de posibles incidencias.'
    : 'El sistema de monitorització SolarEdge proporciona visibilitat a nivell de mòdul individual gràcies als seus optimitzadors de potència. L\'app i el portal web mostren en temps real la producció de cada panell, facilitant la detecció ràpida de possibles incidències.';
} else {
  imgMonitoritzacio = config['IMG_MONITORING_GENERIC'] || '';
  descMonitoritzacioFabricant = '';
}

// ─── VISTA AÈRIA (Google Maps Static API) ───
let imgVistaAeria = '';
let htmlBlocVistaAeria = '';
let imgVistaAeriaPortada = '';

// Descarrega la imatge del mapa i la converteix a base64 per evitar bloquejos de referrer a Playwright
async function fetchMapBase64(url) {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    if (!buf.byteLength) return null;
    return 'data:image/png;base64,' + Buffer.from(buf).toString('base64');
  } catch(e) { return null; }
}

// Placeholder si no es pot carregar el mapa
const mapPlaceholder = `<div style="width:100%;height:220px;background:linear-gradient(135deg,#e8f5e9,#f1f8e9);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#558b2f;font-size:10pt;font-weight:600;gap:8px">
  <div style="font-size:28pt">🗺️</div>
  <div>Lat: ${lat} · Lng: ${lng}</div>
  <div style="font-size:8.5pt;color:#8bc34a;font-weight:400">${s('Vista aèria de la instal·lació','Vista aérea de la instalación')}</div>
</div>`;

// Intentar primer Google Maps, després múltiples OSM fallbacks
let mapB64 = null;
if (MAPS_API_KEY) {
  const mapsUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=19&size=600x300&maptype=satellite&markers=color:red%7C${lat},${lng}&key=${MAPS_API_KEY}`;
  mapB64 = await fetchMapBase64(mapsUrl);
}
if (!mapB64) {
  // OSM fallback 1: staticmap.openstreetmap.de
  const osmUrl1 = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=18&size=600x300&maptype=mapnik&markers=${lat},${lng},ol-marker`;
  mapB64 = await fetchMapBase64(osmUrl1);
}
if (!mapB64) {
  // OSM fallback 2: maps.geoapify.com (no key needed for low usage)
  const osmUrl2 = `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=300&center=lonlat:${lng},${lat}&zoom=18&marker=lonlat:${lng},${lat};color:%23ff0000;size:medium&apiKey=df85d1c0c31b4816b7a2c1b17f8fd8b0`;
  mapB64 = await fetchMapBase64(osmUrl2);
}

if (mapB64) {
  imgVistaAeria = mapB64;
  htmlBlocVistaAeria = `<div class="vista-aeria"><img src="${mapB64}" alt="${s('Vista aèria','Vista aérea')}" style="width:100%;height:220px;object-fit:cover;display:block"><div class="vista-aeria-cap">${s('Vista aèria de la ubicació de la instal·lació','Vista aérea de la ubicación de la instalación')} (lat: ${lat}, lng: ${lng})</div></div>`;
  imgVistaAeriaPortada = `<div class="portada-aerial" data-lat="${lat}" data-lng="${lng}" style="background-image:url('${mapB64}')"></div>`;
} else {
  // Sense mapa: Playwright injectarà Leaflet+ESRI satellite durant el render (portada i interior)
  imgVistaAeria = '';
  htmlBlocVistaAeria = `<div class="vista-aeria" data-lat="${lat}" data-lng="${lng}" style="height:220px;position:relative;overflow:hidden;border-radius:8px"><div class="vista-aeria-cap" style="position:absolute;bottom:0;left:0;right:0;z-index:10;background:rgba(0,0,0,0.45);color:#fff;font-size:8pt;padding:4px 10px">${s('Vista aèria de la ubicació de la instal·lació','Vista aérea de la ubicación de la instalación')} (lat: ${lat}, lng: ${lng})</div></div>`;
  imgVistaAeriaPortada = `<div class="portada-aerial" data-lat="${lat}" data-lng="${lng}" style="background:#1b5e20"></div>`;
}

// ─── TEXTOS ───
const perfilMapCA = {
  'granja_porcina':'Granja Porcina', 'granja_avicola':'Granja Avícola',
  'industria_general':'Indústria', 'logistica_magatzem':'Logística i Magatzem',
  'domestica_residencial':'Autoconsum Domèstic', 'comercial_oficines':'Comerç i Oficines',
  'agricola_reg':'Ús Agrícola'
};
const perfilMapES = {
  'granja_porcina':'Granja Porcina', 'granja_avicola':'Granja Avícola',
  'industria_general':'Industria', 'logistica_magatzem':'Logística y Almacén',
  'domestica_residencial':'Autoconsumo Doméstico', 'comercial_oficines':'Comercio y Oficinas',
  'agricola_reg':'Uso Agrícola'
};
const perfilKey = input.perfil_client || kpis.perfil_client || 'industria_general';
const perfilLabel = lang === 'es'
  ? (perfilMapES[perfilKey] || 'Industrial')
  : (perfilMapCA[perfilKey] || 'Industrial');
const perfilNom = s('per a ','para ') + perfilLabel;

const tarifa = kpis.tarifa || input.tarifa || '2.0TD';

const textObjecte = injectKpisText(decodeStr(informeIA.seccio_objecte)) ||
  (lang === 'es'
    ? `El objeto de este estudio es la evaluación técnico-económica de la implementación de una instalación solar fotovoltaica para autoconsumo en las instalaciones de <strong>${input.client_nom || 'el cliente'}</strong>, ubicadas en ${input.adreca || '-'}. El alcance del documento incluye el análisis del consumo energético actual, el dimensionado del sistema fotovoltaico, la producción estimada, el retorno económico de la inversión y el servicio de mantenimiento recomendado.`
    : `L'objecte d'aquest estudi és l'avaluació tècnico-econòmica de la implementació d'una instal·lació solar fotovoltaica per autoconsum a les instal·lacions de <strong>${input.client_nom || 'el client'}</strong>, ubicades a ${input.adreca || '-'}. L'abast del document inclou l'anàlisi del consum energètic actual, el dimensionament del sistema fotovoltaic, la producció estimada, el retorn econòmic de la inversió i el servei de manteniment recomanat.`);
const textSituacio = injectKpisText(decodeStr(informeIA.seccio_situacio_energetica)) ||
  (lang === 'es'
    ? `El perfil de consumo del cliente corresponde a una instalación de tipo ${perfilLabel.toLowerCase()}, con un consumo anual de ${fmt(consumAnual)} kWh y un coste energético actual estimado de ${fmtE(costActual)}.`
    : `El perfil de consum del client correspon a una instal·lació de tipus ${perfilLabel.toLowerCase()}, amb un consum anual de ${fmt(consumAnual)} kWh i un cost energètic actual estimat de ${fmtE(costActual)}.`);
const textInstalacio = injectKpisText(decodeStr(informeIA.seccio_instalacio)) ||
  (lang === 'es'
    ? `La instalación propuesta consta de ${numModuls} módulos ${modul.marca||'JINKO SOLAR'} ${modul.model||'Tiger Neo'} de ${modul.potencia_wp||510} Wp, alcanzando una potencia de ${fmt(kpis.kwp,2)} kWp. El inversor ${inversor.marca||'HUAWEI'} ${inversor.model||'SUN2000'} de ${inversor.potencia_kw||6} kW trabaja en conexión ${isTrifasic?'trifásica':'monofásica'}.`
    : `La instal·lació proposada consisteix en ${numModuls} mòduls ${modul.marca||'JINKO SOLAR'} ${modul.model||'Tiger Neo'} de ${modul.potencia_wp||510} Wp, assolint una potència de ${fmt(kpis.kwp,2)} kWp. L'inversor ${inversor.marca||'HUAWEI'} ${inversor.model||'SUN2000'} de ${inversor.potencia_kw||6} kW treballa en connexió ${isTrifasic?'trifàsica':'monofàsica'}.`);
const textProduccio = injectKpisText(decodeStr(informeIA.seccio_produccio)) ||
  (lang === 'es'
    ? `La instalación producirá ${fmtK(kpis.produccio_anual)} anualmente. El porcentaje de autoconsumo estimado es del ${fmt(kpis.pct_autoconsum,1)}%, equivalente a ${fmtK(kpis.autoconsum_anual)}. Los excedentes (${fmtK(kpis.excedent_anual)}) se compensarán en la red eléctrica.`
    : `La instal·lació produirà ${fmtK(kpis.produccio_anual)} anualment. El percentatge d'autoconsum estimat és del ${fmt(kpis.pct_autoconsum,1)}%, equivalent a ${fmtK(kpis.autoconsum_anual)}. Els excedents (${fmtK(kpis.excedent_anual)}) es compensaran a la xarxa elèctrica.`);
const textAvaluacio = injectKpisText(decodeStr(informeIA.seccio_economia)) ||
  (lang === 'es'
    ? `El ahorro el primer año es de ${fmtE(kpis.estalvi_any1)}, con un retorno de la inversión en ${kpis.retorn_anys} años. El VAN a 25 años es de ${fmtE(kpis.van_25anys)} y la TIR del ${kpis.tir_pct}%. El beneficio neto acumulado a lo largo de la vida útil es de ${fmtE(kpis.benefici_net_25)}.`
    : `L'estalvi el primer any és de ${fmtE(kpis.estalvi_any1)}, amb un retorn de la inversió en ${kpis.retorn_anys} anys. El VAN a 25 anys és de ${fmtE(kpis.van_25anys)} i la TIR del ${kpis.tir_pct}%. El benefici net acumulat al llarg de la vida útil és de ${fmtE(kpis.benefici_net_25)}.`);
const textExcedents = injectKpisText(decodeStr(informeIA.recomanacio_bateria)) ||
  (lang === 'es'
    ? `La compensación de excedentes a precio de mercado (${fmt(preuExcVal,3)} EUR/kWh) complementa el ahorro directo por autoconsumo, mejorando el retorno total de la inversión.`
    : `La compensació d'excedents a preu de mercat (${fmt(preuExcVal,3)} EUR/kWh) complementa l'estalvi directe per autoconsum, millorant el retorn total de la inversió.`);
const titolEstudi = decodeStr(informeIA.titol) ||
  (lang === 'es'
    ? `Memoria de la Valoración de un Sistema de Autoconsumo Fotovoltaico ${perfilNom}`
    : `Memòria de la Valoració d'un Sistema d'Autoconsum Fotovoltaic ${perfilNom}`);

// ─── FOOTER PER PLAYWRIGHT (apareix a totes les pàgines físiques menys portada) ───
const telDisplay = telefonEmpresa ? ` · ${telefonEmpresa}` : '';
const footerHtml = `<div style="font-size:8px;color:#64748b;font-family:'Segoe UI',Arial,Helvetica,sans-serif;width:100%;display:flex;justify-content:space-between;align-items:center;padding:4px 18mm 0;box-sizing:border-box;border-top:1px solid #e2e8f0"><span>${emailEmpresa}${telDisplay}</span><span style="font-weight:600">${input.client_nom||'-'}</span><span>${idEstudi}</span></div>`;
const logoImgHtml = logoSrc ? `<img src="${logoSrc}" style="height:38px;width:auto;vertical-align:middle">` : `<span style="font-weight:800;letter-spacing:1.5px;color:#1b5e20;font-size:11px">SOLENVER</span>`;
const headerHtml = `<div style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;width:100%;display:flex;justify-content:space-between;align-items:center;padding:0 18mm;box-sizing:border-box;border-bottom:2px solid #27ae60;font-size:8px;"><span>${logoImgHtml}</span><span style="text-align:right;line-height:1.5;color:#64748b"><span style="font-weight:700;color:#1b5e20">${nomEmpresaHeader}</span><br>${adrecaEmpresaHeader}<br>${webEmpresa}</span></div>`;

// ─── PRE-CÀRREGA IMATGES COM A BASE64 (qualitat màxima, sense bloquejos Playwright) ───
const [
  imgModulB64, imgInversorB64, imgEstructuraB64, imgMonitoritzacioB64,
  imgMantenimentB64, imgRevisiB64, imgBateriaB64,
] = await Promise.all([
  driveToBase64(modul.foto_url                  || '', 'image/jpeg'),
  driveToBase64(inversor.foto_url               || '', 'image/jpeg'),
  driveToBase64(muntatge.foto_url               || '', 'image/jpeg'),
  driveToBase64(inversor.sistema_monitoritzacio || '', 'image/jpeg'),
  driveToBase64(config['IMG_MANTENIMENT']       || '', 'image/jpeg'),
  driveToBase64(config['IMG_REVISIO_ANUAL']     || '', 'image/jpeg'),
  driveToBase64(config['IMG_BATERIA']           || '', 'image/jpeg'),
]);

// ─── HTML IMATGES MÒDUL / INVERSOR ───
const modulFotoUrl   = imgModulB64    || driveUrl(modul.foto_url    || '');
const inversorFotoUrl= imgInversorB64 || driveUrl(inversor.foto_url || '');
const htmlImgModul   = modulFotoUrl
  ? `<img src="${modulFotoUrl}" alt="Mòdul fotovoltaic" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;object-fit:contain;max-height:200px;background:#fff;padding:8px;display:block">`
  : `<div style="height:140px;background:#f8fafc;border:1px dashed #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:28pt;color:#94a3b8">☀️</div>`;
const htmlImgInversor= inversorFotoUrl
  ? `<img src="${inversorFotoUrl}" alt="Inversor" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;object-fit:contain;max-height:200px;background:#fff;padding:8px;display:block">`
  : `<div style="height:140px;background:#f8fafc;border:1px dashed #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:28pt;color:#94a3b8">⚡</div>`;

// ─── CASOS D'ÈXIT (des de Drive via Sheets casos_exit) ───
const casosExitRows = $('Llegir casos exit PDF').all().map(i => i.json);
const casosByCategoria = {};
for (const row of casosExitRows) {
  const cat = (row.categoria || '').trim();
  const id  = (row.id_drive  || '').trim();
  if (!cat || !id) continue;
  if (!casosByCategoria[cat]) casosByCategoria[cat] = [];
  casosByCategoria[cat].push({ id, ordre: parseInt(row.ordre) || 0 });
}
for (const cat of Object.keys(casosByCategoria))
  casosByCategoria[cat].sort((a, b) => a.ordre - b.ordre);
const casosCategories = Object.entries(casosByCategoria);
let htmlCasosExit = '';
if (casosCategories.length > 0) {
  const telDisplay2 = telefonEmpresa ? ' | ' + telefonEmpresa : '';
  // Descarregar totes les imatges per categoria
  const catData = await Promise.all(casosCategories.map(async ([catLabel, imgs]) => {
    const srcs = await Promise.all(imgs.map(async ({ id }) => {
      const b64 = await driveToBase64(id, 'image/jpeg');
      return b64 || `https://lh3.googleusercontent.com/d/${id}=s0`;
    }));
    return { catLabel, srcs };
  }));
  // Grid variat: 1a foto destacada (ampla), la resta en grid 2 o 3 col
  // mode: 'compact' (diverses cats/pàgina) | 'normal' (1 cat amb capçalera sh) | 'tall' (1 cat sense capçalera)
  function buildGrid(srcs, mode) {
    const n = srcs.length;
    if (!n) return '';
    const imgBox = (s, h) => `<div style="border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)"><img src="${s}" style="width:100%;height:${h}px;object-fit:cover;display:block"></div>`;
    if (mode === 'compact') {
      // Altures conservadores: diverses categories en una mateixa pàgina
      if (n === 1) return imgBox(srcs[0], 300);
      if (n === 2) return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${srcs.map(s => imgBox(s, 205)).join('')}</div>`;
      const [hero, ...rest] = srcs;
      const cols   = rest.length <= 2 ? rest.length : rest.length <= 4 ? 2 : 3;
      const thumbH = rest.length > 4 ? 118 : 132;
      return `<div style="border-radius:10px;overflow:hidden;box-shadow:0 3px 16px rgba(0,0,0,0.12);margin-bottom:10px"><img src="${hero}" style="width:100%;height:182px;object-fit:cover;display:block"></div><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:9px">${rest.map(s => imgBox(s, thumbH)).join('')}</div>`;
    }
    if (mode === 'tall') {
      // Pàgina de continuació sense capçalera de secció: aprofitem tot l'espai disponible
      if (n === 1) return imgBox(srcs[0], 560);
      if (n === 2) return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${srcs.map(s => imgBox(s, 340)).join('')}</div>`;
      const [hero, ...rest] = srcs;
      const heroH = rest.length <= 2 ? 330 : rest.length <= 4 ? 295 : 280;
      const cols   = rest.length <= 2 ? rest.length : rest.length <= 4 ? 2 : 3;
      const thumbH = rest.length <= 2 ? 265 : rest.length <= 4 ? 220 : 210;
      return `<div style="border-radius:10px;overflow:hidden;box-shadow:0 3px 16px rgba(0,0,0,0.12);margin-bottom:10px"><img src="${hero}" style="width:100%;height:${heroH}px;object-fit:cover;display:block"></div><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:9px">${rest.map(s => imgBox(s, thumbH)).join('')}</div>`;
    }
    // mode 'normal': única categoria amb capçalera sh (pàgina 1 de casos)
    if (n === 1) return imgBox(srcs[0], 420);
    if (n === 2) return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${srcs.map(s => imgBox(s, 280)).join('')}</div>`;
    const [hero, ...rest] = srcs;
    const heroH = rest.length <= 2 ? 300 : rest.length <= 4 ? 255 : 235;
    const cols   = rest.length <= 2 ? rest.length : rest.length <= 4 ? 2 : 3;
    const thumbH = rest.length <= 2 ? 240 : rest.length <= 4 ? 185 : 170;
    return `<div style="border-radius:10px;overflow:hidden;box-shadow:0 3px 16px rgba(0,0,0,0.12);margin-bottom:10px"><img src="${hero}" style="width:100%;height:${heroH}px;object-fit:cover;display:block"></div><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:9px">${rest.map(s => imgBox(s, thumbH)).join('')}</div>`;
  }
  // Sub-secció de categoria
  function catSection(catLabel, srcs, isFirst, mode) {
    const sep = isFirst ? '' : '<div style="margin:16px 0 14px;border-top:2px solid #f0fdf4"></div>';
    return `${sep}<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><div style="width:5px;height:22px;background:linear-gradient(180deg,#22c55e,#16a34a);border-radius:3px;flex-shrink:0"></div><div style="font-size:11pt;font-weight:700;color:#166534;letter-spacing:0.3px">${catLabel}</div></div>${buildGrid(srcs, mode)}`;
  }
  // Agrupar en pàgines: categories amb >5 imatges → pàgina pròpia; les petites comparteixen
  const pageGroups = [];
  let i = 0;
  while (i < catData.length) {
    if (catData[i].srcs.length > 5) {
      pageGroups.push([catData[i]]);
      i++;
    } else {
      const group = [catData[i++]];
      while (i < catData.length && catData[i].srcs.length <= 4) group.push(catData[i++]);
      pageGroups.push(group);
    }
  }
  htmlCasosExit = pageGroups.map((group, pageIdx) => {
    const mode = group.length > 1 ? 'compact' : (pageIdx === 0 ? 'normal' : 'tall');
    const pageBreak = pageIdx > 0 ? ' style="page-break-before:always"' : '';
    // Pàgines de continuació sense capçalera (ja apareix "Casos d'Èxit" a la pàgina 1)
    const header = pageIdx === 0
      ? `<div class="sh"><div class="sh-num">11</div><div class="sh-title">${s("Casos d'Èxit","Casos de Éxito")}</div></div>`
      : '';
    const content = group.map(({ catLabel, srcs }, j) => catSection(catLabel, srcs, j === 0, mode)).join('');
    return `<div class="page"${pageBreak}>\n${header}\n${content}\n<div class="pfooter"><span>${emailEmpresa}${telDisplay2}</span><span>${input.client_nom||'-'}</span><span>${idEstudi}</span></div>\n</div>`;
  }).join('\n');
}

// ─── PÀGINA DE BATERIES (upsell) ──────────────────────────────────────────────
const excedentAnualKwh   = kpis.excedent_anual || 0;
const autoconsumAnualKwh = kpis.autoconsum_anual || 0;
const produccioAnualKwh  = kpis.produccio_anual || (autoconsumAnualKwh + excedentAnualKwh);
const pctAutoconsum      = kpis.pct_autoconsum || 0;
const guanyNetKwh        = Math.max(0, preuMig - preuExcVal);  // EUR/kWh guany real autoconsumint vs exportar

// Preus orientatius per mida (configurables)
const preuBat5  = parseFloat(config['PREU_BATERIA_5']  || config['PREU_BATERIA_REF'] || '') || 2500;
const preuBat10 = parseFloat(config['PREU_BATERIA_10'] || '') || 4200;
const preuBat15 = parseFloat(config['PREU_BATERIA_15'] || '') || 5800;

// Funció de càlcul per a cada mida (~250 cicles/any, eficiència 90%)
function calcBat(n, preu) {
  const cap     = Math.min(excedentAnualKwh, Math.round(n * 250 * 0.9));
  const acB     = Math.round(autoconsumAnualKwh + cap);
  const pctB    = produccioAnualKwh > 0 ? Math.round(acB / produccioAnualKwh * 100) : 0;
  const estalviN = Math.round(cap * guanyNetKwh);
  const estalviT = Math.round((kpis.estalvi_any1 || 0) + estalviN);
  const pb      = estalviN > 0 ? Math.round(preu / estalviN) : null;
  return { n, preu, cap, acB, pctB, estalviN, estalviT, pb };
}
const bat5  = calcBat(5,  preuBat5);
const bat10 = calcBat(10, preuBat10);
const bat15 = calcBat(15, preuBat15);
const bats  = [bat5, bat10, bat15];

// Recomanació: primera que arriba a 60% d'autoconsum; si cap, la de millor payback
const recomanada = bats.find(b => b.pctB >= 60) ||
  bats.reduce((best, b) => (b.pb && (!best.pb || b.pb < best.pb)) ? b : best);

// Tokens per a cada mida de bateria
const showBateries = excedentAnualKwh > 100 || pctAutoconsum < 85;
const REC_BADGE = `<div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:#22c55e;color:#fff;font-size:7pt;font-weight:700;padding:2px 8px;border-radius:20px;white-space:nowrap">★ ${s('RECOMANADA','RECOMENDADA')}</div>`;
function batTokens(b, prefix) {
  const isRec = b === recomanada;
  const paybackLine = b.pb && b.pb <= 15
    ? s('Retorn: ','Retorno: ') + b.pb + ' ' + s('anys','años')
    : '+' + (b.pctB - Math.round(pctAutoconsum)) + ' pts ' + s('autoconsum','autoconsumo');
  return {
    [`{{${prefix}_ACB}}`]:         fmtK(b.acB),
    [`{{${prefix}_PCT}}`]:         String(b.pctB),
    [`{{${prefix}_EXC_REST}}`]:    fmtK(Math.max(0, excedentAnualKwh - b.cap)),
    [`{{${prefix}_ESTALVI_T}}`]:   fmtE(b.estalviT),
    [`{{${prefix}_PREU}}`]:        fmtE(b.preu),
    [`{{${prefix}_CAP}}`]:         fmtK(b.cap),
    [`{{${prefix}_ESTALVI_N}}`]:   fmtE(b.estalviN),
    [`{{${prefix}_PAYBACK_LINE}}`]: paybackLine,
    [`{{${prefix}_STAR}}`]:        isRec ? ' ★' : '',
    [`{{${prefix}_TH_STYLE}}`]:    isRec ? 'font-weight:700;background:#27ae60' : 'font-weight:600;opacity:0.85',
    [`{{${prefix}_FW}}`]:          isRec ? 'font-weight:700' : 'font-weight:500',
    [`{{${prefix}_CARD_BG}}`]:     isRec ? '#f0fdf4' : '#f8fafc',
    [`{{${prefix}_CARD_BORDER}}`]: isRec ? '2px solid #22c55e' : '1px solid #e2e8f0',
    [`{{${prefix}_CARD_COLOR}}`]:  isRec ? '#15803d' : '#0f172a',
    [`{{${prefix}_CARD_FW}}`]:     isRec ? '700' : '600',
    [`{{${prefix}_DIVIDER}}`]:     isRec ? '#bbf7d0' : '#e2e8f0',
    [`{{${prefix}_REC_BADGE}}`]:   isRec ? REC_BADGE : '',
  };
}
const bateriesToks = {
  '{{BATERIES_DISPLAY}}':  showBateries ? '' : 'display:none',
  '{{BAT_EXCEDENT_ANY}}':  fmtK(excedentAnualKwh),
  '{{BAT_PREU_EXC}}':      fmt(preuExcVal, 2),
  '{{BAT_PREU_MIG}}':      fmt(preuMig, 3),
  '{{BAT_RATIO_PREU}}':    fmt(preuMig / preuExcVal, 1),
  '{{BAT_AC_BASE}}':       fmtK(autoconsumAnualKwh),
  '{{BAT_PCT_BASE}}':      fmt(pctAutoconsum, 1),
  '{{BAT_EXC_BASE}}':      fmtK(excedentAnualKwh),
  '{{BAT_ESTALVI_BASE}}':  fmtE(kpis.estalvi_any1 || 0),
  ...batTokens(bat5,  'BAT5'),
  ...batTokens(bat10, 'BAT10'),
  ...batTokens(bat15, 'BAT15'),
};

return [{json: {
  id_estudi:   idEstudi,
  data:        dataStr,
  client_nom:  input.client_nom || 'Client',
  footer_html: footerHtml,
  header_html: headerHtml,
  replacements: {
    '{{ID_ESTUDI}}':                  idEstudi,
    '{{TITOL_ESTUDI}}':               titolEstudi,
    '{{UBICACIO}}':                   input.adreca || '-',
    '{{DATA_ESTUDI}}':                dataStr.toUpperCase(),
    '{{CLIENT_NOM}}':                 input.client_nom || '-',
    '{{CLIENT_NIF}}':                 input.client_nif || '-',
    '{{CLIENT_ADRECA}}':              input.adreca || '-',
    '{{CLIENT_CUPS}}':                input.cups || '-',
    '{{TARIFA}}':                     tarifa,
    '{{CONSUM_ANUAL}}':               fmt(consumAnual) + ' kWh',
    '{{COST_ACTUAL}}':                fmtE(costActual),
    '{{NUM_MODULS}}':                 String(numModuls),
    '{{MODUL_MODEL}}':                (modul.marca||'JINKO') + ' ' + (modul.model||'Tiger Neo'),
    '{{INVERSOR_MODEL}}':             (inversor.marca||'HUAWEI') + ' ' + (inversor.model||'SUN2000'),
    '{{KWP}}':                        fmt(kpis.kwp,2) + ' kWp',
    '{{INVERSOR_KW}}':                `${inversor.marca||'HUAWEI'} ${inversor.model||'SUN2000'} ${inversor.potencia_kw||6} kW`,
    '{{PRODUCCIO_ANUAL}}':            fmtK(kpis.produccio_anual),
    '{{AUTOCONSUM_ANUAL}}':           fmtK(kpis.autoconsum_anual),
    '{{PCT_AUTOCONSUM}}':             fmt(kpis.pct_autoconsum,1),
    '{{ESTALVI_ANY1}}':               fmtE(kpis.estalvi_any1),
    '{{RETORN_ANYS}}':                String(kpis.retorn_anys) + ' ' + s('anys','años'),
    '{{BENEFICI_25_ANYS}}':           fmtE(kpis.benefici_net_25),
    '{{VAN_25_ANYS}}':                fmtE(kpis.van_25anys),
    '{{TIR_PCT}}':                    String(kpis.tir_pct),
    '{{COST_INSTALACIO}}':            fmtE(costSubtotal),
    '{{COST_INSTALACIO_SENSE_IVA}}':  fmtE(costSubtotal),
    '{{PCT_REDUCCIO_COST}}':          consumAnual > 0 ? Math.round((kpis.estalvi_any1 / costActual) * 100) + '%' : '-',
    '{{PREU_ENERGIA_ACTUAL}}':        fmt(preuMig,4) + ' EUR/kWh',
    '{{CO2_ESTALVIAT}}':              fmt(kpis.co2_anual_kg,0) + ' kg',
    '{{ANYS_GARANTIA_MODUL}}':        String(modul.garantia_anys || 25),
    '{{ANYS_GARANTIA_MODUL_PRODUCTE}}': String(modul.garantia_anys || 25),
    '{{ANYS_GARANTIA_INVERSOR}}':     String(inversor.garantia_anys || 10),
    '{{COMERCIAL_NOM}}':              comercial.nom || 'Solenver',
    '{{COMERCIAL_EMAIL}}':            comercial.email || 'info@solenver.cat',
    '{{COMERCIAL_TEL}}':              comercial.telefon || '-',
    '{{ASSESSOR_CONTACT_1}}':         [comercial.nom || 'Solenver', comercial.email || emailEmpresa, telefonEmpresa].filter(Boolean).join(' · '),
    '{{ASSESSOR_CONTACT_2}}':         [comercial.email || emailEmpresa, telefonEmpresa, webEmpresa].filter(Boolean).join(' · '),
    '{{HTML_LOGO}}':                  htmlLogo,
    '{{HTML_IMG_EMPRESA}}':           htmlImgEmpresa,
    '{{EMAIL_EMPRESA}}':              emailEmpresa,
    '{{TELEFON_EMPRESA}}':            telefonEmpresa,
    '{{WEB_EMPRESA}}':                webEmpresa,
    '{{COBERTURA_EMPRESA}}':          coberturaEmpresa,
    '{{CERTIFICACIO_EMPRESA}}':       certificacioEmpresa,
    '{{ANYS_MANT_GRATUIT}}':          anysMantGratuit,
    '{{VALIDESA_PRESSUPOST}}':        validesaPressupost,
    '{{IMG_MODUL}}':                  imgModulB64    || driveUrl(modul.foto_url),
    '{{IMG_INVERSOR}}':               imgInversorB64 || driveUrl(inversor.foto_url),
    '{{MUNTATGE_NOM}}':               muntatge.nom || 'Estructura de muntatge',
    '{{IMG_ESTRUCTURA}}':             imgEstructuraB64 || driveUrl(muntatge.foto_url),
    '{{TEXT_MUNTATGE_DESC}}':         muntatge.descripcio || (() => {
      const nomMunt = (muntatge.nom || '').toLowerCase();
      if (nomMunt.includes('inclinad') || nomMunt.includes('teulada')) return s('Estructura de muntatge sobre coberta inclinada, adaptada al pendent i orientació òptima de la teulada. Els panells s\'integren amb l\'estructura existent minimitzant l\'impacte visual i garantint la màxima captació solar.','Estructura de montaje sobre cubierta inclinada, adaptada a la pendiente y orientación óptima del tejado. Los paneles se integran con la estructura existente minimizando el impacto visual y garantizando la máxima captación solar.');
      if (nomMunt.includes('plan') || nomMunt.includes('plana')) return s('Estructura de muntatge sobre coberta plana amb inclinació optimitzada per maximitzar la captació solar. El sistema permet un manteniment fàcil i evita ombres entre files de panells gràcies al càlcul de distàncies òptim.','Estructura de montaje sobre cubierta plana con inclinación optimizada para maximizar la captación solar. El sistema permite un mantenimiento fácil y evita sombras entre filas de paneles gracias al cálculo de distancias óptimo.');
      if (nomMunt.includes('terra') || nomMunt.includes('suelo')) return s('Estructura de muntatge en terra dissenyada per suportar les condicions meteorològiques de la zona. L\'orientació i inclinació dels panells s\'optimitzen per obtenir el màxim rendiment al llarg de tot l\'any.','Estructura de montaje en suelo diseñada para soportar las condiciones meteorológicas de la zona. La orientación e inclinación de los paneles se optimizan para obtener el máximo rendimiento a lo largo de todo el año.');
      if (nomMunt.includes('pergola') || nomMunt.includes('pèrgola')) return s('Estructura tipus pèrgola que integra els panells solars com a element arquitectònic. A més de generar energia, proporciona ombra i protecció als espais situats a sota, aportant valor afegit a la instal·lació.','Estructura tipo pérgola que integra los paneles solares como elemento arquitectónico. Además de generar energía, proporciona sombra y protección a los espacios situados debajo, aportando valor añadido a la instalación.');
      return s('L\'estructura de muntatge ha estat dissenyada i dimensionada per garantir la màxima resistència i durabilitat, optimitzant l\'orientació i inclinació dels mòduls fotovoltaics per obtenir el millor rendiment energètic possible.','La estructura de montaje ha sido diseñada y dimensionada para garantizar la máxima resistencia y durabilidad, optimizando la orientación e inclinación de los módulos fotovoltaicos para obtener el mejor rendimiento energético posible.');
    })(),
    '{{IMG_MONITORING}}':             imgMonitoritzacioB64 || driveUrl(inversor.sistema_monitoritzacio),
    '{{TEXT_MONITORITZACIO_DESC}}':   inversor.desc_monitoritzacio || descMonitoritzacioFabricant || s('Sistema de monitorització integrat amb app mòbil per seguiment en temps real de la producció, consum i exportació a la xarxa.','Sistema de monitorización integrado con app móvil para seguimiento en tiempo real de la producción, consumo y exportación a la red.'),
    '{{IMG_VISTA_AERIA}}':            imgVistaAeria,
    '{{HTML_BLOC_VISTA_AERIA}}':      htmlBlocVistaAeria,
    '{{IMG_VISTA_AERIA_PORTADA}}':    imgVistaAeriaPortada,
    '{{TEXT_OBJECTE}}':               textObjecte,
    '{{TEXT_SITUACIO_ENERGETICA}}':   textSituacio,
    '{{TEXT_DESCRIPCIO_INSTALACIO}}': textInstalacio,
    '{{TEXT_PRODUCCIO}}':             textProduccio,
    '{{TEXT_EXCEDENTS}}':             textExcedents,
    '{{TEXT_AVALUACIO_ECONOMICA}}':   textAvaluacio,
    '{{HTML_TAULA_CONSUMS}}':         htmlTaulaConsums,
    '{{HTML_CONSUM_FUTUR}}':          htmlConsumsBase,
    '{{HTML_TAULA_PRODUCCIO}}':       htmlTaulaProduccio,
    '{{HTML_TAULA_MODUL}}':           htmlTaulaModul,
    '{{HTML_TAULA_INVERSOR}}':        htmlTaulaInversor,
    '{{HTML_TAULA_CASHFLOW}}':        htmlTaulaCashflow,
    '{{HTML_TAULA_PRESSUPOST}}':      htmlTaulaPressupost,
    '{{IMG_GRAFIC_CONSUM_MENSUAL}}':  urlGraficConsum,
    '{{IMG_GRAFIC_PV_PRODUCTION}}':   urlGraficPVProd,
    '{{IMG_GRAFIC_CONSUM_VS_PRODUCCIO}}': urlGraficProdVsConsum,
    '{{IMG_GRAFIC_COST_ACTUAL_VS_PV}}':   urlGraficCostVsPV,
    '{{IMG_GRAFIC_CASHFLOW}}':            urlGraficCashflow,
    '{{HTML_MANTENIMENT_CARDS}}':         htmlMantCards,
    '{{SECCIO_MANTENIMENT}}': (() => {
      const imgMantId = config['IMG_MANTENIMENT'] || '';
      const imgMant = imgMantId ? `<img src="${imgMantenimentB64 || driveUrl(imgMantId)}" style="width:100%;height:200px;object-fit:cover;border-radius:10px;margin:16px 0;display:block;box-shadow:0 3px 10px rgba(0,0,0,0.07)" alt="Manteniment Solenver">` : '';
      const imgRevId = config['IMG_REVISIO_ANUAL'] || '';
      const imgRev = imgRevId ? `<div><img src="${imgRevisiB64 || driveUrl(imgRevId)}" style="width:100%;border-radius:10px;object-fit:cover;max-height:220px;display:block;box-shadow:0 3px 10px rgba(0,0,0,0.08)" alt="Revisió tècnica anual"></div>` : '<div></div>';
      const introText = senseSel
        ? s('Pots contractar un pla de manteniment en qualsevol moment per garantir el màxim rendiment de la instal·lació. A continuació trobaràs els plans disponibles per si en un futur vols formalitzar el servei.','Puedes contratar un plan de mantenimiento en cualquier momento para garantizar el máximo rendimiento de la instalación. A continuación encontrarás los planes disponibles por si en un futuro quieres formalizar el servicio.')
        : s('Solenver ofereix plans de manteniment preventiu amb revisió anual presencial, telegestió contínua i assistència tècnica inclosa per mantenir el màxim rendiment de la instal·lació.','Solenver ofrece planes de mantenimiento preventivo con revisión anual presencial, telegestión continua y asistencia técnica incluida para mantener el máximo rendimiento de la instalación.');
      return `<div class="page">
    <div class="sh">
      <div class="sh-num">08</div>
      <div class="sh-title">${s('Servei de Manteniment','Servicio de Mantenimiento')}</div>
    </div>
    <p style="margin-top:0;margin-bottom:8px">${introText}</p>
    ${htmlMantCards}
    ${imgMant}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:16px;align-items:start">
      <div>
        <h3 style="margin-top:0">${s("Revisió tècnica anual — servei inclòs als plans","Revisión técnica anual — servicio incluido en los planes")}</h3>
        <ul style="margin:0;padding-left:16px;font-size:9pt;color:#334155;line-height:1.9">
          <li><strong>${s('Inspecció visual','Inspección visual')}</strong> ${s('de tots els mòduls (trencaments, brutícia, ombres)','de todos los módulos (roturas, suciedad, sombras)')}</li>
          <li><strong>${s('Revisió estructura','Revisión estructura')}</strong> ${s('i connexions: ancoratges, cargoleria i unions','y conexiones: anclajes, tornillería y uniones')}</li>
          <li><strong>${s('Verificació proteccions','Verificación protecciones')}</strong> ${s('elèctriques i posada a terra','eléctricas y puesta a tierra')}</li>
          <li><strong>${s('Inspecció termogràfica','Inspección termográfica')}</strong> ${s("amb càmera d'infraroig (punts calents)","con cámara de infrarrojos (puntos calientes)")}</li>
          <li><strong>${s('Actualització firmware',"Actualización firmware")}</strong> ${s("de l'inversor i sistema de monitoratge","del inversor y sistema de monitorización")}</li>
          <li><strong>${s('Informe tècnic complet','Informe técnico completo')}</strong> ${s('amb recomanacions per als propers mesos','con recomendaciones para los próximos meses')}</li>
        </ul>
      </div>
      ${imgRev}
    </div>
    <div class="pfooter">
      <span>{{EMAIL_EMPRESA}} | {{TELEFON_EMPRESA}}</span>
      <span>{{CLIENT_NOM}}</span>
      <span>{{ID_ESTUDI}}</span>
    </div>
  </div>`;
    })(),
    '{{HTML_IMG_BATERIA}}':              (() => { const id = config['IMG_BATERIA'] || ''; return id ? `<img src="${imgBateriaB64 || driveUrl(id)}" style="width:100%;max-height:320px;object-fit:contain;border-radius:10px;margin:12px 0 16px;display:block" alt="Esquema instal·lació amb bateria">` : ''; })(),
    '{{HTML_IMG_REVISIO_ANUAL}}':        (() => { const id = config['IMG_REVISIO_ANUAL'] || ''; return id ? `<div><img src="${imgRevisiB64 || driveUrl(id)}" style="width:100%;border-radius:10px;object-fit:cover;max-height:220px;display:block;box-shadow:0 3px 10px rgba(0,0,0,0.08)" alt="Revisió tècnica anual"></div>` : '<div></div>'; })(),
    '{{MANTENIMENT_NOM}}':                mantNom,
    '{{MANTENIMENT_COST_ANY}}':           mantCostAnual > 0 ? fmtE(mantCostAnual) : s('Sense contracte','Sin contrato'),
    '{{HTML_IMG_MODUL}}':                 htmlImgModul,
    '{{HTML_IMG_INVERSOR}}':             htmlImgInversor,
    '{{HTML_CASOS_EXIT}}':               htmlCasosExit,
    ...bateriesToks,

    // ── Traducció CA→ES dels textos fixos del template HTML ──────────────────
    ...(lang === 'es' ? {
      // Títols de secció
      'Qui Som':                                      'Quiénes Somos',
      "Objecte de l'Estudi":                          'Objeto del Estudio',
      'Situació Energètica Actual':                   'Situación Energética Actual',
      'Instal·lació Proposada':                       'Instalación Propuesta',
      'Producció Solar i Autoconsum':                 'Producción Solar y Autoconsumo',
      'Pressupost Detallat':                          'Presupuesto Detallado',
      'Anàlisi Econòmica i Retorn de la Inversió':    'Análisis Económico y Retorno de la Inversión',
      'Garanties i Propers Passos':                   'Garantías y Próximos Pasos',
      'Independitzeu-vos de la xarxa amb una bateria':'Independizaos de la red con una batería',
      'Flux de caixa anual detallat':                 'Flujo de caja anual detallado',

      // Portada — KPI labels
      'Potència instal·lada':   'Potencia instalada',
      'Estalvi primer any':     'Ahorro primer año',
      'Retorn inversió':        'Retorno inversión',
      '% Autoconsum':           '% Autoconsumo',

      // §01 Qui Som
      "és una empresa especialitzada en el disseny, instal·lació i manteniment d'instal·lacions solars fotovoltaiques per a ús industrial, agrícola i residencial. Amb més de 10 anys d'experiència al sector energètic, hem acompanyat centenars d'empreses, granges i habitatges en la transició cap a l'energia solar, reduint la seva factura elèctrica i la petjada de carboni.":
        "es una empresa especializada en el diseño, instalación y mantenimiento de instalaciones solares fotovoltaicas para uso industrial, agrícola y residencial. Con más de 10 años de experiencia en el sector energético, hemos acompañado a cientos de empresas, granjas y viviendas en la transición hacia la energía solar, reduciendo su factura eléctrica y la huella de carbono.",
      "El nostre equip d'enginyers, tècnics i comercials treballa amb un sol objectiu: oferir la solució fotovoltaica que millor s'adapti a les necessitats reals de cada client. Gestionem tot el procés de manera integral: des de l'estudi de viabilitat inicial fins a la legalització administrativa i el manteniment a llarg termini. No subcontractem — tota la instal·lació la realitza personal propi i certificat per garantir la màxima qualitat d'execució.":
        "Nuestro equipo de ingenieros, técnicos y comerciales trabaja con un solo objetivo: ofrecer la solución fotovoltaica que mejor se adapte a las necesidades reales de cada cliente. Gestionamos todo el proceso de forma integral: desde el estudio de viabilidad inicial hasta la legalización administrativa y el mantenimiento a largo plazo. No subcontratamos — toda la instalación la realiza personal propio y certificado para garantizar la máxima calidad de ejecución.",
      '+200 instal·lacions':    '+200 instalaciones',
      'Projectes executats a Catalunya i Aragó en sectors industrial, agrícola i residencial':
        'Proyectos ejecutados en Cataluña y Aragón en sectores industrial, agrícola y residencial',
      'Qualitat certificada':   'Calidad certificada',
      'Materials de primera categoria (Tier-1) amb garantia de fabricant de fins a 25 anys':
        'Materiales de primera categoría (Tier-1) con garantía de fabricante de hasta 25 años',
      'Servei 360°':            'Servicio 360°',
      "De l'estudi tècnic i la legalització fins al manteniment preventiu anual inclòs":
        'Del estudio técnico y la legalización hasta el mantenimiento preventivo anual incluido',
      'Especialitat':           'Especialidad',
      'Autoconsum industrial, agrícola i residencial': 'Autoconsumo industrial, agrícola y residencial',
      'Cobertura geogràfica':   'Cobertura geográfica',
      'Certificació':           'Certificación',
      'Compromís':              'Compromiso',
      '25 anys de suport tècnic i acompanyament garantit':
        '25 años de soporte técnico y acompañamiento garantizado',
      'El vostre assessor energètic:': 'Vuestro asesor energético:',
      'El vostre assessor energètic':  'Vuestro asesor energético',

      // §03 Situació Energètica
      "Les dades de consum s'han extret directament dels consums reals del client via SIPS / factures elèctriques i reflecteixen el perfil energètic dels darrers 12 mesos.":
        "Los datos de consumo se han extraído directamente de los consumos reales del cliente vía SIPS / facturas eléctricas y reflejan el perfil energético de los últimos 12 meses.",
      'Consum anual total':             'Consumo anual total',
      'Cost energètic anual estimat':   'Coste energético anual estimado',
      'Preu mig energia':               'Precio medio energía',
      'Fig. 1 · Perfil de consum mensual (kWh) — barres mensuals i línia acumulat anual':
        'Fig. 1 · Perfil de consumo mensual (kWh) — barras mensuales y línea acumulado anual',
      'Fig. 2 · Producció fotovoltaica estimada (kWh) — calculada amb dades PVGIS per a la ubicació':
        'Fig. 2 · Producción fotovoltaica estimada (kWh) — calculada con datos PVGIS para la ubicación',
      'Consums mensuals per períodes tarifaris':
        'Consumos mensuales por períodos tarifarios',

      // §04 Instal·lació Proposada
      'Nombre de mòduls':               'Número de módulos',
      'Model mòdul fotovoltaic':        'Modelo módulo fotovoltaico',
      'Mòdul fotovoltaic — especificacions tècniques': 'Módulo fotovoltaico — especificaciones técnicas',
      'Inversor — especificacions tècniques':          'Inversor — especificaciones técnicas',
      'Tipus de muntatge:':             'Tipo de montaje:',
      'Sistema de monitorització':      'Sistema de monitorización',
      'Monitorització en temps real de producció, consum i exportació':
        'Monitorización en tiempo real de producción, consumo y exportación',
      'App mòbil i plataforma web accessible 24h':
        'App móvil y plataforma web accesible 24h',
      "Alertes automàtiques en cas d'anomalia o baixada de rendiment":
        'Alertas automáticas en caso de anomalía o bajada de rendimiento',
      'Històric de dades exportable per a anàlisi energètica':
        'Histórico de datos exportable para análisis energético',
      'Factors de pèrdues del sistema': 'Factores de pérdidas del sistema',
      'Factor de pèrdua':               'Factor de pérdida',
      'Valor estimat':                  'Valor estimado',
      'Cablejat CC (pèrdues resistives)':   'Cableado CC (pérdidas resistivas)',
      'Rendiment inversor (η = 98.6%)':     'Rendimiento inversor (η = 98.6%)',
      'Brutícia i pols (reducció de captació)':     'Suciedad y polvo (reducción de captación)',
      'Temperatura (efecte sobre el mòdul)':        'Temperatura (efecto sobre el módulo)',
      'Degradació anual del panell fotovoltaic':    'Degradación anual del panel fotovoltaico',
      'Performance Ratio (PR) total estimat':       'Performance Ratio (PR) total estimado',

      // §05 Producció Solar
      'Producció anual':                'Producción anual',
      'Autoconsum directe':             'Autoconsumo directo',
      "Fig. 3 · Producció FV (verd) vs Demanda (vermell) mensual en kWh — l'excedent de producció s'exporta a la xarxa":
        'Fig. 3 · Producción FV (verde) vs Demanda (rojo) mensual en kWh — el excedente de producción se exporta a la red',
      'Balanç energètic mensual detallat': 'Balance energético mensual detallado',

      // §06 Pressupost
      'El pressupost inclou':           'El presupuesto incluye',
      'Materials de primera qualitat: mòduls':
        'Materiales de primera calidad: módulos',
      'Muntatge complet per instal·ladors certificats i posada en marxa':
        'Montaje completo por instaladores certificados y puesta en marcha',
      'Sistema de monitoratge integrat amb app mòbil (temps real)':
        'Sistema de monitorización integrado con app móvil (tiempo real)',
      'Memòria tècnica i direcció d\'obra per enginyers titulats':
        'Memoria técnica y dirección de obra por ingenieros titulados',
      'Legalització administrativa davant el departament corresponent':
        'Legalización administrativa ante el departamento correspondiente',
      "Gestió de l'alta als sistemes de compensació d'excedents a la xarxa":
        'Gestión del alta en los sistemas de compensación de excedentes a la red',
      'Manteniment preventiu gratuït els':  'Mantenimiento preventivo gratuito los',
      'primers anys':                   'primeros años',
      'revisió anual inclosa':          'revisión anual incluida',
      'Telegestió i control d\'alarmes en remot les 24h':
        'Telegestión y control de alarmas en remoto las 24h',
      'Pressupost vàlid per':           'Presupuesto válido por',
      'Tots els preus sense IVA (21% a afegir). La instal·lació es realitza per SOLENVER amb personal propi i certificat.':
        'Todos los precios sin IVA (21% a añadir). La instalación la realiza SOLENVER con personal propio y certificado.',

      // §07 Anàlisi Econòmica
      'Estalvi any 1':                  'Ahorro año 1',
      'Reducció cost energètic':        'Reducción coste energético',
      'Benefici net 25 anys':           'Beneficio neto 25 años',
      'Taxa Interna de Retorn':         'Tasa Interna de Retorno',
      'Fig. 4 · Cost energètic mensual actual (vermell) vs amb instal·lació PV (verd) — EUR/mes':
        'Fig. 4 · Coste energético mensual actual (rojo) vs con instalación PV (verde) — EUR/mes',
      "La instal·lació solar es paga sola en": "La instalación solar se paga sola en",
      'generant un benefici net de':    'generando un beneficio neto de',
      'al llarg dels 25 anys de vida útil. TIR:':
        'a lo largo de los 25 años de vida útil. TIR:',
      "Fig. 5 · Evolució del cashflow acumulat (EUR) — la línia creua el zero quan la inversió queda recuperada":
        'Fig. 5 · Evolución del cashflow acumulado (EUR) — la línea cruza el cero cuando la inversión queda recuperada',

      // §09 Garanties i Propers Passos
      'Anys garantia de producte':          'Años garantía de producto',
      'Anys garantia de producció':         'Años garantía de producción',
      'Anys garantia inversor':             'Años garantía inversor',
      'Anys manteniment preventiu inclòs':  'Años mantenimiento preventivo incluido',
      'Propers passos per avançar':         'Próximos pasos para avanzar',
      'Acceptació del pressupost':          'Aceptación del presupuesto',
      "Quan tot quedi clar i estiguis d'acord, signem el document de manera electrònica o física i posem en marxa el projecte.":
        "Cuando todo quede claro y estés de acuerdo, firmamos el documento de manera electrónica o física y ponemos en marcha el proyecto.",
      'Responsabilitat: Client':            'Responsabilidad: Cliente',
      'Disseny tècnic definitiu':           'Diseño técnico definitivo',
      "El nostre equip tècnic visita la instal·lació, pren mides exactes de la coberta i tanca el disseny definitiu adaptat a les teves necessitats.":
        "Nuestro equipo técnico visita la instalación, toma medidas exactas de la cubierta y cierra el diseño definitivo adaptado a tus necesidades.",
      'Responsabilitat: Solenver':          'Responsabilidad: Solenver',
      'Pagament inicial (30%)':             'Pago inicial (30%)',
      "Amb el disseny aprovat, fem la reserva dels equips al proveïdor per assegurar disponibilitat i data d'instal·lació.":
        "Con el diseño aprobado, hacemos la reserva de los equipos al proveedor para asegurar disponibilidad y fecha de instalación.",
      'Documentació tècnica i gestió dels permisos': 'Documentación técnica y gestión de los permisos',
      "Ens encarreguem de tots els tràmits: memòria tècnica, llicències municipals i comunicació a la distribuïdora elèctrica perquè no hagis de preocupar-te de res.":
        "Nos encargamos de todos los trámites: memoria técnica, licencias municipales y comunicación a la distribuidora eléctrica para que no tengas que preocuparte de nada.",
      'Muntatge i posada en marxa':         'Montaje y puesta en marcha',
      "El nostre equip instal·lador muntarà l'estructura, col·locarà els panells i connectarà tot el sistema elèctric. Al final del dia ja estaràs produint energia.":
        "Nuestro equipo instalador montará la estructura, colocará los paneles y conectará todo el sistema eléctrico. Al final del día ya estarás produciendo energía.",
      'Legalització i certificació':        'Legalización y certificación',
      "Gestionem el Butlletí Elèctric i tots els papers davant la distribuïdora perquè la instal·lació quedi al 100% regularitzada.":
        "Gestionamos el Boletín Eléctrico y todos los papeles ante la distribuidora para que la instalación quede al 100% regularizada.",
      'Formació i entrega':                 'Formación y entrega',
      "Et fem una visita per explicar-te com funciona l'App de monitoratge, repassem junts les dades en temps real i resolem qualsevol dubte que tinguis.":
        "Te hacemos una visita para explicarte cómo funciona la App de monitorización, repasamos juntos los datos en tiempo real y resolvemos cualquier duda que tengas.",

      // §10 Bateries
      "La instal·lació solar genera energia durant el dia, però una part s'exporta a la xarxa a tan sols":
        "La instalación solar genera energía durante el día, pero una parte se exporta a la red a tan solo",
      'Amb una bateria domèstica podeu emmagatzemar aquests excedents i consumir-los de nit o en hores vall, on l\'energia val':
        'Con una batería doméstica podéis almacenar estos excedentes y consumirlos de noche o en horas valle, donde la energía vale',
      '× més valuosa':                      '× más valiosa',
      "El resultat: menys dependència de la companyia elèctrica, més autoconsum i una factura que quasi desapareix. La vostra instal·lació exporta":
        "El resultado: menos dependencia de la compañía eléctrica, más autoconsumo y una factura que casi desaparece. Vuestra instalación exporta",
      "que podríeu aprofitar directament a casa.": "que podríais aprovechar directamente en casa.",
      'Sense bateria':                      'Sin batería',
      'Autoconsum solar':                   'Autoconsumo solar',
      '% autoconsum':                       '% autoconsumo',
      'Excedents exportats':                'Excedentes exportados',
      '/any autoconsumits':                 '/año autoconsumidos',
      'Bateria 5 kWh':                      'Batería 5 kWh',
      'Bateria 10 kWh':                     'Batería 10 kWh',
      'Bateria 15 kWh':                     'Batería 15 kWh',
      'Des de ':                            'Desde ',
      '/any addicional':                    '/año adicional',
    } : {}),
  },
}}];