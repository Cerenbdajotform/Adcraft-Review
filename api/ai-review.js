"use strict";

const { methodNotAllowed, sendError, sendJson } = require("./_lib/http");

const FETCH_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "User-Agent":
    "Mozilla/5.0 (compatible; AdcraftReviewDashboard/1.0; +https://adcraft-review-ceren.vercel.app/)",
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "assessment",
  "checklist",
  "for",
  "form",
  "in",
  "of",
  "on",
  "or",
  "report",
  "request",
  "survey",
  "the",
  "to",
  "with",
]);

const SENSITIVE_FIELD_PATTERNS = [
  /credit card/i,
  /\bssn\b/i,
  /social security/i,
  /passport/i,
  /driver'?s licen[sc]e/i,
  /national id/i,
  /government(?:al)? id/i,
  /\biban\b/i,
  /bank account/i,
  /account number/i,
  /tc kimlik/i,
];

const ILLEGAL_CONTENT_PATTERNS = [/gambl/i, /\bbet\b/i, /casino/i, /sexual/i];

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET", "OPTIONS"]);
  }

  try {
    const requestUrl = new URL(req.url, "https://adcraft-review.local");
    const formId = cleanText(requestUrl.searchParams.get("formId") || "");
    const templateUrl = normalizeTemplateUrl(
      requestUrl.searchParams.get("templateUrl") || "",
    );
    const templateId = cleanText(
      requestUrl.searchParams.get("templateId") || "",
    );
    const expectedTitle = cleanText(
      requestUrl.searchParams.get("title") || "",
    );
    const useCase = cleanText(requestUrl.searchParams.get("useCase") || "");

    if (!templateUrl) {
      const error = new Error("A template URL is required.");
      error.statusCode = 400;
      throw error;
    }

    const payload = await analyzeTemplate({
      expectedTitle,
      formId,
      templateId,
      templateUrl,
      useCase,
    });

    return sendJson(res, 200, payload);
  } catch (error) {
    return sendError(res, error);
  }
};

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function analyzeTemplate({
  templateUrl,
  expectedTitle,
  useCase,
  templateId,
  formId,
}) {
  const templateHtml = await fetchText(templateUrl, "Template");
  const pageTitle = extractPageTitle(templateHtml);
  const displayTitle = stripTemplateSuffix(pageTitle);
  const lang = extractLang(templateHtml) || "en";
  const metaDescription = extractMetaContent(templateHtml, "description");
  const robots = extractMetaContent(templateHtml, "robots");
  const overviewSection = extractAboutSection(templateHtml);
  const availableFieldsSection = extractSectionBetween(
    templateHtml,
    'data-tab="available-fields"',
    'data-tab="faq"',
  );
  const faqSection = extractSectionBetween(
    templateHtml,
    'data-tab="faq"',
    '<div aria-roledescription="carousel"',
  );
  const jsonLdEntries = extractJsonLdEntries(templateHtml);
  const aboutParagraphs = extractParagraphs(overviewSection);
  const aboutLength = aboutParagraphs.join(" ").length;
  const faqPairs = extractFaqPairs(faqSection).length
    ? extractFaqPairs(faqSection)
    : extractFaqPairsFromJsonLd(jsonLdEntries);
  const jsonLdFieldNames = extractFieldNamesFromJsonLd(jsonLdEntries);
  const previewPath = extractPreviewPath(templateHtml);
  const previewCandidates = buildPreviewCandidates({
    formId,
    previewPath,
    templateId,
    templateUrl,
  });
  const previewAttempt = await loadPreviewHtml(previewCandidates);
  const previewUrl = previewAttempt.url;
  const previewHtml = previewAttempt.html;
  const preview = parsePreview(previewHtml);

  const englishPage = /^en\b/i.test(lang);
  const indexed = /index/i.test(robots) && !/noindex/i.test(robots);
  const hasEmoji =
    containsEmoji(displayTitle) ||
    containsEmoji(preview.h1) ||
    containsEmoji(metaDescription);
  const sameTitleAsExpected =
    !expectedTitle ||
    normalizeCompare(expectedTitle) === normalizeCompare(displayTitle);
  const sameTitleAsH1 =
    normalizeCompare(displayTitle) === normalizeCompare(preview.h1);
  const h1EndsWithForm = !englishPage || /\bForm$/.test(preview.h1);
  const titleIncludesForm = !englishPage || /\bForm\b/.test(displayTitle);
  const metaLength = metaDescription.length;
  const faqCount = faqPairs.length;
  const fieldCount = preview.fieldCount;
  const requiredFaqCoverage = hasRequiredFaqTopics(faqPairs.map((pair) => pair.question));
  const hasEmptyChoices = preview.fields.some(
    (field) =>
      (field.type === "control_radio" || field.type === "control_checkbox") &&
      (!field.options.length || field.options.some((option) => !option.trim())),
  );
  const contentSections = [
    metaDescription,
    ...aboutParagraphs,
    ...faqPairs.flatMap((pair) => [pair.question, pair.answer]),
  ].join(" ");
  const complianceClaim =
    /hipaa compliant|gdpr compliant|legally binding/i.test(contentSections);
  const illegalContent = ILLEGAL_CONTENT_PATTERNS.some((pattern) =>
    pattern.test([displayTitle, useCase].join(" ")),
  );
  const sensitiveFields = preview.fields
    .filter((field) => isSensitiveField(field.label))
    .map((field) => field.label);
  const checklistExpected = /checklist/i.test([displayTitle, useCase].join(" "));
  const checklistUsesOnlyChecklistInputs =
    preview.checkboxGroupCount > 0 &&
    preview.radioGroupCount === 0 &&
    preview.choiceFieldCount === preview.checkboxGroupCount;
  const orderLikeUseCase = /\b(order|purchase|buy|booking|reservation|pre-order)\b/i.test(
    [displayTitle, useCase].join(" "),
  );
  const consentLikeUseCase = /\b(consent|waiver|release|liability|authorization)\b/i.test(
    [displayTitle, useCase].join(" "),
  );
  const hasConsentField = preview.fields.some((field) =>
    /\b(consent|waiver|release|liability|authorization|terms|acknowledg)/i.test(
      field.label,
    ),
  );
  const hasProductList =
    /product list/i.test(availableFieldsSection) ||
    jsonLdFieldNames.some((fieldName) => /product/i.test(fieldName)) ||
    /data-type="control_paypal"|data-type="control_payment"|product-container-wrapper/i.test(
      previewHtml,
    );
  const hasAvailableFields =
    jsonLdFieldNames.length > 0 ||
    /<li\b|<span\b|<div\b/i.test(availableFieldsSection);
  const useCaseTokens = extractSignalTokens(`${displayTitle} ${useCase}`);
  const matchedTokens = useCaseTokens.filter((token) =>
    preview.searchText.includes(token),
  );
  const alignmentIssues = [];

  if (checklistExpected && !checklistUsesOnlyChecklistInputs) {
    alignmentIssues.push(
      "Checklist-style template still uses radio or non-checklist choice fields.",
    );
  }

  if (orderLikeUseCase && !hasProductList) {
    alignmentIssues.push(
      "Order-focused use case does not expose a clear product list element.",
    );
  }

  if (consentLikeUseCase && !hasConsentField) {
    alignmentIssues.push(
      "Consent-focused use case is missing a visible consent or release field.",
    );
  }

  if (orderLikeUseCase && hasConsentField) {
    alignmentIssues.push(
      "Order-focused use case contains a consent-style field that the prompt discourages.",
    );
  }

  if (matchedTokens.length === 0 && useCaseTokens.length > 0) {
    alignmentIssues.push(
      "Field labels do not clearly echo the core use-case keywords.",
    );
  }

  const checks = [
    buildCheck(
      "Title and H1",
      sameTitleAsExpected && sameTitleAsH1 && h1EndsWithForm && titleIncludesForm && !hasEmoji,
      {
        failDetail:
          `Template title is "${displayTitle || "missing"}" while H1 is "${preview.h1 || "missing"}". English titles and H1 values should match exactly, include Form, and avoid emoji.`,
        passDetail:
          `Template title and H1 match as "${preview.h1 || displayTitle}" and follow the English Form naming rule.`,
        warn: !sameTitleAsExpected,
        warnDetail:
          `Dashboard title "${expectedTitle}" does not match the live template title "${displayTitle}".`,
      },
    ),
    buildCheck(
      "Meta description",
      Boolean(metaDescription) &&
        metaLength >= 120 &&
        metaLength <= 320 &&
        !/:/.test(metaDescription) &&
        !containsForbiddenComplianceLanguage(metaDescription),
      {
        failDetail:
          "Meta description is missing, too short or long, contains forbidden punctuation, or includes compliance language that should not appear.",
        passDetail: `Meta description is present and falls within the expected range at ${metaLength} characters.`,
      },
    ),
    buildCheck(
      "Description structure",
      aboutParagraphs.length === 2 &&
        aboutLength >= 900 &&
        aboutLength <= 1500 &&
        !containsForbiddenComplianceLanguage(aboutParagraphs.join(" ")),
      {
        failDetail:
          `About this template should be two paragraphs and 900 to 1500 characters. The live page currently has ${aboutParagraphs.length} paragraphs and ${aboutLength} characters.`,
        passDetail:
          `About this template uses two paragraphs and ${aboutLength} characters, which fits the prompt structure.`,
      },
    ),
    buildCheck(
      "FAQ coverage",
      faqCount >= 5 && faqCount <= 8 && requiredFaqCoverage,
      {
        failDetail:
          `FAQ coverage should contain 5 to 8 pairs and include the required first five question types. The live template currently has ${faqCount} FAQ pairs.`,
        passDetail:
          `FAQ section has ${faqCount} pairs and covers the required core questions for use case, inclusions, timing, audience, and benefits.`,
        warn: faqCount > 8,
        warnDetail:
          `FAQ section has ${faqCount} entries, which is broader than the preferred 5 to 8 range.`,
      },
    ),
    buildCheck(
      "Field count and options",
      fieldCount === 10 && !hasEmptyChoices,
      {
        failDetail:
          `The embedded form exposes ${fieldCount} usable fields. The prompt requires exactly 10 form fields, and radio or checkbox options cannot be blank.`,
        passDetail:
          `Embedded form exposes exactly 10 usable fields and all detected choice options are populated.`,
        warn: fieldCount === 9 || fieldCount === 11,
        warnDetail:
          `Embedded form is close to the target at ${fieldCount} fields, but the prompt still expects exactly 10.`,
      },
    ),
    buildCheck(
      "Use-case alignment",
      alignmentIssues.length === 0,
      {
        failDetail: alignmentIssues.join(" "),
        passDetail:
          "Field labels and control types align with the main use case, and no checklist, consent, or product-list rule violations were detected.",
      },
    ),
    buildCheck(
      "Safety and compliance",
      sensitiveFields.length === 0 && !illegalContent && !complianceClaim,
      {
        failDetail:
          [
            sensitiveFields.length
              ? `Sensitive field signals detected in ${sensitiveFields.join(", ")}.`
              : "",
            illegalContent
              ? "Use case contains illegal or prohibited content signals."
              : "",
            complianceClaim
              ? "Template copy includes compliance or legally binding language that should not be present."
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        passDetail:
          "No obvious sensitive ID or financial fields, illegal content, or forbidden compliance claims were detected.",
      },
    ),
    buildCheck(
      "Indexing and setup",
      indexed && Boolean(previewUrl) && hasAvailableFields,
      {
        failDetail:
          `Template should be indexable and expose both a preview form and an Available Fields section. One or more of those setup signals is missing.${previewAttempt.error ? ` Preview fetch failed with ${previewAttempt.error.statusCode || "an unknown error"}.` : ""}`,
        passDetail:
          "Template is indexable and exposes both a preview form and an Available Fields section.",
      },
    ),
  ];

  const suggestedDecision = suggestDecision(checks, {
    complianceClaim,
    illegalContent,
    sensitiveFieldCount: sensitiveFields.length,
  });
  const summary = buildSummary(suggestedDecision, checks, {
    fieldCount,
    h1: preview.h1 || displayTitle,
  });

  return {
    analyzedAt: new Date().toISOString(),
    checks,
    extracted: {
      aboutLength,
      faqCount,
      fieldCount,
      h1: preview.h1,
      indexed,
      language: lang,
      metaLength,
      pageTitle: displayTitle,
      previewUrl,
      radioGroupCount: preview.radioGroupCount,
      previewFetchError: previewAttempt.error?.message || "",
    },
    summary,
    suggestedDecision,
  };
}

async function fetchText(url, label = "Template") {
  const response = await fetch(url, { headers: FETCH_HEADERS });

  if (!response.ok) {
    const error = new Error(`${label} request failed with ${response.status}.`);
    error.statusCode = response.status;
    throw error;
  }

  return response.text();
}

function normalizeTemplateUrl(value) {
  try {
    const url = new URL(value);

    if (!/(\.|^)jotform\.com$/i.test(url.hostname)) {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}

function extractPageTitle(html) {
  return cleanText(extractFirstMatch(html, /<title>([\s\S]*?)<\/title>/i));
}

function stripTemplateSuffix(title) {
  return cleanText(title.replace(/\s+Template\s*\|\s*Jotform$/i, ""));
}

function extractLang(html) {
  return cleanText(extractFirstMatch(html, /<html[^>]*lang="([^"]+)"/i));
}

function extractMetaContent(html, metaName) {
  const escapedName = metaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]*name="${escapedName}"[^>]*content="([^"]*)"[^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]*content="([^"]*)"[^>]*name="${escapedName}"[^>]*>`,
      "i",
    ),
  ];

  return cleanText(extractFirstMatch(html, patterns[0]) || extractFirstMatch(html, patterns[1]));
}

function extractSectionBetween(html, startMarker, endMarker) {
  const startIndex = html.indexOf(startMarker);

  if (startIndex === -1) {
    return "";
  }

  const endIndex = endMarker ? html.indexOf(endMarker, startIndex + startMarker.length) : -1;

  if (endIndex === -1) {
    return html.slice(startIndex);
  }

  return html.slice(startIndex, endIndex);
}

function extractAboutSection(html) {
  const directMatch = html.match(
    /About this template<\/strong>([\s\S]*?)<strong[^>]*>\s*Details\s*<\/strong>/i,
  );

  if (directMatch?.[1]) {
    return directMatch[1];
  }

  return extractSectionBetween(
    html,
    'data-tab="overview"',
    'data-tab="available-fields"',
  );
}

function extractParagraphs(sectionHtml) {
  return [...sectionHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean);
}

function extractFaqPairs(sectionHtml) {
  return [...sectionHtml.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => ({
      answer: cleanText(match[2]),
      question: cleanText(match[1]),
    }))
    .filter((pair) => pair.question && pair.answer);
}

function extractJsonLdEntries(html) {
  const entries = [];

  for (const match of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
  )) {
    const raw = cleanText(match[1]);

    if (!raw) {
      continue;
    }

    try {
      entries.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }

  return entries;
}

function extractFaqPairsFromJsonLd(entries) {
  const items = flattenJsonLd(entries);
  const faqPage = items.find((item) => item?.["@type"] === "FAQPage");
  const questions = Array.isArray(faqPage?.mainEntity) ? faqPage.mainEntity : [];

  return questions
    .map((question) => ({
      answer: cleanText(question?.acceptedAnswer?.text || ""),
      question: cleanText(question?.name || ""),
    }))
    .filter((pair) => pair.question && pair.answer);
}

function extractFieldNamesFromJsonLd(entries) {
  const items = flattenJsonLd(entries);
  const creativeWork = items.find((item) => item?.["@type"] === "CreativeWork");
  const properties = Array.isArray(creativeWork?.additionalProperty)
    ? creativeWork.additionalProperty
    : [];

  return properties
    .map((property) => cleanText(property?.value || property?.name || ""))
    .filter(Boolean);
}

function flattenJsonLd(entries) {
  return entries.flatMap((entry) => {
    if (Array.isArray(entry)) {
      return flattenJsonLd(entry);
    }

    if (Array.isArray(entry?.["@graph"])) {
      return flattenJsonLd(entry["@graph"]);
    }

    return [entry];
  });
}

function extractPreviewPath(html) {
  return cleanText(
    extractFirstMatch(
      html,
      /\/form-templates\/preview\/[^"' ]+/i,
    ),
  );
}

function buildPreviewCandidates({ templateUrl, previewPath, templateId, formId }) {
  const candidates = [];

  if (previewPath) {
    try {
      candidates.push(new URL(previewPath, templateUrl).href);
    } catch {
      // Ignore malformed preview URLs from page HTML and use ID fallbacks below.
    }
  }

  const previewId = formId || templateId;

  if (previewId) {
    candidates.push(
      `https://www.jotform.com/form-templates/preview/${previewId}/classic&nofs&disableSmartEmbed=1`,
    );
  }

  return uniqueValues(candidates.filter(Boolean));
}

