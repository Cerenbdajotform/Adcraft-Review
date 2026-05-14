"use strict";

const { loadDashboardState } = require("./_lib/store");
const { methodNotAllowed, sendError, sendJson } = require("./_lib/http");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  try {
    const payload = await loadDashboardState();
    return sendJson(res, 200, payload);
  } catch (error) {
    return sendError(res, error);
  }
};
