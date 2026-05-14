const STORAGE_KEY = "adcraft-review-dashboard-state-v1";
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
  dateFilter: document.getElementById("date-filter"),
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
  exportReviews: document.getElementById("export-reviews"),
  resetLocal: document.getElementById("reset-local"),
};

const state = {
  allItems: [],
  filteredItems: [],
  selectedId: null,
  filters: {
    search: "",
    status: "all",
    campaign: "all",
    date: "all",
  },
};

async function boot() {
  const response = await fetch("./data/sample-review-items.json");
  const sampleItems = await response.json();
  const localState = loadLocalState();
  state.allItems = mergeLocalEdits(sampleItems, localState);
  state.selectedId = state.allItems[0]?.id ?? null;
  bindEvents();
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

  elements.dateFilter.addEventListener("change", (event) => {
    state.filters.date = event.target.value;
    render();
  });

  elements.markReviewed.addEventListener("click", saveCurrentReview);
  elements.exportReviews.addEventListener("click", exportReviews);
  elements.resetLocal.addEventListener("click", resetLocalChanges);
  elements.upload.addEventListener("change", handleUpload);
}

function render() {
  state.filteredItems = applyFilters(state.allItems, state.filters);

  if (!state.filteredItems.find((item) => item.id === state.selectedId)) {
    state.selectedId = state.filteredItems[0]?.id ?? null;
  }

  renderSummary();
  renderFilterOptions();
  renderQueue();
  renderDetail();
}

function renderSummary() {
  const total = state.allItems.length;
  const reviewed = state.allItems.filter((item) => item.reviewStatus === "Reviewed").length;
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

function renderFilterOptions() {
  syncOptions(
    elements.campaignFilter,
    "all",
    "All campaigns",
    uniqueValues(state.allItems.map((item) => item.campaignName || item.displayCampaign)).filter(Boolean),
    state.filters.campaign,
  );

  syncOptions(
    elements.dateFilter,
    "all",
    "All dates",
    uniqueValues(state.allItems.map((item) => item.generatedDate)).filter(Boolean),
    state.filters.date,
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
  elements.openOriginalTemplate.href = item.originalTemplateUrl || item.templateUrl || "#";
  elements.openOriginalTemplate.toggleAttribute(
    "aria-disabled",
    !(item.originalTemplateUrl || item.templateUrl),
  );
  elements.openL2Ticket.href = L2_TICKET_URL;
  elements.templateFrame.src = item.templateUrl || "about:blank";

  renderFacts(item);
  renderChecks(item);

  elements.reviewNotes.value = item.reviewNotes || "";
  elements.reviewerName.value = item.reviewer || "";
  elements.reviewDecision.value = item.reviewDecision || "Pending";
  elements.reviewPriority.value = item.priority || "";
  elements.reviewSavedAt.textContent = item.reviewedAt || "Not saved yet";
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

function saveCurrentReview() {
  const item = state.allItems.find((entry) => entry.id === state.selectedId);
  if (!item) return;

  const checks = { ...item.checks };
  elements.reviewGrid.querySelectorAll("[data-check-key]").forEach((select) => {
    checks[select.dataset.checkKey] = select.value;
  });

  const reviewedAt = new Date().toISOString().slice(0, 10);
  const reviewDecision = elements.reviewDecision.value;

  Object.assign(item, {
    checks,
    reviewNotes: elements.reviewNotes.value.trim(),
    reviewer: elements.reviewerName.value.trim(),
    reviewDecision,
    priority: elements.reviewPriority.value.trim(),
    reviewedAt,
    reviewStatus: reviewDecision === "Pending" ? "Pending" : "Reviewed",
  });

  persistLocalState(state.allItems);
  render();
}

function handleUpload(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  file.text().then((text) => {
    const parsedItems = parseDelimitedDataset(text, file.name);
    const localState = loadLocalState();
    state.allItems = mergeLocalEdits(parsedItems, localState);
    state.selectedId = state.allItems[0]?.id ?? null;
    render();
  });
}

function parseDelimitedDataset(text, fileName) {
  const delimiter = fileName.endsWith(".tsv") || text.includes("\t") ? "\t" : ",";
  const rows = text
    .split(/\r?\n/)
    .map((row) => splitDelimitedRow(row, delimiter))
    .filter((cells) => cells.some((cell) => cell.trim() !== ""));

  if (!rows.length) return [];

  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).map((cells, index) => {
    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, cells[headerIndex] || ""]));
    return normalizeRow(row, index);
  }).filter((item) => item.templateUrl || item.title || item.useCase);
}

