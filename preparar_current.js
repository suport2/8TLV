// ─── INPUTS ───
const raw = $('POST /solenver/generar-estudi').first().json;
const input = raw.body || raw;
// Textos de l'agent IA (opcionals)
const informeIA = input.informe || {};
const kpis = $('Calcular KPIs estudi').first().json;

// ─── COSTOS DES DEL SHEET ───
const costosRaw = $('Llegir costos PDF').all().map(i => i.json);
const C = Object.fromEntries(costosRaw.map(r => [r.clau, parseFloat(r.valor) || 0]));
const C_MO_BASE     = C.ma_obra_base      || 600;
const C_MO_MOD      = C.ma_obra_per_modul || 80;
const C_PROJECTE    = C.projecte_tecnic   || 550;
const C_CABLES      = C.cables            || 75;
const C_MARGE       = C.marge             || 0.35;

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
const driveUrl = (id) => id ? `https://lh3.googleusercontent.com/d/${id}` : '';

// ─── LOOKUP CATÀLEG ───
const modul    = modulsData.find(r => r.id === input.modul_id) || modulsData[0] || {};
const inversor = inversorsData.find(r => r.id === input.inversor_id) || inversorsData[0] || {};
const muntatge = muntAtgesData.find(r => r.id === (input.muntatge_id || input.tipus_coberta)) || muntAtgesData[0] || {};
const comercial = comercialsData.find(c => c.id === input.comercial_id) || comercialsData[0] || {};

// ─── DADES BASE ───
const numModuls = parseInt(input.num_moduls || kpis.num_moduls || 10);
const today = new Date();
const dataStr = today.toLocaleDateString('ca-ES', {day:'2-digit', month:'long', year:'numeric'});
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
const mesNoms  = ['Gener','Febrer','Març','Abril','Maig','Juny','Juliol','Agost','Setembre','Octubre','Novembre','Desembre'];
const consumosObj = input.consumos || {};
const preuMig = kpis.preu_mig_kwh || 0.1287;
const preuP1  = kpis.preu_p1 || 0.2267;
const preuP2  = kpis.preu_p2 || 0.1384;
const preuP3  = kpis.preu_p3 || 0.0877;

// Detectar si tenim P1/P2/P3
const primeraClau = mesClaus.find(k => consumosObj[k] !== undefined);
const tePeriodes = primeraClau && typeof consumosObj[primeraClau] === 'object' && consumosObj[primeraClau] !== null;

let totalConsum = 0, totalCost = 0, totalP1 = 0, totalP2 = 0, totalP3 = 0;
const filesConsum = mesClaus.map((clau, i) => {
  const raw = consumosObj[clau];
  let p1 = 0, p2 = 0, p3 = 0, total = 0;
  if (tePeriodes && raw && typeof raw === 'object') {
    p1 = parseFloat(raw.p1 || 0);
    p2 = parseFloat(raw.p2 || 0);
    p3 = parseFloat(raw.p3 || 0);
    total = p1 + p2 + p3;
  } else {
    total = parseFloat(raw || 0);
    // Distribució estimada per periodicitat típica 2.0TD
    p1 = Math.round(total * 0.21);
    p2 = Math.round(total * 0.22);
    p3 = total - p1 - p2;
  }
  const cost = tePeriodes ? (p1*preuP1 + p2*preuP2 + p3*preuP3) : (total * preuMig);
  totalConsum += total; totalCost += cost;
  totalP1 += p1; totalP2 += p2; totalP3 += p3;
  return {m: mesNoms[i], p1, p2, p3, total, cost};
});

const consumAnual = totalConsum > 0 ? totalConsum : (kpis.consum_anual || input.consum_anual || 0);
const costActual  = kpis.cost_actual_anual || (totalCost > 0 ? totalCost : consumAnual * preuMig);

// ─── HTML TAULA CONSUMS (adaptativa P1/P2/P3 o simple) ───
const htmlTaulaConsums = tePeriodes
  ? `<table>
  <thead><tr><th>Mes</th><th>P1 (kWh)</th><th>P2 (kWh)</th><th>P3 (kWh)</th><th>Total (kWh)</th><th>Cost (EUR)</th></tr></thead>
  <tbody>
    ${filesConsum.map(r=>`<tr><td><strong>${r.m}</strong></td><td>${fmt(r.p1)}</td><td>${fmt(r.p2)}</td><td>${fmt(r.p3)}</td><td>${fmt(r.total)}</td><td>${fmt(r.cost,2)}</td></tr>`).join('\n    ')}
  </tbody>
  <tfoot><tr><td><strong>TOTAL</strong></td><td><strong>${fmt(totalP1)}</strong></td><td><strong>${fmt(totalP2)}</strong></td><td><strong>${fmt(totalP3)}</strong></td><td><strong>${fmt(consumAnual)}</strong></td><td><strong>${fmt(costActual,2)}</strong></td></tr></tfoot>
</table>`
  : `<table>
  <thead><tr><th>Mes</th><th>Consum (kWh)</th><th>Cost estimat (EUR)</th></tr></thead>
  <tbody>
    ${filesConsum.map(r=>`<tr><td><strong>${r.m}</strong></td><td>${fmt(r.total)}</td><td>${fmt(r.cost,2)}</td></tr>`).join('\n    ')}
  </tbody>
  <tfoot><tr><td><strong>TOTAL</strong></td><td><strong>${fmt(consumAnual)}</strong></td><td><strong>${fmt(costActual,2)}</strong></td></tr></tfoot>
</table>`;

