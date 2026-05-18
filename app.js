const LOCAL_STORAGE_KEY = "adcraft-review-dashboard-state-v2";
const PREFERENCES_KEY = "adcraft-review-dashboard-preferences-v1";
const API_ENDPOINTS = {
  data: "/api/data",
  dataset: "/api/dataset",
  reviews: "/api/reviews",
  aiReview: "/api/ai-review",
};
const SHARED_DASHBOARD_ORIGIN = "https://adcraft-review-ceren.vercel.app";
const L2_TICKET_URL =
  "https://support.jotform.com/admn/dashboards/l2-tickets/create/";
const DEFAULT_ASSIGNEE = "Ceren";
const ASSIGNEE_OPTIONS = ["Ceren", "Batuhan", "Buğçe", "Mehmet"];

const DEFAULT_CHECKS = {
  h1CorrectReview: "Pending",
  metaDescriptionReview: "Pending",
  faqCorrectReview: "Pending",
  fieldRangeReview: "Pending",
  indexedReview: "Pending",
  templateSetupReview: "Pending",
};

function normalizeCheckValue(value) {
  return ["Pending", "Pass", "Fail"].includes(value) ? value : "Pending";
}

function normalizeChecks(checks = {}) {
  return {
    h1CorrectReview: normalizeCheckValue(
      checks.h1CorrectReview ?? checks.h1EndsWithForm,
    ),
    metaDescriptionReview: normalizeCheckValue(checks.metaDescriptionReview),
    faqCorrectReview: normalizeCheckValue(
      checks.faqCorrectReview ?? checks.faqReview,
    ),
    fieldRangeReview: normalizeCheckValue(
      checks.fieldRangeReview ?? checks.fieldCountReview,
    ),
    indexedReview: normalizeCheckValue(checks.indexedReview),
    templateSetupReview: normalizeCheckValue(
      checks.templateSetupReview ?? checks.formUseCaseReview,
    ),
  };
}

const elements = {
  summaryGrid: document.getElementById("summary-grid"),
  queueCount: document.getElementById("queue-count"),
  queueList: document.getElementById("queue-list"),
  searchFilter: document.getElementById("search-filter"),
  statusFilter: document.getElementById("status-filter"),
  campaignFilter: document.getElementById("campaign-filter"),
  dateFromFilter: document.getElementById("date-from-filter"),
  dateToFilter: document.getElementById("date-to-filter"),
  emptyState: document.getElementById("empty-state"),
  detailView: document.getElementById("detail-view"),
  detailCampaign: document.getElementById("detail-campaign"),
  detailTitle: document.getElementById("detail-title"),
  detailMeta: document.getElementById("detail-meta"),
  templateFacts: document.getElementById("template-facts"),
  templateFrame: document.getElementById("template-frame"),
  openTemplate: document.getElementById("open-template"),
  openOriginalTemplate: document.getElementById("open-original-template"),
  openL2Ticket: document.getElementById("open-l2-ticket"),
  nextTemplate: document.getElementById("next-template"),
  reviewerName: document.getElementById("reviewer-name"),
  reviewDecision: document.getElementById("review-decision"),
  markReviewed: document.getElementById("mark-reviewed"),
  refreshAiReview: document.getElementById("refresh-ai-review"),
  aiReviewSummary: document.getElementById("ai-review-summary"),
  aiReviewSummaryMeta: document.getElementById("ai-review-summary-meta"),
  savedReviewRecord: document.getElementById("saved-review-record"),
  upload: document.getElementById("dataset-upload"),
  uploadLabel: document.getElementById("upload-label"),
  exportReviews: document.getElementById("export-reviews"),
  resetLocal: document.getElementById("reset-local"),
  syncCard: document.getElementById("sync-card"),
  syncMode: document.getElementById("sync-mode"),
  syncDetail: document.getElementById("sync-detail"),
};

const state = {
  allItems: [],
  filteredItems: [],
  selectedId: null,
  filters: {
    search: "",
    status: "all",
    campaign: "all",
    dateFrom: "all",
    dateTo: "all",
  },
  sync: {
    mode: "loading",
    canWrite: false,
    provider: "local",
    providerLabel: "Local",
    repo: "",
    dataBranch: "",
    updatedAt: "",
    updatedBy: "",
    sourceFileName: "",
    workspace: "",
    statusMessage: "Checking shared review storage…",
    tone: "loading",
  },
  preferences: {
    reviewerName: DEFAULT_ASSIGNEE,
  },
  aiReview: {
    cache: {},
  },
  reviewActionBusy: false,
};

async function boot() {
  loadPreferences();
  syncAssigneeOptions(state.preferences.reviewerName);
  bindEvents();
  await loadDashboardData({ preserveSelection: false });
  render();
}

