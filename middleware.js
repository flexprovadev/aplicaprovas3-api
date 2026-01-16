const { UserType } = require("./enumerator");
const { getSchoolFromEmail } = require("./util/school.util");

const isTruthy = (value) => {
  if (value === undefined || value === null) {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
};

const isSchoolDebugEnabled = () => isTruthy(process.env.DEBUG_SCHOOL_PREFIX);

const debugSchoolPrefix = (...args) => {
  if (isSchoolDebugEnabled()) {
    console.log(...args);
  }
};

const normalizeSchoolPrefix = (value) => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || /\s/.test(normalized) || normalized.includes(".")) {
    return null;
  }

  return normalized;
};

const hasPermission = (permission) => {
  return (req, res, next) => {
    const user = req.user;
    if (user.type === UserType.SUPERUSER || user.hasPermission(permission)) {
      return next();
    }
    return res.status(403).json({ message: "Not authorized" });
  };
};

const isUserType = (type) => (req, res, next) => {
  if (req.user.type === type) {
    return next();
  }
  return res.status(403).json({ message: "Not authorized" });
};

// Identifies the school prefix for protected routes without breaking when user is missing.
const schoolIdentifier = (req, res, next) => {
  const user = req ? req.user : null;
  const querySchool = req && req.query ? req.query.school : null;

  let schoolPrefix = null;

  if (user && user.type === UserType.SUPERUSER) {
    const normalizedQuery = normalizeSchoolPrefix(querySchool);
    if (normalizedQuery) {
      schoolPrefix = normalizedQuery;
    } else {
      schoolPrefix = getSchoolFromEmail(user.email);
    }
  } else if (user && user.email) {
    schoolPrefix = getSchoolFromEmail(user.email);
  }

  if (req) {
    req.schoolPrefix = schoolPrefix;
  }

  debugSchoolPrefix("schoolIdentifier", {
    hasUser: Boolean(user),
    userType: user ? user.type : null,
    hasQuerySchool: typeof querySchool === "string",
    schoolPrefix,
  });

  return next();
};

const isStaff = isUserType(UserType.STAFF);
const isStudent = isUserType(UserType.STUDENT);
const isTeacher = isUserType(UserType.TEACHER);
const isSuperuser = isUserType(UserType.SUPERUSER);

module.exports = {
  hasPermission,
  isStaff,
  isStudent,
  isTeacher,
  isSuperuser,
  schoolIdentifier,
};