// ─── HTML TAULA PRODUCCIÓ ───
const mensual = kpis.mensual || [];
const htmlTaulaProduccio = `<table>
  <thead><tr><th>Mes</th><th>Prod FV (kWh)</th><th>Consum (kWh)</th><th>Autoconsum (kWh)</th><th>Excedent (kWh)</th><th>Xarxa (kWh)</th><th>Estalvi (EUR)</th></tr></thead>
  <tbody>
    ${mensual.map(m=>`<tr><td><strong>${m.mes}</strong></td><td>${m.produccio}</td><td>${m.consum}</td><td>${m.autoconsum}</td><td>${m.excedent}</td><td>${m.xarxa}</td><td>${m.estalvi}</td></tr>`).join('\n    ')}
  </tbody>
</table>`;

// ─── HTML TAULA MÒDUL ───
const htmlTaulaModul = `<table>
  <tbody>
    <tr><td style="width:50%;font-weight:600">Fabricant</td><td>${modul.marca || 'JINKO SOLAR'}</td></tr>
    <tr><td style="font-weight:600">Model</td><td>${modul.model || 'Tiger Neo N-type'}</td></tr>
    <tr><td style="font-weight:600">Potència màxima</td><td>${modul.potencia_wp || 510} Wp</td></tr>
    <tr><td style="font-weight:600">Eficiència</td><td>${modul.eficiencia || 22}%</td></tr>
    <tr><td style="font-weight:600">Degradació</td><td>0.40% anual</td></tr>
    <tr><td style="font-weight:600">Garantia</td><td>${modul.garantia_anys || 25} anys</td></tr>
  </tbody>
</table>`;

// ─── HTML TAULA INVERSOR ───
const isTrifasic = (inversor.trifasic === true || String(inversor.trifasic).toUpperCase() === 'TRUE');
const htmlTaulaInversor = `<table>
  <tbody>
    <tr><td style="width:50%;font-weight:600">Fabricant</td><td>${inversor.marca || 'HUAWEI'}</td></tr>
    <tr><td style="font-weight:600">Model</td><td>${inversor.model || 'SUN2000'}</td></tr>
    <tr><td style="font-weight:600">Potència AC</td><td>${inversor.potencia_kw || 6} kW</td></tr>
    <tr><td style="font-weight:600">Connexió</td><td>${isTrifasic ? 'Trifàsica' : 'Monofàsica'}</td></tr>
    <tr><td style="font-weight:600">Garantia</td><td>${inversor.garantia_anys || 10} anys</td></tr>
  </tbody>
</table>`;

// ─── HTML TAULA CASHFLOW ───
const cf = kpis.cashflow || [];
const htmlTaulaCashflow = `<table>
  <thead><tr><th>Any</th><th>Estalvi anual (EUR)</th><th>Flux acumulat (EUR)</th><th>Estat</th></tr></thead>
  <tbody>
    ${cf.filter(c=>c.any>0).map(c=>{
      const estalvi = Math.round((kpis.estalvi_any1||0)*Math.pow(1.015,c.any-1));
      const acum = c.flux_acumulat || 0;
      const estat = acum < 0
        ? '<span style="color:#C62828">En recuperació</span>'
        : '<span style="color:#2E7D32;font-weight:700">✓ Recuperat</span>';
      return `<tr><td>Any ${c.any}</td><td>${fmt(estalvi,0)} EUR</td><td style="${acum<0?'color:#C62828':'color:#2E7D32;font-weight:600'}">${fmt(acum,0)} EUR</td><td>${estat}</td></tr>`;
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
const senseCard = `<div class="mant-card" style="border:2px solid ${senseSel ? '#455a64' : '#cfd8dc'};border-radius:12px;padding:20px;background:${senseSel ? '#eceff1' : '#fff'};display:flex;flex-direction:column">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#78909c;margin-bottom:6px">Sense manteniment</div>
  <div style="font-size:30px;font-weight:800;color:#455a64;line-height:1">0<span style="font-size:14px;font-weight:400;color:#555"> €</span></div>
  <div style="font-size:11px;color:#aaa;margin:4px 0 14px">Sense contracte de manteniment</div>
  <ul style="margin:0;padding-left:16px;font-size:12px;color:#666;line-height:2;flex:1">
    <li>El client gestiona el manteniment de forma autònoma</li>
    <li>Accés al suport tècnic puntual de Solenver (pressupost a part)</li>
    <li>Recomanem revisió anual per preservar el rendiment i la garantia</li>
  </ul>
  ${senseSel ? '<div style="margin-top:12px;font-size:11px;font-weight:700;color:#455a64;text-transform:uppercase">✓ Opció seleccionada</div>' : ''}
