import { sleep } from 'k6';
import { buildOptions, makeSummary, simulate } from './config.js';

// Crafting at scale: stress test for the recycling_crafter and blueprint_factory.
// Default profile: stress (ramp to 250 VUs, 10 min).
// Override: PROFILE=smoke|baseline|stress|spike|soak|breakpoint
//
// Pass a pre-signed crafting transaction envelope:
//   k6 run -e TX_XDR_CRAFT="$XDR" tests/load/crafting_load.js
export const options = buildOptions('stress');

export default function () {
  simulate(__ENV.TX_XDR_CRAFT, 'crafting');
  sleep(Math.random() * 0.5);
}

export const handleSummary = makeSummary('crafting');