function bindEvents() {
  elements.searchFilter.addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    render();
  });

  elements.statusFilter.addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    render();
  });

  elements.campaignFilter.addEventListener("change", (event) => {
    state.filters.campaign = event.target.value;
    render();
  });

  elements.dateFromFilter.addEventListener("change", (event) => {
    state.filters.dateFrom = event.target.value;

    if (
      state.filters.dateFrom !== "all" &&
      state.filters.dateTo !== "all" &&
      state.filters.dateFrom > state.filters.dateTo
    ) {
      state.filters.dateTo = state.filters.dateFrom;
    }

    render();
  });

  elements.dateToFilter.addEventListener("change", (event) => {
    state.filters.dateTo = event.target.value;

    if (
      state.filters.dateFrom !== "all" &&
      state.filters.dateTo !== "all" &&
      state.filters.dateTo < state.filters.dateFrom
    ) {
      state.filters.dateFrom = state.filters.dateTo;
    }

    render();
  });

  elements.reviewerName.addEventListener("change", (event) => {
    state.preferences.reviewerName = event.target.value.trim();
    persistPreferences();
  });

  elements.nextTemplate.addEventListener("click", goToNextTemplate);
  elements.markReviewed.addEventListener("click", saveCurrentReview);
  elements.refreshAiReview.addEventListener("click", () => {
    const item = state.allItems.find((entry) => entry.id === state.selectedId);

    if (!item) return;

    loadAiReview(item, { force: true });
  });
  elements.exportReviews.addEventListener("click", exportReviews);
  elements.resetLocal.addEventListener("click", handleResetAction);
  elements.upload.addEventListener("change", handleUpload);
}

function syncAssigneeOptions(preferredValue = DEFAULT_ASSIGNEE) {
  const normalizedValue = String(preferredValue || DEFAULT_ASSIGNEE).trim() || DEFAULT_ASSIGNEE;
  const options = [...ASSIGNEE_OPTIONS];

  if (!options.includes(normalizedValue)) {
    options.push(normalizedValue);
  }

  elements.reviewerName.innerHTML = options
    .map(
      (assignee) =>
        `<option value="${escapeHtml(assignee)}">${escapeHtml(assignee)}</option>`,
    )
    .join("");
  elements.reviewerName.value = normalizedValue;
}

async function loadDashboardData({ preserveSelection = true } = {}) {
  const previousSelectedId = preserveSelection ? state.selectedId : null;

  setSyncStatus("loading", "Connecting to the review data source…");

  try {
    const payload = await fetchJson(API_ENDPOINTS.data);
    applyLoadedItems(payload.items || [], payload, previousSelectedId);
  } catch (error) {
    const fallbackPayload = await loadFallbackSeed();
    const localState = loadLocalState();

    state.allItems = mergeLocalEdits(fallbackPayload.items, localState);
    state.selectedId =
      state.allItems.find((item) => item.id === previousSelectedId)?.id ||
      state.allItems[0]?.id ||
      null;
    state.sync = {
      ...state.sync,
      canWrite: false,
      dataBranch: "",
      mode: "local",
      provider: "local",
      providerLabel: "Local",
      repo: "",
      sourceFileName: fallbackPayload.sourceFileName || "Bundled seed",
      statusMessage:
        "Local preview mode. Reviews are saved only in this browser until shared storage is configured.",
      tone: "local",
      updatedAt: fallbackPayload.updatedAt || "",
      updatedBy: fallbackPayload.updatedBy || "",
      workspace: "",
    };
  }
}

function applyLoadedItems(items, payload, previousSelectedId) {
  state.allItems = items.map((item) => prepareItem(item));
  state.selectedId =
    state.allItems.find((item) => item.id === previousSelectedId)?.id ||
    state.allItems[0]?.id ||
    null;
  state.sync = {
    ...state.sync,
    canWrite: Boolean(payload.canWrite),
    dataBranch: payload.dataBranch || "",
    mode: payload.mode || "local",
    provider: payload.provider || "local",
    providerLabel: payload.providerLabel || "Local",
    repo: payload.repo || "",
    sourceFileName: payload.sourceFileName || "",
    statusMessage:
      payload.mode === "shared"
        ? `Shared ${payload.providerLabel || "review"} sync is active for this dashboard.`
        : "Local preview mode. Reviews are saved only in this browser.",
    tone: payload.mode === "shared" ? "shared" : "local",
    updatedAt: payload.updatedAt || "",
    updatedBy: payload.updatedBy || "",
    workspace: payload.workspace || "",
  };
}

async function loadFallbackSeed() {
  try {
    const payload = await fetchJson("./data/review-dashboard-state.json");

    if (Array.isArray(payload.items)) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return { items: payload, sourceFileName: "Local seed array" };
    }
  } catch {
    const sampleItems = await fetchJson("./data/sample-review-items.json");
    return { items: sampleItems, sourceFileName: "Sample review items" };
  }

  return { items: [], sourceFileName: "Empty local state" };
}