</div>`;

const htmlMantCards = `
<div class="mant-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:16px 0;page-break-inside:auto">
  ${plansActius.map(m => {
    const costAny  = calcPreuMant(m);
    const perKwp   = parseFloat(m.preu_per_kwp) || parseFloat(m.preu_kwp_any) || 0;
    const preuBase = parseFloat(m.preu_base) || 0;
    const sel      = m.id === mantId;
    const serveis  = (m.serveis || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean);
    const labelPreu = kwpInstalat <= 10
      ? `${preuBase} € + IVA / any`
      : `${perKwp} €/kWp × ${fmt(kwpInstalat,2)} kWp`;
    return `<div class="mant-card${sel ? ' mant-selected' : ''}" style="border:2px solid ${sel ? '#1b5e20' : '#c8e6c9'};border-radius:12px;padding:20px;background:${sel ? '#f1f8e9' : '#fff'};display:flex;flex-direction:column">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#4caf50;margin-bottom:6px">${m.nom}</div>
  <div style="font-size:30px;font-weight:800;color:#1b5e20;line-height:1">${fmt(costAny)}<span style="font-size:14px;font-weight:400;color:#555"> €</span></div>
  <div style="font-size:11px;color:#888;margin:4px 0 14px">${labelPreu}</div>
  <ul style="margin:0;padding-left:16px;font-size:12px;color:#333;line-height:2;flex:1">
    ${serveis.map(s => `<li>${s}</li>`).join('')}
  </ul>
  ${sel ? '<div style="margin-top:12px;font-size:11px;font-weight:700;color:#1b5e20;text-transform:uppercase">✓ Pla seleccionat</div>' : ''}
</div>`;
  }).join('\n  ')}
  ${senseSel ? senseCard : ''}
</div>`;

const mantSeleccionat = mantenimentsData.find(m => m.id === mantId) || null;
const mantCostAnual   = mantSeleccionat ? calcPreuMant(mantSeleccionat) : (parseFloat(input.manteniment_anual) || 0);
const mantNom         = mantSeleccionat?.nom || (mantId === 'sense' ? 'Sense manteniment' : mantId);

// ─── COSTOS PER PLACA ───
const preuModul        = parseFloat(modul.preu || 71.50);
const preuInv          = parseFloat(inversor.preu || 793);
const preuMuntRaw      = parseFloat(muntatge.preu_base || 612);
const preuMuntPerPlaca = preuMuntRaw > 200 ? preuMuntRaw / numModuls : preuMuntRaw;
const costMuntatge     = preuMuntRaw > 200 ? preuMuntRaw : preuMuntRaw * numModuls;
const costMaObra       = C_MO_BASE + (C_MO_MOD * numModuls);
const projecte         = C_PROJECTE;
const cables           = C_CABLES;
const costDirecte      = Math.round((numModuls * preuModul) + costMuntatge + preuInv + costMaObra + projecte + cables);
const MARGE            = C_MARGE;
const costGestio       = Math.round(costDirecte * MARGE);
const costSubtotal     = costDirecte + costGestio;
const ivaEur           = Math.round(costSubtotal * 0.21);
const costTotal        = costSubtotal + ivaEur;

const htmlTaulaPressupost = `<table>
  <thead><tr><th>Concepte</th><th>Quantitat</th><th>Preu unit.</th><th>Total (EUR)</th></tr></thead>
  <tbody>
    <tr><td>Mòduls ${modul.marca||'JINKO'} ${modul.model||'Tiger Neo'} ${modul.potencia_wp||510}Wp</td><td>${numModuls} u.</td><td>${fmt(preuModul,2)} EUR</td><td>${fmt(numModuls*preuModul,2)} EUR</td></tr>
    <tr><td>Inversor ${inversor.marca||'HUAWEI'} ${inversor.model||'SUN2000'} ${inversor.potencia_kw||6}kW</td><td>1 u.</td><td>${fmt(preuInv,2)} EUR</td><td>${fmt(preuInv,2)} EUR</td></tr>
    <tr><td>Muntatge ${muntatge.nom||'Estructura'} (per placa)</td><td>${numModuls} u.</td><td>${fmt(preuMuntPerPlaca,2)} EUR/u.</td><td>${fmt(costMuntatge,2)} EUR</td></tr>
    <tr><td>Mà d'obra i instal·lació</td><td>1 lot</td><td>-</td><td>${fmt(costMaObra,2)} EUR</td></tr>
    <tr><td>Projecte tècnic i legalització</td><td>1 u.</td><td>${fmt(projecte,2)} EUR</td><td>${fmt(projecte,2)} EUR</td></tr>
    <tr><td>Cablejat i materials</td><td>1 lot</td><td>-</td><td>${fmt(cables,2)} EUR</td></tr>
    <tr><td>Gestió i coordinació (overhead 35%)</td><td>1 lot</td><td>-</td><td>${fmt(costGestio,2)} EUR</td></tr>
  </tbody>
  <tfoot>
    <tr class="press-sub"><td colspan="3"><strong>Subtotal sense IVA</strong></td><td><strong>${fmt(costSubtotal,2)} EUR</strong></td></tr>
    <tr><td colspan="3">IVA (21%)</td><td>${fmt(ivaEur,2)} EUR</td></tr>
    <tr class="press-total"><td colspan="3"><strong>TOTAL AMB IVA</strong></td><td><strong>${fmt(costTotal,2)} EUR</strong></td></tr>
  </tfoot>
