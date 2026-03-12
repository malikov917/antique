#!/usr/bin/env node
import { readFileSync, statSync } from "node:fs";
import process from "node:process";
import Database from "better-sqlite3";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveFileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function findOtpInLog({ logFilePath, phone, fromOffset }) {
  let content = "";
  try {
    content = readFileSync(logFilePath, "utf8");
  } catch {
    return null;
  }

  const slice = fromOffset > 0 ? content.slice(fromOffset) : content;
  const lines = slice.split(/\r?\n/).filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const payload = safeJsonParse(lines[index]);
    if (!payload || typeof payload !== "object") {
      continue;
    }
    if (payload.msg !== "OTP issued") {
      continue;
    }
    if (payload.phoneE164 !== phone) {
      continue;
    }
    if (typeof payload.otpCode === "string" && /^\d{6}$/.test(payload.otpCode)) {
      return payload.otpCode;
    }
  }

  return null;
}

async function requestJson({ apiBaseUrl, method, path, token, payload, expectedStatus = 200 }) {
  const headers = {};
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });

  let body = null;
  const rawBody = await response.text();
  if (rawBody.trim().length > 0) {
    body = safeJsonParse(rawBody) ?? rawBody;
  }

  if (response.status !== expectedStatus) {
    const error = new Error(
      `Request ${method} ${path} failed (expected ${expectedStatus}, got ${response.status})`
    );
    error.details = body;
    throw error;
  }

  return body;
}

async function createAuthenticatedSession({ apiBaseUrl, apiLogFile, phone, platform, label }) {
  const logOffset = resolveFileSize(apiLogFile);

  await requestJson({
    apiBaseUrl,
    method: "POST",
    path: "/v1/auth/otp/request",
    payload: { phone },
    expectedStatus: 200
  });

  let otpCode = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    otpCode = findOtpInLog({ logFilePath: apiLogFile, phone, fromOffset: logOffset });
    if (otpCode) {
      break;
    }
    await sleep(200);
  }

  if (!otpCode) {
    throw new Error(`Could not resolve OTP code for ${phone} from ${apiLogFile}`);
  }

  const verifyBody = await requestJson({
    apiBaseUrl,
    method: "POST",
    path: "/v1/auth/otp/verify",
    payload: {
      phone,
      code: otpCode,
      deviceId: `e2e-${label}-${platform}-${Date.now()}`,
      platform
    },
    expectedStatus: 200
  });

  return {
    phone,
    userId: verifyBody.user.id,
    accessToken: verifyBody.tokens.accessToken,
    refreshToken: verifyBody.tokens.refreshToken
  };
}

async function refreshAccessToken({ apiBaseUrl, refreshToken }) {
  const payload = await requestJson({
    apiBaseUrl,
    method: "POST",
    path: "/v1/auth/refresh",
    payload: { refreshToken },
    expectedStatus: 200
  });
  return {
    accessToken: payload.tokens.accessToken,
    refreshToken: payload.tokens.refreshToken
  };
}

