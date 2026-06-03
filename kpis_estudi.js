// SOLENVER — Motor fotovoltaic v5 — Simulació hora·hora + PVGIS real
const raw   = $('POST /solenver/generar-estudi').first().json;
const input = raw.body || raw;

const motorData = $('Llegir dades motor PDF').first().json;
const SOLAR   = motorData.solar_8760h;
let   TARIFES = motorData.tarifes_8760h;

// Producció mensual real de PVGIS (kWh/kWp/mes) per lat/lng/inclinació/acimut del client
// Prioritat 1: node PVGIS de n8n | Prioritat 2: pvgis_monthly del payload (pre-calculat per formulari)
let pvgisMonthly = null;
try {
  const pvgisRaw = $('PVGIS - Producció solar').first().json;
  const pvgisData = pvgisRaw.outputs?.monthly?.fixed || pvgisRaw.monthly?.fixed;
  if (pvgisData && pvgisData.length === 12) {
    pvgisMonthly = pvgisData.map(r => r.E_m); // kWh/kWp per mes
  }
} catch(e) { /* PVGIS node no disponible */ }

// Fallback: llegir pvgis_monthly del payload (enviat pel formulari)
if (!pvgisMonthly && Array.isArray(input.pvgis_monthly) && input.pvgis_monthly.length === 12) {
  pvgisMonthly = input.pvgis_monthly;
}

// Construir shapes des de la fulla perfils del Sheets
const perfilsRaw = $('Llegir perfils PDF').all().map(i => i.json);
const SHAPES_SHEETS = {};
perfilsRaw.forEach(row => {
  const hora = parseInt(row.hora) - 1; // hora va de 1 a 24
  if (hora < 0 || hora > 23) return;
  const cols = {
    'granja_porcina':        parseFloat(row.granja_porcina)        || 0,
    'granja_avicola':        parseFloat(row.granja_avicola)        || 0,
    'industria_general':     parseFloat(row.industria_general)     || 0,
    'logistica_magatzem':    parseFloat(row.logistica_magatzem)    || 0,
    'domestica_residencial': parseFloat(row.domestica_residencial) || 0,
    'comercial_oficines':    parseFloat(row.comercial_oficines)    || 0,
    'agricola_reg':          parseFloat(row.agricola_reg)          || 0,
    'industrial_nocturn':    parseFloat(row.industrial_nocturn)    || 0,
    'domestica_plana':       parseFloat(row.domestica_plana)       || 0,
  };
  Object.entries(cols).forEach(([key, val]) => {
    if (!SHAPES_SHEETS[key]) SHAPES_SHEETS[key] = new Array(24).fill(0);
    SHAPES_SHEETS[key][hora] = val;
  });
});
// Normalitzar cada shape (suma = 1) i eliminar si buida (no sobreescriure motor_data.json)
Object.keys(SHAPES_SHEETS).forEach(key => {
  const total = SHAPES_SHEETS[key].reduce((a, b) => a + b, 0);
  if (total > 0) SHAPES_SHEETS[key] = SHAPES_SHEETS[key].map(v => v / total);
  else delete SHAPES_SHEETS[key];
});
// Merge: Sheets té prioritat, motor_data.json com a fallback
const SHAPES = { ...motorData.shapes, ...SHAPES_SHEETS };

const paramsRaw = $('Llegir paràmetres PDF').all().map(i => i.json);
const P = {};
paramsRaw.forEach(r => { P[r.clau] = r.valor; });
const INFLACIO  = parseFloat(P.inflacio_energia) || 0.015;
const IVA       = parseFloat(P.iva)              || 0.21;
const MARGE     = parseFloat(P.marge_comercial)  || 0.35;
const VIDA_UTIL = parseInt(P.vida_util)          || 25;
const TAXA_DESC  = parseFloat(P.taxa_descont)     || 0.05;
const DEGRADACIO = parseFloat(P.degradacio_anual) || 0.004;

