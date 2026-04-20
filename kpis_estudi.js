// SOLENVER — Motor fotovoltaic v5 — Simulació hora·hora + PVGIS real
const raw   = $('POST /solenver/generar-estudi').first().json;
const input = raw.body || raw;

const motorData = $('Llegir dades motor PDF').first().json;
const SOLAR   = motorData.solar_8760h;
const TARIFES = motorData.tarifes_8760h;

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
  const hora = parseInt(row.horra) - 1; // horra va de 1 a 24
  if (hora < 0 || hora > 23) return;
  const cols = {
    'granja_porcina':        parseFloat(row.granja_porcina)    || 0,
    'granja_avicola':        parseFloat(row.granja_avicola)    || 0,
    'industria_general':     parseFloat(row.industria_general) || 0,
    'logistica_magatzem':    parseFloat(row.logistica_magatz)  || 0,
    'domestica_residencial': parseFloat(row.domestica_resid)   || 0,
    'comercial_oficines':    parseFloat(row.comercial_oficin)  || 0,
    'agricola_reg':          parseFloat(row.agricola_reg)      || 0,
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
const TAXA_DESC = parseFloat(P.taxa_descont)     || 0.05;

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
const PREUS    = { P1: preu_p1, P2: preu_p2, P3: preu_p3, P4: preu_p3, P5: preu_p3, P6: preu_p3 };

const shape = SHAPES[perfil] || SHAPES['industria_general'];

// Format consums: {gen:{p1,p2,p3},...} o {gen:700,...}
const mesClaus = ['gen','feb','mar','abr','mai','jun','jul','ago','set','oct','nov','des'];
const dies_l   = [31,28,31,30,31,30,31,31,30,31,30,31];
const consumos = input.consumos || {};
let cp1, cp2, cp3;

const primeraClau = mesClaus.find(k => consumos[k] !== undefined);
const tePeriodes  = primeraClau && typeof consumos[primeraClau] === 'object' && consumos[primeraClau] !== null;
const teFactura   = tePeriodes && mesClaus.some(m => (consumos[m]?.p1 || 0) > 0 || (consumos[m]?.p3 || 0) > 0);

if (teFactura) {
  cp1 = mesClaus.map(m => parseFloat(consumos[m]?.p1 || 0));
  cp2 = mesClaus.map(m => parseFloat(consumos[m]?.p2 || 0));
  cp3 = mesClaus.map(m => parseFloat(consumos[m]?.p3 || 0));
} else {
  // Sense factura detallada: distribuïr per sector usant TARIFES hora×hora (igual que kpis_calcular)
  const cAnual = primeraClau
    ? mesClaus.reduce((s,m) => s + parseFloat(consumos[m] || 0), 0)
    : parseFloat(input.consum_anual || 6792);
  const mesConsum = primeraClau
    ? mesClaus.map(m => parseFloat(consumos[m] || 0))
    : dies_l.map(d => cAnual*(d/365));

  // Calcular fracció P1/P2/P3 real per mes usant shape del sector i TARIFES
  cp1 = []; cp2 = []; cp3 = [];
  let idxT = 0;
  for (let m = 0; m < 12; m++) {
    const sP = {P1:0, P2:0, P3:0};
    for (let d=0; d<dies_l[m]; d++)
      for (let h=0; h<24; h++) {
        const i=idxT+d*24+h; if(i>=TARIFES.length) break;
        const tn=TARIFES[i]==='P1'?'P1':(TARIFES[i]==='P2'?'P2':'P3');
        sP[tn] += shape[h];
      }
    const tot = sP.P1+sP.P2+sP.P3 || 1;
    cp1.push(mesConsum[m]*(sP.P1/tot));
    cp2.push(mesConsum[m]*(sP.P2/tot));
    cp3.push(mesConsum[m]*(sP.P3/tot));
    idxT += dies_l[m]*24;
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
  // pvgisMonthly[m] = kWh/kWp/mes (inclou pèrdues sistema al 14%)
  // solarMesTotals[m]/1000 = kWh/kWp del motor fix (sense factorPerdues addicional)
  let scalePvgis = 1;
  if (pvgisMonthly && pvgisMonthly[m] > 0 && solarMesTotals[m] > 0) {
    // PVGIS ja inclou pèrdues (loss=14%), per tant NO apliquem factorPerdues a sobre
    scalePvgis = pvgisMonthly[m] / solarMesTotals[m];
  }

  const sP = {P1:0, P2:0, P3:0};
  for (let d=0; d<dies_l[m]; d++)
    for (let h=0; h<24; h++) {
      const i=idx+d*24+h; if(i>=TARIFES.length) break;
      const tn=TARIFES[i]==='P1'?'P1':(TARIFES[i]==='P2'?'P2':'P3');
      sP[tn]+=shape[h];
    }
  const fP = {
    P1: sP.P1>0 ? cp1[m]/sP.P1 : 0,
    P2: sP.P2>0 ? cp2[m]/sP.P2 : 0,
    P3: sP.P3>0 ? cp3[m]/sP.P3 : 0,
  };
  let ac=0,exc=0,xa=0,pv=0,cost=0,comp=0;
  for (let d=0; d<dies_l[m]; d++) {
    for (let h=0; h<24; h++) {
      if(idx>=SOLAR.length) break;
      // Producció real: SOLAR escalar per PVGIS (o factorPerdues si no hi ha PVGIS)
      const pv_brut = pvgisMonthly
        ? SOLAR[idx] * kwp * scalePvgis * factorOmbres
        : SOLAR[idx] * kwp * factorPerdues * factorOmbres;
      const pv_h  = Math.min(pv_brut, potInv);   // clipping inversor
      const t     = TARIFES[idx]||'P3';
      const tn    = t==='P1'?'P1':(t==='P2'?'P2':'P3');
      const con_h = shape[h]*fP[tn];
      const pr    = PREUS[t]||preu_p3;
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

const cAnualTot  = cp1.reduce((a,b)=>a+b,0)+cp2.reduce((a,b)=>a+b,0)+cp3.reduce((a,b)=>a+b,0);
const costActual = cp1.reduce((s,v,i)=>s+v*preu_p1+cp2[i]*preu_p2+cp3[i]*preu_p3, 0);
const estalviMesCor = costMes.map((c,m) => {
  const costAct = cp1[m]*preu_p1 + cp2[m]*preu_p2 + cp3[m]*preu_p3;
  return costAct - (c - compMes[m]);
});
const estalviAny1 = estalviMesCor.reduce((a,b)=>a+b,0);

// Pressupost — usa el cost_instalacio del payload si ve informat (ja calculat a l'app)
// i recalcula des del catàleg només si no ve
let costInstal;
if (input.cost_instalacio && parseFloat(input.cost_instalacio) > 0) {
  costInstal = parseFloat(input.cost_instalacio);
} else {
  const costEstPerMod = 18;
  const preuMod    = parseFloat(input.preu_modul || 66.30);
  const preuInvEur = parseFloat(input.preu_inversor || 793);
  const monit      = trifasic ? 437 : 120;
  const subtotal   = (numMod*preuMod) + (costEstPerMod*numMod) + preuInvEur + monit +
                     225 + (15*2.50) + (15*1.80) + 200 + 175 +
                     (numMod*(parseFloat(input.ma_obra_modul)||100)) +
                     (parseFloat(input.projecte_tecnic)||550);
  costInstal = subtotal*(1+MARGE)*(1+IVA);
}

const mantAnual    = parseFloat(input.manteniment_anual || 0);

// Cashflow 25 anys — sense degradació (igual que l'Excel i el motor del formulari)
const cashflow = [-costInstal];
for (let n=1; n<=VIDA_UTIL; n++) {
  const estalvi_n = estalviAny1 * Math.pow(1+INFLACIO, n-1) - mantAnual;
  cashflow.push(estalvi_n);
}

// Cost de producció €/kWh (kWh totals 25 anys sense degradació)
const kwhTotals25 = t_pv * VIDA_UTIL;
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
  (cp1.reduce((a,b)=>a+b,0)*preu_p1 + cp2.reduce((a,b)=>a+b,0)*preu_p2 + cp3.reduce((a,b)=>a+b,0)*preu_p3) / cAnualTot
  : (preu_p1+preu_p2+preu_p3)/3;

const mesos = ['Gener','Febrer','Març','Abril','Maig','Juny',
               'Juliol','Agost','Setembre','Octubre','Novembre','Desembre'];

return [{json:{
  kwp: Math.round(kwp*100)/100,
  num_moduls: numMod, potencia_modul: potMod, trifasic,
  latitud: input.lat||input.latitud||41, inclinacio: parseInt(input.inclinacio||30), acimut: parseInt(input.acimut||0),
  perfil_client: perfil, tarifa: '2.0TD',
  preu_p1, preu_p2, preu_p3, preu_excedent: preu_exc,
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
    consum: Math.round(cp1[i]+cp2[i]+cp3[i]),
    produccio: Math.round(pvMes[i]),
    autoconsum: Math.round(acMes[i]),
    excedent: Math.round(excMes[i]),
    xarxa: Math.round(xaMes[i]),
    cost_actual: Math.round((cp1[i]*preu_p1+cp2[i]*preu_p2+cp3[i]*preu_p3)*100)/100,
    cost_pv: Math.round((costMes[i]-compMes[i])*100)/100,
    estalvi: Math.round(estalviMesCor[i]*100)/100,
  })),
  cashflow: flux.map((f,n)=>({any:n, flux_acumulat:Math.round(f)})),
  consumos: input.consumos, cp1, cp2, cp3,
}}];
