import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { parseUnits } from 'viem';
import { canonical } from './public-runtime.mjs';
import { sha256 } from './oracle-health.mjs';

export const footballProviders = [
  { id: 'football-data', env: 'FOOTBALL_DATA_TOKEN', header: 'X-Auth-Token' },
  { id: 'api-football', env: 'API_FOOTBALL_KEY', header: 'x-apisports-key' },
  { id: 'sportmonks', env: 'SPORTMONKS_TOKEN', header: 'Authorization' },
];
const equal = (a,b,field) => { if (JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b))) throw new Error(`${field} mismatch.`); };
const validId = id => Number.isSafeInteger(id) && id > 0;
const goals = value => { if (!Number.isInteger(value) || value < 0 || value > 30) throw new Error('Invalid regulation-time score.'); return value; };
const sourceURL = (id, fixtureId) => ({
  'football-data': `https://api.football-data.org/v4/matches/${fixtureId}`,
  'api-football': `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,
  sportmonks: `https://api.sportmonks.com/v3/football/fixtures/${fixtureId}?include=participants;scores;state`,
})[id];

export function footballOraclePolicy(fixture) {
  if (!fixture || typeof fixture.home !== 'string' || !fixture.home.trim() || typeof fixture.away !== 'string' || !fixture.away.trim() || fixture.home === fixture.away || !Number.isFinite(Date.parse(fixture.kickoffUTC))) throw new Error('Fixture needs home, away and kickoffUTC.');
  const sources = footballProviders.map(({id}) => {
    const mapping = fixture.sources?.find(source => source.id === id);
    if (!mapping || !['fixtureId','homeTeamId','awayTeamId','competitionId','seasonId'].every(field => validId(mapping[field])) || mapping.homeTeamId === mapping.awayTeamId) throw new Error(`${id}: fixture/team/competition/season IDs required.`);
    return { id, ...Object.fromEntries(['fixtureId','homeTeamId','awayTeamId','competitionId','seasonId'].map(key => [key,mapping[key]])), url: sourceURL(id, mapping.fixtureId) };
  });
  if (fixture.sources.length !== 3) throw new Error('Exactly three provider mappings required.');
  return { version: 1, sport: 'football', requiredSources: 3, scorePeriod: 'regulation', maxSnapshotAgeSeconds: 300, fixture: { home: fixture.home, away: fixture.away, kickoffUTC: fixture.kickoffUTC }, sources };
}
function validatePolicy(policy) {
  equal(policy, footballOraclePolicy({ ...policy?.fixture, sources: policy?.sources }), 'Football policy');
}
export function footballCredentials(fileSystem = fs, env = process.env) {
  const local = fileSystem.existsSync('.env') ? parseEnv(fileSystem.readFileSync('.env','utf8')) : {};
  return Object.fromEntries(footballProviders.map(({id,env:key}) => [id, env[key] || local[key]]));
}
export function readFootballResult(source, bytes) {
  let body;
  try { body = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new Error('Invalid football response JSON.'); }
  let id, homeId, awayId, competition, season, kickoff, home, away;
  if (source.id === 'football-data') {
    if (body.status !== 'FINISHED' || body.score?.duration !== 'REGULAR') throw new Error('Match is not regulation-time FINISHED.');
    id = body.id; homeId = body.homeTeam?.id; awayId = body.awayTeam?.id; competition = body.competition?.id; season = body.season?.id;
    kickoff = Date.parse(body.utcDate) / 1000; home = body.score.fullTime?.home; away = body.score.fullTime?.away;
  } else if (source.id === 'api-football') {
    if (!body.errors || Object.keys(body.errors).length || !Array.isArray(body.response) || body.response.length !== 1) throw new Error('Exactly one API-Football fixture required.');
    const match = body.response[0];
    if (match.fixture?.status?.short !== 'FT') throw new Error('Match is not regulation-time FT.');
    id = match.fixture.id; homeId = match.teams?.home?.id; awayId = match.teams?.away?.id; competition = match.league?.id; season = match.league?.season;
    kickoff = match.fixture.timestamp; home = match.score?.fulltime?.home; away = match.score?.fulltime?.away;
  } else if (source.id === 'sportmonks') {
    const match = body.data;
    if (match?.state?.developer_name !== 'FT' || match.state_id !== 5) throw new Error('Match is not regulation-time FT.');
    id = match.id; competition = match.league_id; season = match.season_id; kickoff = match.starting_at_timestamp;
    if (!Array.isArray(match.participants) || match.participants.length !== 2 || !Array.isArray(match.scores)) throw new Error('Missing Sportmonks participants/scores.');
    const participant = side => { const rows = match.participants.filter(p => p.meta?.location === side); if (rows.length !== 1) throw new Error('Ambiguous participant.'); return rows[0].id; };
    homeId = participant('home'); awayId = participant('away');
    const score = (side, teamId) => {
      const rows = match.scores.filter(row => row.description === 'CURRENT' && row.participant_id === teamId && row.score?.participant === side);
      if (rows.length !== 1 || rows[0].fixture_id !== id) throw new Error('Ambiguous Sportmonks score.');
      return rows[0].score.goals;
    };
    home = score('home',homeId); away = score('away',awayId);
  } else throw new Error('Unsupported football provider.');
  for (const [field,value] of Object.entries({fixtureId:id,homeTeamId:homeId,awayTeamId:awayId,competitionId:competition,seasonId:season})) equal(value,source[field],field);
  if (!Number.isSafeInteger(kickoff)) throw new Error('Invalid match kickoff.');
  home = goals(home); away = goals(away);
  if (home + away > 30) throw new Error('Total goals exceed supported range.');
  return { kickoff, home, away, rawValue: String(home + away) };
}