const numMod   = parseInt(input.num_moduls || 12);
const potMod   = parseFloat(input.potencia_modul || 510);
const kwp      = numMod * potMod / 1000;
const potInv   = parseFloat(input.potencia_inversor_kw || 6);
const trifasic = input.trifasic || false;
const perfil   = input.perfil_client || 'industria_general';
const perdues_cable    = parseFloat(input.perdues_cable    || 0.015);
const perdues_inversor = parseFloat(input.perdues_inversor || 0.08);
const factorPerdues    = (1 - perdues_cable) * (1 - perdues_inversor);
const factorOmbres     = {'cap': 1, 'parcials': 0.95, 'importants': 0.85}[input.ombres || input.instalacio?.ombres] ?? 1;

const preu_p1  = parseFloat(input.preu_p1 || 0.2267);
const preu_p2  = parseFloat(input.preu_p2 || 0.1384);
const preu_p3  = parseFloat(input.preu_p3 || 0.0877);
const preu_exc = parseFloat(input.preu_excedent || 0.07);
const tariffType = (input.tariff_type || '2td').toLowerCase();
const is6P       = tariffType === '3td' || tariffType.startsWith('6');
const N          = is6P ? 6 : 3;
if (is6P) TARIFES = motorData.tarifes_8760h_6p || TARIFES;
const preu_p4    = parseFloat(input.preu_p4 || motorData.preus_defecte_3td?.P4 || 0.060);
const preu_p5    = parseFloat(input.preu_p5 || motorData.preus_defecte_3td?.P5 || 0.050);
const preu_p6    = parseFloat(input.preu_p6 || motorData.preus_defecte_3td?.P6 || 0.040);
const PREUS_ARR  = [preu_p1, preu_p2, preu_p3, preu_p4, preu_p5, preu_p6];
const PREUS      = { P1: preu_p1, P2: preu_p2, P3: preu_p3, P4: preu_p4, P5: preu_p5, P6: preu_p6 };

const shape = SHAPES[perfil] || SHAPES['industria_general'];

// Format consums: {gen:{p1,p2,p3},...} o {gen:700,...}
const mesClaus = ['gen','feb','mar','abr','mai','jun','jul','ago','set','oct','nov','des'];
const dies_l   = [31,28,31,30,31,30,31,31,30,31,30,31];
const consumos = input.consumos || {};
const cp = Array.from({length: N}, () => new Array(12).fill(0));

const primeraClau = mesClaus.find(k => consumos[k] !== undefined);
const tePeriodes  = primeraClau && typeof consumos[primeraClau] === 'object' && consumos[primeraClau] !== null;
const teFactura   = tePeriodes && mesClaus.some(m => [1,2,3,4,5,6].some(n => (consumos[m]?.['p'+n] || 0) > 0));

if (teFactura) {
  for (let n = 0; n < N; n++)
    cp[n] = mesClaus.map(m => parseFloat(consumos[m]?.['p'+(n+1)] || 0));
} else {
  // Sense factura detallada: distribuïr per sector usant TARIFES hora×hora
  const cAnual = primeraClau
    ? mesClaus.reduce((s,m) => s + parseFloat(consumos[m] || 0), 0)
    : parseFloat(input.consum_anual || 6792);
  const mesConsum = primeraClau
    ? mesClaus.map(m => parseFloat(consumos[m] || 0))
    : dies_l.map(d => cAnual*(d/365));

  let idxT = 0;
  for (let m = 0; m < 12; m++) {
    const sP = {};
    for (let n = 1; n <= N; n++) sP['P'+n] = 0;
    for (let d=0; d<dies_l[m]; d++)
      for (let h=0; h<24; h++) {
        const i=idxT+d*24+h; if(i>=TARIFES.length) break;
        const tn = TARIFES[i] || 'P'+N;
        if (sP[tn] !== undefined) sP[tn] += shape[h];
      }
    const tot = Object.values(sP).reduce((a,b)=>a+b,0) || 1;
    for (let n = 0; n < N; n++) cp[n][m] = mesConsum[m] * (sP['P'+(n+1)] / tot);
    idxT += dies_l[m]*24;
  }
}

