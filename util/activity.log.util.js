const { ActivityLog } = require("../model");
const { UserType } = require("../enumerator");

const ActivityAction = {
  UPLOAD: "upload",
  DOWNLOAD: "download",
  DELETE: "delete",
};

const FileTypeKey = {
  NAMELIST: "exam.field.namelist",
  DOCUMENT: "exam.field.document",
  PRELIMINARY_KEY: "exam.field.preliminarkey",
  FINAL_KEY: "exam.field.finalkey",
  PRINTABLE_ANSWER_SHEETS: "exam.field.printableAnswerSheets",
  ANSWER_SHEET_IMAGES: "exam.field.answerSheetImages",
  CLASSIFICATION_1: "exam.field.classification1",
  CLASSIFICATION_2: "exam.field.classification2",
  INDIVIDUAL_RESULTS: "exam.field.individualResults",
};

const TRACKED_USER_TYPES = [UserType.STAFF, UserType.SUPERUSER];
const TRACKED_FILE_TYPES = new Set(Object.values(FileTypeKey));
const TRACKED_ACTIONS = new Set(Object.values(ActivityAction));

const isTrackedUser = (user) => {
  if (!user || !user.type) {
    return false;
  }
  return TRACKED_USER_TYPES.includes(user.type);
};

const getUsernameFromEmail = (email = "") => {
  if (!email || typeof email !== "string") {
    return "";
  }
  const localPart = email.split("@")[0] || "";
  return localPart.trim();
};

const decodeSafe = (value = "") => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const extractFileNameFromUrl = (url = "") => {
  if (!url || typeof url !== "string") {
    return "";
  }
  const withoutQuery = url.split("?")[0];
  const parts = withoutQuery.split("/");
  const last = parts[parts.length - 1] || "";
  return decodeSafe(last);
};

const shouldTrack = ({ user, action, fileTypeKey }) => {
  if (!isTrackedUser(user)) {
    return false;
  }
  if (!TRACKED_ACTIONS.has(action)) {
    return false;
  }
  if (!TRACKED_FILE_TYPES.has(fileTypeKey)) {
    return false;
  }
  return true;
};

const createActivityLog = async ({
  user,
  action,
  fileTypeKey,
  fileName,
  fileUrl,
  examUuid,
  schoolPrefix,
}) => {
  try {
    if (!shouldTrack({ user, action, fileTypeKey })) {
      return null;
    }

    const resolvedFileName =
      (typeof fileName === "string" ? fileName.trim() : "") ||
      extractFileNameFromUrl(fileUrl);

    return await ActivityLog.create({
      userId: user._id,
      name: user.name || "",
      username: getUsernameFromEmail(user.email),
      email: user.email || "",
      role: user.type,
      action,
      fileTypeKey,
      fileName: resolvedFileName,
      fileUrl: fileUrl || "",
      examUuid: examUuid || "",
      schoolPrefix: schoolPrefix || "",
    });
  } catch (error) {
    // Logging must not impact the main request flow.
    console.error("Failed to create activity log:", error?.message || error);
    return null;
  }
};

const parsePagination = (query = {}) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limitOptions = [25, 50, 100];
  const requestedLimit = parseInt(query.limit, 10);
  const limit = limitOptions.includes(requestedLimit) ? requestedLimit : 25;
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

module.exports = {
  ActivityAction,
  FileTypeKey,
  createActivityLog,
  isTrackedUser,
  parsePagination,
  extractFileNameFromUrl,
};
