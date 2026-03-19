// ─── INPUTS ───
const raw = $('POST /solenver/generar-estudi').first().json;
const input = raw.body || raw;
// Textos de l'agent IA (opcionals)
const informeIA = input.informe || {};
const kpis = $('Calcular KPIs estudi').first().json;

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
  return t;
};
const modulsData    = $('Llegir catàleg PDF').all().map(i => i.json);
const inversorsData = $('Llegir inversors PDF').all().map(i => i.json);
const muntAtgesData = $('Llegir muntatges PDF').all().map(i => i.json);
const comercialsData = $('Llegir comercials PDF').all().map(i => i.json);
const configData = $('Llegir configuració').all().map(i => i.json);
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
const costActual  = totalCost  > 0 ? totalCost  : consumAnual * preuMig;

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

// ─── COSTOS PER PLACA ───
const preuModul        = parseFloat(modul.preu || 71.50);
const preuInv          = parseFloat(inversor.preu || 793);
const preuMuntRaw      = parseFloat(muntatge.preu_base || 612);
const preuMuntPerPlaca = preuMuntRaw > 200 ? preuMuntRaw / numModuls : preuMuntRaw;
const costMuntatge     = preuMuntRaw > 200 ? preuMuntRaw : preuMuntRaw * numModuls;
const costMaObra       = 600 + (80 * numModuls);
const projecte         = 550;
const cables           = 75;
// BUG 3: Incloure marge 35% igual al que usa kpis_estudi.js en cost_instalacio
const costDirecte      = Math.round((numModuls * preuModul) + costMuntatge + preuInv + costMaObra + projecte + cables);
const MARGE            = 0.35;
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
const costPVMens     = mensual.map(m => Math.max(0, m.cost_pv || 0));
const consumAcum     = consumTotal.reduce((acc,v,i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);
const prodAcum       = prodTotal.reduce((acc,v,i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);
const cfVals         = kpis.cashflow ? kpis.cashflow.map(c => c.flux_acumulat||0) : [];
const cfLabels       = kpis.cashflow ? kpis.cashflow.map(c => 'Any '+c.any) : [];

const urlGraficConsum = 'https://quickchart.io/chart?w=600&h=300&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: {
    labels: labelsM,
    datasets: [
      {
        type: 'bar',
        label: 'Mensual (kWh)',
        data: consumTotal,
        backgroundColor: 'rgba(27,94,32,0.85)',
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

const urlGraficPVProd = 'https://quickchart.io/chart?w=550&h=280&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: {
    labels: labelsM,
    datasets: [
      { type:'bar',  label:'Producció FV (kWh)', data: prodTotal,
        backgroundColor:'rgba(76,175,80,0.85)', yAxisID:'y-axis-0' },
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

const urlGraficProdVsConsum = 'https://quickchart.io/chart?w=550&h=280&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: { labels: labelsM, datasets: [
    { label:'Produccio PV', data: prodTotal,   backgroundColor:'rgba(76,175,80,0.85)' },
    { label:'Demanda',      data: consumTotal, backgroundColor:'rgba(198,40,40,0.75)' }
  ]},
  options: {
    legend: { position:'top' },
    scales: { yAxes: [{ ticks:{ beginAtZero:true }, scaleLabel:{ display:true, labelString:'Energia [kWh]' } }] }
  }
}));

const urlGraficCostVsPV = 'https://quickchart.io/chart?w=550&h=280&c=' + encodeURIComponent(JSON.stringify({
  type: 'bar',
  data: { labels: labelsM, datasets: [
    { label:'Cost actual', data: costActualMens, backgroundColor:'rgba(198,40,40,0.8)' },
    { label:'Cost amb PV', data: costPVMens,     backgroundColor:'rgba(76,175,80,0.8)' }
  ]},
  options: {
    legend: { position:'top' },
    scales: { yAxes: [{ ticks:{ beginAtZero:true }, scaleLabel:{ display:true, labelString:'Cost [EUR]' } }] }
  }
}));

