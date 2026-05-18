"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const REVIEW_DECISIONS = new Set([
  "Pending",
  "Pass",
  "Needs Fix",
  "Escalate L2",
]);
const CHECK_VALUES = new Set(["Pending", "Pass", "Fail"]);
const DEFAULT_CHECKS = {
  h1CorrectReview: "Pending",
  metaDescriptionReview: "Pending",
  faqCorrectReview: "Pending",
  fieldRangeReview: "Pending",
  indexedReview: "Pending",
  templateSetupReview: "Pending",
};
const LOCAL_STATE_PATH = path.join(
  process.cwd(),
  "data",
  "review-dashboard-state.json",
);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || "review_dashboard_state";
const SUPABASE_STATE_ROW_ID =
  process.env.SUPABASE_STATE_ROW_ID || "primary";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_OWNER =
  process.env.GITHUB_OWNER || process.env.VERCEL_GIT_REPO_OWNER || "";
const GITHUB_REPO =
  process.env.GITHUB_REPO || process.env.VERCEL_GIT_REPO_SLUG || "";
const GITHUB_BASE_BRANCH = process.env.GITHUB_BASE_BRANCH || "main";
const GITHUB_DATA_BRANCH = process.env.GITHUB_DATA_BRANCH || "review-data";
const GITHUB_STATE_PATH =
  process.env.GITHUB_STATE_PATH || "data/review-dashboard-state.json";
const GITHUB_API_BASE = "https://api.github.com";

function hasSupabaseStore() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function hasGitHubStore() {
  return Boolean(GITHUB_TOKEN && GITHUB_OWNER && GITHUB_REPO);
}

