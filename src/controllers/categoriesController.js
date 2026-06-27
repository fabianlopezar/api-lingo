const categoriesService = require('../services/categoriesService');
const asyncHandler = require('../utils/asyncHandler');

const getCategories = asyncHandler(async (req, res) => {
  const data = await categoriesService.getAllCategories(req.user.id);
  res.json({ success: true, data });
});

const getCategory = asyncHandler(async (req, res) => {
  const category = await categoriesService.getCategoryById(req.user.id, req.params.id);
  res.json({ success: true, data: category });
});

const createCategory = asyncHandler(async (req, res) => {
  const { nombre_categoria, name, calificacion_categoria, rating } = req.body;
  const category = await categoriesService.createCategory(req.user.id, {
    nombre_categoria,
    name,
    calificacion_categoria,
    rating,
  });

  res.status(201).json({
    success: true,
    message: 'Categoría creada correctamente',
    data: category,
  });
});

const updateCategory = asyncHandler(async (req, res) => {
  const { nombre_categoria, name, calificacion_categoria, rating } = req.body;
  const category = await categoriesService.updateCategory(req.user.id, req.params.id, {
    nombre_categoria,
    name,
    calificacion_categoria,
    rating,
  });

  res.json({
    success: true,
    message: 'Categoría actualizada correctamente',
    data: category,
  });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const result = await categoriesService.deleteCategory(req.user.id, req.params.id);

  res.json({
    success: true,
    message: 'Categoría eliminada. Las palabras asociadas quedaron sin categoría.',
    data: result,
  });
});

module.exports = {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
};