function render() {
  state.filteredItems = applyFilters(state.allItems, state.filters);

  if (!state.filteredItems.find((item) => item.id === state.selectedId)) {
    state.selectedId = state.filteredItems[0]?.id ?? null;
  }

  renderSummary();
  renderSyncStatus();
  renderFilterOptions();
  renderQueue();
  renderDetail();
}

function renderSummary() {
  const total = state.allItems.length;
  const reviewed = state.allItems.filter(
    (item) => item.reviewStatus === "Reviewed",
  ).length;
  const pending = total - reviewed;
  const l2Needed = state.allItems.filter(
    (item) => item.reviewDecision === "Escalate L2",
  ).length;

  const cards = [
    { label: "Total templates", value: total, hint: "Loaded review rows" },
    { label: "Reviewed", value: reviewed, hint: "Saved human reviews" },
    { label: "Pending", value: pending, hint: "Waiting for review" },
    { label: "L2 candidates", value: l2Needed, hint: "Marked for escalation" },
  ];

  elements.summaryGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="summary-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${card.value}</strong>
          <span>${escapeHtml(card.hint)}</span>
        </article>
      `,
    )
    .join("");
}

function renderSyncStatus() {
  const detailParts = [];

  if (state.sync.repo) {
    detailParts.push(state.sync.repo);
  }

  if (state.sync.dataBranch) {
    detailParts.push(`branch ${state.sync.dataBranch}`);
  }

  if (state.sync.updatedAt) {
    detailParts.push(`updated ${formatDateTime(state.sync.updatedAt)}`);
  }

  if (state.sync.updatedBy) {
    detailParts.push(`by ${state.sync.updatedBy}`);
  }

  if (state.sync.workspace) {
    detailParts.push(state.sync.workspace.replace(/^https?:\/\//, ""));
  }

  if (state.sync.sourceFileName) {
    detailParts.push(state.sync.sourceFileName);
  }

  const detailText = detailParts.length
    ? `${state.sync.statusMessage} ${detailParts.join(" • ")}`
    : state.sync.statusMessage;

  elements.syncCard.dataset.mode = state.sync.tone;
  elements.syncMode.textContent =
    state.sync.mode === "shared"
      ? `Shared ${state.sync.providerLabel} Sync`
      : "Local Preview Mode";
  elements.syncDetail.textContent = detailText;
  elements.uploadLabel.textContent = state.sync.canWrite
    ? "Upload shared TSV or CSV"
    : "Upload TSV or CSV";
  elements.resetLocal.textContent = state.sync.canWrite
    ? "Reload Shared Data"
    : "Reset Local Changes";
}

function renderFilterOptions() {
  const dateOptions = sortDateKeys(
    uniqueValues(state.allItems.map((item) => item.generatedDate)).filter(Boolean),
  );

  syncOptions(
    elements.campaignFilter,
    "all",
    "All campaigns",
    uniqueValues(
      state.allItems.map((item) => item.campaignName || item.displayCampaign),
    ).filter(Boolean),
    state.filters.campaign,
  );

  syncOptions(
    elements.dateFromFilter,
    "all",
    "All dates",
    dateOptions,
    state.filters.dateFrom,
  );

  syncOptions(
    elements.dateToFilter,
    "all",
    "All dates",
    dateOptions,
    state.filters.dateTo,
  );
}

function renderQueue() {
  elements.queueCount.textContent = `${state.filteredItems.length} items`;

  if (!state.filteredItems.length) {
    elements.queueList.innerHTML = `
      <article class="queue-item">
        <h3>No templates match these filters</h3>
        <p>Adjust the search or upload a fresh export file.</p>
      </article>
    `;
    return;
  }

  elements.queueList.innerHTML = state.filteredItems
    .map((item) => {
      const activeClass = item.id === state.selectedId ? "active" : "";
      const statusClass =
        item.reviewStatus === "Reviewed" ? "status-reviewed" : "status-pending";

      return `
        <button class="queue-item ${activeClass}" data-select-id="${escapeHtml(item.id)}" type="button">
          <div class="queue-meta">
            <span class="meta-chip ${statusClass}">${escapeHtml(item.reviewStatus)}</span>
            <span class="meta-chip">${escapeHtml(item.generatedDate || "No date")}</span>
            <span class="meta-chip">${escapeHtml(item.reviewDecision || "Pending")}</span>
          </div>
          <div>
            <h3>${escapeHtml(item.title || "Untitled template")}</h3>
            <p>${escapeHtml(item.campaignName || item.displayCampaign || "No campaign")}</p>
          </div>
          <p>${escapeHtml(item.useCase || item.keyword || "No use case")}</p>
        </button>
      `;
    })
    .join("");

  elements.queueList.querySelectorAll("[data-select-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.selectId;
      render();
    });
  });
}

function renderDetail() {
  const item = state.allItems.find((entry) => entry.id === state.selectedId);

  if (!item) {
    elements.emptyState.classList.remove("hidden");
    elements.detailView.classList.add("hidden");
    elements.aiReviewSummary.value = "";
    elements.aiReviewSummaryMeta.textContent = "";
    elements.refreshAiReview.disabled = true;
    elements.nextTemplate.disabled = true;
    elements.savedReviewRecord.textContent = "";
    return;
  }

  elements.emptyState.classList.add("hidden");
  elements.detailView.classList.remove("hidden");

  elements.detailCampaign.textContent =
    item.campaignName || item.displayCampaign || "Campaign not set";
  elements.detailTitle.textContent = item.title || "Untitled template";
  elements.detailMeta.innerHTML = [
    item.generatedDate,
    item.reviewStatus,
    item.reviewDecision,
    item.reviewer || state.preferences.reviewerName || DEFAULT_ASSIGNEE,
  ]
    .filter(Boolean)
    .map((value) => `<span class="meta-chip">${escapeHtml(value)}</span>`)
    .join("");

  elements.openTemplate.href = item.templateUrl || "#";
  elements.openOriginalTemplate.href =
    item.originalTemplateUrl || item.templateUrl || "#";
  elements.openOriginalTemplate.toggleAttribute(
    "aria-disabled",
    !(item.originalTemplateUrl || item.templateUrl),
  );
  elements.openL2Ticket.href = L2_TICKET_URL;
  elements.templateFrame.src = item.templateUrl || "about:blank";

  renderFacts(item);
  renderAiReview(item);
  renderSavedReviewRecord(item);
  syncAssigneeOptions(
    item.reviewer || state.preferences.reviewerName || DEFAULT_ASSIGNEE,
  );
  elements.reviewDecision.value = item.reviewDecision || "Pending";
  elements.markReviewed.disabled = state.reviewActionBusy;
  elements.refreshAiReview.disabled = !item.templateUrl;
  elements.nextTemplate.disabled =
    state.reviewActionBusy || getNextFilteredItemId(item.id) === null;

  ensureAiReview(item);
}

function renderFacts(item) {
  const facts = [
    ["Template URL", item.templateUrl],
    ["Original Template URL", item.originalTemplateUrl],
    ["Template ID", item.templateId],
    ["Form ID", item.formId],
    ["Use Case", item.useCase],
    ["Keyword", item.keyword],
    ["Source Form", item.sourceForm],
    ["Display Campaign", item.displayCampaign],
  ];

  elements.templateFacts.innerHTML = facts
    .map(
      ([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value || "—")}</dd>
        </div>
      `,
    )
    .join("");
}

