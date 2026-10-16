import {VERSION,HOURS,START_HOUR,FLEET,STATES,makeForecast,makeRealization,createSession,dispatch,settle,optimizePlan,orbitDecision,summarize} from './engine.mjs';

export const clockLabel = h => `${String(START_HOUR+h).padStart(2,'0')}:00`;
/** Simple player aid; central forecast plus a visible reserve margin, no ORBIT scenarios. */
export function starterPlan(forecast,reserve=50){
  let previousMask=0;
  return forecast.hours.map(a=>{
    let best=0,bestCost=Infinity;
    for(let m=0;m<STATES;m++){
      const row=settle({hour:a.hour,mask:m,previousMask,planMask:m,actual:{...a,demand:a.demand+reserve}});
      if(row.total<bestCost){best=m;bestCost=row.total;}
    }
    previousMask=best;return best;
  });
}
/** Add capacity only; this current-hour aid cannot read future conditions. */
export function coverGap({mask,actual,previousMask=0,planMask=mask}){
  if(dispatch(mask,actual).shortage<1e-7)return mask;
  let best=mask,bestCost=Infinity;
  for(let m=0;m<STATES;m++){
    if((m&mask)!==mask)continue;
    const row=settle({hour:actual.hour??0,mask:m,previousMask,planMask,actual});
    if(row.total<bestCost){best=m;bestCost=row.total;}
  }
  return best;
}
const validMask=m=>Number.isInteger(m)&&m>=0&&m<STATES;
export function restoreSaved(saved){
  try{
    if(!saved||saved.version!==VERSION||!/^[A-Z0-9-]{1,24}$/.test(saved.seed)||!Array.isArray(saved.plan)||saved.plan.length!==HOURS||!saved.plan.every(validMask)||!['plan','play','results'].includes(saved.phase))return null;
    const session=createSession(saved.seed),plan=[...saved.plan];
    if(saved.phase==='plan')return {seed:saved.seed,session,plan,phase:'plan',masks:[],view:null,draft:0,selected:Math.min(HOURS-1,Math.max(0,Math.floor(saved.selected)||0))};
    if(!Array.isArray(saved.masks)||saved.masks.length>HOURS||!saved.masks.every(validMask))return null;
    let view=session.start(plan);for(const m of saved.masks)view=session.settle(m);
    return {seed:saved.seed,session,plan,phase:view.complete?'results':'play',masks:[...saved.masks],view,draft:validMask(saved.draft)?saved.draft:view.humanPlan[view.hour]??0,selected:0};
  }catch{return null;}
}
export function savedSnapshot(game){return {version:VERSION,seed:game.seed,phase:game.phase,plan:[...game.plan],masks:[...game.masks],draft:game.draft,selected:game.selected};}
export function exportCsv(seed,human,orbit){
  const names=m=>FLEET.filter((u,i)=>m&(1<<i)).map(u=>u.id).join(' + ')||'None';
  const rows=[['player','day_code','shift_hour','clock_time','planned_units','settled_units','demand_MW','wind_available_MW','solar_available_MW',...FLEET.map(u=>`${u.id}_MW`),'wind_used_MW','solar_used_MW','spare_MW','shortage_MWh','curtailed_MWh','emissions_tCO2','running_GBP','startup_GBP','adjustment_GBP','penalty_GBP','total_GBP']];
  for(const [player,ledger] of [['You',human],['ORBIT simulator',orbit]])for(const l of ledger)rows.push([player,seed,l.hour+1,clockLabel(l.hour),names(l.planMask),names(l.mask),l.actual.demand,l.actual.wind,l.actual.solar,...l.outputs,l.windUsed,l.solarUsed,l.spare,l.shortage,l.curtailment,l.emissions,l.running,l.startup,l.adjustment,l.penalty,l.total]);
  return rows.map(r=>r.map(v=>typeof v==='number'?v.toFixed(4):`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
}
/** A separate teaching example. No live game, storage, or DOM is passed into it. */
export function buildTourExample(){
  const base=makeForecast('TOUR-12'),forecast={seed:base.seed,hours:base.hours.map(a=>({...a}))};
  forecast.hours[0]={hour:0,clockHour:START_HOUR,demand:600,wind:180,solar:180};
  const actual=makeRealization(forecast);actual[0]={hour:0,clockHour:START_HOUR,demand:620,wind:70,solar:180};
  const plan=starterPlan(forecast);plan[0]=1;
  const orbitPlan=optimizePlan({forecast}).plan,human=[],orbit=[];
  for(let h=0;h<HOURS;h++){
    const previousMask=human.at(-1)?.mask??0;
    const mask=h===0?9:coverGap({mask:plan[h],actual:actual[h],previousMask,planMask:plan[h]});
    human.push(settle({hour:h,mask,previousMask,planMask:plan[h],actual:actual[h]}));
    const decision=orbitDecision({forecast,history:actual.slice(0,h+1),submittedPlan:orbitPlan,previousMask:orbit.at(-1)?.mask??0});
    orbit.push(settle({hour:h,mask:decision.mask,previousMask:orbit.at(-1)?.mask??0,planMask:orbitPlan[h],actual:actual[h]}));
  }
  return {forecast,expected:forecast.hours[0],surprise:actual[0],plan,human,orbit,humanTotal:summarize(human),orbitTotal:summarize(orbit)};
}