// Equips futurs: afegir delta de consum mensual proporcional a P1/P2/P3 existents
// Perfils del Sheets (enviats al payload) amb fallback hardcodat
const PERFILS_EQ_FALLBACK = {
  cooling_granja:     [0,0,4,6,8,10,12,12,10,4,0,0],
  camara_frigorifica: [6,6,7,8,10,12,14,14,11,8,6,6],
  aerotermia_acs:     [4,4,3,2,1,1,1,1,1,2,3,4],
  aerotermia_calef:   [8,7,5,2,0,0,0,0,0,2,5,8],
  carregador_ve:      [2,2,2,2,2,2,2,2,2,2,2,2],
  bombament_reg:      [0,0,1,2,4,6,8,8,6,2,0,0],
  compressor_fred:    [3,3,4,5,7,9,10,10,8,5,3,3],
  altre:              [3,3,3,3,3,3,3,3,3,3,3,3],
};
// Construir lookup des de Sheets (si disponible) o usar fallback
const perfilsEquipsArr = Array.isArray(input.perfils_equips) && input.perfils_equips.length > 0
  ? input.perfils_equips
  : [];
const PERFILS_EQ = {};
perfilsEquipsArr.forEach(p => { if (p.id && p.hores) PERFILS_EQ[p.id] = p.hores; });
const getHoresEq = (id) => PERFILS_EQ[id] || PERFILS_EQ_FALLBACK[id] || PERFILS_EQ_FALLBACK['altre'];

const equipsFuturs = Array.isArray(input.equips_futurs) ? input.equips_futurs : [];
if (equipsFuturs.length > 0) {
  for (const eq of equipsFuturs) {
    for (let m = 0; m < 12; m++) {
      const tot = cp.reduce((s,cpi)=>s+cpi[m], 0);
      let extra = 0;
      if (eq.mode === 'pct') {
        extra = tot * ((eq.pct || 0) / 100);
      } else {
        const hores = getHoresEq(eq.tipus);
        extra = (eq.unitats || 1) * (eq.kw_unit || 0) * hores[m] * dies_l[m];
      }
      if (tot > 0) {
        for (let n = 0; n < N; n++) cp[n][m] += extra * cp[n][m] / tot;
      } else {
        cp[N-1][m] += extra;
      }
    }
  }
}

// SIMULACIÓ HORA·HORA
// Si tenim dades PVGIS, escalar la producció horària perquè els totals mensuals coincideixin
// amb els kWh/kWp/mes reals de PVGIS (lat/lng/inclinació/acimut del client)
const acMes=[],excMes=[],xaMes=[],pvMes=[],costMes=[],compMes=[];
let idx = 0;

// Pre-calcular totals mensuals del SOLAR fix per poder escalar
const solarMesTotals = [];
let idxS = 0;
for (let m = 0; m < 12; m++) {
  let tot = 0;
  for (let d=0; d<dies_l[m]; d++)
    for (let h=0; h<24; h++) {
      if(idxS>=SOLAR.length) break;
      tot += SOLAR[idxS++];
    }
  solarMesTotals.push(tot); // W/kWp acumulats del mes
}

for (let m = 0; m < 12; m++) {
  // Factor d'escala PVGIS: ajustar la producció horària als kWh/kWp reals del mes
  // pvgisMonthly[m] = kWh/kWp/mes (inclou pèrdues sistema al 19% → PR≈81%)
  // solarMesTotals[m]/1000 = kWh/kWp del motor fix (sense factorPerdues addicional)
  let scalePvgis = 1;
  if (pvgisMonthly && pvgisMonthly[m] > 0 && solarMesTotals[m] > 0) {
    // PVGIS ja inclou pèrdues (loss=19%), per tant NO apliquem factorPerdues a sobre
    scalePvgis = pvgisMonthly[m] / solarMesTotals[m];
  }

  const sP = {};
  for (let n = 1; n <= N; n++) sP['P'+n] = 0;
  for (let d=0; d<dies_l[m]; d++)
    for (let h=0; h<24; h++) {
      const i=idx+d*24+h; if(i>=TARIFES.length) break;
      const tn = TARIFES[i] || 'P'+N;
      if (sP[tn] !== undefined) sP[tn] += shape[h];
    }
  const fP = {};
  for (let n = 1; n <= N; n++)
    fP['P'+n] = sP['P'+n] > 0 ? cp[n-1][m] / sP['P'+n] : 0;
  let ac=0,exc=0,xa=0,pv=0,cost=0,comp=0;
  for (let d=0; d<dies_l[m]; d++) {
    for (let h=0; h<24; h++) {
      if(idx>=SOLAR.length) break;
      // Producció real: SOLAR escalar per PVGIS (o factorPerdues si no hi ha PVGIS)
      const pv_brut = pvgisMonthly
        ? SOLAR[idx] * kwp * scalePvgis * factorOmbres
        : SOLAR[idx] * kwp * factorPerdues * factorOmbres;
      const pv_h  = Math.min(pv_brut, potInv);   // clipping inversor
      const tn    = TARIFES[idx] || 'P'+N;
      const con_h = shape[h] * (fP[tn] || 0);
      const pr    = PREUS[tn]  || PREUS_ARR[N-1];
      ac   += Math.min(pv_h, con_h);
      exc  += Math.max(0, pv_h-con_h);
      xa   += Math.max(0, con_h-pv_h);
      pv   += pv_h;
      cost += Math.max(0, con_h-pv_h)*pr;
      comp += Math.max(0, pv_h-con_h)*preu_exc;
      idx++;
    }
  }
  acMes.push(ac); excMes.push(exc); xaMes.push(xa);
  pvMes.push(pv); costMes.push(cost); compMes.push(comp);
}

