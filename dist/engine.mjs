/** Grid Shift: deterministic, browser-local simulation. Money is illustrative GBP. */
export const VERSION = 2;
export const HOURS = 12;
export const START_HOUR = 8;
export const SHORTAGE_PRICE = 2500;
export const WIND_CAPACITY = 280;
export const SOLAR_CAPACITY = 300;
export const FLEET = Object.freeze([
  {id:'N1', name:'Northbank', type:'Nuclear', capacity:240, rate:14, fixed:1000, startup:10000, change:2400, co2:0.012, color:'#b9a1ff'},
  {id:'C1', name:'Ironbridge', type:'Coal', capacity:180, rate:34, fixed:550, startup:4500, change:1600, co2:0.92, color:'#a7b6c5'},
  {id:'C2', name:'Moorfield', type:'Coal', capacity:140, rate:39, fixed:420, startup:3400, change:1300, co2:0.96, color:'#a7b6c5'},
  {id:'G1', name:'Riverside', type:'Gas', capacity:180, rate:67, fixed:180, startup:1000, change:800, co2:0.36, color:'#fbbf24'},
  {id:'G2', name:'Eastgate', type:'Gas', capacity:120, rate:90, fixed:90, startup:600, change:600, co2:0.43, color:'#fbbf24'},
  {id:'G3', name:'Hilltop', type:'Gas', capacity:90, rate:115, fixed:50, startup:350, change:450, co2:0.49, color:'#fbbf24'},
].map(Object.freeze));
export const STATES = 1 << FLEET.length;
export const bits = m => FLEET.map((u,i)=>(m>>i)&1);
export const capacity = m => FLEET.reduce((s,u,i)=>s+((m>>i)&1)*u.capacity,0);
export const changeCost = (m,p) => FLEET.reduce((s,u,i)=>s+(((m^p)>>i)&1)*u.change,0);
export const startupCost = (m,p) => FLEET.reduce((s,u,i)=>s+(((m&~p)>>i)&1)*u.startup,0);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export function hash(text) {let h=2166136261; for(const c of String(text)) {h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
export function rng(seed) {let a=hash(seed);return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const noise = r => (r()+r()+r()+r()-2)*1.73;
const round = v => Math.round(v*10)/10;
export function makeForecast(seed) {
  const r=rng(`${seed}:forecast:v2`); const phase=r()*4, windBase=100+r()*75, cloud=.65+r()*.3, demandScale=.93+r()*.14;
  const hours=Array.from({length:HOURS},(_,index)=>{
    const h=START_HOUR+index;
    const morning=105*Math.exp(-(((h-8)/2.5)**2)), evening=240*Math.exp(-(((h-18.5)/3.1)**2));
    const demand=round((455+morning+evening+30*Math.sin((h-5)/24*Math.PI*2))*demandScale);
    const wind=round(clamp(windBase+48*Math.sin((h+phase)/24*Math.PI*2)+20*Math.cos(h/9),30,250));
    const solar=round(Math.max(0,Math.sin((h-6)/12*Math.PI))*SOLAR_CAPACITY*cloud);
    return {hour:index,clockHour:h,demand,wind,solar};
  });
  return Object.freeze({seed:String(seed),hours:Object.freeze(hours.map(Object.freeze))});
}
/** Separate streams: forecast, hidden realization, and each planner scenario never share RNG state. */
function weatherPath(forecast, stream, history=[]) {
  const r=rng(stream); const current=history.length-1;
  let ed=0, ew=0, es=0;
  if(current>=0){const a=history[current],f=forecast.hours[current];ed=a.demand-f.demand;ew=a.wind-f.wind;es=f.solar>20?(a.solar/f.solar-1)*75:0;}
  else {ed=noise(r)*18;ew=noise(r)*32;es=noise(r)*20;}
  const biasD=current<0?noise(r)*12:0,biasW=current<0?noise(r)*22:0;
  return forecast.hours.map((f,h)=>{
    if(h<=current)return {...history[h]};
    ed=.82*ed+noise(r)*12+biasD*.18;ew=.88*ew+noise(r)*23+biasW*.12;es=.85*es+noise(r)*11;
    return {hour:h,clockHour:START_HOUR+h,demand:round(clamp(f.demand+ed,300,950)),wind:round(clamp(f.wind+ew,0,WIND_CAPACITY)),solar:round(clamp(f.solar*(1+es/75),0,SOLAR_CAPACITY))};
  });
}
export const makeRealization = (forecast) => weatherPath(forecast,`${forecast.seed}:hidden-realization:v2`);
export const makePlanningScenarios = (forecast,history=[],count=12) => Array.from({length:count},(_,i)=>weatherPath(forecast,`${forecast.seed}:planner:${history.length}:${i}:v2`,history));
/** Renewables first, then ascending variable cost; no conventional minimum output. */
export function dispatch(mask, actual) {
  if(!Number.isInteger(mask)||mask<0||mask>=STATES)throw Error('Invalid commitment mask');
  for(const k of ['demand','wind','solar'])if(!Number.isFinite(actual[k])||actual[k]<0)throw Error('Invalid conditions');
  const available=actual.wind+actual.solar, renewable=Math.min(actual.demand,available);
  const windUsed=available?renewable*actual.wind/available:0,solarUsed=renewable-windUsed;
  let remaining=actual.demand-renewable, running=0, emissions=0;
  const outputs=FLEET.map((u,i)=>{
    if(!((mask>>i)&1))return 0;
    const p=Math.min(remaining,u.capacity);remaining-=p;running+=u.fixed+p*u.rate;emissions+=p*u.co2;return p;
  });
  const shortage=Math.max(0,remaining),conventional=outputs.reduce((s,v)=>s+v,0);
  return {outputs,windUsed,solarUsed,renewable,conventional,served:renewable+conventional,shortage,curtailment:available-renewable,spare:Math.max(0,capacity(mask)-conventional),running,emissions,penalty:shortage*SHORTAGE_PRICE};
}
export function settle({hour,mask,previousMask=0,planMask,actual}) {
  const d=dispatch(mask,actual),startup=startupCost(mask,previousMask),adjustment=changeCost(mask,planMask);
  return {hour,mask,planMask,previousMask,actual:{...actual},...d,startup,adjustment,total:d.running+startup+adjustment+d.penalty};
}
export function summarize(ledger) {
  const keys=['running','startup','adjustment','penalty','total','shortage','emissions','curtailment','served','renewable'];
  return Object.fromEntries(keys.map(k=>[k,ledger.reduce((s,l)=>s+l[k],0)]));
}
/** Exact dynamic program over 64 commitment states for a finite scenario-average model.
 * Day-ahead is one shared nonanticipative commitment path. Hourly revision treats today's
 * revelation as known and all later hours as conditional scenarios. This is a simulator,
 * not the production ORBIT service, and has no claim to global stochastic optimality.
 */
export function optimizePlan({forecast,history=[],startHour=0,previousMask=0,submittedPlan=null}) {
  if(startHour!==Math.max(0,history.length-1)&&!(startHour===0&&history.length===0))throw Error('History must end at the current revealed hour');
  const scenarios=makePlanningScenarios(forecast,history,12),back=[];
  let previous=Array(STATES).fill(Infinity);previous[previousMask]=0;
  for(let h=startHour;h<HOURS;h++){
    const expected=Array.from({length:STATES},(_,m)=>{
      const operating=scenarios.reduce((s,path)=>{const d=dispatch(m,path[h]);return s+d.running+d.penalty;},0)/scenarios.length;
      return operating+(submittedPlan?changeCost(m,submittedPlan[h]):0);
    });
    const next=Array(STATES).fill(Infinity),from=new Int16Array(STATES);
    for(let m=0;m<STATES;m++)for(let p=0;p<STATES;p++){
      const cost=previous[p]+startupCost(m,p)+expected[m];
      if(cost<next[m]){next[m]=cost;from[m]=p;}
    }
    back.push(from);previous=next;
  }
  let best=previous.indexOf(Math.min(...previous));const expectedCost=previous[best],plan=Array(HOURS).fill(0);
  for(let i=back.length-1;i>=0;i--){plan[startHour+i]=best;best=back[i][best];}
  return {plan,expectedCost,scenarioCount:scenarios.length};
}
/** This policy accepts only the public forecast, revealed prefix and own commitment history.
 * It is deliberately unable to take a realized-day or game-state object as input. */
export function orbitDecision({forecast,history,submittedPlan,previousMask=0}) {
  if(!history.length||history.length>HOURS)throw Error('Reveal a valid current hour first');
  const hour=history.length-1;
  const solved=optimizePlan({forecast,history,startHour:hour,previousMask,submittedPlan});
  const mask=solved.plan[hour],planned=submittedPlan[hour],a=history[hour],d=dispatch(mask,a);
  const net=a.demand-a.wind-a.solar,forecastNet=forecast.hours[hour].demand-forecast.hours[hour].wind-forecast.hours[hour].solar;
  const changes=FLEET.filter((u,i)=>((mask^planned)>>i)&1).map((u)=>`${u.id} ${mask&(1<<FLEET.indexOf(u))?'on':'off'}`);
  const reason=`Net demand ${Math.round(net)} MW (${net>=forecastNet?'+':''}${Math.round(net-forecastNet)} vs forecast). ${changes.length?`Changed ${changes.join(', ')} from its submitted plan.`:'Kept its submitted commitment.'} ${Math.round(d.spare)} MW spare.`;
  return {mask,reason};
}
export function baselinePlan() {return Array(HOURS).fill(3);}
/** Public optional player aid: hourly forecast merit order, no scenarios or lookahead. */
export function forecastPlan(forecast) {
  let prev=0;
  return forecast.hours.map(a=>{let best=0,cost=Infinity;for(let m=0;m<STATES;m++){const d=dispatch(m,a),c=d.running+d.penalty+startupCost(m,prev);if(c<cost){cost=c;best=m;}}prev=best;return best;});
}
/** Hidden data lives inside this session, never passed to either planner. */
export function createSession(seed) {
  const forecast=makeForecast(seed),actual=makeRealization(forecast);
  let humanPlan=null,orbitPlan=null,ledger=[],orbitLedger=[],history=[],orbitActions=[],hour=0;
  return {
    forecast,
    start(plan){if(humanPlan)throw Error('Already started');if(!Array.isArray(plan)||plan.length!==HOURS||plan.some(m=>!Number.isInteger(m)||m<0||m>=STATES))throw Error('Invalid plan');humanPlan=Object.freeze([...plan]);orbitPlan=Object.freeze(optimizePlan({forecast}).plan);history=[{...actual[0]}];return this.view();},
    view(){return {hour,complete:hour===HOURS,actual:humanPlan&&hour<HOURS?{...actual[hour]}:null,history:history.map(a=>({...a})),humanPlan:humanPlan?[...humanPlan]:null,ledger:ledger.map(l=>({...l,actual:{...l.actual},outputs:[...l.outputs]})),...(hour===HOURS?{orbitPlan:[...orbitPlan],orbitLedger:orbitLedger.map(l=>({...l,actual:{...l.actual},outputs:[...l.outputs]})),orbitActions:[...orbitActions]}:{})};},
    settle(mask){if(!humanPlan||hour>=HOURS)throw Error('No active hour');const previousMask=ledger.at(-1)?.mask??0,previousOrbit=orbitLedger.at(-1)?.mask??0;
      const decision=orbitDecision({forecast,history,submittedPlan:orbitPlan,previousMask:previousOrbit});
      ledger.push(settle({hour,mask,previousMask,planMask:humanPlan[hour],actual:actual[hour]}));
      orbitLedger.push(settle({hour,mask:decision.mask,previousMask:previousOrbit,planMask:orbitPlan[hour],actual:actual[hour]}));orbitActions.push(decision.reason);
      hour++;if(hour<HOURS)history.push({...actual[hour]});return this.view();}
  };
}