const urlGraficCashflow = 'https://quickchart.io/chart?w=550&h=280&c=' + encodeURIComponent(JSON.stringify({
  type: 'line',
  data: { labels: cfLabels, datasets: [{
    label:'Flux acumulat (EUR)', data: cfVals,
    borderColor:'rgba(27,94,32,1)', backgroundColor:'rgba(76,175,80,0.15)',
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
const htmlLogo = logoId
  ? `<img src="https://lh3.googleusercontent.com/d/${logoId}" style="max-height:65px;width:auto;display:block" alt="Solenver">`
  : `<span style="font-weight:700;font-size:20px;color:inherit;letter-spacing:2px">SOLENVER</span>`;

const emailEmpresa    = config['EMAIL_EMPRESA']    || 'info@solenver.cat';
const telefonEmpresa  = config['TELEFON_EMPRESA']  || '';
const webEmpresa      = config['WEB_EMPRESA']      || 'Energia Solar Fotovoltaica · www.solenver.cat';

const imgEmpresaId = config['IMG_EMPRESA'] || '';
const htmlImgEmpresa = imgEmpresaId
  ? `<div style="margin:16px 0;text-align:center"><img src="https://lh3.googleusercontent.com/d/${imgEmpresaId}" style="max-width:100%;max-height:220px;border-radius:8px;object-fit:cover" alt="Equip Solenver"></div>`
  : '';

// ─── IMATGE MONITORITZACIÓ (per fabricant inversor) ───
const fabricantInversor = (inversor.fabricant || inversor.marca || inversor.model || '').toLowerCase();
let imgMonitoritzacio = '';
if (fabricantInversor.includes('huawei')) {
  imgMonitoritzacio = config['IMG_MONITORING_HUAWEI'] || '';
} else if (fabricantInversor.includes('fronius')) {
  imgMonitoritzacio = config['IMG_MONITORING_FRONIUS'] || '';
} else if (fabricantInversor.includes('sma')) {
  imgMonitoritzacio = config['IMG_MONITORING_SMA'] || '';
} else if (fabricantInversor.includes('solaredge')) {
  imgMonitoritzacio = config['IMG_MONITORING_SOLAREDGE'] || '';
} else {
  imgMonitoritzacio = config['IMG_MONITORING_GENERIC'] || '';
}

// ─── VISTA AÈRIA (Google Maps Static API) ───
let imgVistaAeria = '';
let htmlBlocVistaAeria = '';
let imgVistaAeriaPortada = '';

if (MAPS_API_KEY) {
  const mapsUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=17&size=600x300&maptype=satellite&markers=color:red%7C${lat},${lng}&key=${MAPS_API_KEY}`;
  imgVistaAeria = mapsUrl;
  htmlBlocVistaAeria = `<div class="vista-aeria"><img src="${mapsUrl}" alt="Vista aèria"><div class="vista-aeria-cap">Vista aèria de la ubicació de la instal·lació (lat: ${lat}, lng: ${lng})</div></div>`;
  imgVistaAeriaPortada = `<div class="portada-aerial" style="background-image:url('${mapsUrl}')"></div>`;
} else {
  // Sense Maps API: mostrar bloc buit
  htmlBlocVistaAeria = ``;
  imgVistaAeriaPortada = ``;
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

return [{json: {
  id_estudi:  idEstudi,
  data:       dataStr,
  client_nom: input.client_nom || 'Client',
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
    '{{CO2_ESTALVIAT}}':              fmt(kpis.co2_estalviat_kg,0) + ' kg',
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
    '{{IMG_MODUL}}':                  driveUrl(modul.foto_url),
    '{{IMG_INVERSOR}}':               driveUrl(inversor.foto_url),
    '{{IMG_ESTRUCTURA}}':             driveUrl(muntatge.foto_url),
    '{{IMG_MONITORING}}':             driveUrl(inversor.sistema_monitoritzacio),
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
  },
}}];