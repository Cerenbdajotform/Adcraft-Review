const LOCAL_STORAGE_KEY = "adcraft-review-dashboard-state-v2";
const PREFERENCES_KEY = "adcraft-review-dashboard-preferences-v1";
const API_ENDPOINTS = {
  data: "/api/data",
  dataset: "/api/dataset",
  reviews: "/api/reviews",
};
const L2_TICKET_URL =
  "https://support.jotform.com/admn/dashboards/l2-tickets/create/";

const CHECK_FIELDS = [
  {
    key: "titleReview",
    label: "Title Review",
    hint: "Title should match the prompt, avoid emoji, and use Form correctly.",
  },
  {
    key: "h1EndsWithForm",
    label: "H1 Ends With Form",
    hint: "The H1 should end with the word Form and stay consistent with the title.",
  },
  {
    key: "faqReview",
    label: "FAQ Review",
    hint: "FAQ should be relevant to the template use case and not generic filler.",
  },
  {
    key: "availableFieldsReview",
    label: "Available Fields",
    hint: "Check whether the template page includes the Available Fields tab or section.",
  },
  {
    key: "formUseCaseReview",
    label: "Form-Use Case Field",
    hint: "Form structure should match the use case and required operational fields.",
  },
  {
    key: "fieldCountReview",
    label: "Field Count Review",
    hint: "Generated form should stay between 10 and 10 top-level fields per the prompt.",
  },
  {
    key: "consentRuleReview",
    label: "Consent Rule Review",
    hint: "Consent should exist only when the prompt rules require it.",
  },
  {
    key: "sensitiveFieldsReview",
    label: "Sensitive Fields Review",
    hint: "No prohibited IDs, payment data, or other sensitive information should be collected.",
  },
];

const DEFAULT_CHECKS = Object.fromEntries(
  CHECK_FIELDS.map((field) => [field.key, "Pending"]),
);

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
  reviewGrid: document.getElementById("review-grid"),
  reviewNotes: document.getElementById("review-notes"),
  reviewerName: document.getElementById("reviewer-name"),
  reviewDecision: document.getElementById("review-decision"),
  reviewPriority: document.getElementById("review-priority"),
  reviewSavedAt: document.getElementById("review-saved-at"),
  markReviewed: document.getElementById("mark-reviewed"),
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
    reviewerName: "",
  },
};

