import test from "node:test";
import assert from "node:assert/strict";
import { makeManualBonusAdjustment } from "../lib/manual-bonus-adjustment.mjs";
import { calculateBonusServiceUsage } from "../lib/bonus-service-usage.mjs";

const bonus = "andres";
function movement(id, q, p, created_at) {
  return { id,bonus_id:bonus,movement_type:"usage",amount:q*p,created_at,
    detail:{source:"delivery_auto",services:{reels:{quantity:q,unitPrice:p}}} };
}
function usage(movements,amount) {
  return calculateBonusServiceUsage({bonusId:bonus,usedAmount:amount,movements});
}
function recorded(input,created_at) {
  const entry = makeManualBonusAdjustment(input);
  return { id:"manual", bonus_id:bonus, created_at, ...entry };
}
test("Adding 2 reels manually preserves the 18 delivered/historical reels",()=>{
 const old={ id:"historical",bonus_id:bonus,movement_type:"usage",amount:135,created_at:"2026-10-05",
   detail:{source:"manual_override",services:{reels:{quantity:9,unitPrice:15}}} };
 const records=[old,movement("auto1",4,15,"2026-10-18"),movement("auto2",5,15,"2026-10-23"),
   recorded({mode:"add",serviceName:"Reels",quantity:2,unitPrice:15},"2026-10-24")];
 const rows=usage(records,300);
 assert.equal(rows.find(x=>x.service==="reels").quantity,20);
 assert.equal(rows.find(x=>x.service==="reels").amount,300);
 assert.equal(rows[0].unattributedAmount,0);
});
test("Correcting one service only does not erase other services or future deliveries",()=>{
 const base=[movement("a",2,8,"2026-10-21"),
   {id:"youtube",bonus_id:bonus,movement_type:"usage",amount:25,created_at:"2026-10-20",
   detail:{source:"delivery_auto",services:{youtube:{quantity:1,unitPrice:25}}}}];
 const correction=recorded({mode:"correct",serviceName:"Reels",quantity:3,unitPrice:8,
   currentRow:{quantity:2,unitPrice:8,amount:16},reason:"Reel adicional"},"2026-10-24");
 const rows=usage([...base,correction,movement("later",1,8,"2026-10-25")],57);
 assert.equal(rows.find(x=>x.service==="reels").quantity,4);
 assert.equal(rows.find(x=>x.service==="youtube").quantity,1);
 assert.equal(rows.reduce((sum,x)=>sum+x.amount,0),57);
});
test("Correcting an existing price posts only the financial difference",()=>{
 const entry=makeManualBonusAdjustment({mode:"correct",serviceName:"Reels",quantity:5,unitPrice:10,
   currentRow:{quantity:5,unitPrice:8,amount:40},reason:"Precio real"});
 assert.equal(entry.amount,10);
 assert.deepEqual(entry.detail.services.Reels,{quantity:5,unitPrice:10,amount:50});
});
test("Quantity-only correction preserves mixed-price legacy amounts",()=>{
 const entry=makeManualBonusAdjustment({mode:"correct",serviceName:"YouTube",quantity:4,unitPrice:21.5,
   currentRow:{quantity:3,unitPrice:21.5,amount:65},reason:"Faltaba un vídeo"});
 assert.equal(entry.amount,21.5);
 assert.equal(entry.detail.services.YouTube.amount,86.5);
});
test("Free services preserve units without spending money",()=>{
 const entry=recorded({mode:"add",serviceName:"Miniaturas",quantity:2,unitPrice:0},"2026-10-24");
 const rows=usage([entry],0);
 assert.equal(rows.find(x=>x.service==="thumbnails").quantity,2);
 assert.equal(rows[0].unattributedAmount,0);
});
test("Prevent invalid and unchanged financial actions",()=>{
 assert.throws(()=>makeManualBonusAdjustment({mode:"add",serviceName:"Reels",quantity:0,unitPrice:15}),/al menos una unidad/);
 assert.throws(()=>makeManualBonusAdjustment({mode:"add",serviceName:"Reels",quantity:1.5,unitPrice:15}),/enteras/);
 assert.throws(()=>makeManualBonusAdjustment({mode:"correct",serviceName:"Reels",quantity:3,unitPrice:15,
 currentRow:{quantity:3,unitPrice:15,amount:45},reason:"ok"}),/Cambia las unidades/);
 assert.throws(()=>makeManualBonusAdjustment({mode:"correct",serviceName:"Reels",quantity:2,unitPrice:15,
 currentRow:{quantity:3,unitPrice:15,amount:45},reason:""}),/motivo/);
});
