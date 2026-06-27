const { query } = require('../config/db');
const AppError = require('../utils/AppError');
const { formatCategory } = require('../utils/mappers');
const { validateRequiredString, validateUuid } = require('../utils/validators');

async function assertUserOwnsCategory(userId, categoryId) {
  const validUserId = validateUuid(userId, 'user id');
  const validCategoryId = validateUuid(categoryId, 'category id');

  const result = await query(
    'SELECT id FROM categories WHERE id = $1 AND user_id = $2',
    [validCategoryId, validUserId]
  );

  if (result.rows.length === 0) {
    throw new AppError('La categoría no existe o no te pertenece', 404);
  }

  return validCategoryId;
}

async function resolveCategoryId(userId, categoryId) {
  if (categoryId === null || categoryId === undefined || categoryId === '') {
    return null;
  }
  return assertUserOwnsCategory(userId, categoryId);
}

async function getAllCategories(userId) {
  const validUserId = validateUuid(userId, 'user id');

  const result = await query(
    `SELECT
       c.id,
       c.nombre_categoria,
       c.calificacion_categoria,
       c.created_at,
       COUNT(w.id)::int AS word_count
     FROM categories c
     LEFT JOIN words w ON w.category_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id
     ORDER BY c.nombre_categoria ASC`,
    [validUserId]
  );

  return {
    categories: result.rows.map(formatCategory),
    total: result.rows.length,
  };
}

async function getCategoryById(userId, categoryId) {
  await assertUserOwnsCategory(userId, categoryId);

  const result = await query(
    `SELECT
       c.id,
       c.nombre_categoria,
       c.calificacion_categoria,
       c.created_at,
       COUNT(w.id)::int AS word_count
     FROM categories c
     LEFT JOIN words w ON w.category_id = c.id
     WHERE c.id = $1
     GROUP BY c.id`,
    [categoryId]
  );

  return formatCategory(result.rows[0]);
}

async function createCategory(userId, { nombre_categoria, name, calificacion_categoria, rating }) {
  const validUserId = validateUuid(userId, 'user id');
  const categoryName = validateRequiredString(nombre_categoria || name, 'nombre_categoria');
  const categoryRating = parseInt(calificacion_categoria ?? rating ?? 0, 10) || 0;

  const result = await query(
    `INSERT INTO categories (nombre_categoria, calificacion_categoria, user_id)
     VALUES ($1, $2, $3)
     RETURNING id, nombre_categoria, calificacion_categoria, created_at`,
    [categoryName, categoryRating, validUserId]
  );

  return { ...formatCategory(result.rows[0]), wordCount: 0 };
}

async function updateCategory(userId, categoryId, { nombre_categoria, name, calificacion_categoria, rating }) {
  await assertUserOwnsCategory(userId, categoryId);

  const categoryName = validateRequiredString(nombre_categoria || name, 'nombre_categoria');
  const categoryRating = parseInt(calificacion_categoria ?? rating ?? 0, 10) || 0;

  const result = await query(
    `UPDATE categories
     SET nombre_categoria = $1, calificacion_categoria = $2
     WHERE id = $3
     RETURNING id, nombre_categoria, calificacion_categoria, created_at`,
    [categoryName, categoryRating, categoryId]
  );

  const countResult = await query(
    'SELECT COUNT(*)::int AS total FROM words WHERE category_id = $1',
    [categoryId]
  );

  return { ...formatCategory(result.rows[0]), wordCount: countResult.rows[0].total };
}

async function deleteCategory(userId, categoryId) {
  await assertUserOwnsCategory(userId, categoryId);

  await query('UPDATE words SET category_id = NULL WHERE category_id = $1', [categoryId]);

  await query('DELETE FROM categories WHERE id = $1', [categoryId]);

  return { deleted: true, wordsUncategorized: true };
}

module.exports = {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  resolveCategoryId,
  assertUserOwnsCategory,
};
