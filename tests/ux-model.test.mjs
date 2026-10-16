import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION,HOURS,START_HOUR,createSession,makeForecast,dispatch,settle,summarize} from '../dist/engine.mjs';
import {clockLabel,starterPlan,coverGap,restoreSaved,savedSnapshot,exportCsv,buildTourExample} from '../dist/support.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
test('Shift is exactly twelve one-hour decisions from 08:00 through 19:00, ending 20:00',()=>{
 assert.equal(HOURS,12);assert.equal(START_HOUR,8);const s=createSession('CLOCK');assert.equal(s.forecast.hours.length,12);
 assert.deepEqual(s.forecast.hours.map(a=>a.clockHour),[8,9,10,11,12,13,14,15,16,17,18,19]);
 let view=s.start(starterPlan(s.forecast));for(let i=0;i<12;i++){assert.equal(view.hour,i);assert.equal(view.actual.clockHour,i+8);view=s.settle(63);assert.equal(view.complete,i===11);}assert.equal(clockLabel(12),'20:00');assert.throws(()=>s.settle(63));
});
test('Starter plans cover central forecast and expose different reserve choices',()=>{
 const f=makeForecast('STARTER');for(const reserve of [0,50,110]){const p=starterPlan(f,reserve);assert.equal(p.length,12);p.forEach((m,h)=>close(dispatch(m,{...f.hours[h],demand:f.hours[h].demand+reserve}).shortage,0));}
 assert.notDeepEqual(starterPlan(f,0),starterPlan(f,110));
});
test('Current-hour power helper adds units only and chooses an affordable covering mix',()=>{
 const actual={hour:0,demand:620,wind:70,solar:180};const mask=coverGap({mask:1,actual,previousMask:1,planMask:1});assert.equal(mask&1,1);close(dispatch(mask,actual).shortage,0);
 const chosen=settle({hour:0,mask,previousMask:1,planMask:1,actual}).total;
 for(let m=0;m<64;m++)if((m&1)===1&&dispatch(m,actual).shortage===0)assert.ok(chosen<=settle({hour:0,mask:m,previousMask:1,planMask:1,actual}).total+1e-7);
 assert.equal(coverGap({mask:63,actual}),63);
});
test('Old and malformed saved games reset safely; current plans and in-hour changes resume',()=>{
 assert.equal(restoreSaved({version:1,seed:'OLD',phase:'plan',plan:Array(24).fill(3)}),null);
 assert.equal(restoreSaved({version:VERSION,seed:'BAD',phase:'plan',plan:Array(24).fill(3)}),null);
 assert.equal(restoreSaved({version:VERSION,seed:'BAD',phase:'plan',plan:Array(12).fill(999)}),null);
 const session=createSession('SAVE'),plan=starterPlan(session.forecast);let view=session.start(plan);view=session.settle(plan[0]);
 const game={seed:'SAVE',session,plan,view,phase:'play',masks:[plan[0]],draft:63,selected:0};
 const saved=savedSnapshot(game),restored=restoreSaved(saved);assert.equal(restored.draft,63);assert.equal(restored.view.hour,1);assert.deepEqual(restored.plan,plan);assert.deepEqual(restored.view.ledger,view.ledger);assert.equal(restored.view.orbitPlan,undefined);
 const restoredPlan=restoreSaved({...saved,phase:'plan',selected:11,masks:[]});assert.equal(restoredPlan.selected,11);assert.equal(restoredPlan.view,null);
});
test('Twelve-hour export has 24 records, real clock labels, shared conditions and reconciled costs',()=>{
 const session=createSession('CSV'),plan=starterPlan(session.forecast);let view=session.start(plan);for(let h=0;h<HOURS;h++)view=session.settle(h===0?0:63);
 const lines=exportCsv('CSV',view.ledger,view.orbitLedger).split('\r\n');assert.equal(lines.length,25);
 const rows=lines.map(l=>l.split(',').map(s=>s.replace(/^"|"$/g,''))),head=rows[0],col=k=>head.indexOf(k);assert.equal(rows[1][col('clock_time')],'08:00');assert.equal(rows[12][col('clock_time')],'19:00');assert.equal(rows[13][col('clock_time')],'08:00');assert.equal(rows[24][col('clock_time')],'19:00');
 for(let h=0;h<12;h++)for(const key of ['demand_MW','wind_available_MW','solar_available_MW'])assert.equal(rows[h+1][col(key)],rows[h+13][col(key)]);
 for(const group of [rows.slice(1,13),rows.slice(13)]){const total=group.reduce((s,r)=>s+Number(r[col('total_GBP')]),0);const components=group.reduce((s,r)=>s+['running_GBP','startup_GBP','adjustment_GBP','penalty_GBP'].reduce((a,k)=>a+Number(r[col(k)]),0),0);close(total,components);}
});
test('Walkthrough animates a real shortage and recovery while staying isolated from a live game',()=>{
 const session=createSession('LIVE'),plan=starterPlan(session.forecast);session.start(plan);session.settle(plan[0]);const before=session.view();
 const demo=buildTourExample();close(dispatch(1,demo.expected).shortage,0);close(dispatch(1,demo.surprise).shortage,130);close(dispatch(9,demo.surprise).shortage,0);close(dispatch(9,demo.surprise).spare,50);assert.equal(demo.human[0].adjustment,800);
 assert.equal(demo.human.length,12);assert.equal(demo.orbit.length,12);close(demo.humanTotal.total,summarize(demo.human).total);assert.deepEqual(session.view(),before);assert.deepEqual(buildTourExample(),demo);
});
test('Returned view data cannot mutate the submitted plan, hourly allocation or condition records',()=>{
 const s=createSession('COPY'),plan=starterPlan(s.forecast);s.start(plan);const v=s.settle(plan[0]);const expected=s.view();v.humanPlan[0]=0;v.ledger[0].actual.demand=9999;v.ledger[0].outputs[0]=9999;v.history[0].wind=9999;assert.deepEqual(s.view(),expected);
});
