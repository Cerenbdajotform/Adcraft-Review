"use strict";

function sendJson(res, statusCode, payload) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(statusCode).send(JSON.stringify(payload));
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();

  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody);
}

function sendError(res, error) {
  const statusCode = error.statusCode || error.status || 500;
  sendJson(res, statusCode, {
    error: error.publicMessage || error.message || "Unexpected error.",
  });
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader("Allow", allowedMethods.join(", "));
  sendJson(res, 405, { error: "Method not allowed." });
}

module.exports = {
  methodNotAllowed,
  readJsonBody,
  sendError,
  sendJson,
};
