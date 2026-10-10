import fs from 'node:fs';
import { footballCredentials, footballProviders, footballOraclePolicy, collectFootballHealth } from './football-oracle.mjs';

const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i+1]; };
const configFile = option('--config') ?? 'work/football-oracles.json';
const credentials = footballCredentials();
const readiness = { providers:footballProviders.map(({id,env})=>({id,credentialConfigured:!!credentials[id],requiredVariable:env})), fixtureMappingsConfigured:false };
if (fs.existsSync(configFile)) {
  try {
    const fixtures = JSON.parse(fs.readFileSync(configFile,'utf8')).fixtures;
    if (!Array.isArray(fixtures) || !fixtures.length || new Set(fixtures.map(f=>f.slug)).size !== fixtures.length) throw new Error('Nonempty unique fixture mappings required.');
    for (const fixture of fixtures) { if (typeof fixture.slug !== 'string' || !fixture.slug.trim()) throw new Error('Fixture slug required.'); footballOraclePolicy(fixture); }
    readiness.fixtureMappingsConfigured = true;
  } catch(error) { readiness.mappingError = error.message; }
}
const slug = option('--fixture');
let health;
if (slug) {
  try {
    if (!readiness.fixtureMappingsConfigured) throw new Error('Fixture mappings missing or invalid. Copy config/football-oracles.example.json and fill real provider IDs.');
    const entry = JSON.parse(fs.readFileSync(configFile,'utf8')).fixtures.find(item=>item.slug===slug);
    if (!entry) throw new Error('Fixture slug not mapped.');
    const policy = footballOraclePolicy(entry);
    const closeAt = Math.floor(Date.parse(entry.kickoffUTC)/1000), resolveBy = closeAt + 48*3600;
    health = await collectFootballHealth(policy,{closeAt,resolveBy},{credentials});
  } catch(error) { health = {healthy:false,reason:error.message}; }
}
const report = { ...readiness, ...(health ? {fixture:slug,...health} : {}) };
fs.mkdirSync('work',{recursive:true});
fs.writeFileSync('work/football-oracle-health.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ ...report, observations:health?.observations?.map(({id,error,result})=>({id,error,result})) },null,2));
process.exitCode = health ? (health.healthy ? 0 : 1) : (readiness.providers.every(p=>p.credentialConfigured) && readiness.fixtureMappingsConfigured ? 0 : 1);
