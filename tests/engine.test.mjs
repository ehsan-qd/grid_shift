import test from 'node:test';
import assert from 'node:assert/strict';
import {FLEET,STATES,HOURS,START_HOUR,SHORTAGE_PRICE,capacity,changeCost,startupCost,makeForecast,makeRealization,makePlanningScenarios,dispatch,settle,summarize,optimizePlan,orbitDecision,createSession,baselinePlan,forecastPlan} from '../dist/engine.mjs';
import {starterPlan} from '../dist/support.mjs';
const near=(a,b,message='')=>assert.ok(Math.abs(a-b)<1e-6,`${message}: ${a} ≠ ${b}`);
function validateRow(l){
 assert.equal(l.outputs.length,FLEET.length);
 l.outputs.forEach((p,i)=>{assert.ok(p>=-1e-7);assert.ok(p<=FLEET[i].capacity+1e-7);if(!(l.mask&(1<<i)))assert.equal(p,0);});
 near(l.served+l.shortage,l.actual.demand,'Demand balance');near(l.windUsed+l.solarUsed+l.conventional,l.served,'Generation balance');
 near(l.renewable+l.curtailment,l.actual.wind+l.actual.solar,'Renewable balance');near(l.spare+l.conventional,capacity(l.mask),'Capacity balance');
 near(l.total,l.running+l.startup+l.adjustment+l.penalty,'Objective');near(l.penalty,l.shortage*SHORTAGE_PRICE);
 near(l.startup,startupCost(l.mask,l.previousMask));near(l.adjustment,changeCost(l.mask,l.planMask));
 near(l.running,FLEET.reduce((s,u,i)=>s+l.outputs[i]*u.rate+((l.mask&(1<<i))?u.fixed:0),0));
 near(l.emissions,FLEET.reduce((s,u,i)=>s+l.outputs[i]*u.co2,0));
}
test('Seeds reproduce forecasts, hidden days and planner scenarios independently',()=>{
 const a=makeForecast('CHECK-1'),b=makeForecast('CHECK-1');assert.deepEqual(a,b);assert.deepEqual(makeRealization(a),makeRealization(b));
 assert.notDeepEqual(makeRealization(a),makeRealization(makeForecast('CHECK-2')));
 const scenarios=makePlanningScenarios(a);assert.equal(scenarios.length,12);assert.deepEqual(scenarios,makePlanningScenarios(b));
 scenarios.forEach(s=>assert.notDeepEqual(s,makeRealization(a)));
 assert.notDeepEqual(scenarios[0],scenarios[1]);
});
test('Generated forecasts and weather respect bounds with persistent errors',()=>{
 let pairs=[];for(let i=0;i<40;i++){const f=makeForecast('WEATHER-'+i),a=makeRealization(f);for(let h=0;h<HOURS;h++){
 assert.ok(a[h].demand>=300&&a[h].demand<=950);assert.ok(a[h].wind>=0&&a[h].wind<=280);assert.ok(a[h].solar>=0&&a[h].solar<=300);
 if(START_HOUR+h>=18)near(a[h].solar,0);if(h>0)pairs.push([a[h-1].wind-f.hours[h-1].wind,a[h].wind-f.hours[h].wind]);}}
 const mean=k=>pairs.reduce((s,p)=>s+p[k],0)/pairs.length,m0=mean(0),m1=mean(1),cov=pairs.reduce((s,p)=>s+(p[0]-m0)*(p[1]-m1),0),v0=pairs.reduce((s,p)=>s+(p[0]-m0)**2,0),v1=pairs.reduce((s,p)=>s+(p[1]-m1)**2,0);
 assert.ok(cov/Math.sqrt(v0*v1)>.6,'Wind errors persist across hours rather than independent spikes');
});
test('Dispatch uses renewables then conventional merit order within capacity',()=>{
 const d=dispatch(63,{demand:800,wind:70,solar:30});assert.deepEqual(d.outputs,[240,180,140,140,0,0]);near(d.shortage,0);near(d.spare,250);
 const p=dispatch(24,{demand:280,wind:0,solar:0});assert.deepEqual(p.outputs,[0,0,0,180,100,0]);
});
test('Excess renewables are proportionally curtailed; online idle units still cost money',()=>{
 const d=dispatch(1,{demand:100,wind:200,solar:300});near(d.windUsed,40);near(d.solarUsed,60);near(d.curtailment,400);near(d.running,FLEET[0].fixed);near(d.outputs[0],0);
});
test('Shortages receive the same large penalty and no phantom supply',()=>{
 const d=dispatch(0,{demand:500,wind:25,solar:25});near(d.served,50);near(d.shortage,450);near(d.penalty,450*SHORTAGE_PRICE);near(d.running,0);
});
test('Startups charge off-to-on edges; on/off are instant at hour boundaries',()=>{
 const a={demand:230,wind:0,solar:0};const first=settle({hour:0,mask:1,previousMask:0,planMask:1,actual:a});near(first.startup,10000);near(first.outputs[0],230);
 const second=settle({hour:1,mask:1,previousMask:1,planMask:1,actual:a});near(second.startup,0);
 const off=settle({hour:2,mask:0,previousMask:1,planMask:0,actual:a});near(off.startup,0);near(off.shortage,230);
 const again=settle({hour:3,mask:1,previousMask:0,planMask:0,actual:a});near(again.startup,10000);near(again.adjustment,2400);
});
test('Each settled on/off deviation incurs its unit charge, including cancelled commitments',()=>{
 near(changeCost(0,63),FLEET.reduce((s,u)=>s+u.change,0));near(changeCost(63,63),0);near(changeCost(9,1),800);
 const l=settle({hour:1,mask:0,previousMask:1,planMask:1,actual:{demand:0,wind:0,solar:0}});near(l.adjustment,2400);near(l.startup,0);
});
test('Planner solves a genuine scheduling choice with startup economics',()=>{
 const hours=Array.from({length:HOURS},(_,h)=>({hour:h,demand:500,wind:0,solar:0}));
 const f={seed:'ECONOMICS',hours};const solution=optimizePlan({forecast:f});assert.equal(solution.plan.length,HOURS);assert.equal(solution.scenarioCount,12);assert.ok(solution.expectedCost>0);
 assert.ok(solution.plan.every(m=>m>=0&&m<STATES));assert.notDeepEqual(solution.plan,Array(HOURS).fill(0));
 const a=optimizePlan({forecast:makeForecast('GS-1015')});const b=optimizePlan({forecast:makeForecast('GS-287')});assert.notDeepEqual(a.plan,b.plan);
});
test('Causal policy receives only forecast, revealed history and own plan/state',()=>{
 const f=makeForecast('CAUSAL'),real=makeRealization(f),plan=optimizePlan({forecast:f}).plan,history=real.slice(0,10);
 const allowed={forecast:f,history,submittedPlan:plan,previousMask:plan[8]};
 const poison=new Proxy(allowed,{get(t,key){if(!(key in t))throw Error('Read forbidden input: '+String(key));return t[key];}});
 assert.deepEqual(orbitDecision(poison),orbitDecision(allowed));
 const withHidden={...allowed,get actualFuture(){throw Error('Future accessed');},get realizedDay(){throw Error('Future accessed');}};assert.deepEqual(orbitDecision(withHidden),orbitDecision(allowed));
 const scenarios=makePlanningScenarios(f,history);for(const s of scenarios)assert.deepEqual(s.slice(0,10),history);
 assert.throws(()=>optimizePlan({forecast:f,history,startHour:7}),/History/);
});
test('Revealed surprises can change the ORBIT current decision',()=>{
 const f=makeForecast('RESPONSE'),plan=optimizePlan({forecast:f}).plan;
 const low=orbitDecision({forecast:f,history:[{hour:0,demand:300,wind:250,solar:0}],submittedPlan:plan});
 const high=orbitDecision({forecast:f,history:[{hour:0,demand:900,wind:0,solar:0}],submittedPlan:plan});
 assert.notEqual(low.mask,high.mask);near(dispatch(high.mask,{demand:900,wind:0,solar:0}).shortage,0);
});
test('Session withholds opponent and future conditions until results; submitted plan copied',()=>{
 const s=createSession('VIEW'),p=baselinePlan();let v=s.start(p);p[0]=0;assert.equal(v.humanPlan[0],3);assert.equal(v.history.length,1);assert.equal(v.orbitPlan,undefined);assert.equal(v.orbitLedger,undefined);assert.equal(v.orbitActions,undefined);assert.equal(v.actual.hour,0);assert.equal(v.actual.clockHour,8);assert.equal(v.complete,false);
 assert.throws(()=>s.start(p),/Already/);for(let i=0;i<HOURS;i++){v=s.settle(3);if(i<HOURS-1){assert.equal(v.orbitPlan,undefined);assert.equal(v.history.length,i+2);assert.equal(v.actual.hour,i+1);}}
 assert.equal(v.complete,true);assert.equal(v.actual,null);assert.equal(v.orbitPlan.length,HOURS);assert.equal(v.orbitLedger.length,HOURS);assert.throws(()=>s.settle(3),/No active/);
});
test('12-hour playthroughs: shared realized day, allocation constraints, scoring and ledgers reconcile',()=>{
 for(const seed of ['GS-1015','WIND-2','SOLAR-13','STORM-4','TEST-5','CALM-9']){
 const s=createSession(seed),p=forecastPlan(s.forecast);let v=s.start(p);
 for(let h=0;h<HOURS;h++){const mask=h%7===0?63:h%11===0?0:p[h];v=s.settle(mask);}
 assert.equal(v.ledger.length,HOURS);assert.equal(v.orbitActions.length,HOURS);assert.deepEqual(v.humanPlan,p);
 for(let h=0;h<HOURS;h++){validateRow(v.ledger[h]);validateRow(v.orbitLedger[h]);assert.deepEqual(v.ledger[h].actual,v.orbitLedger[h].actual);}
 for(const ledger of [v.ledger,v.orbitLedger]){const sum=summarize(ledger);near(sum.total,sum.running+sum.startup+sum.adjustment+sum.penalty);near(sum.total,ledger.reduce((s,l)=>s+l.total,0));}
 }
});
test('A capable reactive player can beat or lose to the simulator through decisions',()=>{
 let wins=0,losses=0;
 for(let i=0;i<12;i++){const s=createSession('MATCH-'+i),p=starterPlan(s.forecast);let v=s.start(p),prev=0;for(let h=0;h<HOURS;h++){
 let best=0,cost=Infinity;for(let m=0;m<64;m++){const row=settle({hour:h,mask:m,previousMask:prev,planMask:p[h],actual:v.actual});if(row.total<cost){best=m;cost=row.total;}}prev=best;v=s.settle(best);}
 const gap=summarize(v.ledger).total-summarize(v.orbitLedger).total;if(gap<0)wins++;if(gap>0)losses++;
 }
 assert.ok(wins>0,`Reactive player must be able to win (${wins} wins, ${losses} losses)`);assert.ok(losses>0,`A win must not be baked in (${wins} wins, ${losses} losses)`);
});
test('Invalid commitment and invalid conditions fail explicitly',()=>{assert.throws(()=>dispatch(64,{demand:1,wind:0,solar:0}),/mask/);assert.throws(()=>dispatch(1,{demand:-1,wind:0,solar:0}),/conditions/);assert.throws(()=>createSession('BAD').start([1]),/Invalid plan/);});
