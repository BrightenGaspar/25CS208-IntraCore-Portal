'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApp } = require('../server');

test('wellness API persists and validates app state', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitalcore-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const server = createApp({ dbFile: path.join(tempDir, 'db.json') }).listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const future = new Date();
  future.setDate(future.getDate() + 1);
  const testDate = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;

  const request = (url, options) => fetch(`${baseUrl}${url}`, options);
  const initialResponse = await request('/api/state');
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.profile.name, 'Alex Morgan');
  assert.equal(initial.weightLogs.length, 5);
  assert.deepEqual(initial.mealProofs, []);

  const syncResponse = await request('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initial)
  });
  assert.equal(syncResponse.status, 200);

  const profileResponse = await request('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...initial.profile, name: 'Jordan Lee', extra: 'ignored' })
  });
  assert.equal(profileResponse.status, 200);
  assert.equal((await profileResponse.json()).profile.name, 'Jordan Lee');

  const invalidProfileResponse = await request('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...initial.profile, age: 8 })
  });
  assert.equal(invalidProfileResponse.status, 400);

  const weightResponse = await request('/api/weights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: testDate, weight: 73.25, note: 'test entry' })
  });
  assert.equal(weightResponse.status, 201);
  const savedWeight = await weightResponse.json();
  assert.equal(savedWeight.entry.weight, 73.3);
  assert.equal(savedWeight.state.profile.weight, 73.3);

  const badWeightResponse = await request('/api/weights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: '2026-02-30', weight: 70 })
  });
  assert.equal(badWeightResponse.status, 400);

  const taskResponse = await request('/api/tasks', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'blk_wake', date: testDate, completed: true })
  });
  assert.equal(taskResponse.status, 200);
  assert.equal((await taskResponse.json()).completedTasks[testDate].blk_wake, true);

  const resetResponse = await request(`/api/tasks/${testDate}`, { method: 'DELETE' });
  assert.equal(resetResponse.status, 200);
  assert.equal((await resetResponse.json()).completedTasks[testDate], undefined);

  const deleteResponse = await request(`/api/weights/${savedWeight.entry.id}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await deleteResponse.json()).state.weightLogs.length, 5);

  const imageForm = new FormData();
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=',
    'base64'
  );
  imageForm.append('mealPhoto', new Blob([onePixelPng], { type: 'image/png' }), 'meal.png');
  imageForm.append('mealName', 'Lunch');
  imageForm.append('date', testDate);
  const photoResponse = await request('/api/meals/verify-photo', {
    method: 'POST',
    body: imageForm
  });
  assert.equal(photoResponse.status, 201);
  const photoResult = await photoResponse.json();
  assert.equal(photoResult.record.mealName, 'Lunch');
  assert.equal(photoResult.record.status, 'review');
  assert.match(photoResult.note, /cannot prove/);

  const persistedResponse = await request('/api/state');
  const persisted = await persistedResponse.json();
  assert.equal(persisted.profile.name, 'Jordan Lee');
  assert.equal(persisted.mealProofs.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.mealProofs[0], 'image'), false);

  const invalidPhotoForm = new FormData();
  invalidPhotoForm.append('mealPhoto', new Blob(['not an image'], { type: 'text/plain' }), 'meal.txt');
  invalidPhotoForm.append('mealName', 'Lunch');
  const invalidPhotoResponse = await request('/api/meals/verify-photo', {
    method: 'POST',
    body: invalidPhotoForm
  });
  assert.equal(invalidPhotoResponse.status, 415);

  const htmlResponse = await request('/');
  assert.equal(htmlResponse.status, 200);
  assert.match(await htmlResponse.text(), /VitalCore/);
});