function createError(statusCode, publicMessage, debugMessage) {
  const error = new Error(debugMessage || publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}

function coerceText(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function normalizeCheckValue(value) {
  return CHECK_VALUES.has(value) ? value : "Pending";
}

function normalizeChecks(checks) {
  return {
    h1CorrectReview: normalizeCheckValue(
      checks?.h1CorrectReview ?? checks?.h1EndsWithForm,
    ),
    metaDescriptionReview: normalizeCheckValue(
      checks?.metaDescriptionReview,
    ),
    faqCorrectReview: normalizeCheckValue(
      checks?.faqCorrectReview ?? checks?.faqReview,
    ),
    fieldRangeReview: normalizeCheckValue(
      checks?.fieldRangeReview ?? checks?.fieldCountReview,
    ),
    indexedReview: normalizeCheckValue(checks?.indexedReview),
    templateSetupReview: normalizeCheckValue(
      checks?.templateSetupReview ?? checks?.formUseCaseReview,
    ),
  };
}

function normalizeReviewDecision(value) {
  return REVIEW_DECISIONS.has(value) ? value : "Pending";
}

function normalizeReviewStatus(status, reviewDecision) {
  if (status === "Reviewed" || reviewDecision !== "Pending") {
    return "Reviewed";
  }

  return "Pending";
}

function normalizeItem(item = {}, index = 0) {
  const title = coerceText(item.title);
  const templateUrl = coerceText(item.templateUrl);
  const templateId = coerceText(item.templateId);
  const reviewDecision = normalizeReviewDecision(item.reviewDecision);

  return {
    id:
      coerceText(item.id) ||
      templateId ||
      templateUrl ||
      `${title || "template"}-${index}`,
    templateId,
    templateUrl,
    title,
    originalTemplateUrl: coerceText(item.originalTemplateUrl),
    formId: coerceText(item.formId),
    sourceForm: coerceText(item.sourceForm),
    useCase: coerceText(item.useCase),
    keyword: coerceText(item.keyword),
    generatedDate: coerceText(item.generatedDate),
    campaignName: coerceText(item.campaignName),
    displayCampaign: coerceText(item.displayCampaign),
    priority: coerceText(item.priority),
    reviewStatus: normalizeReviewStatus(item.reviewStatus, reviewDecision),
    reviewDecision,
    reviewer: coerceText(item.reviewer),
    reviewedAt: coerceText(item.reviewedAt),
    reviewNotes: coerceText(item.reviewNotes),
    checks: normalizeChecks({
      ...DEFAULT_CHECKS,
      ...(item.checks || {}),
    }),
  };
}

function normalizeState(rawState) {
  const sourceItems = Array.isArray(rawState)
    ? rawState
    : Array.isArray(rawState?.items)
      ? rawState.items
      : [];

  return {
    version: 1,
    updatedAt: coerceText(rawState?.updatedAt),
    updatedBy: coerceText(rawState?.updatedBy),
    sourceFileName: coerceText(rawState?.sourceFileName),
    items: sourceItems.map((item, index) => normalizeItem(item, index)),
  };
}

function mergeUploadedWithExisting(uploadedItem, existingItem) {
  if (!existingItem) {
    return normalizeItem(uploadedItem);
  }

  const uploadedChecks = normalizeChecks(uploadedItem.checks || {});
  const uploadedHasReviewOverride =
    coerceText(uploadedItem.reviewer) ||
    coerceText(uploadedItem.reviewedAt) ||
    coerceText(uploadedItem.reviewNotes) ||
    coerceText(uploadedItem.priority) ||
    uploadedItem.reviewDecision === "Pass" ||
    uploadedItem.reviewDecision === "Needs Fix" ||
    uploadedItem.reviewDecision === "Escalate L2" ||
    Object.values(uploadedChecks).some((value) => value !== "Pending");

  const baseReview = uploadedHasReviewOverride ? uploadedItem : existingItem;
  const baseChecks = uploadedHasReviewOverride
    ? uploadedChecks
    : existingItem.checks || DEFAULT_CHECKS;

  return normalizeItem({
    ...existingItem,
    ...uploadedItem,
    reviewStatus: baseReview.reviewStatus,
    reviewDecision: baseReview.reviewDecision,
    reviewer: baseReview.reviewer,
    reviewedAt: baseReview.reviewedAt,
    reviewNotes: baseReview.reviewNotes,
    priority: baseReview.priority,
    checks: {
      ...DEFAULT_CHECKS,
      ...baseChecks,
    },
  });
}

function buildStateResponse(state, details = {}) {
  return {
    canWrite: details.mode === "shared",
    dataBranch: details.dataBranch || "",
    items: state.items,
    mode: details.mode || "local",
    provider: details.provider || "local",
    providerLabel: details.providerLabel || "Local",
    repo: details.repo || "",
    sourceFileName: state.sourceFileName || details.sourceFileName || "",
    updatedAt: state.updatedAt || details.updatedAt || "",
    updatedBy: state.updatedBy || details.updatedBy || "",
    workspace: details.workspace || "",
  };
}

async function readLocalState() {
  const raw = await fs.readFile(LOCAL_STATE_PATH, "utf8");
  return normalizeState(JSON.parse(raw));
}

function getGitHubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "adcraft-review-dashboard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getGitHubHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = new Error(`GitHub request failed with ${response.status}`);
    error.statusCode = response.status;
    error.responseText = await response.text();
    throw error;
  }

  return response.json();
}

function getRepoContentUrl(filePath, branch) {
  const safePath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(
    GITHUB_OWNER,
  )}/${encodeURIComponent(
    GITHUB_REPO,
  )}/contents/${safePath}?ref=${encodeURIComponent(branch)}`;
}

async function fetchRemoteState(branch) {
  try {
    const payload = await githubJson(getRepoContentUrl(GITHUB_STATE_PATH, branch));
    const content = Buffer.from(payload.content, "base64").toString("utf8");
    return {
      branch,
      sha: payload.sha,
      state: normalizeState(JSON.parse(content)),
    };
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }

    throw error;
  }
}

async function fetchBranchSha(branch) {
  try {
    const payload = await githubJson(
      `${GITHUB_API_BASE}/repos/${encodeURIComponent(
        GITHUB_OWNER,
      )}/${encodeURIComponent(
        GITHUB_REPO,
      )}/git/ref/heads/${encodeURIComponent(branch)}`,
    );

    return payload.object.sha;
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }

    throw error;
  }
}

async function ensureDataBranch() {
  const existingSha = await fetchBranchSha(GITHUB_DATA_BRANCH);

  if (existingSha) {
    return existingSha;
  }

  const baseSha = await fetchBranchSha(GITHUB_BASE_BRANCH);

  if (!baseSha) {
    throw createError(
      500,
      "Could not find the GitHub base branch for shared storage.",
    );
  }

  await githubJson(
    `${GITHUB_API_BASE}/repos/${encodeURIComponent(
      GITHUB_OWNER,
    )}/${encodeURIComponent(GITHUB_REPO)}/git/refs`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${GITHUB_DATA_BRANCH}`,
        sha: baseSha,
      }),
    },
  );

  return baseSha;
}