function updateUserRoles({ dbPath, userId, allowedRoles, activeRole }) {
  const sqlite = new Database(dbPath);
  try {
    sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(allowedRoles), activeRole, userId);
  } finally {
    sqlite.close();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const apiBaseUrl = args["api-base-url"];
  const apiLogFile = args["api-log-file"];
  const dbPath = args["db-path"];
  const platform = args.platform === "android" ? "android" : "ios";

  if (!apiBaseUrl || !apiLogFile || !dbPath) {
    throw new Error("Missing required args: --api-base-url --api-log-file --db-path");
  }

  const seed = String(Date.now()).slice(-7);
  const sellerPhone = `+15551${seed}`;
  const adminPhone = `+15552${seed}`;
  const buyerPhone = `+15553${seed}`;

  const scenarios = {
    wf1NewUserBuyerOfferFlow: { ok: false },
    wf2SellerApplicationApprovalListing: { ok: false },
    wf3DayCloseBehaviorNotifications: { ok: false }
  };

  const seller = await createAuthenticatedSession({
    apiBaseUrl,
    apiLogFile,
    phone: sellerPhone,
    platform,
    label: "seller"
  });

  const admin = await createAuthenticatedSession({
    apiBaseUrl,
    apiLogFile,
    phone: adminPhone,
    platform,
    label: "admin"
  });

  updateUserRoles({
    dbPath,
    userId: admin.userId,
    allowedRoles: ["buyer", "admin"],
    activeRole: "admin"
  });

  const adminRefreshed = await refreshAccessToken({
    apiBaseUrl,
    refreshToken: admin.refreshToken
  });
  admin.accessToken = adminRefreshed.accessToken;
  admin.refreshToken = adminRefreshed.refreshToken;

  await requestJson({
    apiBaseUrl,
    method: "POST",
    path: "/v1/seller/apply",
    token: seller.accessToken,
    payload: {
      fullName: "E2E Seller",
      shopName: "Antique Workflow Shop",
      note: "ANT-67 workflow setup"
    },
    expectedStatus: 200
  });

  await requestJson({
    apiBaseUrl,
    method: "POST",
    path: `/v1/admin/seller-applications/${seller.userId}/approve`,
    token: admin.accessToken,
    expectedStatus: 200
  });

  const sellerRefreshed = await refreshAccessToken({
    apiBaseUrl,
    refreshToken: seller.refreshToken
  });
  seller.accessToken = sellerRefreshed.accessToken;
  seller.refreshToken = sellerRefreshed.refreshToken;

  await requestJson({
    apiBaseUrl,
    method: "POST",
    path: "/v1/me/role-switch",
    token: seller.accessToken,
    payload: { role: "seller" },
    expectedStatus: 200
  });

  const openSession = await requestJson({
    apiBaseUrl,
    method: "POST",
    path: "/v1/seller/sessions/open",
    token: seller.accessToken,
    expectedStatus: 200
  });

  const sessionId = openSession.session.id;

  const listingForOffer = await requestJson({
    apiBaseUrl,
    method: "POST",
    path: "/v1/listings",
    token: seller.accessToken,
    payload: {
      title: "ANT-67 Buyer Offer Reel",
      description: "Workflow listing for buyer offer coverage",
      listedPriceCents: 2500,
      currency: "USD"
    },
    expectedStatus: 200
  });

  await requestJson({
    apiBaseUrl,
    method: "POST",
    path: "/v1/listings",
    token: seller.accessToken,
    payload: {
      title: "ANT-67 Day Close Reel",
      description: "Workflow listing left unsold for day-close behavior",
      listedPriceCents: 1900,
      currency: "USD"
    },
    expectedStatus: 200
  });

  scenarios.wf2SellerApplicationApprovalListing = {
    ok: true,
    sellerApplicationStatus: "approved",
    sessionOpened: true,
    listingCreated: listingForOffer.listing.id
  };

  const buyer = await createAuthenticatedSession({
    apiBaseUrl,
    apiLogFile,
    phone: buyerPhone,
    platform,
    label: "buyer"
  });

  await requestJson({
    apiBaseUrl,
    method: "POST",
    path: `/v1/listings/${listingForOffer.listing.id}/basket`,
    token: buyer.accessToken,
    expectedStatus: 200
  });

  const createdOffer = await requestJson({
    apiBaseUrl,
    method: "POST",
    path: `/v1/listings/${listingForOffer.listing.id}/offers`,
    token: buyer.accessToken,
    payload: {
      amountCents: 2500,
      shippingAddress: "Workflow Lane 67, Berlin"
    },
    expectedStatus: 200
  });

  const offers = await requestJson({
    apiBaseUrl,
    method: "GET",
    path: `/v1/seller/listings/${listingForOffer.listing.id}/offers`,
    token: seller.accessToken,
    expectedStatus: 200
  });

  const offerId = offers.offers?.[0]?.id ?? createdOffer.offer.id;

  const acceptResult = await requestJson({
    apiBaseUrl,
    method: "POST",
    path: `/v1/offers/${offerId}/accept`,
    token: seller.accessToken,
    expectedStatus: 200
  });

  scenarios.wf1NewUserBuyerOfferFlow = {
    ok: true,
    buyerUserId: buyer.userId,
    offerId,
    dealId: acceptResult.deal.id
  };

  const closeSession = await requestJson({
    apiBaseUrl,
    method: "POST",
    path: `/v1/seller/sessions/${sessionId}/close`,
    token: seller.accessToken,
    expectedStatus: 200
  });

  const notifications = await requestJson({
    apiBaseUrl,
    method: "GET",
    path: "/v1/notifications",
    token: seller.accessToken,
    expectedStatus: 200
  });

  const announcements = await requestJson({
    apiBaseUrl,
    method: "GET",
    path: "/v1/announcements",
    token: seller.accessToken,
    expectedStatus: 200
  });

  const notificationTypes = new Set((notifications.notifications ?? []).map((entry) => entry.type));
  const hasOfferSubmitted = notificationTypes.has("offer_submitted");
  const hasSessionClosed = notificationTypes.has("session_closed");
  const hasCloseAnnouncement = (announcements.announcements ?? []).some(
    (entry) => entry.eventType === "session_closed"
  );

  scenarios.wf3DayCloseBehaviorNotifications = {
    ok:
      Number(closeSession.transitionedListingCount ?? 0) >= 1 &&
      hasOfferSubmitted &&
      hasSessionClosed &&
      hasCloseAnnouncement,
    transitionedListingCount: closeSession.transitionedListingCount ?? 0,
    hasOfferSubmitted,
    hasSessionClosed,
    hasCloseAnnouncement
  };

  const result = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl,
    platform,
    appAccessToken: seller.accessToken,
    users: {
      sellerUserId: seller.userId,
      adminUserId: admin.userId,
      buyerUserId: buyer.userId
    },
    scenarios
  };

  const failed = Object.entries(scenarios).filter(([, value]) => value.ok !== true);
  if (failed.length > 0) {
    throw new Error(`Workflow setup validation failed: ${failed.map(([key]) => key).join(", ")}`);
  }

  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  const details = error && typeof error === "object" && "details" in error ? error.details : undefined;
  process.stderr.write(`workflow-e2e-setup failed: ${error.message}\n`);
  if (details !== undefined) {
    process.stderr.write(`${JSON.stringify(details)}\n`);
  }
  process.exit(1);
});