</table>`;

// ─── QUICKCHART V2 ───
const labelsM        = ['Gen','Feb','Mar','Abr','Mai','Jun','Jul','Ago','Set','Oct','Nov','Des'];
const consumTotal    = mensual.map(m => m.consum || 0);
const prodTotal      = mensual.map(m => m.produccio || 0);
const costActualMens = mensual.map(m => m.cost_actual || 0);
const costPVMens     = mensual.map(m => m.cost_pv != null ? parseFloat(m.cost_pv) : 0);
const consumAcum     = consumTotal.reduce((acc,v,i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);
const prodAcum       = prodTotal.reduce((acc,v,i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);
const cfVals         = kpis.cashflow ? kpis.cashflow.map(c => c.flux_acumulat||0) : [];
const cfLabels       = kpis.cashflow ? kpis.cashflow.map(c => 'Any '+c.any) : [];

const urlGraficConsum = 'https://quickchart.io/chart?w=420&h=210&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: {
    labels: labelsM,
    datasets: [
      {
        type: 'bar',
        label: 'Mensual (kWh)',
        data: consumTotal,
        backgroundColor: 'rgba(39,174,96,0.92)',
        yAxisID: 'y-axis-0'
      },
      {
        type: 'line',
        label: 'Acumulat (kWh)',
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
          scaleLabel: { display: true, labelString: 'Consum mensual [kWh]' }
        },
        {
          id: 'y-axis-1',
          type: 'linear',
          position: 'right',
          ticks: { beginAtZero: true },
          scaleLabel: { display: true, labelString: 'Consum acumulat [kWh]' },
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
      { type:'bar',  label:'Producció FV (kWh)', data: prodTotal,
        backgroundColor:'rgba(39,174,96,0.92)', yAxisID:'y-axis-0' },
      { type:'line', label:'Acumulat (kWh)',       data: prodAcum,
        borderColor:'#F57C00', backgroundColor:'transparent',
        pointRadius:3, borderWidth:2, yAxisID:'y-axis-1', lineTension:0.3 }
    ]
  },
  options: {
    legend: { position:'top' },
    scales: {
      yAxes: [
        { id:'y-axis-0', position:'left',  ticks:{ beginAtZero:true }, scaleLabel:{ display:true, labelString:'Produccio PV [kWh]' } },
        { id:'y-axis-1', position:'right', ticks:{ beginAtZero:true }, scaleLabel:{ display:true, labelString:'Acumulat [kWh]' }, gridLines:{ drawOnChartArea:false } }
      ]
    }
  }
}));

const urlGraficProdVsConsum = 'https://quickchart.io/chart?w=420&h=210&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: { labels: labelsM, datasets: [
    { label:'Produccio PV', data: prodTotal,   backgroundColor:'rgba(39,174,96,0.92)' },
    { label:'Demanda',      data: consumTotal, backgroundColor:'rgba(231,76,60,0.9)' }
  ]},
  options: {
    legend: { position:'top' },
    scales: { yAxes: [{ ticks:{ beginAtZero:true }, scaleLabel:{ display:true, labelString:'Energia [kWh]' } }] }
  }
}));

const urlGraficCostVsPV = 'https://quickchart.io/chart?w=420&h=210&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: { labels: labelsM, datasets: [
    { label:'Cost actual', data: costActualMens, backgroundColor:'rgba(231,76,60,0.9)' },
    { label:'Cost amb PV', data: costPVMens,     backgroundColor:'rgba(39,174,96,0.92)' }
  ]},
  options: {
    legend: { position:'top' },
    scales: { yAxes: [{ ticks:{ beginAtZero:false }, scaleLabel:{ display:true, labelString:'Cost [EUR]' } }] }
  }
}));

const urlGraficCashflow = 'https://quickchart.io/chart?w=420&h=210&c=' + encodeURIComponent(JSON.stringify({
  type: 'line',
  data: { labels: cfLabels, datasets: [{
    label:'Flux acumulat (EUR)', data: cfVals,
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
    `https://drive.google.com/thumbnail?id=${id}&sz=w400`,
    `https://drive.google.com/uc?export=view&id=${id}`,
    `https://lh3.googleusercontent.com/d/${id}`,
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const buf = await resp.arrayBuffer();
      if (!buf.byteLength) continue;
      const ct = resp.headers.get('content-type') || '';
      if (ct.startsWith('text/html')) continue; // descarta pàgines HTML d'error/confirmació
      const finalType = ct.startsWith('image/') ? ct : (mime || 'image/png');
      return `data:${finalType};base64,` + Buffer.from(buf).toString('base64');
    } catch(e) { continue; }
  }
  return null;
}

