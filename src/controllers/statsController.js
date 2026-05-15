const statsService = require('../services/statsService');
const asyncHandler = require('../utils/asyncHandler');

const getStats = asyncHandler(async (req, res) => {
  const stats = await statsService.getUserStats(req.user.id);

  res.json({
    success: true,
    data: stats,
  });
});

module.exports = {
  getStats,
};