function renderAiReview(item) {
  const entry = state.aiReview.cache[item.id];

  if (!item.templateUrl) {
    elements.aiReviewSummary.value =
      "No template URL available.\n\nThe dashboard can only generate an AI review suggestion for rows that include a live template URL.";
    elements.aiReviewSummaryMeta.textContent = "AI review unavailable";
    return;
  }

  if (!entry || entry.status === "idle") {
    elements.aiReviewSummary.value =
      "AI review is ready to run.\n\nSelect this template on the deployed dashboard or press Refresh AI Review to analyze its title, copy, FAQ, fields, and prompt alignment.";
    elements.aiReviewSummaryMeta.textContent = "Ready to analyze";
    return;
  }

  if (entry.status === "loading") {
    elements.aiReviewSummary.value =
      "Analyzing template...\n\nReviewing the live template page and embedded form against the generation rules.";
    elements.aiReviewSummaryMeta.textContent = "Running AI review";
    return;
  }

  if (entry.status === "error" || entry.status === "local") {
    elements.aiReviewSummary.value = [
      entry.title || "AI review unavailable",
      "",
      entry.message ||
        "The AI review suggestion could not be generated for this template.",
    ].join("\n");
    elements.aiReviewSummaryMeta.textContent =
      entry.status === "local" ? "Local preview mode" : "AI review failed";
    return;
  }

  const { data } = entry;
  elements.aiReviewSummary.value = formatAiReviewSummaryText(data);
  elements.aiReviewSummaryMeta.textContent = [
    `Suggested ${data.suggestedDecision}`,
    data.extracted?.indexed ? "Indexed" : "Not indexed",
    `${data.extracted?.fieldCount ?? "—"} fields`,
    `${data.extracted?.faqCount ?? "—"} FAQ items`,
    formatDateTime(data.analyzedAt),
  ]
    .filter(Boolean)
    .join(" • ");
}