const logoB64 = await driveToBase64(logoId, 'image/png');
const logoSrc = logoB64 || (logoId ? `https://lh3.googleusercontent.com/d/${logoId}` : '');
// CSS override injectat directament (no depèn de la versió del template a GitHub)
// IMPORTANT: mantenim display:flex per al layout de portada — els KPIs van al final del flex column
const portadaCssOverride = `<style>
.portada{display:flex!important;flex-direction:column!important;height:297mm!important;max-height:297mm!important;overflow:hidden!important;position:relative!important}
.portada-top{flex-shrink:0!important;position:relative!important;z-index:2!important}
.portada-aerial{flex:1!important;min-height:0!important;position:relative!important;z-index:1!important}
.portada-kpis{flex-shrink:0!important;position:static!important;display:grid!important;grid-template-columns:repeat(4,1fr)!important;width:100%!important;background:#fff!important;padding:16px 20mm!important;gap:14px!important;box-shadow:0 -4px 24px rgba(0,0,0,0.25)!important}
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
  descMonitoritzacioFabricant = 'La instal·lació incorpora el sistema de monitorització FusionSolar de Huawei, accessible via app mòbil i portal web. Permet visualitzar en temps real la producció solar, el consum de la llar i l\'exportació a la xarxa, amb alertes automàtiques davant qualsevol anomalia de rendiment.';
} else if (fabricantInversor.includes('fronius')) {
  imgMonitoritzacio = config['IMG_MONITORING_FRONIUS'] || '';
  descMonitoritzacioFabricant = 'El sistema Solar.web de Fronius ofereix monitorització en temps real accessible des de qualsevol dispositiu. La plataforma registra totes les dades de producció i consum, envia notificacions davant incidències i permet exportar historials energètics per a una anàlisi detallada.';
} else if (fabricantInversor.includes('sma')) {
  imgMonitoritzacio = config['IMG_MONITORING_SMA'] || '';
  descMonitoritzacioFabricant = 'La solució Sunny Portal de SMA permet gestionar i monitoritzar la instal·lació fotovoltaica des de la seva plataforma en línia o app mòbil. Proporciona dades en temps real de producció i consum, alertes d\'errors i informes energètics automatitzats.';
} else if (fabricantInversor.includes('solaredge')) {
  imgMonitoritzacio = config['IMG_MONITORING_SOLAREDGE'] || '';
  descMonitoritzacioFabricant = 'El sistema de monitorització SolarEdge proporciona visibilitat a nivell de mòdul individual gràcies als seus optimitzadors de potència. L\'app i el portal web mostren en temps real la producció de cada panell, facilitant la detecció ràpida de possibles incidències.';
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
  <div style="font-size:8.5pt;color:#8bc34a;font-weight:400">Vista aèria de la instal·lació</div>
</div>`;