export function evaluateFootballHealth(policy, observations, { closeAt, resolveBy, nowMs = Date.now(), requireFresh = true }) {
  validatePolicy(policy);
  if (!Array.isArray(observations) || observations.length !== 3) throw new Error('Three football observations required.');
  const scores = observations.map((observation,i) => {
    const source = policy.sources[i]; equal(observation.id,source.id,'Source'); equal(observation.url,source.url,'Source URL');
    const time = Date.parse(observation.retrievedAt);
    if (!Number.isFinite(time) || time < Number(closeAt)*1000 || time >= Number(resolveBy)*1000 || time > nowMs || (requireFresh && nowMs - time > policy.maxSnapshotAgeSeconds*1000)) throw new Error('Stale or inadmissible football observation.');
    const bytes = Buffer.from(observation.sourceBytes,'base64');
    if (bytes.toString('base64') !== observation.sourceBytes || sha256(bytes) !== observation.sourceSha256) throw new Error('Football archive integrity mismatch.');
    const result = readFootballResult(source,bytes);
    if (result.kickoff < Number(closeAt) || result.kickoff + 90*60 > time/1000) throw new Error('Earlier reschedule or premature full-time result.');
    equal(observation.result,result,'Archived score'); return result;
  });
  const healthy = scores.every(result => result.home === scores[0].home && result.away === scores[0].away && result.kickoff === scores[0].kickoff);
  return { healthy, reason: healthy ? 'All three providers agree on the completed regulation score.' : 'Football providers disagree on score or kickoff.', rawValue: scores[0].rawValue, observations };
}
export async function collectFootballHealth(policy, window, { credentials = footballCredentials(), fetchImpl = fetch, clock = () => new Date() } = {}) {
  validatePolicy(policy);
  const settled = await Promise.allSettled(policy.sources.map(async (source,i) => {
    const provider = footballProviders[i], key = credentials[source.id];
    if (!key) throw new Error(`Missing ${provider.env}.`);
    let response;
    try { response = await fetchImpl(source.url,{ headers: { [provider.header]: key }, signal: AbortSignal.timeout(20000), redirect:'error' }); }
    catch { throw new Error('Provider request failed.'); }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const result = readFootballResult(source,bytes);
    return { id: source.id, url: source.url, retrievedAt:clock().toISOString(), sourceBytes:bytes.toString('base64'), sourceSha256:sha256(bytes), result };
  }));
  const observations = settled.map((result,i) => result.status === 'fulfilled' ? result.value : { id:policy.sources[i].id, error:result.reason.message });
  if (settled.some(result=>result.status==='rejected')) return { healthy:false, reason:'Football source unavailable, unconfigured, or not full time.', observations };
  try { return evaluateFootballHealth(policy,observations,{ ...window, nowMs:clock().getTime() }); }
  catch(error) { return { healthy:false, reason:error.message, observations }; }
}

export async function validateFootballEvidence({ evidence, rules, market, manifest, marketId, normalize, nowMs = Date.now() }) {
  const expected = { schemaVersion:1,chainId:manifest.chainId,contract:manifest.address,marketId:String(marketId),resolver:market.resolver,rulesHash:market.rulesHash };
  for (const [field,value] of Object.entries(expected)) equal(evidence?.[field],value,field);
  for (const field of ['source','field','observationAt','publicationPolicy','units','precision','rounding','normalization']) equal(evidence[field],rules[field],field);
  const health = evaluateFootballHealth(rules.oracleHealth,evidence.oracleHealth?.observations,{ closeAt:market.closeAt,resolveBy:market.resolveBy,nowMs,requireFresh:false });
  if (!health.healthy) throw new Error(health.reason);
  equal(evidence.rawValue,health.rawValue,'rawValue');
  const latest = Math.max(...health.observations.map(o=>Date.parse(o.retrievedAt)));
  equal(evidence.publicationAt,new Date(latest).toISOString(),'publicationAt');
  const outcome = await normalize(parseUnits(health.rawValue,18));
  equal(evidence.normalizedOutcome,outcome.toString(),'normalizedOutcome');
  return outcome;
}
