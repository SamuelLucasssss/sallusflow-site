import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function scenario(name) {
  const child=spawnSync(process.execPath,[
    '--import','./tests/fixtures/imec-uti-fake-fetch.mjs',
    'scripts/imec-uti-monitor-runner.mjs'
  ],{
    cwd:process.cwd(),
    env:{
      ...process.env,
      MONITOR_TEST_SCENARIO:name,
      GITHUB_TOKEN:'test-only-token',
      GITHUB_REPOSITORY:'SamuelLucasssss/sallusflow-site',
      GITHUB_STEP_SUMMARY:''
    },
    encoding:'utf8',
    timeout:20000
  });
  if(child.error)throw child.error;
  return child;
}

test('healthy endpoint: no incident created',()=>{
  const run=scenario('healthy');
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/Public monitoring: healthy; endpoints=6; failures=0/);
  assert.match(run.stdout,/No open incident/);
  assert.doesNotMatch(run.stdout,/Incident opened/);
});

test('persistent public outage: one incident is created, monitoring run fails',()=>{
  const run=scenario('down');
  assert.equal(run.status,1,run.stderr);
  assert.match(run.stdout,/Public monitoring: FAILED; endpoints=6; failures=1/);
  assert.match(run.stdout,/Incident opened: #42/);
});

test('outage with existing incident: no duplicate issue',()=>{
  const run=scenario('existing');
  assert.equal(run.status,1,run.stderr);
  assert.match(run.stdout,/Existing incident remains open/);
  assert.doesNotMatch(run.stdout,/Incident opened/);
});

test('recovered service: existing incident is resolved',()=>{
  const run=scenario('recovered');
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/Public monitoring: healthy; endpoints=6; failures=0/);
  assert.match(run.stdout,/Incident resolved: #42/);
});