function normalizeRow(row, index = 0) {
  const templateUrl = row["Template URL"] || row["templateUrl"] || row["URL"] || "";
  const title =
    row["Original Template Title"] ||
    row["Template Title"] ||
    row["title"] ||
    row["Name"] ||
    "";

  return {
    id:
      row["Template ID"] ||
      row["templateId"] ||
      row["ID"] ||
      templateUrl ||
      `${title}-${index}`,
    templateId: row["Template ID"] || row["templateId"] || "",
    templateUrl,
    title,
    originalTemplateUrl:
      row["Original Template URL"] || row["originalTemplateUrl"] || "",
    formId: row["Form ID"] || row["formId"] || "",
    sourceForm: row["Source Form"] || row["sourceForm"] || "",
    useCase: row["Use Case"] || row["useCase"] || "",
    keyword: row["Keyword"] || row["keyword"] || "",
    generatedDate: row["Generated Date"] || row["generatedDate"] || "",
    campaignName: row["Campaign Name"] || row["campaignName"] || "",
    displayCampaign: row["Display Campaign"] || row["displayCampaign"] || "",
    priority: row["Priority"] || row["priority"] || "",
    reviewStatus: row["Review Status"] || row["reviewStatus"] || "Pending",
    reviewDecision: row["Review Decision"] || row["reviewDecision"] || "Pending",
    reviewer: row["Reviewer"] || row["reviewer"] || "",
    reviewedAt: row["Reviewed At"] || row["reviewedAt"] || "",
    reviewNotes: row["Review Notes"] || row["reviewNotes"] || "",
    checks: {
      titleReview: row["Title Review"] || row["titleReview"] || "Pending",
      h1EndsWithForm:
        row["H1 Ends With Form"] || row["h1EndsWithForm"] || "Pending",
      faqReview: row["FAQ Review"] || row["faqReview"] || "Pending",
      availableFieldsReview:
        row["Available Fields Review"] ||
        row["availableFieldsReview"] ||
        "Pending",
      formUseCaseReview:
        row["Form-Use Case Field"] ||
        row["Form-Use Case Review"] ||
        row["formUseCaseReview"] ||
        "Pending",
      fieldCountReview:
        row["Field Count Review"] || row["fieldCountReview"] || "Pending",
      consentRuleReview:
        row["Consent Rule Review"] ||
        row["Consent Rule"] ||
        row["consentRuleReview"] ||
        "Pending",
      sensitiveFieldsReview:
        row["Sensitive Fields Review"] ||
        row["Sensitive Fields"] ||
        row["sensitiveFieldsReview"] ||
        "Pending",
    },
  };
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
    const matchesDate =
      filters.date === "all" || item.generatedDate === filters.date;

    return matchesSearch && matchesStatus && matchesCampaign && matchesDate;
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
      headers
        .map((header) => csvEscape(row[header] ?? ""))
        .join(","),
    ),
  ].join("\n");

  downloadText("adcraft-review-export.csv", csv, "text/csv");
}

function resetLocalChanges() {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}

function loadLocalState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
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

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function mergeLocalEdits(items, localState) {
  return items.map((item) => {
    const local = localState[item.id];
    if (!local) {
      return {
        ...item,
        checks: { ...DEFAULT_CHECKS, ...item.checks },
      };
    }

    return {
      ...item,
      ...local,
      checks: { ...DEFAULT_CHECKS, ...item.checks, ...local.checks },
    };
  });
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

boot();
