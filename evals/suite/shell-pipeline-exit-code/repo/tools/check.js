'use strict';

// A stand-in for whatever a real repository's checker is. It fails when a
// forbidden file is present, and says so on stdout — the point of the task
// is the WRAPPER's exit status, not this.

const fs = require('node:fs');

const FORBIDDEN = ['DO_NOT_SHIP.txt'];

let problems = 0;
for (const file of FORBIDDEN) {
  if (fs.existsSync(file)) {
    console.log(`found forbidden file: ${file}`);
    problems += 1;
  }
}

console.log(problems === 0 ? 'check: ok' : `check: ${problems} problem(s)`);
process.exit(problems === 0 ? 0 : 1);
