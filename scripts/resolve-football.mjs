import fs from 'node:fs';
import { keccak256, toBytes, parseUnits } from 'viem';
import { publicRuntime, canonical } from './public-runtime.mjs';
import { collectFootballHealth, validateFootballEvidence } from './football-oracle.mjs';

export async function resolveFootball({ network='arc-testnet', marketId, runtime=publicRuntime(network), fileSystem=fs, credentials, fetchImpl=fetch, clock=()=>new Date() } = {}) {
  const {manifest,account,client,abi,call} = runtime;
  const catalog = JSON.parse(fileSystem.readFileSync(`deployments/${network}-real-markets.json`,'utf8'));
  if (catalog.chainId !== manifest.chainId || catalog.contract.toLowerCase() !== manifest.address.toLowerCase()) throw new Error('Catalog deployment mismatch.');
  const item = catalog.markets.find(m=>m.marketId===String(marketId) && m.rules.category==='Football');
  if (!item || item.rules.oracleHealth?.sport !== 'football') throw new Error('A football market with committed three-source rules is required. Existing official-source rules cannot be replaced.');
  const rules = item.rules, id = BigInt(item.marketId);
  const market = await client.readContract({address:manifest.address,abi,functionName:'getMarket',args:[id]});
  if (market.rulesHash !== keccak256(toBytes(JSON.stringify(canonical(rules)))) || market.resolver.toLowerCase() !== account.address.toLowerCase()) throw new Error('Rules or resolver mismatch.');
  if (market.status===2) throw new Error('Cancelled market cannot resolve.');
  const directory = `web/public/evidence/${network}-${item.slug}`, file = `${directory}/evidence.json`;
  let raw;
  if (fileSystem.existsSync(file)) raw = fileSystem.readFileSync(file,'utf8');
  else {
    const block = await client.getBlock();
    if (market.status !== 0 || block.timestamp < market.closeAt || block.timestamp >= market.resolveBy) throw new Error('Outside resolution window.');
    const health = await collectFootballHealth(rules.oracleHealth,{closeAt:market.closeAt,resolveBy:market.resolveBy},{credentials,fetchImpl,clock});
    fileSystem.mkdirSync('work',{recursive:true});
    fileSystem.writeFileSync(`work/${network}-${item.slug}-football-health.json`,JSON.stringify(health,null,2)+'\n');
    if (!health.healthy) throw new Error(`Football health blocked signing: ${health.reason}`);
    const normalized = await client.readContract({address:manifest.address,abi,functionName:'normalizeOutcome',args:[id,parseUnits(health.rawValue,18)]});
    const evidence = {schemaVersion:1,chainId:manifest.chainId,contract:manifest.address,marketId:item.marketId,resolver:market.resolver,rulesHash:market.rulesHash,rawValue:health.rawValue,normalizedOutcome:normalized.toString(),publicationAt:new Date(Math.max(...health.observations.map(o=>Date.parse(o.retrievedAt)))).toISOString(),oracleHealth:{observations:health.observations},...Object.fromEntries(['source','field','observationAt','publicationPolicy','units','precision','rounding','normalization'].map(key=>[key,rules[key]]))};
    raw = JSON.stringify(canonical(evidence));
    fileSystem.mkdirSync(directory,{recursive:true}); fileSystem.writeFileSync(file,raw);
  }
  const evidence = JSON.parse(raw), evidenceHash = keccak256(toBytes(raw));
  const outcome = await validateFootballEvidence({evidence,rules,market,manifest,marketId:id,nowMs:clock().getTime(),normalize:value=>client.readContract({address:manifest.address,abi,functionName:'normalizeOutcome',args:[id,value]})});
  if (market.status===1) {
    if (market.evidenceHash!==evidenceHash || market.outcome!==outcome) throw new Error('Resolved outcome and archive disagree.');
    console.log(`Existing football resolution verified: ${evidence.rawValue} goals.`); return;
  }
  const latest = await client.getBlock();
  if (latest.timestamp < market.closeAt || latest.timestamp >= market.resolveBy) throw new Error('Outside resolution window; do not sign.');
  const receipt = await call(`resolve:${item.slug}`,manifest.address,abi,'resolve',[id,outcome,evidenceHash]);
  fileSystem.writeFileSync(`deployments/${network}-${item.slug}-resolution-evidence.json`,JSON.stringify({marketId:item.marketId,contract:manifest.address,rawValue:evidence.rawValue,normalizedOutcome:outcome.toString(),evidenceHash,evidencePath:file,transactionHash:receipt.transactionHash,blockNumber:receipt.blockNumber.toString()},null,2)+'\n');
  console.log(`Resolved football market ${item.marketId}: ${evidence.rawValue} regulation goals.`);
}
if (process.argv[1]?.endsWith('resolve-football.mjs')) {
  const option = name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
  if (!option('--market')) throw new Error('--market <market ID> is required.');
  await resolveFootball({network:option('--network')??'arc-testnet',marketId:option('--market')});
}