// Intentar primer Google Maps, després múltiples OSM fallbacks
let mapB64 = null;
if (MAPS_API_KEY) {
  const mapsUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=600x300&maptype=satellite&markers=color:red%7C${lat},${lng}&key=${MAPS_API_KEY}`;
  mapB64 = await fetchMapBase64(mapsUrl);
}
if (!mapB64) {
  // OSM fallback 1: staticmap.openstreetmap.de
  const osmUrl1 = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=17&size=600x300&maptype=mapnik&markers=${lat},${lng},ol-marker`;
  mapB64 = await fetchMapBase64(osmUrl1);
}
if (!mapB64) {
  // OSM fallback 2: maps.geoapify.com (no key needed for low usage)
  const osmUrl2 = `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=300&center=lonlat:${lng},${lat}&zoom=16&marker=lonlat:${lng},${lat};color:%23ff0000;size:medium&apiKey=df85d1c0c31b4816b7a2c1b17f8fd8b0`;
  mapB64 = await fetchMapBase64(osmUrl2);
}

if (mapB64) {
  imgVistaAeria = mapB64;
  htmlBlocVistaAeria = `<div class="vista-aeria"><img src="${mapB64}" alt="Vista aèria" style="width:100%;height:220px;object-fit:cover;display:block"><div class="vista-aeria-cap">Vista aèria de la ubicació de la instal·lació (lat: ${lat}, lng: ${lng})</div></div>`;
  imgVistaAeriaPortada = `<div class="portada-aerial" data-lat="${lat}" data-lng="${lng}" style="background-image:url('${mapB64}')"></div>`;
} else {
  // Sense mapa: Playwright injectarà Leaflet+ESRI satellite durant el render de la portada
  imgVistaAeria = '';
  htmlBlocVistaAeria = `<div class="vista-aeria">${mapPlaceholder}<div class="vista-aeria-cap">Vista aèria de la ubicació de la instal·lació (lat: ${lat}, lng: ${lng})</div></div>`;
  imgVistaAeriaPortada = `<div class="portada-aerial" data-lat="${lat}" data-lng="${lng}" style="background:#1b5e20"></div>`;
}

// ─── TEXTOS ───
const perfilLabel = {
  'granja_porcina':'Granja Porcina', 'granja_avicola':'Granja Avícola',
  'industria_general':'Indústria', 'logistica_magatzem':'Logística i Magatzem',
  'domestica_residencial':'Autoconsum Domèstic', 'comercial_oficines':'Comerç i Oficines',
  'agricola_reg':'Ús Agrícola'
}[input.perfil_client || kpis.perfil_client || 'industria_general'] || 'Industrial';
const perfilNom = 'per a ' + perfilLabel;

const tarifa = kpis.tarifa || input.tarifa || '2.0TD';

const textObjecte = injectKpisText(decodeStr(informeIA.seccio_objecte)) ||
  `L'objecte d'aquest estudi és l'avaluació tècnico-econòmica de la implementació d'una instal·lació solar fotovoltaica per autoconsum a ${input.adreca || input.client_nom || 'la instal·lació del client'}. No és àmbit d'aquest document el disseny de la instal·lació elèctrica interior.`;
const textSituacio = injectKpisText(decodeStr(informeIA.seccio_situacio_energetica)) ||
  `El perfil de consum del client correspon a una instal·lació de tipus ${perfilLabel.toLowerCase()}, amb un consum anual de ${fmt(consumAnual)} kWh i un cost energètic actual estimat de ${fmtE(costActual)}.`;
const textInstalacio = injectKpisText(decodeStr(informeIA.seccio_instalacio)) ||
  `La instal·lació proposada consisteix en ${numModuls} mòduls ${modul.marca||'JINKO SOLAR'} ${modul.model||'Tiger Neo'} de ${modul.potencia_wp||510} Wp, assolint una potència de ${fmt(kpis.kwp,2)} kWp. L'inversor ${inversor.marca||'HUAWEI'} ${inversor.model||'SUN2000'} de ${inversor.potencia_kw||6} kW treballa en connexió ${isTrifasic?'trifàsica':'monofàsica'}.`;
const textProduccio = injectKpisText(decodeStr(informeIA.seccio_produccio)) ||
  `La instal·lació produirà ${fmtK(kpis.produccio_anual)} anualment. El percentatge d'autoconsum estimat és del ${fmt(kpis.pct_autoconsum,1)}%, equivalent a ${fmtK(kpis.autoconsum_anual)}. Els excedents (${fmtK(kpis.excedent_anual)}) es compensaran a la xarxa elèctrica.`;
const textAvaluacio = injectKpisText(decodeStr(informeIA.seccio_economia)) ||
  `L'estalvi el primer any és de ${fmtE(kpis.estalvi_any1)}, amb un retorn de la inversió en ${kpis.retorn_anys} anys. El VAN a 25 anys és de ${fmtE(kpis.van_25anys)} i la TIR del ${kpis.tir_pct}%. El benefici net acumulat al llarg de la vida útil és de ${fmtE(kpis.benefici_net_25)}.`;
