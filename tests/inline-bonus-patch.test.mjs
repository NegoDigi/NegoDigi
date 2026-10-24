import test from "node:test";
import assert from "node:assert/strict";
import { buildInlineBonusPatch } from "../lib/inline-bonus-patch.mjs";
import { calculateBonusServiceUsage } from "../lib/bonus-service-usage.mjs";

const initial=[
  {service:"reels",label:"Reels",quantity:5,unitPrice:8,amount:40},
  {service:"youtube",label:"YouTube",quantity:0,unitPrice:0,amount:0},
  {service:"thumbnails",label:"Miniaturas",quantity:0,unitPrice:0,amount:0},
];
function drafts(overrides={}) {
  return Object.fromEntries(initial.map(row=>[
    row.service,overrides[row.service]||{quantity:String(row.quantity),unitPrice:String(row.unitPrice)}
  ]));
}
test("Albert: replace 5 with 6 -> 48 euros, without another UI",()=>{
 const change=buildInlineBonusPatch(initial,drafts({reels:{quantity:"6",unitPrice:"8"}}));
 assert.equal(change.amount,8);
 assert.deepEqual(change.detail.services.reels,{quantity:6,unitPrice:8,amount:48});
});
test("Cleared quantities can be replaced before saving",()=>{
 const incomplete=buildInlineBonusPatch(initial,drafts({reels:{quantity:"",unitPrice:"8"}}));
 assert.equal(incomplete.amount,-40);
 const replaced=buildInlineBonusPatch(initial,drafts({reels:{quantity:"12",unitPrice:"8"}}));
 assert.equal(replaced.amount,56);
});
test("Multiple changes create one ledger movement, preserving other service counts",()=>{
 const change=buildInlineBonusPatch(initial,drafts({
  reels:{quantity:"6",unitPrice:"8"},youtube:{quantity:"2",unitPrice:"25"}
 }));
 assert.equal(change.amount,58);
 assert.deepEqual(Object.keys(change.detail.services),["reels","youtube"]);
 const prior=[{id:"old",bonus_id:"albert",movement_type:"usage",created_at:"2026-10-01",amount:40,detail:{source:"manual_override",services:{reels:{quantity:5,unitPrice:8}}}}];
 const next=[...prior,{id:"new",bonus_id:"albert",created_at:"2026-10-24",...change}];
 const balance=calculateBonusServiceUsage({bonusId:"albert",usedAmount:98,movements:next});
 assert.equal(balance.find(row=>row.service==="reels").quantity,6);
 assert.equal(balance.find(row=>row.service==="youtube").quantity,2);
 assert.equal(balance[0].unattributedAmount,0);
});
test("Mixed historical prices stay exact when only units change",()=>{
 const before=[{service:"youtube",label:"YouTube",quantity:3,unitPrice:21.5,amount:65}];
 const change=buildInlineBonusPatch(before,{youtube:{quantity:"4",unitPrice:"21.5"}});
 assert.equal(change.amount,21.5);
 assert.equal(change.detail.services.youtube.amount,86.5);
});
test("Changing price without changing quantity posts only a delta",()=>{
 const change=buildInlineBonusPatch(initial,drafts({reels:{quantity:"5",unitPrice:"10"}}));
 assert.equal(change.amount,10);
 assert.equal(change.detail.services.reels.amount,50);
});
test("Unchanged inputs do not create a movement",()=>{
 assert.equal(buildInlineBonusPatch(initial,drafts()),null);
});
test("Invalid values are blocked before writing",()=>{
 assert.throws(()=>buildInlineBonusPatch(initial,drafts({reels:{quantity:"6.5",unitPrice:"8"}})),/enteras/);
 assert.throws(()=>buildInlineBonusPatch(initial,drafts({reels:{quantity:"6",unitPrice:"-1"}})),/unidades deben/);
});