const t_pv  = pvMes.reduce((a,b)=>a+b,0);
const t_ac  = acMes.reduce((a,b)=>a+b,0);
const t_exc = excMes.reduce((a,b)=>a+b,0);
const t_xa  = xaMes.reduce((a,b)=>a+b,0);

const cAnualTot  = cp.reduce((tot, cpi) => tot + cpi.reduce((a,b)=>a+b,0), 0);
const costActual = cp[0].reduce((s,_,i) => s + cp.reduce((sum,cpi,n) => sum + cpi[i]*PREUS_ARR[n], 0), 0);
const estalviMesCor = costMes.map((c,m) => {
  const costAct = cp.reduce((s, cpi, n) => s + cpi[m]*PREUS_ARR[n], 0);
  return costAct - (c - compMes[m]);
});
const estalviAny1 = estalviMesCor.reduce((a,b)=>a+b,0);

// Pressupost — usa el cost_instalacio del payload si ve informat (ja calculat a l'app)
// i recalcula des del catàleg només si no ve
let costInstal, subtotal;
if (input.cost_instalacio && parseFloat(input.cost_instalacio) > 0) {
  costInstal = parseFloat(input.cost_instalacio);  // ja sense IVA
  subtotal   = costInstal;
} else {
  const costosRaw = $('Llegir costos PDF').all().map(i => i.json);
  const C = Object.fromEntries(costosRaw.map(r => [r.clau, parseFloat(r.valor) || 0]));
  const preuMod    = parseFloat(input.preu_modul)    || C.preu_modul    || 71.50;
  const preuInvEur = parseFloat(input.preu_inversor) || C.preu_inversor || 793;
  const preuMuntRaw = parseFloat(input.preu_muntatge || 0);
  const costMuntatge = preuMuntRaw > 200 ? preuMuntRaw : (preuMuntRaw || C.preu_muntatge || 50) * numMod;
  const costMaObra   = (C.ma_obra_base || 600) + (C.ma_obra_per_modul || 80) * numMod;
  const projecte     = C.projecte_tecnic || 550;
  const cables       = parseFloat(input.petit_material) || ((C.petit_material_per_modul || 20) * numMod);
  subtotal   = (numMod * preuMod) + preuInvEur + costMuntatge + costMaObra + projecte + cables;
  costInstal = Math.round(subtotal * (1 + MARGE)); // pre-IVA, consistent amb normal path
}

const mantAnual    = parseFloat(input.manteniment_anual || 0);

// Cashflow 25 anys — estalvi_n = estalvi_1 × (1+inflació)^(n-1) × (1-degradació)^(n-1)
const cashflow = [-costInstal];
for (let n=1; n<=VIDA_UTIL; n++) {
  const estalvi_n = estalviAny1 * Math.pow(1+INFLACIO, n-1) * Math.pow(1-DEGRADACIO, n-1) - mantAnual;
  cashflow.push(estalvi_n);
}