const textExcedents = injectKpisText(decodeStr(informeIA.recomanacio_bateria)) ||
  `La compensació d'excedents a preu de mercat (${fmt(kpis.preu_excedent||0.065,3)} EUR/kWh) complementa l'estalvi directe per autoconsum, millorant el retorn total de la inversió.`;
const titolEstudi = decodeStr(informeIA.titol) ||
  `Memòria de la Valoració d'un Sistema d'Autoconsum Fotovoltaic ${perfilNom}`;

// ─── FOOTER PER PLAYWRIGHT (apareix a totes les pàgines físiques menys portada) ───
const telDisplay = telefonEmpresa ? ` · ${telefonEmpresa}` : '';
const footerHtml = `<div style="font-size:8px;color:#64748b;font-family:'Segoe UI',Arial,Helvetica,sans-serif;width:100%;display:flex;justify-content:space-between;align-items:center;padding:4px 18mm 0;box-sizing:border-box;border-top:1px solid #e2e8f0"><span>${emailEmpresa}${telDisplay}</span><span style="font-weight:600">${input.client_nom||'-'}</span><span>${idEstudi}</span></div>`;
const logoImgHtml = logoId ? `<img src="LOGO_PLACEHOLDER" style="height:24px;width:auto;vertical-align:middle;margin-right:6px">` : '';
const headerHtml = `<div style="font-family:'Segoe UI',Arial,Helvetica,sans-serif;width:100%;display:flex;justify-content:space-between;align-items:center;padding:0 18mm;box-sizing:border-box;border-bottom:2px solid #27ae60;font-size:8px;"><span style="display:flex;align-items:center;gap:6px">${logoImgHtml}<span style="font-weight:800;letter-spacing:1.5px;color:#1b5e20;font-size:9px">SOLENVER</span></span><span style="text-align:right;line-height:1.5;color:#64748b"><span style="font-weight:700;color:#1b5e20">${nomEmpresaHeader}</span><br>${adrecaEmpresaHeader}<br>${webEmpresa}</span></div>`;

// ─── HTML IMATGES MÒDUL / INVERSOR ───
const modulFotoUrl   = driveUrl(modul.foto_url   || '');
const inversorFotoUrl= driveUrl(inversor.foto_url || '');
const htmlImgModul   = modulFotoUrl
  ? `<img src="${modulFotoUrl}" alt="Mòdul fotovoltaic" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;object-fit:contain;max-height:200px;background:#fff;padding:8px;display:block">`
  : `<div style="height:140px;background:#f8fafc;border:1px dashed #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:28pt;color:#94a3b8">☀️</div>`;
const htmlImgInversor= inversorFotoUrl
  ? `<img src="${inversorFotoUrl}" alt="Inversor" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;object-fit:contain;max-height:200px;background:#fff;padding:8px;display:block">`
  : `<div style="height:140px;background:#f8fafc;border:1px dashed #e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:28pt;color:#94a3b8">⚡</div>`;

