import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {contentEvents,normalizeContact,optionalNumber,rate,safeExternalUrl,stateHistory,sumKnown,localDateKey,persistMarketingRecord} from '../lib/marketing.ts';

test('marketing distinguishes missing measurements from measured zero',()=>{
  assert.equal(optionalNumber(''),null);
  assert.equal(optionalNumber('0'),0);
  assert.equal(optionalNumber('-1'),null);
  assert.equal(sumKnown(['',undefined]),null);
  assert.equal(sumKnown(['', '0','12.5']),12.5);
  assert.equal(rate(0,100),0);
  assert.equal(rate(10,0),null);
});
test('CRM normalizes contacts and persists through the existing tenant-scoped helper',async()=>{
  assert.equal(normalizeContact(' A@Example.com '),'a@example.com');
  const source=await readFile(new URL('../app/marketing-workspace.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/marketingDemo|demoMode|Vista de ejemplo/);
  assert.doesNotMatch(source,/from\(['"](?:financial_transactions|finance_transactions|transactions)['"]\)/);
  assert.match(source,/persistMarketingRecord\(db,table,id,organizationId,payload,previous\?\.updated_at\)/);
});
test('persistence inserts once, edits the same ID and rejects a stale or wrong-tenant update',async()=>{
  const rows=new Map();
  const db={from(table){assert.equal(table,'leads');let operation,values;const filters={};const q={insert(v){operation='insert';values=v;return q;},update(v){operation='update';values=v;return q;},eq(k,v){filters[k]=v;return q;},select(){return q;},async single(){
    if(operation==='insert'){if(rows.has(values.id))return {error:{code:'23505'}};rows.set(values.id,{...values});return {data:{...values}};}
    const row=rows.get(filters.id);
    if(!row||Object.entries(filters).some(([k,v])=>row[k]!==v))return {error:{code:'PGRST116'}};
    const next={...row,...values};rows.set(row.id,next);return {data:next};
  }};return q;}};
  await persistMarketingRecord(db,'leads','local-id','local-org',{name:'Local fixture',updated_at:'v1'});
  await persistMarketingRecord(db,'leads','local-id','local-org',{name:'Edited fixture',updated_at:'v2'},'v1');
  assert.equal(rows.size,1);
  assert.equal(rows.get('local-id').name,'Edited fixture');
  await assert.rejects(persistMarketingRecord(db,'leads','local-id','local-org',{name:'stale'},'v1'));
  await assert.rejects(persistMarketingRecord(db,'leads','local-id','other-org',{name:'unauthorized'},'v2'));
  assert.equal(rows.get('local-id').name,'Edited fixture');
});
test('content can have recording, editing and publication in different months without duplication',()=>{
  const record={id:'local-only',title:'local test',publish_on:'2026-10-01',marketing_details:{record_on:'2026-09-30',edit_on:'2026-09-30'}};
  const events=contentEvents([record]);
  assert.deepEqual(events.map(e=>e.date),['2026-09-30','2026-09-30','2026-10-01']);
  assert.equal(events[0].record,events[2].record);
  assert.equal(localDateKey(new Date(2026,8,5)),'2026-09-05');
});
test('links and malformed stored history cannot inject code or crash the detail',()=>{
  assert.equal(safeExternalUrl('javascript:alert(1)'),null);
  assert.equal(safeExternalUrl('https://example.com'),'https://example.com/');
  assert.deepEqual(stateHistory('broken'),[]);
  assert.deepEqual(stateHistory('{}'),[]);
  assert.deepEqual(stateHistory('[null,{"at":"bad","state":"new"}]'),[]);
});
test('new marketing schema is additive, tenant-scoped and without seeded business data',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20260905222605_marketing_workspace.sql',import.meta.url),'utf8');
  assert.match(sql,/enable row level security/);
  assert.match(sql,/with check \(private.has_role/);
  assert.match(sql,/foreign key \(organization_id,source_id\)/);
  assert.match(sql,/create unique index if not exists leads_contact_unique/);
  assert.doesNotMatch(sql,/insert into|delete from|drop table|security definer/i);
});
