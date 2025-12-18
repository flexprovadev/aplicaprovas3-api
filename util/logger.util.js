const crypto = require("crypto");

const isTruthy = (value) => {
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
};

const isAuthDebugEnabled = () => isTruthy(process.env.DEBUG_AUTH);

const debugAuth = (...args) => {
  if (isAuthDebugEnabled()) {
    console.log(...args);
  }
};

const redactEmail = (email) => {
  if (!email || typeof email !== "string") {
    return "";
  }
  const [localPart, domain] = email.split("@");
  if (!domain) {
    return "";
  }
  if (!localPart) {
    return `***@${domain}`;
  }
  if (localPart.length <= 2) {
    return `${localPart[0]}***@${domain}`;
  }
  return `${localPart.slice(0, 2)}***@${domain}`;
};

const tokenFingerprint = (token) => {
  if (!token || typeof token !== "string") {
    return "";
  }
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
};

module.exports = {
  debugAuth,
  isAuthDebugEnabled,
  redactEmail,
  tokenFingerprint,
};

