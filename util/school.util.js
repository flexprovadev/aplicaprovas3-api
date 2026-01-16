const hasSchoolPrefix = (value) => {
  if (typeof value !== "string") {
    return false;
  }

  return /^[a-z0-9_-]+\./.test(value);
};

const normalizePrefix = (schoolPrefix) => {
  if (schoolPrefix === null || schoolPrefix === undefined) {
    return null;
  }

  if (typeof schoolPrefix !== "string") {
    return null;
  }

  const normalized = schoolPrefix.trim().toLowerCase();

  if (!normalized || /\s/.test(normalized) || normalized.includes(".")) {
    return null;
  }

  return normalized;
};

const escapeRegExp = (value) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Extracts the school prefix from the email, or returns null when missing.
const getSchoolFromEmail = (email) => {
  if (email === null || email === undefined) {
    return null;
  }

  if (typeof email !== "string") {
    return null;
  }

  const trimmed = email.trim();
  if (!trimmed) {
    return null;
  }

  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0) {
    return null;
  }

  const userPart = trimmed.slice(0, atIndex);
  const dotIndex = userPart.indexOf(".");
  if (dotIndex <= 0) {
    return null;
  }

  const prefix = userPart.slice(0, dotIndex);
  return normalizePrefix(prefix);
};

// Adds the school prefix only when the value is not already prefixed.
const addSchoolPrefix = (value, schoolPrefix) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const normalizedPrefix = normalizePrefix(schoolPrefix);
  if (!normalizedPrefix) {
    return value;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return value;
  }

  const expectedPrefix = `${normalizedPrefix}.`;
  const lowerValue = trimmedValue.toLowerCase();

  if (lowerValue.startsWith(expectedPrefix)) {
    const remainder = trimmedValue.slice(expectedPrefix.length);
    return `${normalizedPrefix}.${remainder}`;
  }

  return `${normalizedPrefix}.${trimmedValue}`;
};

// Removes the school prefix when present; otherwise returns the original value.
const removeSchoolPrefix = (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  if (!hasSchoolPrefix(value)) {
    return value;
  }

  return value.replace(/^[a-z0-9_-]+\./, "");
};

// Builds a MongoDB filter for a school prefix using a case-sensitive regex.
const createSchoolFilter = (schoolPrefix, fieldName = "name") => {
  const normalizedPrefix = normalizePrefix(schoolPrefix);
  if (!normalizedPrefix) {
    return null;
  }

  if (typeof fieldName !== "string") {
    return null;
  }

  const trimmedFieldName = fieldName.trim();
  if (!trimmedFieldName) {
    return null;
  }

  const escapedPrefix = escapeRegExp(normalizedPrefix);

  return {
    [trimmedFieldName]: {
      $regex: `^${escapedPrefix}\\.`,
    },
  };
};

module.exports = {
  getSchoolFromEmail,
  addSchoolPrefix,
  removeSchoolPrefix,
  createSchoolFilter,
};

// Simple manual tests: run `node Aplicaprovas3-api/util/school.util.js`.
if (require.main === module) {
  const assert = require("assert");

  assert.strictEqual(
    getSchoolFromEmail("podion.fernando@flexprova.com"),
    "podion"
  );
  assert.strictEqual(getSchoolFromEmail("fernando@flexprova.com"), null);
  assert.strictEqual(getSchoolFromEmail("podion@flexprova.com"), null);

  assert.strictEqual(addSchoolPrefix("MATEMATICA", "podion"), "podion.MATEMATICA");
  assert.strictEqual(
    addSchoolPrefix("podion.MATEMATICA", "podion"),
    "podion.MATEMATICA"
  );

  assert.strictEqual(removeSchoolPrefix("podion.MATEMATICA"), "MATEMATICA");
  assert.strictEqual(removeSchoolPrefix("MATEMATICA"), "MATEMATICA");

  assert.deepStrictEqual(createSchoolFilter("podion"), {
    name: { $regex: "^podion\\." },
  });

  console.log("school.util.js basic tests passed");
}