function formatAiReviewSummaryText(data) {
  const lines = [
    `Suggested Decision: ${data.suggestedDecision}`,
    "",
    `Summary: ${data.summary || "No summary generated."}`,
    "",
    "Signals:",
    `- H1: ${data.extracted?.h1 || "—"}`,
    `- Meta length: ${data.extracted?.metaLength ?? "—"}`,
    `- Language: ${(data.extracted?.language || "unknown").toUpperCase()}`,
    `- Indexed: ${data.extracted?.indexed ? "Yes" : "No"}`,
    `- Field count: ${data.extracted?.fieldCount ?? "—"}`,
    `- FAQ count: ${data.extracted?.faqCount ?? "—"}`,
    "",
    "Checks:",
    ...data.checks.map(
      (check) =>
        `- ${check.label} [${String(check.status || "").toUpperCase()}]: ${check.detail}`,
    ),
  ];

  return lines.join("\n");
}

function ensureAiReview(item) {
  if (!item?.id || !item.templateUrl) {
    return;
  }

  const entry = state.aiReview.cache[item.id];

  if (entry && ["loading", "ready", "local"].includes(entry.status)) {
    return;
  }

  if (entry?.status === "error") {
    return;
  }

  loadAiReview(item);
}

async function loadAiReview(item, { force = false } = {}) {
  if (!item?.templateUrl) {
    return;
  }

  if (window.location.protocol === "file:" && !force) {
    state.aiReview.cache[item.id] = {
      status: "local",
      title: "Live AI review runs on the deployed dashboard",
      message:
        "This local file view cannot analyze templates by itself. Use the deployed dashboard or press refresh after deploying the new API route.",
    };
    render();
    return;
  }

  state.aiReview.cache[item.id] = { status: "loading" };
  render();

  try {
    const params = new URLSearchParams({
      templateUrl: item.templateUrl,
      title: item.title || "",
      useCase: item.useCase || item.keyword || "",
    });
    const payload = await fetchJson(
      `${resolveAiReviewEndpoint()}?${params.toString()}`,
    );

    state.aiReview.cache[item.id] = {
      status: "ready",
      data: payload,
    };
  } catch (error) {
    state.aiReview.cache[item.id] = {
      status: "error",
      title: "AI review could not be loaded",
      message:
        error.message || "The template analysis endpoint did not return a review.",
    };
  }

  render();
}

function resolveAiReviewEndpoint() {
  if (window.location.protocol === "file:") {
    return `${SHARED_DASHBOARD_ORIGIN}${API_ENDPOINTS.aiReview}`;
  }

  return API_ENDPOINTS.aiReview;
}

function renderSavedReviewRecord(item) {
  const savedRecord = {
    id: item.id,
    templateId: item.templateId,
    templateUrl: item.templateUrl,
    title: item.title,
    generatedDate: item.generatedDate,
    campaignName: item.campaignName,
    displayCampaign: item.displayCampaign,
    reviewStatus: item.reviewStatus,
    reviewDecision: item.reviewDecision,
    reviewer: item.reviewer,
    reviewedAt: item.reviewedAt,
    priority: item.priority,
    checks: item.checks,
  };

  elements.savedReviewRecord.textContent = JSON.stringify(savedRecord, null, 2);
}

async function persistCurrentReview() {
  const item = state.allItems.find((entry) => entry.id === state.selectedId);

  if (!item) return false;

  const previousItem = JSON.parse(JSON.stringify(item));
  const reviewPayload = collectReviewPayload();
  const optimisticItem = prepareItem({
    ...item,
    ...reviewPayload,
    reviewStatus: reviewPayload.reviewDecision === "Pending" ? "Pending" : "Reviewed",
  });

  replaceItemInState(optimisticItem);
  persistPreferences();
  render();

  try {
    if (state.sync.canWrite) {
      setSyncStatus("shared", "Saving review to the shared dashboard…");

      const payload = await postJson(API_ENDPOINTS.reviews, {
        itemId: optimisticItem.id,
        review: reviewPayload,
      });

      replaceItemInState(prepareItem(payload.item));
      state.sync.updatedAt = payload.savedAt || new Date().toISOString();
      state.sync.updatedBy = reviewPayload.reviewer;
      setSyncStatus("shared", "Review saved to the shared dashboard.");
    } else {
      persistLocalState(state.allItems);
      state.sync.updatedAt = reviewPayload.reviewedAt;
      state.sync.updatedBy = reviewPayload.reviewer;
      setSyncStatus(
        "local",
        "Review saved locally in this browser. Configure shared storage to share it with the team.",
      );
    }

    return true;
  } catch (error) {
    replaceItemInState(previousItem);
    setSyncStatus(
      "error",
      error.message || "Could not save the review. Please try again.",
    );

    return false;
  } finally {
    render();
  }
}

