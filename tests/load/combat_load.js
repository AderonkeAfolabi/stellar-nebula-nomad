import { sleep } from 'k6';
import { buildOptions, makeSummary, simulate } from './config.js';

// Concurrent PvP combat matches load test.
// Default profile: spike (10 → 500 → 10 VUs) to simulate match-making bursts.
// Override: PROFILE=smoke|baseline|stress|spike|soak|breakpoint
//
// Pass a pre-signed combat transaction envelope:
//   k6 run -e TX_XDR_COMBAT="$XDR" tests/load/combat_load.js
export const options = buildOptions('spike');

export default function () {
  simulate(__ENV.TX_XDR_COMBAT, 'pvp_combat');
  sleep(Math.random() * 0.5);
}

export const handleSummary = makeSummary('pvp_combat');
