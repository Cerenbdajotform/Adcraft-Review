"use strict";

const { readJsonBody, methodNotAllowed, sendError, sendJson } = require("./_lib/http");
const { createError, normalizeItem, replaceDataset } = require("./_lib/store");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    const body = await readJsonBody(req);
    const items = Array.isArray(body.items) ? body.items : [];

    if (!items.length) {
      throw createError(400, "The uploaded dataset did not contain any rows.");
    }

    const normalizedItems = items.map((item, index) => normalizeItem(item, index));
    const savedItems = await replaceDataset(normalizedItems, {
      fileName: body.fileName,
      uploadedBy: body.uploadedBy,
    });

    return sendJson(res, 200, {
      items: savedItems,
      uploadedCount: savedItems.length,
    });
  } catch (error) {
    return sendError(res, error);
  }
};