async function saveCurrentReview() {
  state.reviewActionBusy = true;
  elements.markReviewed.disabled = true;
  elements.nextTemplate.disabled = true;
  elements.markReviewed.textContent = state.sync.canWrite
    ? "Saving…"
    : "Saved Locally";

  try {
    await persistCurrentReview();
  } finally {
    state.reviewActionBusy = false;
    elements.markReviewed.textContent = "Save Review";
    render();
  }
}

function collectReviewPayload() {
  const reviewDecision = elements.reviewDecision.value;
  const reviewer =
    String(elements.reviewerName.value || DEFAULT_ASSIGNEE).trim() || DEFAULT_ASSIGNEE;

  state.preferences.reviewerName = reviewer;

  return {
    reviewDecision,
    reviewedAt: new Date().toISOString(),
    reviewer,
    reviewStatus: reviewDecision === "Pending" ? "Pending" : "Reviewed",
  };
}

function getNextFilteredItemId(currentId) {
  const currentIndex = state.filteredItems.findIndex((item) => item.id === currentId);

  if (currentIndex === -1 || currentIndex >= state.filteredItems.length - 1) {
    return null;
  }

  return state.filteredItems[currentIndex + 1].id;
}

async function goToNextTemplate() {
  const nextId = getNextFilteredItemId(state.selectedId);

  if (!nextId) return;

  if (elements.reviewDecision.value !== "Pending") {
    state.reviewActionBusy = true;
    elements.markReviewed.disabled = true;
    elements.nextTemplate.disabled = true;
    elements.nextTemplate.textContent = "Saving…";

    try {
      const didSave = await persistCurrentReview();

      if (!didSave) {
        return;
      }
    } finally {
      state.reviewActionBusy = false;
      elements.nextTemplate.textContent = "Next Template";
      render();
    }
  }

  state.selectedId = nextId;
  render();
}

async function handleUpload(event) {
  const [file] = event.target.files || [];

  if (!file) return;

  try {
    const text = await file.text();
    const parsedItems = parseDelimitedDataset(text, file.name);

    if (!parsedItems.length) {
      throw new Error("No review rows were found in the uploaded file.");
    }

    if (state.sync.canWrite) {
      setSyncStatus("shared", `Uploading ${file.name} to the shared dashboard…`);

      const payload = await postJson(API_ENDPOINTS.dataset, {
        fileName: file.name,
        items: parsedItems,
        uploadedBy:
          elements.reviewerName.value.trim() || state.preferences.reviewerName,
      });

      state.allItems = payload.items.map((item) => prepareItem(item));
      state.selectedId = state.allItems[0]?.id || null;
      state.sync.updatedAt = new Date().toISOString();
      state.sync.updatedBy =
        elements.reviewerName.value.trim() || state.preferences.reviewerName;
      state.sync.sourceFileName = file.name;
      setSyncStatus(
        "shared",
        `Uploaded ${payload.uploadedCount} templates to the shared dashboard.`,
      );
    } else {
      const localState = loadLocalState();
      state.allItems = mergeLocalEdits(parsedItems, localState);
      state.selectedId = state.allItems[0]?.id || null;
      setSyncStatus(
        "local",
        `Loaded ${parsedItems.length} templates locally. This upload is only visible in your browser.`,
      );
    }
  } catch (error) {
    setSyncStatus(
      "error",
      error.message || "Could not process the uploaded dataset.",
    );
  } finally {
    elements.upload.value = "";
    render();
  }
}

async function handleResetAction() {
  if (state.sync.canWrite) {
    await loadDashboardData();
    render();
    return;
  }

  localStorage.removeItem(LOCAL_STORAGE_KEY);
  await loadDashboardData();
  render();
}

function parseDelimitedDataset(text, fileName) {
  const delimiter = fileName.endsWith(".tsv") || text.includes("\t") ? "\t" : ",";
  const rows = text
    .split(/\r?\n/)
    .map((row) => splitDelimitedRow(row, delimiter))
    .filter((cells) => cells.some((cell) => cell.trim() !== ""));

  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());

  return rows
    .slice(1)
    .map((cells, index) => {
      const row = Object.fromEntries(
        headers.map((header, headerIndex) => [header, cells[headerIndex] || ""]),
      );
      return normalizeRow(row, index);
    })
    .filter((item) => item.templateUrl || item.originalTemplateUrl);
}