// ─── CASOS D'ÈXIT (fotos de projectes des de Sheets configuracio) ───
// Camps: IMG_CASO_EXIT_1..4, TITLE_CASO_EXIT_1..4, DESC_CASO_EXIT_1..4
const casosItems = [];
for (let i = 1; i <= 4; i++) {
  const imgId = config[`IMG_CASO_EXIT_${i}`] || '';
  const title = config[`TITLE_CASO_EXIT_${i}`] || '';
  const desc  = config[`DESC_CASO_EXIT_${i}`] || '';
  if (imgId || title) casosItems.push({ img: driveUrl(imgId), title: title || `Projecte ${i}`, desc });
}
const htmlCasosExit = casosItems.length > 0
  ? `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin:16px 0">
      ${casosItems.map(c => `
      <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05)">
        ${c.img ? `<img src="${c.img}" style="width:100%;height:160px;object-fit:cover;display:block" alt="${c.title}">` : '<div style="height:160px;background:linear-gradient(135deg,#e8f5e9,#f1f8e9);display:flex;align-items:center;justify-content:center;font-size:28pt">☀️</div>'}
        <div style="padding:10px 14px">
          <div style="font-weight:700;font-size:10pt;color:#0f172a;margin-bottom:3px">${c.title}</div>
          ${c.desc ? `<div style="font-size:8.5pt;color:#64748b">${c.desc}</div>` : ''}
        </div>
      </div>`).join('')}
    </div>`
  : `<div style="text-align:center;padding:36px 20px;background:#f8fafc;border-radius:10px;border:1px dashed #e2e8f0">
      <div style="font-size:28pt;margin-bottom:10px">☀️</div>
      <div style="font-weight:700;font-size:11pt;color:#334155">Galeria de Projectes Solenver</div>
      <div style="font-size:9pt;color:#64748b;margin-top:6px">Més de 200 instal·lacions a Catalunya i Aragó. Contacta'ns per veure el portafoli complet.</div>
    </div>`;

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
    '{{RETORN_ANYS}}':                String(kpis.retorn_anys) + ' anys',
    '{{BENEFICI_25_ANYS}}':           fmtE(kpis.benefici_net_25),
    '{{VAN_25_ANYS}}':                fmtE(kpis.van_25anys),
    '{{TIR_PCT}}':                    String(kpis.tir_pct),
    '{{COST_INSTALACIO}}':            fmtE(costTotal),
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
    '{{HTML_LOGO}}':                  htmlLogo,
    '{{HTML_IMG_EMPRESA}}':           htmlImgEmpresa,
    '{{EMAIL_EMPRESA}}':              emailEmpresa,
    '{{TELEFON_EMPRESA}}':            telefonEmpresa,
    '{{WEB_EMPRESA}}':                webEmpresa,
    '{{COBERTURA_EMPRESA}}':          coberturaEmpresa,
    '{{CERTIFICACIO_EMPRESA}}':       certificacioEmpresa,
    '{{ANYS_MANT_GRATUIT}}':          anysMantGratuit,
    '{{VALIDESA_PRESSUPOST}}':        validesaPressupost,
    '{{IMG_MODUL}}':                  driveUrl(modul.foto_url),
    '{{IMG_INVERSOR}}':               driveUrl(inversor.foto_url),
    '{{MUNTATGE_NOM}}':               muntatge.nom || 'Estructura de muntatge',
    '{{IMG_ESTRUCTURA}}':             driveUrl(muntatge.foto_url),
    '{{TEXT_MUNTATGE_DESC}}':         muntatge.descripcio || (() => {
      const nomMunt = (muntatge.nom || '').toLowerCase();
      if (nomMunt.includes('inclinad') || nomMunt.includes('teulada')) return 'Estructura de muntatge sobre coberta inclinada, adaptada al pendent i orientació òptima de la teulada. Els panells s\'integren amb l\'estructura existent minimitzant l\'impacte visual i garantint la màxima captació solar.';
      if (nomMunt.includes('plan') || nomMunt.includes('plana')) return 'Estructura de muntatge sobre coberta plana amb inclinació optimitzada per maximitzar la captació solar. El sistema permet un manteniment fàcil i evita ombres entre files de panells gràcies al càlcul de distàncies òptim.';
      if (nomMunt.includes('terra') || nomMunt.includes('suelo')) return 'Estructura de muntatge en terra dissenyada per suportar les condicions meteorològiques de la zona. L\'orientació i inclinació dels panells s\'optimitzen per obtenir el màxim rendiment al llarg de tot l\'any.';
      if (nomMunt.includes('pergola') || nomMunt.includes('pèrgola')) return 'Estructura tipus pèrgola que integra els panells solars com a element arquitectònic. A més de generar energia, proporciona ombra i protecció als espais situats a sota, aportant valor afegit a la instal·lació.';
      return 'L\'estructura de muntatge ha estat dissenyada i dimensionada per garantir la màxima resistència i durabilitat, optimitzant l\'orientació i inclinació dels mòduls fotovoltaics per obtenir el millor rendiment energètic possible.';
    })(),
    '{{IMG_MONITORING}}':             driveUrl(inversor.sistema_monitoritzacio),
    '{{TEXT_MONITORITZACIO_DESC}}':   inversor.desc_monitoritzacio || descMonitoritzacioFabricant || 'Sistema de monitorització integrat amb app mòbil per seguiment en temps real de la producció, consum i exportació a la xarxa.',
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
    '{{HTML_IMG_MANTENIMENT}}':          (() => { const id = config['IMG_MANTENIMENT'] || ''; return id ? `<img src="${driveUrl(id)}" style="width:100%;height:200px;object-fit:cover;border-radius:10px;margin:16px 0;display:block;box-shadow:0 3px 10px rgba(0,0,0,0.07)" alt="Manteniment Solenver">` : ''; })(),
    '{{MANTENIMENT_NOM}}':                mantNom,
    '{{MANTENIMENT_COST_ANY}}':           mantCostAnual > 0 ? fmtE(mantCostAnual) : 'Sense contracte',
    '{{HTML_IMG_MODUL}}':                 htmlImgModul,
    '{{HTML_IMG_INVERSOR}}':             htmlImgInversor,
    '{{HTML_CASOS_EXIT}}':               htmlCasosExit,
  },
}}];