async function loadPreviewHtml(previewCandidates) {
  let lastError = null;

  for (const previewUrl of previewCandidates) {
    try {
      return {
        error: null,
        html: await fetchText(previewUrl, "Preview"),
        url: previewUrl,
      };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    error: lastError,
    html: "",
    url: "",
  };
}

function parsePreview(previewHtml) {
  const h1 = cleanText(
    extractFirstMatch(
      previewHtml,
      /<h1[^>]*class="[^"]*form-header[^"]*"[^>]*>([\s\S]*?)<\/h1>/i,
    ),
  );
  const subHeader = cleanText(
    extractFirstMatch(
      previewHtml,
      /<div[^>]*class="[^"]*form-subHeader[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ),
  );
  const fieldBlocks = [
    ...previewHtml.matchAll(
      /<li\b[^>]*class="[^"]*\bform-line\b[^"]*"[^>]*data-type="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi,
    ),
  ];
  const fields = [];
  let radioGroupCount = 0;
  let checkboxGroupCount = 0;
  let choiceFieldCount = 0;

  for (const match of fieldBlocks) {
    const type = match[1];
    const block = match[2];

    if (type === "control_head" || type === "control_button") {
      continue;
    }

    if (type === "control_radio") {
      radioGroupCount += 1;
      choiceFieldCount += 1;
    }

    if (type === "control_checkbox") {
      checkboxGroupCount += 1;
      choiceFieldCount += 1;
    }

    const label = cleanText(
      extractFirstMatch(
        block,
        /<(?:label|span)[^>]*class="[^"]*\bform-label\b[^"]*"[^>]*>([\s\S]*?)<\/(?:label|span)>/i,
      ),
    ).replace(/\*+$/, "").trim();
    const options = [...block.matchAll(/id="label_input_[^"]+"[^>]*>([\s\S]*?)<\/label>/gi)]
      .map((optionMatch) => cleanText(optionMatch[1]))
      .filter(Boolean);

    fields.push({ label, options, type });
  }

  return {
    checkboxGroupCount,
    choiceFieldCount,
    fieldCount: fields.length,
    fields,
    h1,
    radioGroupCount,
    searchText: cleanText(
      [h1, subHeader, ...fields.map((field) => field.label)].join(" "),
    ).toLowerCase(),
    subHeader,
  };
}

function buildCheck(label, pass, options) {
  if (pass) {
    return { detail: options.passDetail, label, status: "pass" };
  }

  if (options.warn) {
    return { detail: options.warnDetail, label, status: "warn" };
  }

  return { detail: options.failDetail, label, status: "fail" };
}

function suggestDecision(checks, safetyFlags) {
  const failCount = checks.filter((check) => check.status === "fail").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;

  if (
    safetyFlags.sensitiveFieldCount > 0 ||
    safetyFlags.complianceClaim ||
    safetyFlags.illegalContent
  ) {
    return "Escalate L2";
  }

  if (failCount >= 2) {
    return "Needs Fix";
  }

  if (failCount === 1 || warnCount >= 2) {
    return "Needs Fix";
  }

  return "Pass";
}

function buildSummary(suggestedDecision, checks, extracted) {
  const problematicChecks = checks
    .filter((check) => check.status !== "pass")
    .map((check) => check.label.toLowerCase());

  if (suggestedDecision === "Pass") {
    return `AI review suggests Pass. The live template looks aligned with the prompt rules, with ${extracted.fieldCount} detected form fields and a matching H1 of "${extracted.h1}".`;
  }

  if (problematicChecks.length === 0) {
    return `AI review suggests ${suggestedDecision}. Manual review is still recommended because the extracted template signals were incomplete.`;
  }

  return `AI review suggests ${suggestedDecision} because ${joinLabels(problematicChecks)} need attention before this template is considered clean.`;
}

function hasRequiredFaqTopics(questions) {
  const lowered = questions.map((question) => question.toLowerCase());
  const patterns = [
    /what is this .* used for|why is .* used|what is .* used for/,
    /what should be included|what should be in/,
    /when to use|when should .* be used/,
    /who can use/,
    /what are the benefits/,
  ];

  return patterns.every((pattern) =>
    lowered.some((question) => pattern.test(question)),
  );
}

function extractSignalTokens(text) {
  return uniqueValues(
    cleanText(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
  ).slice(0, 8);
}

function isSensitiveField(label) {
  if (!label) {
    return false;
  }

  if (/last 4 digits/i.test(label)) {
    return false;
  }

  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(label));
}

function containsForbiddenComplianceLanguage(text) {
  return /hipaa compliant|gdpr compliant|legally binding/i.test(text);
}

function containsEmoji(text) {
  return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text);
}

function normalizeCompare(text) {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "");
}

function extractFirstMatch(text, pattern) {
  const match = pattern.exec(text);
  return match ? match[1] || match[0] : "";
}

function cleanText(text) {
  return decodeEntities(String(text || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1]?.toLowerCase() === "x";
      const value = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    }

    return named[entity.toLowerCase()] || _;
  });
}

function joinLabels(labels) {
  if (labels.length <= 1) {
    return labels[0] || "the extracted checks";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

function uniqueValues(values) {
  return [...new Set(values)];
}
