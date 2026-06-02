#!/usr/bin/env node
'use strict';
const { main } = require('../dist/index.js');
main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
