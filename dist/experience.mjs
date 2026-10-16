import {HOURS,FLEET,STATES,dispatch,settle} from './engine.mjs';
import {coverGap} from './support.mjs';

/** Current-hour decisions. All inputs are public; no future actuals or opponent data. */
export function chooseAssist(kind,{mask,actual,previousMask=0,planMask=mask}){
  if(kind==='cover')return coverGap({mask,actual,previousMask,planMask});
  if(!['trim','reserve'].includes(kind))throw new Error('Unknown decision');
  const initial=dispatch(mask,actual),target=kind==='reserve'?90:0;
  if(kind==='reserve'&&initial.spare>=target)return mask;
  let best=mask,bestCost=Infinity;
  for(let m=0;m<STATES;m++){
    if(kind==='reserve'&&(m&mask)!==mask)continue;
    const row=settle({hour:actual.hour??0,mask:m,previousMask,planMask,actual});
    if(row.shortage>1e-7||row.spare+1e-7<target)continue;
    if(row.total<bestCost-1e-7||(Math.abs(row.total-bestCost)<1e-7&&m===mask)){best=m;bestCost=row.total;}
  }
  return best;
}

/** Describe the actual forecast error; these events add no fabricated weather effects. */
export function conditionsEvent(actual,forecast,mask){
  const d=dispatch(mask,actual),events=[];
  if(actual.wind-forecast.wind<=-45)events.push({kind:'wind',title:'Wind drop',delta:actual.wind-forecast.wind,detail:'Wind below forecast'});
  if(actual.solar-forecast.solar<=-45)events.push({kind:'cloud',title:'Cloud front',delta:actual.solar-forecast.solar,detail:'Solar below forecast'});
  if(actual.demand-forecast.demand>=40)events.push({kind:'demand',title:'Demand surge',delta:actual.demand-forecast.demand,detail:'Demand above forecast'});
  if(d.shortage>1e-7&&!events.length)events.push({kind:'gap',title:'Power gap',delta:d.shortage,detail:'More power needed'});
  return {events,needsDecision:events.length>0||d.shortage>1e-7,shortage:d.shortage,spare:d.spare};
}

/** Persistent weather only interrupts again if the error worsens materially. */
export function needsIntervention(actual,forecast,mask,previousActual=null,previousForecast=null){
  const now=conditionsEvent(actual,forecast,mask);
  if(now.shortage>1e-7)return true;
  if(!previousActual||!previousForecast)return now.needsDecision;
  const prior=conditionsEvent(previousActual,previousForecast,63).events;
  return now.events.some(e=>{const before=prior.find(p=>p.kind===e.kind);return !before||Math.abs(e.delta)>=Math.abs(before.delta)+30;});
}

/** Twelve chart rows from public information only. Future rows ALWAYS use forecast. */
export function timelineData({forecast,plan,history=[],ledger=[],draft=null,currentHour=null}){
  return forecast.hours.map((expected,h)=>{
    const revealed=h<history.length,actual=revealed?history[h]:null;
    const row=ledger[h]??null;
    const mask=row?row.mask:(h===currentHour&&draft!==null?draft:plan[h]);
    const conditions=actual??expected,d=dispatch(mask,conditions);
    return {hour:h,kind:row?'settled':revealed?'live':'forecast',mask,demand:conditions.demand,forecastDemand:expected.demand,
      windAvailable:conditions.wind,solarAvailable:conditions.solar,actualDemand:actual?.demand??null,
      generation:[d.outputs[0],d.outputs[1]+d.outputs[2],d.outputs[3]+d.outputs[4]+d.outputs[5],d.windUsed,d.solarUsed],
      served:d.served,spare:d.spare,shortage:d.shortage,curtailment:d.curtailment};
  });
}

/** Timer-independent controller: every callback carries a generation AND hour token. */
export function createProgression(){
  let running=false,generation=0,expectedHour=null,quietHours=0;
  return {
    get running(){return running;},
    pause(){running=false;generation++;expectedHour=null;},
    run(hour){if(!Number.isInteger(hour)||hour<0||hour>=HOURS)throw new Error('Invalid hour');running=true;generation++;expectedHour=hour;quietHours=0;},
    ticket(hour){return running&&expectedHour===hour?Object.freeze({generation,hour}):null;},
    consume(ticket,hour){if(!ticket||!running||ticket.generation!==generation||ticket.hour!==hour||expectedHour!==hour)return false;expectedHour=hour+1;generation++;quietHours++;return true;},
    arrived(hour,{needsDecision=false,complete=false}={}){if(complete||needsDecision||quietHours>=3||hour!==expectedHour)this.pause();return running;}
  };
}

export function streakFor(ledger){let streak=0;for(let i=ledger.length-1;i>=0&&ledger[i].shortage<1e-7;i--)streak++;return streak;}
