import assert from 'node:assert/strict';
import { createDemoFolio, findIncidentStatus, findSectorService, chatbotReadiness } from '../shared/citizen-portal.js';

assert.equal(createDemoFolio(7), 'SW-FOLIO-3007');
assert.equal(findSectorService('centro').pickupDay, 'Lunes y jueves');
assert.equal(findIncidentStatus('SW-FOLIO-1001').status, 'En revisión');
assert.ok(chatbotReadiness.intentSources.includes('estado_folio'));
console.log('citizen-portal ok');
