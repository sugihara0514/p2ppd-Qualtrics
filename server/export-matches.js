import fs from 'node:fs';
import { recordsToCsv } from './match-history.js';

const [input, output, session] = process.argv.slice(2);
if (!input || !output || input === output) {
  throw new Error('Usage: node export-matches.js INPUT.jsonl OUTPUT.csv [SESSION_ID] (different paths)');
}
let records = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
if (session) records = records.filter(r => r.session_id === session);
// Exclusive creation avoids overwriting an existing export accidentally.
fs.writeFileSync(output, recordsToCsv(records), { flag: 'wx' });
console.log(`Exported ${records.length} matches`);
