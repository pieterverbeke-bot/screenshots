#!/usr/bin/env node

import { startMonitoring } from './scheduler.js';

console.log('='.repeat(50));
console.log('  Website Screenshot Monitor');
console.log('='.repeat(50));
console.log('');

startMonitoring().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