async function boot() {
  loadPreferences();
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

  elements.reviewerName.addEventListener("input", (event) => {
    state.preferences.reviewerName = event.target.value.trim();
    persistPreferences();
  });

  elements.markReviewed.addEventListener("click", saveCurrentReview);
  elements.exportReviews.addEventListener("click", exportReviews);
  elements.resetLocal.addEventListener("click", handleResetAction);
  elements.upload.addEventListener("change", handleUpload);
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
      const availableFieldsValue = item.checks.availableFieldsReview || "Pending";

      return `
        <button class="queue-item ${activeClass}" data-select-id="${escapeHtml(item.id)}" type="button">
          <div class="queue-meta">
            <span class="meta-chip ${statusClass}">${escapeHtml(item.reviewStatus)}</span>
            <span class="meta-chip">${escapeHtml(item.generatedDate || "No date")}</span>
            <span class="meta-chip">Available Fields: ${escapeHtml(availableFieldsValue)}</span>
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
    item.priority || "No priority",
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
  renderChecks(item);

  elements.reviewNotes.value = item.reviewNotes || "";
  elements.reviewerName.value = item.reviewer || state.preferences.reviewerName || "";
  elements.reviewDecision.value = item.reviewDecision || "Pending";
  elements.reviewPriority.value = item.priority || "";
  elements.reviewSavedAt.textContent = item.reviewedAt
    ? formatDateTime(item.reviewedAt)
    : "Not saved yet";
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

function renderChecks(item) {
  elements.reviewGrid.innerHTML = CHECK_FIELDS.map((field) => {
    const currentValue = item.checks[field.key] || "Pending";
    return `
      <label class="review-field">
        <h4>${escapeHtml(field.label)}</h4>
        <p>${escapeHtml(field.hint)}</p>
        <select data-check-key="${escapeHtml(field.key)}">
          ${renderCheckOptions(currentValue)}
        </select>
      </label>
    `;
  }).join("");
}

function renderCheckOptions(selectedValue) {
  return ["Pending", "Pass", "Fail"]
    .map(
      (value) =>
        `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${value}</option>`,
    )
    .join("");
}

async function saveCurrentReview() {
  const item = state.allItems.find((entry) => entry.id === state.selectedId);

  if (!item) return;

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

  elements.markReviewed.disabled = true;
  elements.markReviewed.textContent = state.sync.canWrite
    ? "Saving…"
    : "Saved Locally";

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
  } catch (error) {
    replaceItemInState(previousItem);
    setSyncStatus(
      "error",
      error.message || "Could not save the review. Please try again.",
    );
  } finally {
    elements.markReviewed.disabled = false;
    elements.markReviewed.textContent = "Save Review";
    render();
  }
}

function collectReviewPayload() {
  const checks = {};

  elements.reviewGrid.querySelectorAll("[data-check-key]").forEach((select) => {
    checks[select.dataset.checkKey] = select.value;
  });

  const reviewDecision = elements.reviewDecision.value;
  const reviewer = elements.reviewerName.value.trim();

  state.preferences.reviewerName = reviewer;

  return {
    checks,
    priority: elements.reviewPriority.value.trim(),
    reviewDecision,
    reviewNotes: elements.reviewNotes.value.trim(),
    reviewedAt: new Date().toISOString(),
    reviewer,
    reviewStatus: reviewDecision === "Pending" ? "Pending" : "Reviewed",
  };
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
  const title =
    row["Original Template Title"] ||
    row["Template Title"] ||
    row.title ||
    row.Name ||
    useCase ||
    titleFromTemplateUrl(templateUrl);
  const campaignId = row["Campaign ID"] || row.campaignId || "";
  const createdAt = row["Created At"] || row.createdAt || "";

  return prepareItem({
    campaignName: row["Campaign Name"] || row.campaignName || campaignId,
    checks: {
      titleReview: row["Title Review"] || row.titleReview || "Pending",
      h1EndsWithForm:
        row["H1 Ends With Form"] || row.h1EndsWithForm || "Pending",
      faqReview: row["FAQ Review"] || row.faqReview || "Pending",
      availableFieldsReview:
        row["Available Fields Review"] ||
        row.availableFieldsReview ||
        "Pending",
      formUseCaseReview:
        row["Form-Use Case Field"] ||
        row["Form-Use Case Review"] ||
        row.formUseCaseReview ||
        "Pending",
      fieldCountReview:
        row["Field Count Review"] || row.fieldCountReview || "Pending",
      consentRuleReview:
        row["Consent Rule Review"] ||
        row["Consent Rule"] ||
        row.consentRuleReview ||
        "Pending",
      sensitiveFieldsReview:
        row["Sensitive Fields Review"] ||
        row["Sensitive Fields"] ||
        row.sensitiveFieldsReview ||
        "Pending",
    },
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
    reviewDecision: row["Review Decision"] || row.reviewDecision || "Pending",
    reviewNotes: row["Review Notes"] || row.reviewNotes || "",
    reviewStatus: row["Review Status"] || row.reviewStatus || "Pending",
    reviewedAt: row["Reviewed At"] || row.reviewedAt || "",
    reviewer: row.Reviewer || row.reviewer || "",
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
    checks: {
      ...DEFAULT_CHECKS,
      ...(item.checks || {}),
    },
  };
}

function normalizeReviewDecision(value) {
  return ["Pending", "Pass", "Needs Fix", "Escalate L2"].includes(value)
    ? value
    : "Pending";
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
    title: item.title,
    templateUrl: item.templateUrl,
    generatedDate: item.generatedDate,
    campaignName: item.campaignName,
    reviewStatus: item.reviewStatus,
    reviewDecision: item.reviewDecision,
    reviewer: item.reviewer,
    reviewedAt: item.reviewedAt,
    titleReview: item.checks.titleReview,
    h1EndsWithForm: item.checks.h1EndsWithForm,
    faqReview: item.checks.faqReview,
    availableFieldsReview: item.checks.availableFieldsReview,
    formUseCaseReview: item.checks.formUseCaseReview,
    fieldCountReview: item.checks.fieldCountReview,
    consentRuleReview: item.checks.consentRuleReview,
    sensitiveFieldsReview: item.checks.sensitiveFieldsReview,
    reviewNotes: item.reviewNotes,
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
    state.preferences.reviewerName = saved.reviewerName || "";
  } catch {
    state.preferences.reviewerName = "";
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
