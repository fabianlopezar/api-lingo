/**
 * Pruebas unitarias básicas del Sistema Leitner (sin BD).
 * Ejecuta con: node scripts/test-leitner.js
 *
 * Valida saltos entre cajas, caídas a Caja 1 y cálculo de next_review_at.
 */
const assert = require('node:assert/strict');
const {
  BOX_INTERVALS_DAYS,
  computeNextBox,
  computeNextReviewDate,
} = require('../src/services/leitnerService');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 1. Intervalos por caja según especificación.
check('intervalos 1d / 3d / 7d / 14d / 30d', () => {
  assert.deepEqual({ ...BOX_INTERVALS_DAYS }, { 1: 1, 2: 3, 3: 7, 4: 14, 5: 30 });
});

// 2. Aciertos avanzan una caja (1→2→3→4→5).
check('acierto avanza 1→2, 2→3, 3→4, 4→5', () => {
  assert.equal(computeNextBox(1, true), 2);
  assert.equal(computeNextBox(2, true), 3);
  assert.equal(computeNextBox(3, true), 4);
  assert.equal(computeNextBox(4, true), 5);
});

// 3. Acierto en Caja 5 permanece en 5.
check('acierto en caja 5 se queda en 5', () => {
  assert.equal(computeNextBox(5, true), 5);
});

// 4. Fallo desde cualquier caja regresa a Caja 1.
check('fallo regresa a caja 1 desde 2, 3, 4 y 5', () => {
  for (const box of [1, 2, 3, 4, 5]) {
    assert.equal(computeNextBox(box, false), 1);
  }
});

// 5. next_review_at suma los días de la caja destino.
check('next_review_at = base + días de la caja', () => {
  const base = new Date('2026-01-01T00:00:00.000Z');
  const cases = [[1, 1], [2, 3], [3, 7], [4, 14], [5, 30]];
  for (const [box, days] of cases) {
    const expected = new Date(base.getTime());
    expected.setDate(expected.getDate() + days);
    assert.equal(computeNextReviewDate(box, base).toISOString(), expected.toISOString());
  }
});

// 6. Validaciones: caja fuera de rango e isCorrect no booleano fallan con 400.
check('validaciones lanzan error 400', () => {
  assert.throws(() => computeNextBox(0, true), (e) => e.statusCode === 400);
  assert.throws(() => computeNextBox(6, false), (e) => e.statusCode === 400);
  assert.throws(() => computeNextBox(1, 'si'), (e) => e.statusCode === 400);
  assert.throws(() => computeNextReviewDate(9), (e) => e.statusCode === 400);
});

console.log(`\nLeitner: ${passed} pruebas OK`);
