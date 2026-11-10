import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordingDateJst, recordingPrefix } from './recording-path.js';

test('recording date switches at midnight in Japan, rather than midnight UTC', () => {
  assert.equal(recordingDateJst(new Date('2026-11-10T14:59:59.999Z')), '20261110');
  assert.equal(recordingDateJst(new Date('2026-11-10T15:00:00.000Z')), '20261111');
  assert.equal(recordingDateJst(new Date('2026-12-31T15:00:00.000Z')), '20270101');
});

test('prefix contains only date and sanitized room, and stays fixed after start', () => {
  const prefix = recordingPrefix('room-ab12-cd34', new Date('2026-11-10T14:59:59Z'));
  assert.deepEqual(prefix, ['20261110', 'roomab12cd34']);
  const next = recordingPrefix('room-ab12-cd34', new Date('2026-11-10T15:00:00Z'));
  assert.deepEqual(next, ['20261111', 'roomab12cd34']);
  assert.deepEqual(prefix, ['20261110', 'roomab12cd34']);
  assert.deepEqual(recordingPrefix('---', new Date('2026-11-10T00:00:00Z')), ['20261110', 'room']);
});