function normalizeRow(row, index = 0) {
  const templateUrl = row["Template URL"] || row.templateUrl || row.URL || "";
  const useCase = row["Use Case"] || row.useCase || "";
  const reviewedFlag = String(
    row["Reviewed?"] || row.reviewed || row.reviewedFlag || "",
  )
    .trim()
    .toLowerCase();
  const issueNotes = [row.Issues || row.issues || "", row.Actions || row.actions || ""]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
  const importedDecision = deriveImportedDecision(
    row["Final Decision"] ||
      row["Review Decision"] ||
      row.reviewDecision ||
      "",
    reviewedFlag,
    issueNotes,
  );
  const title =
    row["Original Template Title"] ||
    row["Template Title"] ||
    row.Title ||
    row.title ||
    row.Name ||
    useCase ||
    titleFromTemplateUrl(templateUrl);
  const campaignId = row["Campaign ID"] || row.campaignId || "";
  const createdAt = row["Created At"] || row.createdAt || "";

  return prepareItem({
    campaignName: row["Campaign Name"] || row.Campaign || row.campaignName || campaignId,
    checks: normalizeChecks({
      h1CorrectReview:
        row["H1 Correct"] || row.h1CorrectReview || row["H1 Ends With Form"] || row.h1EndsWithForm,
      metaDescriptionReview:
        row["Meta Description Meaningful"] ||
        row["Meta Description Review"] ||
        row.metaDescriptionReview,
      faqCorrectReview:
        row["FAQ Correct"] || row.faqCorrectReview || row["FAQ Review"] || row.faqReview,
      fieldRangeReview:
        row["Form Fields 8 to 12"] ||
        row["Field Range Review"] ||
        row.fieldRangeReview ||
        row["Field Count Review"] ||
        row.fieldCountReview,
      indexedReview:
        row["Form Is Indexed"] || row["Indexed Review"] || row.indexedReview,
      templateSetupReview:
        row["Form Template Correctly Set Up"] ||
        row["Template Setup Review"] ||
        row.templateSetupReview ||
        row["Form-Use Case Field"] ||
        row["Form-Use Case Review"] ||
        row.formUseCaseReview,
    }),
    displayCampaign:
      row["Display Campaign"] || row.displayCampaign || campaignId,
    formId: row["Form ID"] || row.formId || "",
    generatedDate:
      row["Generated Date"] ||
      row.generatedDate ||
      normalizeGeneratedDate(createdAt),
    id:
      row["Template ID"] ||
      row.templateId ||
      row.ID ||
      templateUrl ||
      `${title}-${index}`,
    keyword: row.Keyword || row.keyword || "",
    originalTemplateUrl:
      row["Original Template URL"] || row.originalTemplateUrl || "",
    priority: row.Priority || row.priority || "",
    reviewDecision: importedDecision,
    reviewNotes: row["Review Notes"] || row.reviewNotes || issueNotes,
    reviewStatus:
      row["Review Status"] ||
      row.reviewStatus ||
      (reviewedFlag === "true" || reviewedFlag === "yes" ? "Reviewed" : "Pending"),
    reviewedAt: row["Reviewed At"] || row.reviewedAt || "",
    reviewer: row.Assignee || row.Reviewer || row.reviewer || "",
    sourceForm: row["Source Form"] || row.sourceForm || "",
    templateId: row["Template ID"] || row.templateId || "",
    templateUrl,
    title,
    useCase,
  });
}

function prepareItem(item) {
  const reviewDecision = normalizeReviewDecision(item.reviewDecision);

  return {
    id: String(item.id || item.templateId || item.templateUrl || "").trim(),
    templateId: String(item.templateId || "").trim(),
    templateUrl: String(item.templateUrl || "").trim(),
    title: String(item.title || "").trim(),
    originalTemplateUrl: String(item.originalTemplateUrl || "").trim(),
    formId: String(item.formId || "").trim(),
    sourceForm: String(item.sourceForm || "").trim(),
    useCase: String(item.useCase || "").trim(),
    keyword: String(item.keyword || "").trim(),
    generatedDate: String(item.generatedDate || "").trim(),
    campaignName: String(item.campaignName || "").trim(),
    displayCampaign: String(item.displayCampaign || "").trim(),
    priority: String(item.priority || "").trim(),
    reviewStatus:
      item.reviewStatus === "Reviewed" || reviewDecision !== "Pending"
        ? "Reviewed"
        : "Pending",
    reviewDecision,
    reviewer: String(item.reviewer || "").trim(),
    reviewedAt: String(item.reviewedAt || "").trim(),
    reviewNotes: String(item.reviewNotes || "").trim(),
    checks: normalizeChecks(item.checks || {}),
  };
}

function normalizeReviewDecision(value) {
  return ["Pending", "Pass", "Needs Fix", "Escalate L2"].includes(value)
    ? value
    : "Pending";
}

