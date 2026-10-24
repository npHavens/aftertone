import assert from 'node:assert/strict';
import test from 'node:test';
import {
  definitiveRejection,
  readPendingPublish,
  readPlaylistOperation,
} from '../lib/publish-recovery.ts';

const saved = {
  scope: 'spotify:session-one',
  key: 'original-idempotency-key',
  body: JSON.stringify({ name: 'A favorite mix', trackIds: ['one', 'two'] }),
  operation: null,
};

test('unknown publish survives reload with exactly the original key and payload', () => {
  assert.deepEqual(readPendingPublish(JSON.stringify(saved), saved.scope), saved);
});

test('recovery does not cross account sessions or providers', () => {
  assert.equal(readPendingPublish(JSON.stringify(saved), 'spotify:session-two'), null);
  assert.equal(readPendingPublish(JSON.stringify(saved), 'apple-music:session-one'), null);
});

test('known processing operation survives reload for read-only polling', () => {
  const pending = { ...saved, operation: { id: 'op-1', status: 'processing', addedCount: 2 } };
  assert.deepEqual(readPendingPublish(JSON.stringify(pending), saved.scope), pending);
});

test('malformed persisted requests are not sent to the provider', () => {
  for (const raw of ['invalid', 'null', '{}', JSON.stringify({ ...saved, body: '{}' })]) {
    assert.equal(readPendingPublish(raw, saved.scope), null);
  }
});

test('only definitive first-request client rejections unlock a draft', () => {
  for (const status of [400, 401, 403, 404, 422, 429])
    assert.equal(definitiveRejection(status, false), true);
  for (const status of [408, 409, 410, 500, 502, 503])
    assert.equal(definitiveRejection(status, false), false);
});

test('a rejected replay never clears a previously ambiguous publish', () => {
  for (const status of [400, 401, 403, 404, 408, 409, 410, 422, 429, 500])
    assert.equal(definitiveRejection(status, true), false);
});

test('a malformed stored result preserves its frozen request for safe recovery', () => {
  const malformed = { ...saved, operation: { id: 'op-1', status: 'invented' } };
  assert.deepEqual(readPendingPublish(JSON.stringify(malformed), saved.scope), saved);
});

test('unreadable success responses are not accepted as a confirmed operation', () => {
  for (const value of [
    null,
    {},
    { id: 'op-1', status: 'completed' },
    { id: 'op-1', status: 'completed', addedCount: -1 },
    { id: 'op-1', status: 'completed', addedCount: 2, playlistUrl: {} },
  ]) {
    assert.equal(readPlaylistOperation(value), null);
  }
  const operation = { id: 'op-1', status: 'completed', addedCount: 2 };
  assert.deepEqual(readPlaylistOperation(operation), operation);
});
