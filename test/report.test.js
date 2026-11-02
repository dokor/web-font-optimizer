import assert from 'node:assert/strict';
import test from 'node:test';
import { exampleReport } from 'web-font-optimizer/examples/report-v1';

test('the typed v1 example survives JSON transport and links advice to its evidence', () => {
  const report = JSON.parse(JSON.stringify(exampleReport));
  assert.deepEqual(report, exampleReport);
  assert.equal(report.version, 1);
  const [usage] = report.inventory.observations;
  const [diagnostic] = report.diagnostics;
  assert.equal(usage.family, 'Atlas');
  assert.deepEqual(diagnostic.locations, [usage.location]);
  assert.equal(diagnostic.ruleId, 'undeclared-family');
  assert.equal(diagnostic.severity, 'warning');
  assert.equal(diagnostic.confidence, 'possible');
  assert.ok(diagnostic.advice.trim());
});
