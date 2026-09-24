const test = require('node:test');
const assert = require('node:assert/strict');
const { advisoryChecks } = require('../src/services/documentValidationService');

const student = { first_name: 'Jamie', last_name: 'Garcia' };

test('report card OCR checks linked name, possible school text, and apparent grade entries as suggestions', () => {
  const checks = advisoryChecks('report_card', 'JAMIE GARCIA\nOther Academy\nMathematics 150\nScience B+', student);
  assert.deepEqual(checks.map(({ key, found }) => [key, found]), [
    ['linked_student_name', true],
    ['possible_school_name', true],
    ['apparent_grade_entries', true]
  ]);
  assert.deepEqual(checks[1].candidates, ['Other Academy']);
  assert.deepEqual(checks[2].candidates, ['Mathematics 150', 'Science B+']);
  assert.equal(checks[2].label, 'Apparent grade entries');
});

test('Good Moral and PSA checks are limited to their leader-directed advisory clues', () => {
  const goodMoral = advisoryChecks('good_moral', 'Jamie M. Garcia\nNo institution text\nMathematics 100', student);
  assert.deepEqual(goodMoral.map(({ key }) => key), ['linked_student_name', 'possible_school_name']);
  assert.equal(goodMoral[1].found, false);
  assert.deepEqual(goodMoral[1].candidates, []);

  const psa = advisoryChecks('psa_birth_certificate', 'Jamie Garcia\nCity Civil Registry', student);
  assert.deepEqual(psa.map(({ key, found }) => [key, found]), [['linked_student_name', true]]);
});

test('candidate lines are capped and bounded before staff views render them', () => {
  const longLine = `Private School ${'x'.repeat(500)}`;
  const checks = advisoryChecks('report_card', `Jamie Garcia\n${longLine}\nAnother College\nThird Institute\nFourth Academy\nMathematics 150`, student);
  assert.equal(checks[1].candidates.length, 3);
  assert.ok(checks[1].candidates.every((candidate) => candidate.length <= 200));
  assert.equal(checks[2].candidates.length, 1);
});