async function writeRemoteState(nextState, sha, message) {
  const body = {
    branch: GITHUB_DATA_BRANCH,
    content: Buffer.from(
      `${JSON.stringify(normalizeState(nextState), null, 2)}\n`,
      "utf8",
    ).toString("base64"),
    message,
  };

  if (sha) {
    body.sha = sha;
  }

  return githubJson(getRepoContentUrl(GITHUB_STATE_PATH, GITHUB_DATA_BRANCH), {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

function getSupabaseHeaders(additionalHeaders = {}) {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    ...additionalHeaders,
  };
}

async function supabaseJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: getSupabaseHeaders(options.headers || {}),
  });

  if (!response.ok) {
    const error = new Error(`Supabase request failed with ${response.status}`);
    error.statusCode = response.status;
    error.responseText = await response.text();
    throw error;
  }

  return response.status === 204 ? null : response.json();
}

function buildSupabaseUrl(params = {}) {
  const url = new URL(`/rest/v1/${SUPABASE_TABLE}`, SUPABASE_URL);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

async function fetchSupabaseState() {
  try {
    const rows = await supabaseJson(
      buildSupabaseUrl({
        id: `eq.${SUPABASE_STATE_ROW_ID}`,
        select: "id,state,updated_at,updated_by,source_file_name",
      }),
    );

    if (!rows?.length) {
      return null;
    }

    const row = rows[0];

    return {
      state: normalizeState({
        ...(row.state || {}),
        sourceFileName: row.source_file_name || row.state?.sourceFileName,
        updatedAt: row.updated_at || row.state?.updatedAt,
        updatedBy: row.updated_by || row.state?.updatedBy,
      }),
      workspace: SUPABASE_URL,
    };
  } catch (error) {
    throw error;
  }
}

async function writeSupabaseState(nextState) {
  const rows = await supabaseJson(
    buildSupabaseUrl({
      on_conflict: "id",
      select: "id,state,updated_at,updated_by,source_file_name",
    }),
    {
      body: JSON.stringify([
        {
          id: SUPABASE_STATE_ROW_ID,
          source_file_name: nextState.sourceFileName || "",
          state: normalizeState(nextState),
          updated_at: nextState.updatedAt || new Date().toISOString(),
          updated_by: nextState.updatedBy || "",
        },
      ]),
      headers: {
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      method: "POST",
    },
  );

  const row = rows?.[0];

  return normalizeState({
    ...(row?.state || nextState),
    sourceFileName: row?.source_file_name || nextState.sourceFileName,
    updatedAt: row?.updated_at || nextState.updatedAt,
    updatedBy: row?.updated_by || nextState.updatedBy,
  });
}

async function loadDashboardState() {
  if (hasSupabaseStore()) {
    const supabaseState = await fetchSupabaseState();

    if (supabaseState) {
      return buildStateResponse(supabaseState.state, {
        mode: "shared",
        provider: "supabase",
        providerLabel: "Supabase",
        workspace: SUPABASE_URL,
      });
    }

    return buildStateResponse(await readLocalState(), {
      mode: "shared",
      provider: "supabase",
      providerLabel: "Supabase",
      workspace: SUPABASE_URL,
    });
  }

  if (hasGitHubStore()) {
    const remoteState =
      (await fetchRemoteState(GITHUB_DATA_BRANCH)) ||
      (await fetchRemoteState(GITHUB_BASE_BRANCH));

    if (!remoteState) {
      return buildStateResponse(await readLocalState(), {
        mode: "shared",
        provider: "github",
        providerLabel: "GitHub",
        dataBranch: GITHUB_DATA_BRANCH,
        repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
      });
    }

    return buildStateResponse(remoteState.state, {
      mode: "shared",
      provider: "github",
      providerLabel: "GitHub",
      dataBranch: GITHUB_DATA_BRANCH,
      repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    });
  }

  return buildStateResponse(await readLocalState(), {
    mode: "local",
    provider: "local",
    providerLabel: "Local",
  });
}

async function mutateGitHubState(message, mutator) {
  await ensureDataBranch();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current =
      (await fetchRemoteState(GITHUB_DATA_BRANCH)) ||
      (await fetchRemoteState(GITHUB_BASE_BRANCH)) || {
        sha: null,
        state: await readLocalState(),
      };

    const nextState = normalizeState(await mutator(current.state));
    nextState.updatedAt = new Date().toISOString();

    try {
      await writeRemoteState(nextState, current.sha, message);
      return nextState;
    } catch (error) {
      if (error.statusCode === 409 || error.statusCode === 422) {
        continue;
      }

      throw error;
    }
  }

  throw createError(
    409,
    "The shared review file changed while saving. Please try again.",
  );
}

async function mutateSupabaseState(mutator) {
  const current = (await fetchSupabaseState()) || {
    state: await readLocalState(),
  };
  const nextState = normalizeState(await mutator(current.state));
  nextState.updatedAt = new Date().toISOString();
  return writeSupabaseState(nextState);
}

async function saveReview(itemId, reviewPatch) {
  if (!hasSupabaseStore() && !hasGitHubStore()) {
    throw createError(
      503,
      "Shared storage is not configured yet. Add either Supabase or GitHub environment variables in Vercel first.",
    );
  }

  const mutate = async (currentState) => {
    const state = normalizeState(currentState);
    const itemIndex = state.items.findIndex((item) => item.id === itemId);

    if (itemIndex === -1) {
      throw createError(404, "Could not find the template to review.");
    }

    const currentItem = state.items[itemIndex];
    const reviewDecision = normalizeReviewDecision(reviewPatch.reviewDecision);
    const hasChecksPatch = reviewPatch.checks && typeof reviewPatch.checks === "object";
    const hasPriorityPatch = Object.hasOwn(reviewPatch, "priority");
    const hasReviewNotesPatch = Object.hasOwn(reviewPatch, "reviewNotes");

    state.items[itemIndex] = normalizeItem({
      ...currentItem,
      priority: hasPriorityPatch
        ? coerceText(reviewPatch.priority)
        : currentItem.priority,
      reviewDecision,
      reviewNotes: hasReviewNotesPatch
        ? coerceText(reviewPatch.reviewNotes)
        : currentItem.reviewNotes,
      reviewedAt:
        coerceText(reviewPatch.reviewedAt) || new Date().toISOString(),
      reviewer: coerceText(reviewPatch.reviewer),
      reviewStatus: normalizeReviewStatus(
        reviewPatch.reviewStatus,
        reviewDecision,
      ),
      checks: hasChecksPatch
        ? {
            ...currentItem.checks,
            ...normalizeChecks(reviewPatch.checks || {}),
          }
        : currentItem.checks,
    });
    state.updatedBy = coerceText(reviewPatch.reviewer);

    return state;
  };

  const nextState = hasSupabaseStore()
    ? await mutateSupabaseState(mutate)
    : await mutateGitHubState(`Save review for ${itemId}`, mutate);

  return nextState.items.find((item) => item.id === itemId);
}

async function replaceDataset(items, options = {}) {
  if (!hasSupabaseStore() && !hasGitHubStore()) {
    throw createError(
      503,
      "Shared storage is not configured yet. Add either Supabase or GitHub environment variables in Vercel first.",
    );
  }

  const mutate = async (currentState) => {
    const current = normalizeState(currentState);
    const existingById = new Map(current.items.map((item) => [item.id, item]));

    const mergedItems = items.map((item, index) => {
      const normalizedItem = normalizeItem(item, index);
      return mergeUploadedWithExisting(
        normalizedItem,
        existingById.get(normalizedItem.id),
      );
    });

    return {
      ...current,
      items: mergedItems,
      sourceFileName: coerceText(options.fileName),
      updatedBy: coerceText(options.uploadedBy),
    };
  };

  const nextState = hasSupabaseStore()
    ? await mutateSupabaseState(mutate)
    : await mutateGitHubState(
        `Upload dataset ${options.fileName || new Date().toISOString()}`,
        mutate,
      );

  return nextState.items;
}

module.exports = {
  DEFAULT_CHECKS,
  buildStateResponse,
  createError,
  hasGitHubStore,
  hasSupabaseStore,
  loadDashboardState,
  normalizeItem,
  replaceDataset,
  saveReview,
};
