"use strict";

const { readJsonBody, methodNotAllowed, sendError, sendJson } = require("./_lib/http");
const { createError, saveReview } = require("./_lib/store");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    const body = await readJsonBody(req);
    const itemId = body.itemId || body.id;

    if (!itemId) {
      throw createError(400, "Missing template id for the review save.");
    }

    const savedItem = await saveReview(itemId, body.review || body);

    return sendJson(res, 200, {
      item: savedItem,
      savedAt: savedItem.reviewedAt,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
