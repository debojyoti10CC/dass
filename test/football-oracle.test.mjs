import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak256,toBytes } from 'viem';
import { canonical } from '../scripts/public-runtime.mjs';
import { footballOraclePolicy,footballCredentials,footballProviders,collectFootballHealth,evaluateFootballHealth } from '../scripts/football-oracle.mjs';
import { resolveFootball } from '../scripts/resolve-football.mjs';

const kickoff=1800000000, now=new Date((kickoff+7200)*1000), WAD=10n**18n;
const fixture={home:'Home',away:'Away',kickoffUTC:new Date(kickoff*1000).toISOString(),sources:footballProviders.map(({id},i)=>({id,fixtureId:100+i,homeTeamId:200+i,awayTeamId:300+i,competitionId:400+i,seasonId:500+i}))};
const policy=footballOraclePolicy(fixture),window={closeAt:kickoff,resolveBy:kickoff+48*3600};
const credentials=Object.fromEntries(footballProviders.map(({id})=>[id,`private-${id}`]));
function body(source,home=2,away=1,time=kickoff) {
  const {fixtureId:id,homeTeamId:h,awayTeamId:a,competitionId:c,seasonId:s}=source;
  if(source.id==='football-data') return {id,utcDate:new Date(time*1000).toISOString(),status:'FINISHED',homeTeam:{id:h},awayTeam:{id:a},competition:{id:c},season:{id:s},score:{duration:'REGULAR',fullTime:{home,away}}};
  if(source.id==='api-football') return {errors:[],response:[{fixture:{id,timestamp:time,status:{short:'FT'}},teams:{home:{id:h},away:{id:a}},league:{id:c,season:s},score:{fulltime:{home,away}}}]};
  return {data:{id,league_id:c,season_id:s,starting_at_timestamp:time,state_id:5,state:{developer_name:'FT'},participants:[{id:h,meta:{location:'home'}},{id:a,meta:{location:'away'}}],scores:[{fixture_id:id,participant_id:h,description:'CURRENT',score:{participant:'home',goals:home}},{fixture_id:id,participant_id:a,description:'CURRENT',score:{participant:'away',goals:away}}]}};
}
function fetcher(overrides={}) {
  return async(url,options)=>{
    const source=policy.sources.find(s=>s.url===url); assert.ok(source);
    const provider=footballProviders.find(p=>p.id===source.id);
    assert.equal(options.headers[provider.header],credentials[source.id]); assert.equal(options.redirect,'error');
    if(overrides[source.id] instanceof Error) throw overrides[source.id];
    return {ok:true,arrayBuffer:async()=>Buffer.from(JSON.stringify(overrides[source.id]??body(source)))};
  };
}
const collect=(overrides={},clock=()=>now)=>collectFootballHealth(policy,window,{credentials,fetchImpl:fetcher(overrides),clock});
test('three exact completed regulation scores agree, including a zero-goal draw',async()=>{
  assert.equal((await collect()).rawValue,'3');
  const zero=Object.fromEntries(policy.sources.map(s=>[s.id,body(s,0,0)])); const health=await collect(zero);
  assert.equal(health.healthy,true);assert.equal(health.rawValue,'0');
  assert.ok(!JSON.stringify(health).includes('private-'),'Credentials never archived');
});
test('missing credentials block requests; readiness never prints secrets',async()=>{
  const health=await collectFootballHealth(policy,window,{credentials:{},fetchImpl:async()=>{throw new Error('Must not request without credentials');},clock:()=>now});
  assert.equal(health.healthy,false);assert.ok(health.observations.every(o=>o.error.startsWith('Missing')));
  const fakeFs={existsSync:()=>true,readFileSync:()=> 'FOOTBALL_DATA_TOKEN=local\n'};
  assert.equal(footballCredentials(fakeFs,{FOOTBALL_DATA_TOKEN:'environment'})['football-data'],'environment');
});
test('outages, wrong fixture/team/league/season, null scores and duplicate rows block',async()=>{
  const source=policy.sources[1];
  const mutations=[b=>b.response[0].fixture.id++,b=>b.response[0].teams.home.id++,b=>b.response[0].teams.away.id++,b=>b.response[0].league.id++,b=>b.response[0].league.season++,b=>b.response[0].score.fulltime.home=null,b=>b.response.push(b.response[0])];
  for(const mutate of mutations){const b=body(source);mutate(b);assert.equal((await collect({[source.id]:b})).healthy,false);}
  const health=await collect({sportmonks:new Error('private-token-in-error')});assert.equal(health.healthy,false);assert.ok(!JSON.stringify(health).includes('private-token'));
});
test('live, postponed, abandoned, awarded and extra-time/penalty statuses cannot settle',async()=>{
  for(const status of ['NS','1H','HT','PST','ABD','AWD','AET','PEN']){const b=body(policy.sources[1]);b.response[0].fixture.status.short=status;assert.equal((await collect({'api-football':b})).healthy,false);}
  const b=body(policy.sources[0]);b.score.duration='EXTRA_TIME';assert.equal((await collect({'football-data':b})).healthy,false);
});
test('different home/away scores block even if total goals match; later reschedules require exact agreement',async()=>{
  assert.equal((await collect({sportmonks:body(policy.sources[2],1,2)})).healthy,false);
  assert.equal((await collect({sportmonks:body(policy.sources[2],2,1,kickoff+60)})).healthy,false);
  const earlier=Object.fromEntries(policy.sources.map(s=>[s.id,body(s,2,1,kickoff-60)]));assert.equal((await collect(earlier)).healthy,false);
  const later=Object.fromEntries(policy.sources.map(s=>[s.id,body(s,2,1,kickoff+60)]));assert.equal((await collect(later)).healthy,true);
  assert.equal((await collect({},()=>new Date((kickoff+60)*1000))).healthy,false);
});
test('stale, future and corrupted archived observations cannot pass fresh health',async()=>{
  const health=await collect();
  assert.throws(()=>evaluateFootballHealth(policy,health.observations,{...window,nowMs:now.getTime()+301000}),/Stale/);
  assert.throws(()=>evaluateFootballHealth(policy,health.observations,{...window,nowMs:now.getTime()-1000}),/Stale/);
  const observations=structuredClone(health.observations);observations[0].result.home=99;
  assert.throws(()=>evaluateFootballHealth(policy,observations,{...window,nowMs:now.getTime()}),/score/);
  assert.throws(()=>footballOraclePolicy({...fixture,sources:fixture.sources.slice(0,2)}),/required/);
  assert.throws(()=>footballOraclePolicy({...fixture,sources:fixture.sources.map(s=>({...s,fixtureId:null}))}),/required/);
});
function setup(){
 const rules={category:'Football',oracleHealth:policy,source:policy.sources[0].url,field:'regulation goals',observationAt:fixture.kickoffUTC,publicationPolicy:'first all-three final snapshot',units:'goals',precision:'integer',rounding:'nearest',normalization:{origin:'0',scale:'1'}};
 const manifest={chainId:5042002,address:'0xcontract'},market={...window,status:0,resolver:'0xresolver',rulesHash:keccak256(toBytes(JSON.stringify(canonical(rules))))};
 const path='web/public/evidence/arc-testnet-match/evidence.json';
 const files=new Map([['deployments/arc-testnet-real-markets.json',JSON.stringify({chainId:manifest.chainId,contract:manifest.address,markets:[{slug:'match',marketId:'1',rules}]})]]),calls=[];
 const runtime={manifest,account:{address:market.resolver},abi:[],client:{getBlock:async()=>({timestamp:BigInt(kickoff+7200)}),readContract:async({functionName,args})=>functionName==='getMarket'?market:args[1]},call:async(...args)=>{calls.push(args);return {transactionHash:'0xtest',blockNumber:1n};}};
 const fileSystem={existsSync:p=>files.has(p),readFileSync:p=>{assert.ok(files.has(p));return files.get(p);},mkdirSync:()=>{},writeFileSync:(p,v)=>files.set(p,v)};
 return {rules,market,path,files,calls,options:{marketId:'1',runtime,fileSystem,credentials,fetchImpl:fetcher(),clock:()=>now}};
}
test('football resolver signs exact consensus outcome; cached evidence is revalidated and settled retries never sign',async()=>{
 const f=setup();await resolveFootball(f.options);assert.equal(f.calls.length,1);assert.equal(f.calls[0][4][1],3n*WAD);
 f.calls.length=0;f.market.status=1;f.market.outcome=3n*WAD;f.market.evidenceHash=keccak256(toBytes(f.files.get(f.path)));
 await resolveFootball({...f.options,fetchImpl:async()=>{throw new Error('No re-fetch of pinned evidence');}});assert.equal(f.calls.length,0);
});
test('unhealthy sources and tampered cached normalized result never sign',async()=>{
 const f=setup();await assert.rejects(resolveFootball({...f.options,fetchImpl:fetcher({sportmonks:new Error('offline')})}),/blocked signing/);assert.equal(f.calls.length,0);
 await resolveFootball(f.options);f.calls.length=0;const evidence=JSON.parse(f.files.get(f.path));evidence.normalizedOutcome='99';f.files.set(f.path,JSON.stringify(evidence));
 await assert.rejects(resolveFootball(f.options),/normalizedOutcome/);assert.equal(f.calls.length,0);
});
test('legacy official-page markets and expired markets cannot silently use new provider rules',async()=>{
 const f=setup();delete f.rules.oracleHealth;const catalog=JSON.parse(f.files.get('deployments/arc-testnet-real-markets.json'));delete catalog.markets[0].rules.oracleHealth;f.files.set('deployments/arc-testnet-real-markets.json',JSON.stringify(catalog));
 await assert.rejects(resolveFootball(f.options),/committed three-source/);assert.equal(f.calls.length,0);
 const expired=setup();expired.options.runtime.client.getBlock=async()=>({timestamp:BigInt(expired.market.resolveBy)});
 await assert.rejects(resolveFootball(expired.options),/Outside resolution/);assert.equal(expired.calls.length,0);
});