function deriveImportedDecision(value, reviewedFlag, issueNotes) {
  const normalizedDirectDecision = normalizeReviewDecision(String(value || "").trim());

  if (normalizedDirectDecision !== "Pending") {
    return normalizedDirectDecision;
  }

  const reviewed = reviewedFlag === "true" || reviewedFlag === "yes";

  if (!reviewed) {
    return "Pending";
  }

  if (/\bl2\b|escalat/i.test(issueNotes)) {
    return "Escalate L2";
  }

  return issueNotes ? "Needs Fix" : "Pass";
}

function splitDelimitedRow(row, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    const nextChar = row[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function applyFilters(items, filters) {
  return items.filter((item) => {
    const matchesSearch =
      !filters.search ||
      [item.title, item.campaignName, item.displayCampaign, item.useCase, item.keyword]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(filters.search));

    const matchesStatus =
      filters.status === "all" || item.reviewStatus === filters.status;
    const matchesCampaign =
      filters.campaign === "all" ||
      (item.campaignName || item.displayCampaign) === filters.campaign;
    const itemDate = normalizeGeneratedDate(item.generatedDate);
    const matchesDateFrom =
      filters.dateFrom === "all" || (itemDate && itemDate >= filters.dateFrom);
    const matchesDateTo =
      filters.dateTo === "all" || (itemDate && itemDate <= filters.dateTo);

    return (
      matchesSearch &&
      matchesStatus &&
      matchesCampaign &&
      matchesDateFrom &&
      matchesDateTo
    );
  });
}

function exportReviews() {
  const rows = state.allItems.map((item) => ({
    Title: item.title,
    "Template URL": item.templateUrl,
    "Generated Date": item.generatedDate,
    Campaign: item.campaignName,
    "Review Status": item.reviewStatus,
    "Final Decision": item.reviewDecision,
    Assignee: item.reviewer,
    "Reviewed At": item.reviewedAt,
  }));

  const headers = Object.keys(rows[0] || {});
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((header) => csvEscape(row[header] ?? "")).join(","),
    ),
  ].join("\n");

  downloadText("adcraft-review-export.csv", csv, "text/csv");
}

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    state.preferences.reviewerName = saved.reviewerName || DEFAULT_ASSIGNEE;
  } catch {
    state.preferences.reviewerName = DEFAULT_ASSIGNEE;
  }
}

function persistPreferences() {
  localStorage.setItem(
    PREFERENCES_KEY,
    JSON.stringify({
      reviewerName: state.preferences.reviewerName,
    }),
  );
}

function loadLocalState() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persistLocalState(items) {
  const payload = Object.fromEntries(
    items.map((item) => [
      item.id,
      {
        reviewStatus: item.reviewStatus,
        reviewDecision: item.reviewDecision,
        reviewer: item.reviewer,
        reviewedAt: item.reviewedAt,
        reviewNotes: item.reviewNotes,
        priority: item.priority,
        checks: item.checks,
      },
    ]),
  );

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
}

function mergeLocalEdits(items, localState) {
  return items.map((item) => {
    const preparedItem = prepareItem(item);
    const local = localState[preparedItem.id];

    if (!local) {
      return preparedItem;
    }

    return prepareItem({
      ...preparedItem,
      ...local,
      checks: { ...preparedItem.checks, ...(local.checks || {}) },
    });
  });
}

function replaceItemInState(nextItem) {
  const itemIndex = state.allItems.findIndex((item) => item.id === nextItem.id);

  if (itemIndex === -1) {
    return;
  }

  state.allItems.splice(itemIndex, 1, prepareItem(nextItem));
}

function syncOptions(select, allValue, allLabel, options, currentValue) {
  const uniqueOptions = uniqueValues(options);
  select.innerHTML = [
    `<option value="${allValue}">${escapeHtml(allLabel)}</option>`,
    ...uniqueOptions.map(
      (option) =>
        `<option value="${escapeHtml(option)}" ${
          option === currentValue ? "selected" : ""
        }>${escapeHtml(option)}</option>`,
    ),
  ].join("");

  select.value = currentValue;
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function sortDateKeys(values) {
  return [...values].sort((left, right) => {
    const normalizedLeft = normalizeGeneratedDate(left);
    const normalizedRight = normalizeGeneratedDate(right);
    return normalizedLeft.localeCompare(normalizedRight);
  });
}

function normalizeGeneratedDate(value) {
  if (!value) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function titleFromTemplateUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const slug = pathname.split("/").filter(Boolean).pop() || "";

    return slug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return "";
  }
}

function csvEscape(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function downloadText(fileName, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with ${response.status}.`);
  }

  return payload;
}

async function postJson(url, body) {
  return fetchJson(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

function setSyncStatus(tone, message) {
  state.sync.tone = tone;
  state.sync.statusMessage = message;
}

function formatDateTime(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: value.includes("T") ? "short" : undefined,
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

boot();
