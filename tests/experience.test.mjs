import test from 'node:test';
import assert from 'node:assert/strict';
import {FLEET,HOURS,createSession,dispatch,settle,summarize,makeForecast} from '../dist/engine.mjs';
import {starterPlan,savedSnapshot,restoreSaved,buildTourExample} from '../dist/support.mjs';
import {chooseAssist,conditionsEvent,needsIntervention,timelineData,createProgression,streakFor} from '../dist/experience.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} vs ${b}`);

test('Decision cards price the actual hour; cover preserves units and trim is lowest feasible total',()=>{
 for(const actual of [{hour:0,demand:620,wind:70,solar:180},{hour:4,demand:580,wind:280,solar:260},{hour:11,demand:910,wind:0,solar:0}])for(const mask of [0,1,9,63]){
  const opts={mask,actual,previousMask:3,planMask:3},cover=chooseAssist('cover',opts),trim=chooseAssist('trim',opts);
  assert.equal(cover&mask,mask);near(dispatch(cover,actual).shortage,0);
  const row=settle({...opts,mask:trim,hour:actual.hour});near(row.shortage,0);
  for(let m=0;m<64;m++){const candidate=settle({...opts,mask:m,hour:actual.hour});if(candidate.shortage<1e-7)assert.ok(row.total<=candidate.total+1e-7);}
  assert.deepEqual(actual,opts.actual);
 }
});
test('Reserve adds only capacity and chooses the cheapest current-hour 90 MW cushion',()=>{
 const opts={mask:1,actual:{hour:0,demand:620,wind:70,solar:180},previousMask:1,planMask:1};const reserve=chooseAssist('reserve',opts),row=settle({...opts,mask:reserve,hour:0});assert.equal(reserve&1,1);assert.ok(row.spare>=90);
 for(let m=0;m<64;m++){const r=settle({...opts,mask:m,hour:0});if((m&1)===1&&r.spare>=90&&!r.shortage)assert.ok(row.total<=r.total+1e-7);}
 assert.equal(chooseAssist('reserve',{...opts,mask:63}),63);
});
test('Alerts describe shared realized weather, demand and gaps; recovery removes a shortage',()=>{
 const f={hour:0,demand:600,wind:180,solar:180};
 assert.equal(conditionsEvent({...f},f,63).needsDecision,false);
 const a={...f,demand:650,wind:70,solar:100},ev=conditionsEvent(a,f,1);
 assert.deepEqual(ev.events.map(e=>e.kind),['wind','cloud','demand']);assert.deepEqual(ev.events.map(e=>e.delta),[-110,-80,50]);assert.equal(ev.shortage,240);
 const mask=chooseAssist('cover',{mask:1,actual:a});near(conditionsEvent(a,f,mask).shortage,0);
 assert.equal(conditionsEvent({...f},f,0).events[0].kind,'gap');
});
test('Chart uses only revealed values and public plan forecasts; changes preview just the current column',()=>{
 const s=createSession('CHART-12'),plan=starterPlan(s.forecast);let view=s.start(plan);view=s.settle(plan[0]);
 const safeHistory=new Proxy(view.history,{get(t,k){if(/^\d+$/.test(String(k))&&Number(k)>=t.length)throw Error('Future access');return Reflect.get(t,k);}});
 const opts={forecast:s.forecast,plan,history:safeHistory,ledger:view.ledger,currentHour:1,draft:63};
 const rows=timelineData(opts);assert.equal(rows.length,12);assert.equal(rows[0].kind,'settled');assert.equal(rows[1].kind,'live');
 rows.forEach((r,h)=>{const a=h<2?view.history[h]:s.forecast.hours[h];near(r.demand,a.demand);near(r.served+r.shortage,r.demand);near(r.generation.reduce((a,b)=>a+b,0),r.served);assert.equal(r.actualDemand,h<2?a.demand:null);if(h>1){assert.equal(r.kind,'forecast');assert.equal(r.mask,plan[h]);near(r.windAvailable,s.forecast.hours[h].wind);}});
 const changed=timelineData({...opts,draft:0});for(let h=0;h<12;h++)if(h!==1)assert.deepEqual(changed[h],rows[h]);assert.ok(changed[1].served<rows[1].served);
 assert.equal('orbitPlan' in rows[0],false);assert.deepEqual(s.view(),view);
});
test('Run tickets cannot skip or double-settle an hour; pause and resume invalidate stale callbacks',()=>{
 const c=createProgression();assert.equal(c.ticket(0),null);c.run(0);const old=c.ticket(0);c.pause();assert.equal(c.consume(old,0),false);c.run(0);assert.equal(c.consume(old,0),false);const fresh=c.ticket(0);assert.equal(c.consume(fresh,1),false);assert.equal(c.consume(fresh,0),true);assert.equal(c.consume(fresh,0),false);assert.equal(c.arrived(1),true);assert.equal(c.ticket(0),null);assert.equal(c.consume(c.ticket(1),1),true);assert.equal(c.arrived(2),true);assert.equal(c.consume(c.ticket(2),2),true);assert.equal(c.arrived(3),false);assert.equal(c.ticket(3),null);
 c.run(3);const pending=c.ticket(3);assert.equal(c.consume(pending,3),true);assert.equal(c.arrived(4,{needsDecision:true}),false);assert.equal(c.consume(pending,3),false);
});
test('Twelve progressed hours share all actuals with ORBIT and reconcile the complete score',()=>{
 const s=createSession('RUN-12'),plan=starterPlan(s.forecast);let view=s.start(plan);const c=createProgression();let pauses=0;
 while(!view.complete){const h=view.hour;if(!c.running){pauses++;c.run(h);}const mask=chooseAssist('trim',{mask:plan[h],actual:view.actual,previousMask:view.ledger.at(-1)?.mask??0,planMask:plan[h]});const ticket=c.ticket(h);assert.ok(c.consume(ticket,h));view=s.settle(mask);assert.equal(view.ledger.length,h+1);assert.equal(c.consume(ticket,h),false);c.arrived(view.hour,{complete:view.complete,needsDecision:!view.complete&&conditionsEvent(view.actual,s.forecast.hours[view.hour],plan[view.hour]).needsDecision});}
 assert.equal(c.running,false);assert.ok(pauses>=4);assert.equal(view.ledger.length,12);assert.equal(view.orbitLedger.length,12);assert.deepEqual(view.ledger.map(r=>r.actual),view.orbitLedger.map(r=>r.actual));const total=summarize(view.ledger);near(total.total,total.running+total.startup+total.adjustment+total.penalty);assert.equal(streakFor(view.ledger),12);
});
test('Undo preview and save restoration preserve the submitted plan; run state never resumes itself',()=>{
 const s=createSession('SAVE-CHART'),plan=starterPlan(s.forecast),view=s.start(plan),original=plan[0];let draft=chooseAssist('trim',{mask:original,actual:view.actual,planMask:original});const g={seed:'SAVE-CHART',session:s,plan,phase:'play',masks:[],view,draft,selected:0};const loaded=restoreSaved(savedSnapshot(g));assert.equal(loaded.draft,draft);assert.deepEqual(loaded.plan,plan);g.draft=original;assert.equal(restoreSaved(savedSnapshot(g)).draft,original);assert.equal(createProgression().running,false);assert.equal(s.view().ledger.length,0);
 const fresh=createSession('RESET');assert.equal(fresh.view().history.length,0);
});
test('Tour charts and computed event recovery stay isolated from a real in-progress game',()=>{
 const s=createSession('TOUR-SAFE'),plan=starterPlan(s.forecast);s.start(plan);s.settle(plan[0]);const before=s.view(),demo=buildTourExample();
 const opts={forecast:demo.forecast,plan:demo.plan,history:[demo.surprise],currentHour:0};const gap=timelineData({...opts,draft:1}),fixed=timelineData({...opts,draft:9});near(gap[0].shortage,130);near(fixed[0].shortage,0);near(fixed[0].spare,50);assert.equal(fixed[1].kind,'forecast');assert.equal(fixed[1].actualDemand,null);assert.deepEqual(s.view(),before);
});

test('Covered persistent weather does not interrupt every hour, but new or worsening shocks do',()=>{
 const f={hour:1,demand:600,wind:180,solar:180},prior={...f,wind:100};
 assert.equal(needsIntervention({...f,wind:95},f,63,prior,f),false);
 assert.equal(needsIntervention({...f,wind:60},f,63,prior,f),true);
 assert.equal(needsIntervention({...f,wind:100,solar:100},f,63,prior,f),true);
 assert.equal(needsIntervention({...f,wind:95},f,0,prior,f),true);
});