// Cost de producció €/kWh (kWh totals 25 anys amb degradació acumulada)
const kwhTotals25 = Array.from({length: VIDA_UTIL}, (_,i) => t_pv * Math.pow(1-DEGRADACIO, i)).reduce((a,b)=>a+b,0);
const cost_produccio_kwh = kwhTotals25 > 0 ? Math.round(costInstal/kwhTotals25*1000)/1000 : null;
const capex_especific_eur_wp = kwp > 0 ? Math.round(costInstal/(kwp*1000)*1000)/1000 : null;
const flux=[]; let acF=0;
cashflow.forEach(f => { acF+=f; flux.push(acF); });
let retorn=null;
for (let n=0; n<=VIDA_UTIL; n++) {
  if(flux[n]>=0) { retorn = n>0 ? (n-1)+(-flux[n-1])/(flux[n]-flux[n-1]) : 0; break; }
}
const van = cashflow.reduce((s,f,n) => s+f/Math.pow(1+TAXA_DESC,n), 0);
let tir=0.1;
for(let i=0;i<100;i++){
  const f=cashflow.reduce((s,c,n)=>s+c/Math.pow(1+tir,n),0);
  const df=cashflow.reduce((s,c,n)=>s-n*c/Math.pow(1+tir,n+1),0);
  if(Math.abs(df)<1e-10) break;
  const dt=f/df; tir-=dt;
  if(Math.abs(dt)<1e-8) break;
}

const preuMigKwh = cAnualTot > 0 ?
  cp.reduce((s, cpi, n) => s + cpi.reduce((a,b)=>a+b,0)*PREUS_ARR[n], 0) / cAnualTot
  : PREUS_ARR.slice(0, N).reduce((a,b)=>a+b,0) / N;

const mesos = ['Gener','Febrer','Març','Abril','Maig','Juny',
               'Juliol','Agost','Setembre','Octubre','Novembre','Desembre'];

return [{json:{
  kwp: Math.round(kwp*100)/100,
  num_moduls: numMod, potencia_modul: potMod, trifasic,
  latitud: input.lat||input.latitud||41, inclinacio: parseInt(input.inclinacio||30), acimut: parseInt(input.acimut||0),
  perfil_client: perfil, tarifa: is6P ? '3.0TD' : '2.0TD', tariff_type: tariffType, num_periodes: N,
  preu_p1, preu_p2, preu_p3, preu_p4, preu_p5, preu_p6, preu_excedent: preu_exc,
  preu_mig_kwh: Math.round(preuMigKwh*10000)/10000,
  consum_anual: Math.round(cAnualTot),
  cost_actual_anual: Math.round(costActual*100)/100,
  produccio_anual: Math.round(t_pv),
  autoconsum_anual: Math.round(t_ac),
  excedent_anual: Math.round(t_exc),
  xarxa_anual: Math.round(t_xa),
  pct_autoconsum: t_pv>0 ? Math.round(t_ac/t_pv*1000)/10 : 0,
  pct_cobertura:  cAnualTot>0 ? Math.round(t_ac/cAnualTot*1000)/10 : 0,
  estalvi_any1: Math.round(estalviAny1*100)/100,
  cost_instalacio: Math.round(costInstal*100)/100,
  subtotal_sense_iva: Math.round(subtotal*100)/100,
  retorn_anys: retorn ? Math.round(retorn*100)/100 : null,
  van_25anys: Math.round(van),
  tir_pct: Math.round(tir*1000)/10,
  benefici_net_25: Math.round(flux[VIDA_UTIL]),
  co2_anual_kg: Math.round(t_ac*0.321),
  co2_25anys_kg: Math.round(t_ac*0.321*VIDA_UTIL),
  hsp_anual: t_pv > 0 ? Math.round(t_pv / kwp) : 0,
  capex_especific_eur_wp,
  cost_produccio_kwh,
  mensual: mesos.map((mes,i)=>({
    mes,
    consum: Math.round(cp.reduce((s,cpi)=>s+cpi[i],0)),
    produccio: Math.round(pvMes[i]),
    autoconsum: Math.round(acMes[i]),
    excedent: Math.round(excMes[i]),
    xarxa: Math.round(xaMes[i]),
    cost_actual: Math.round(cp.reduce((s,cpi,n)=>s+cpi[i]*PREUS_ARR[n],0)*100)/100,
    cost_pv: Math.round((costMes[i]-compMes[i])*100)/100,
    estalvi: Math.round(estalviMesCor[i]*100)/100,
  })),
  cashflow: flux.map((f,n)=>({any:n, flux_acumulat:Math.round(f)})),
  consumos: input.consumos, cp,
}}];
