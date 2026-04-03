const config = require("../../config");
const express = require("express");
const router = express.Router();
const { Classroom, Exam, ExamStudent, Course, ActivityLog } = require("../../model");
const multer = require("multer");
const {
  doExamUpload,
  doPreliminarkeyUpload,
  doEditableDocumentUpload,
  doFinalkeyUpload,
  doNamelistUpload,
  doAnswerSheetImageUpload,
  doClassification1Upload,
  doClassification2Upload,
  doIndividualResultsUpload,
  doPrintableAnswerSheetUpload,
  createPresignedUpload,
  buildPublicUrl,
} = require("../../util/s3.util");
const {
  Permission,
  QuestionType,
  ExamStudentStatus,
  StorageFolder,
  UserType,
} = require("../../enumerator");
const { hasPermission, isStudent } = require("../../middleware");
const { v4: uuidv4 } = require("uuid");
const { DateTime } = require("luxon");
const { applyTimezone } = require("../../util/date.util");
const { generateArchive } = require("../../util/exam.export.util");
const { importCsvAnswers } = require("../../util/import.csv.answers.util");
const { addSchoolPrefix, createSchoolFilter } = require("../../util/school.util");
const {
  ActivityAction,
  FileTypeKey,
  createActivityLog,
  isTrackedUser,
  parsePagination,
  parseActivityLogFilters,
  extractFileNameFromUrl,
} = require("../../util/activity.log.util");

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_ANSWER_SHEET_IMAGE_SIZE_BYTES = 500 * 1024 * 1024; // 500MB (para imagens de folhas de respostas)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
});

const uploadAnswerSheetImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ANSWER_SHEET_IMAGE_SIZE_BYTES },
});

const questionFilter = (question) =>
  [
    QuestionType.A,
    QuestionType.B,
    QuestionType.C,
    QuestionType.D,
    QuestionType.ENEM,
    QuestionType.F,
  ].includes(question.type);

const questionMapper = (question) => ({
  ...question,
  uuid: question.uuid || uuidv4(),
});

const normalizeQuestions = (questions = []) =>
  questions.filter(questionFilter).map(questionMapper);

const hasAnswerKeyFile = (exam = {}) =>
  Boolean(exam?.preliminarkeyURL || exam?.finalkeyURL);

const isAnswerKeyReleased = (exam = {}, currentDate) =>
  Boolean(exam?.endAt && exam.endAt < currentDate);

const answerKeyMapper = (exam = {}) => {
  const { uuid, name, preliminarkeyURL = null, finalkeyURL = null } = exam;
  return { uuid, name, preliminarkeyURL, finalkeyURL };
};

const LEGACY_PUT_FILE_FIELDS_ENABLED =
  process.env.EXAM_ALLOW_LEGACY_FILE_FIELDS_IN_PUT !== "false";

const PUT_METADATA_FIELDS = new Set([
  "name",
  "startAt",
  "endAt",
  "durationExam",
  "instructions",
  "gradeStrategy",
  "gradeOptions",
  "questions",
  "classrooms",
]);

const PUT_GENERAL_FILE_FIELDS = new Set([
  "documentUrl",
  "namelistURL",
  "preliminarkeyURL",
  "finalkeyURL",
  "editableDocumentURL",
  "answerSheetImages",
  "printableAnswerSheetURLs",
]);

const PUT_RESULT_FILE_FIELDS = new Set([
  "classification1URL",
  "classification2URL",
  "individualResultsURLs",
]);

const canDownloadResults = (user) => {
  if (!user) {
    return false;
  }
  return user.getPermissions().includes(Permission.DOWNLOAD_RESULTS.key);
};

const canEditExam = (user) => {
  if (!user) {
    return false;
  }
  return (
    user.type === UserType.SUPERUSER ||
    user.getPermissions().includes(Permission.UPDATE_EXAM.key)
  );
};

const canManageResults = (user) => canEditExam(user) && canDownloadResults(user);

const hasAnyPathSegmentAfterPrefix = (key, prefix) => {
  const marker = `${prefix}/`;
  const markerIndex = key.indexOf(marker);
  if (markerIndex === -1) {
    return "";
  }
  return key.substring(markerIndex + marker.length);
};

const isValidKeyForPrefix = ({ key, prefix, allowNested = false }) => {
  if (!key || typeof key !== "string") {
    return false;
  }

  const suffix = hasAnyPathSegmentAfterPrefix(key, prefix);
  if (!suffix) {
    return false;
  }

  if (!allowNested && suffix.includes("/")) {
    return false;
  }

  return true;
};

const getExamFilter = (examUuid, schoolPrefix) => ({
  uuid: examUuid,
  ...(createSchoolFilter(schoolPrefix, "name") || {}),
});

const assertCanManageResults = (req, res) => {
  if (canManageResults(req.user)) {
    return true;
  }
  res.status(403).json({ message: "Not authorized" });
  return false;
};

const filterExamPutBody = (payload = {}, { user }) => {
  const allowedFields = new Set(PUT_METADATA_FIELDS);

  if (LEGACY_PUT_FILE_FIELDS_ENABLED) {
    PUT_GENERAL_FILE_FIELDS.forEach((field) => allowedFields.add(field));
    if (canManageResults(user)) {
      PUT_RESULT_FILE_FIELDS.forEach((field) => allowedFields.add(field));
    }
  }

  return Object.entries(payload).reduce((acc, [field, value]) => {
    if (allowedFields.has(field)) {
      acc[field] = value;
    }
    return acc;
  }, {});
};

const clearSingleFileField = async ({
  examUuid,
  schoolPrefix,
  field,
  fileTypeKey,
  user,
}) => {
  const exam = await Exam.findOne(getExamFilter(examUuid, schoolPrefix))
    .select(`_id ${field}`)
    .lean();

  if (!exam) {
    throw new Error("Não foi possível encontrar a prova");
  }

  const previousValue = exam[field] || null;
  if (previousValue) {
    await createActivityLog({
      user,
      action: ActivityAction.DELETE,
      fileTypeKey,
      fileName: extractFileNameFromUrl(previousValue),
      fileUrl: previousValue,
      examUuid,
      schoolPrefix,
    });
  }

  await Exam.updateOne({ _id: exam._id }, { [field]: null });
};

const isFieldCleared = (value) =>
  value === null || (typeof value === "string" && value.trim() === "");

const resolveFileName = (req, fallbackUrl) =>
  req?.body?.name || extractFileNameFromUrl(fallbackUrl);

const RESULT_FILE_TYPE_KEYS = new Set([
  FileTypeKey.CLASSIFICATION_1,
  FileTypeKey.CLASSIFICATION_2,
  FileTypeKey.INDIVIDUAL_RESULTS,
]);

router.get(
  "/activity-logs",
  hasPermission(Permission.READ_EXAM.key),
  async (req, res) => {
    try {
      if (!isTrackedUser(req.user)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { page, limit, skip } = parsePagination(req.query);
      const { filters, examNameRegex } = parseActivityLogFilters(req.query);
      const queryFilter = req.schoolPrefix
        ? { schoolPrefix: req.schoolPrefix, ...filters }
        : { ...filters };

      if (examNameRegex) {
        const schoolExamFilter = createSchoolFilter(req.schoolPrefix, "name");
        const examQuery = schoolExamFilter
          ? { $and: [schoolExamFilter, { name: examNameRegex }] }
          : { name: examNameRegex };

        const filteredExams = await Exam.find(examQuery).select("uuid").lean();
        const filteredExamUuids = filteredExams
          .map(({ uuid }) => uuid)
          .filter(Boolean);

        if (!filteredExamUuids.length) {
          return res.json({ data: [], total: 0, page, limit });
        }

        queryFilter.examUuid = { $in: filteredExamUuids };
      }

      const [logs, total] = await Promise.all([
        ActivityLog.find(queryFilter)
          .select(
            "uuid name username action fileTypeKey fileName fileUrl examUuid createdAt"
          )
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ActivityLog.countDocuments(queryFilter),
      ]);

      const examUuids = [
        ...new Set(logs.map(({ examUuid }) => examUuid).filter(Boolean)),
      ];
      const examFilter = createSchoolFilter(req.schoolPrefix, "name");
      const examQuery = { uuid: { $in: examUuids } };
      if (examFilter) {
        Object.assign(examQuery, examFilter);
      }

      let examNameByUuid = new Map();
      if (examUuids.length) {
        const exams = await Exam.find(examQuery).select("uuid name").lean();
        examNameByUuid = new Map(
          exams.map(({ uuid, name }) => [uuid, name || ""])
        );
      }

      const canEditExamFiles =
        req.user.type === UserType.SUPERUSER ||
        Boolean(req.user.hasPermission(Permission.UPDATE_EXAM.key));
      const canDownloadResultsFiles = canDownloadResults(req.user);

      const logsWithExamName = logs.map((entry) => ({
        ...entry,
        fileUrl: RESULT_FILE_TYPE_KEYS.has(entry.fileTypeKey)
          ? canDownloadResultsFiles
            ? entry.fileUrl || ""
            : ""
          : canEditExamFiles
            ? entry.fileUrl || ""
            : "",
        examName: examNameByUuid.get(entry.examUuid) || "",
      }));

      return res.json({ data: logsWithExamName, total, page, limit });
    } catch (ex) {
      const { message = "Erro ao recuperar logs de atividade" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/activity-logs",
  hasPermission(Permission.READ_EXAM.key),
  async (req, res) => {
    try {
      if (!isTrackedUser(req.user)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { uuid: examUuid } = req.params;
      const { action, fileTypeKey, fileName, fileUrl } = req.body || {};

      await createActivityLog({
        user: req.user,
        action,
        fileTypeKey,
        fileName,
        fileUrl,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.status(204).send();
    } catch (ex) {
      const { message = "Erro ao registrar atividade" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get("", hasPermission(Permission.READ_EXAM.key), async (req, res) => {
  try {
    const studentsSelectFields = "-_id uuid name email";

    const examFilter = createSchoolFilter(req.schoolPrefix, "name") || {};
    const classroomMatch = createSchoolFilter(req.schoolPrefix, "name");
    const studentMatch = createSchoolFilter(req.schoolPrefix, "email");

    const exams = await Exam.find(examFilter)
      .populate([
        {
          path: "classrooms",
          select: "-_id uuid name year level",
          ...(classroomMatch ? { match: classroomMatch } : {}),
          populate: {
            path: "students",
            select: studentsSelectFields,
            ...(studentMatch ? { match: studentMatch } : {}),
          },
        },
        {
          path: "examsInProgress",
          select: "-_id -exam uuid createdAt",
          populate: {
            path: "student",
            select: studentsSelectFields,
            ...(studentMatch ? { match: studentMatch } : {}),
          },
        },
        {
          path: "examsSubmitted",
          select: "-_id -exam uuid createdAt submittedAt",
          populate: {
            path: "student",
            select: studentsSelectFields,
            ...(studentMatch ? { match: studentMatch } : {}),
          },
        },
      ])
      .select(
        "uuid name classrooms startAt endAt durationExam examsInProgress examsSubmitted"
      )
      .lean();

    const studentMapper = (entry) => entry.student.email;

    const studentExistsFilter = (entry) => entry.student;

    const examStudentMapper = (examStudent) => {
      const { uuid, name, email } = examStudent.student;
      return { uuid, name, email };
    };

    exams.forEach((exam) => {
      const { examsInProgress, examsSubmitted, classrooms } = exam;
      let examsPending = [];
      const studentsInProgress = examsInProgress
        .filter(studentExistsFilter)
        .map(studentMapper);
      const studentsSubmitted = examsSubmitted
        .filter(studentExistsFilter)
        .map(studentMapper);
      classrooms.forEach((classroom) => {
        const studentsPending = classroom.students.filter(
          ({ email }) =>
            !studentsInProgress.includes(email) &&
            !studentsSubmitted.includes(email)
        );
        examsPending = examsPending.concat(studentsPending);
      });
      Object.assign(exam, { examsPending });
      exam.examsInProgress = exam.examsInProgress
        .filter(studentExistsFilter)
        .map(examStudentMapper);
      exam.examsSubmitted = exam.examsSubmitted
        .filter(studentExistsFilter)
        .map(examStudentMapper);
    });

    return res.json(exams);
  } catch (ex) {
    const { message = "Erro ao recuperar provas" } = ex;
    return res.status(400).json({ message });
  }
});

router.get("/available", isStudent, async (req, res) => {
  try {
    const { user: student } = req;

    const examMatch = createSchoolFilter(req.schoolPrefix, "name");
    const classroomMatch = createSchoolFilter(req.schoolPrefix, "name");
    const currentDateTime = DateTime.local();
    const currentDate = currentDateTime.toJSDate();
    const comingSoonLimitDate = currentDateTime
      .plus({ days: config.exam.comingSoonMaxDays })
      .toJSDate();

    const examsInProgress = await ExamStudent.find({
      student,
      status: ExamStudentStatus.PROGRESS,
    })
      .populate({
        path: "exam",
        ...(examMatch ? { match: examMatch } : {}),
      })
      .lean();

    const examsSubmitted = await ExamStudent.find({
      student,
      status: ExamStudentStatus.SUBMITTED,
    })
      .populate({
        path: "exam",
        ...(examMatch ? { match: examMatch } : {}),
      })
      .lean();

    const examStudentMapper = (entry) => {
      const { exam } = entry;
      const { uuid, name, startAt, endAt, durationExam } = exam;
      return {
        uuid,
        name,
        durationExam,
        startAt: applyTimezone(startAt),
        endAt: applyTimezone(endAt),
      };
    };

    const examExistsFilter = (entry) => entry.exam;

    const progress = examsInProgress.filter(examExistsFilter).map(examStudentMapper);

    const done = examsSubmitted.filter(examExistsFilter).map(examStudentMapper);

    const answerKeysFromSubmitted = examsSubmitted
      .filter(examExistsFilter)
      .map(({ exam }) => exam)
      .filter(
        (exam) => isAnswerKeyReleased(exam, currentDate) && hasAnswerKeyFile(exam)
      )
      .map(answerKeyMapper);

    const unavailableUuids = [...progress, ...done].map((entry) => entry.uuid);

    const classrooms = await Classroom.find({
      enabled: true,
      students: { $in: [student] },
      ...(classroomMatch || {}),
    })
      .select("_id")
      .lean();

    const examFilter = examMatch || {};

    const availableExams = await Exam.find({
      ...examFilter,
      classrooms: { $in: classrooms },
      uuid: { $nin: unavailableUuids },
      $or: [
        { startAt: null },
        {
          startAt: { $lte: currentDate },
          $or: [{ endAt: null }, { endAt: { $gte: currentDate } }],
        },
      ],
    }).lean();

    const comingSoonExams = await Exam.find({
      ...examFilter,
      classrooms: { $in: classrooms },
      uuid: { $nin: unavailableUuids },
      startAt: {
        $gte: currentDate,
        $lte: comingSoonLimitDate,
      },
    });

    const answerKeyExams = await Exam.find({
      ...examFilter,
      classrooms: { $in: classrooms },
      uuid: { $nin: unavailableUuids },
      endAt: { $lt: currentDate },
      $or: [
        { preliminarkeyURL: { $exists: true, $nin: [null, ""] } },
        { finalkeyURL: { $exists: true, $nin: [null, ""] } },
      ],
    }).lean();

    const exampMapper = (entry) => {
      const { uuid, name, startAt, endAt, durationExam } = entry;
      return {
        uuid,
        name,
        durationExam,
        startAt: applyTimezone(startAt),
        endAt: applyTimezone(endAt),
      };
    };

    const available = availableExams.map(exampMapper);

    const comingSoon = comingSoonExams.map(exampMapper);
    const answerKeys = [
      ...answerKeysFromSubmitted,
      ...answerKeyExams.map(answerKeyMapper),
    ];

    return res.json({
      done,
      available,
      progress,
      comingSoon,
      answerKeys,
    });
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar provas" });
  }
});

router.get(
  "/:uuid",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };
      const classroomMatch = createSchoolFilter(req.schoolPrefix, "name");
      const studentMatch = createSchoolFilter(req.schoolPrefix, "email");

      const exam = await Exam.findOne(examFilter)
        .populate([
          {
            path: "classrooms",
            select: "-_id uuid name",
            ...(classroomMatch ? { match: classroomMatch } : {}),
          },
          {
            path: "examsInProgress",
            select: "-_id -exam uuid createdAt",
            populate: {
              path: "student",
              select: "-_id email",
              ...(studentMatch ? { match: studentMatch } : {}),
            },
          },
          {
            path: "examsSubmitted",
            select: "-_id -exam uuid createdAt submittedAt",
            populate: {
              path: "student",
              select: "-_id email",
              ...(studentMatch ? { match: studentMatch } : {}),
            },
          },
        ])
        .select(
          "uuid name startAt endAt durationExam instructions documentUrl namelistURL preliminarkeyURL finalkeyURL editableDocumentURL answerSheetImages printableAnswerSheetURLs classification1URL classification2URL individualResultsURLs questions gradeStrategy gradeOptions"
        )
        .lean();

      if (!exam) {
        throw new Error("Erro ao recuperar prova");
      }

      if (!canDownloadResults(req.user)) {
        exam.classification1URL = null;
        exam.classification2URL = null;
        exam.individualResultsURLs = [];
      }

      const courseUuids = exam.questions.reduce((acc, { course }) => {
        if (!acc.includes(course)) {
          acc.push(course);
        }
        return acc;
      }, []);

      const courses = await Course.find({ uuid: { $in: courseUuids } })
        .select("-_id uuid name")
        .lean();

      const coursesMap = courses.reduce(
        (acc, { uuid, name }) => ({
          ...acc,
          [uuid]: name,
        }),
        {}
      );

      exam.questions.forEach((question, index) => {
        Object.assign(question, {
          id: index + 1,
          course: {
            uuid: question.course,
            name: coursesMap[question.course],
          },
        });
      });

      return res.json(exam);
    } catch (ex) {
      const { message = "Erro ao recuperar prova" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get(
  "/:uuid/export",
  hasPermission(Permission.EXPORT_EXAM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter);

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const archive = await generateArchive(exam);

      archive.pipe(res);
      archive.finalize();
    } catch (ex) {
      const { message = "Erro ao recuperar prova" } = ex;
      return res.status(400).json({ message });
    }
  }
);

//// TRECHO ALTERADO PARA INCLUIR A gradeStrategy na definição de prova

router.post("", hasPermission(Permission.CREATE_EXAM.key), async (req, res) => {
  try {
    if (!req.schoolPrefix) {
      return res.status(400).json({ message: "Escola não identificada" });
    }

    const { questions, classrooms: classroomUuids, gradeStrategy } = req.body;
    const prefixedName = addSchoolPrefix(req.body.name, req.schoolPrefix);

    const classroomFilter = createSchoolFilter(req.schoolPrefix, "name") || {};

    const classrooms = await Classroom.find({
      uuid: classroomUuids,
      ...classroomFilter,
    }).select("uuid");

    if (
      Array.isArray(classroomUuids) &&
      classroomUuids.length !== classrooms.length
    ) {
      return res
        .status(400)
        .json({ message: "Turma pertence a outra escola" });
    }

    const exam = await Exam.create({
      ...req.body,
      name: prefixedName,
      gradeStrategy,
      questions: normalizeQuestions(questions),
      classrooms,
    });

    if (!exam) {
      throw new Error("Não foi possível encontrar a prova");
    }

    const { uuid } = exam;
    return res.json({ uuid });
  } catch (ex) {
    const { message = "Erro ao criar prova" } = ex;
    return res.status(400).json({ message });
  }
});

router.put("/:uuid", hasPermission(Permission.UPDATE_EXAM.key), async (req, res) => {
  try {
    const { uuid } = req.params;
    const sanitizedBody = filterExamPutBody(req.body, { user: req.user });
    const discardedFields = Object.keys(req.body || {}).filter(
      (field) => !Object.prototype.hasOwnProperty.call(sanitizedBody, field)
    );
    if (discardedFields.length) {
      console.warn(
        `[exam.put] Ignored unauthorized/unsupported fields for exam ${uuid}: ${discardedFields.join(
          ", "
        )}`
      );
    }

    const { questions, classrooms: classroomUuids, gradeStrategy } = sanitizedBody;
    const previousExam = await Exam.findOne({ uuid })
      .select(
        "documentUrl namelistURL preliminarkeyURL finalkeyURL editableDocumentURL classification1URL classification2URL"
      )
      .lean();

    if (classroomUuids !== undefined && !req.schoolPrefix) {
      return res.status(400).json({ message: "Escola não identificada" });
    }

    if (sanitizedBody.name !== undefined && !req.schoolPrefix) {
      return res.status(400).json({ message: "Escola não identificada" });
    }

    let classrooms;
    if (classroomUuids !== undefined) {
      const classroomFilter = createSchoolFilter(req.schoolPrefix, "name") || {};

      classrooms = await Classroom.find({
        uuid: classroomUuids,
        ...classroomFilter,
      }).select("uuid");

      if (
        Array.isArray(classroomUuids) &&
        classroomUuids.length !== classrooms.length
      ) {
        return res
          .status(400)
          .json({ message: "Turma pertence a outra escola" });
      }
    }

    const updateQuery = {
      ...sanitizedBody,
      ...(sanitizedBody.name !== undefined
        ? { name: addSchoolPrefix(sanitizedBody.name, req.schoolPrefix) }
        : {}),
      ...(gradeStrategy !== undefined ? { gradeStrategy } : {}),
      ...(questions !== undefined
        ? { questions: normalizeQuestions(questions) }
        : {}),
      ...(classroomUuids !== undefined ? { classrooms } : {}),
    };

    const exam = await Exam.findOneAndUpdate({ uuid }, updateQuery);

    if (!exam) {
      throw new Error("Não foi possível encontrar a prova");
    }

    const deleteFieldMap = [
      { field: "documentUrl", fileTypeKey: FileTypeKey.DOCUMENT },
      { field: "namelistURL", fileTypeKey: FileTypeKey.NAMELIST },
      { field: "preliminarkeyURL", fileTypeKey: FileTypeKey.PRELIMINARY_KEY },
      { field: "finalkeyURL", fileTypeKey: FileTypeKey.FINAL_KEY },
      { field: "editableDocumentURL", fileTypeKey: FileTypeKey.EDITABLE_DOCUMENT },
      { field: "classification1URL", fileTypeKey: FileTypeKey.CLASSIFICATION_1 },
      { field: "classification2URL", fileTypeKey: FileTypeKey.CLASSIFICATION_2 },
    ];

    for (const { field, fileTypeKey } of deleteFieldMap) {
      const shouldCheckField = Object.prototype.hasOwnProperty.call(
        sanitizedBody,
        field
      );
      if (!shouldCheckField) {
        continue;
      }

      const previousValue = previousExam ? previousExam[field] : null;
      const nextValue = sanitizedBody[field];
      if (previousValue && isFieldCleared(nextValue)) {
        await createActivityLog({
          user: req.user,
          action: ActivityAction.DELETE,
          fileTypeKey,
          fileName: extractFileNameFromUrl(previousValue),
          fileUrl: previousValue,
          examUuid: uuid,
          schoolPrefix: req.schoolPrefix,
        });
      }
    }

    return res.json({ message: "Prova atualizada com sucesso" });
  } catch (ex) {
    const { message = "Erro ao atualizar prova" } = ex;
    return res.status(400).json({ message });
  }
});

router.delete(
  "/:uuid/document",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      await clearSingleFileField({
        examUuid,
        schoolPrefix: req.schoolPrefix,
        field: "documentUrl",
        fileTypeKey: FileTypeKey.DOCUMENT,
        user: req.user,
      });
      return res.json({ message: "Documento removido com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover documento" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/namelist",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      await clearSingleFileField({
        examUuid,
        schoolPrefix: req.schoolPrefix,
        field: "namelistURL",
        fileTypeKey: FileTypeKey.NAMELIST,
        user: req.user,
      });
      return res.json({ message: "Lista de inscritos removida com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover lista de inscritos" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/preliminarkey",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      await clearSingleFileField({
        examUuid,
        schoolPrefix: req.schoolPrefix,
        field: "preliminarkeyURL",
        fileTypeKey: FileTypeKey.PRELIMINARY_KEY,
        user: req.user,
      });
      return res.json({ message: "Gabarito preliminar removido com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover gabarito preliminar" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/finalkey",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      await clearSingleFileField({
        examUuid,
        schoolPrefix: req.schoolPrefix,
        field: "finalkeyURL",
        fileTypeKey: FileTypeKey.FINAL_KEY,
        user: req.user,
      });
      return res.json({ message: "Gabarito final removido com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover gabarito final" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/editabledocument",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      await clearSingleFileField({
        examUuid,
        schoolPrefix: req.schoolPrefix,
        field: "editableDocumentURL",
        fileTypeKey: FileTypeKey.EDITABLE_DOCUMENT,
        user: req.user,
      });
      return res.json({ message: "Documento editável removido com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover documento editável" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/classification-1",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      await clearSingleFileField({
        examUuid,
        schoolPrefix: req.schoolPrefix,
        field: "classification1URL",
        fileTypeKey: FileTypeKey.CLASSIFICATION_1,
        user: req.user,
      });
      return res.json({ message: "Classificação 1 removida com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover classificação 1" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/classification-2",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      await clearSingleFileField({
        examUuid,
        schoolPrefix: req.schoolPrefix,
        field: "classification2URL",
        fileTypeKey: FileTypeKey.CLASSIFICATION_2,
        user: req.user,
      });
      return res.json({ message: "Classificação 2 removida com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover classificação 2" } = ex;
      return res.status(400).json({ message });
    }
  }
);


//// FIM DA ALTERAÇÃO

router.delete(
  "/:uuid",
  hasPermission(Permission.DELETE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const exam = await Exam.findOneAndDelete({ uuid });

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      return res.json({ message: "Prova removida com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover prova" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-answer-sheet-image",
  uploadAnswerSheetImages.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const { uuid, location } = await doAnswerSheetImageUpload(req, examUuid);

      await Exam.updateOne(
        { _id: exam._id },
        { $push: { answerSheetImages: location } }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.ANSWER_SHEET_IMAGES,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ uuid, location });
    } catch (ex) {
      const { message = "Erro ao enviar arquivo" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/answer-sheet-images/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.ANSWER_SHEET_IMAGES}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.ANSWER_SHEET_IMAGES,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/answer-sheet-images/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.ANSWER_SHEET_IMAGES}`;
      if (!key || !key.includes(expectedPrefix)) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne(
        { _id: exam._id },
        { $push: { answerSheetImages: location } }
      );

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get(
  "/:uuid/answer-sheet-images",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter)
        .select("answerSheetImages")
        .lean();

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      return res.json(exam.answerSheetImages || []);
    } catch (ex) {
      const { message = "Erro ao recuperar imagens" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/answer-sheet-images/:imageUrl",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid, imageUrl } = req.params;
      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      await Exam.updateOne(
        { _id: exam._id },
        { $pull: { answerSheetImages: imageUrl } }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.DELETE,
        fileTypeKey: FileTypeKey.ANSWER_SHEET_IMAGES,
        fileName: extractFileNameFromUrl(imageUrl),
        fileUrl: imageUrl,
        examUuid: uuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ message: "Imagem removida com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover imagem" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-printable-answer-sheets",
  uploadAnswerSheetImages.array("files"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const results = [];
      const locations = [];
      for (const file of req.files) {
        const singleFileReq = { ...req, file };
        const { uuid, location } = await doPrintableAnswerSheetUpload(
          singleFileReq,
          examUuid
        );
        results.push({ uuid, location });
        locations.push(location);
      }

      await Exam.updateOne(
        { _id: exam._id },
        { $push: { printableAnswerSheetURLs: { $each: locations } } }
      );

      for (const location of locations) {
        await createActivityLog({
          user: req.user,
          action: ActivityAction.UPLOAD,
          fileTypeKey: FileTypeKey.PRINTABLE_ANSWER_SHEETS,
          fileName: extractFileNameFromUrl(location),
          fileUrl: location,
          examUuid,
          schoolPrefix: req.schoolPrefix,
        });
      }

      return res.json({ locations, results });
    } catch (ex) {
      const { message = "Erro ao enviar arquivos" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get(
  "/:uuid/printable-answer-sheets",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter)
        .select("printableAnswerSheetURLs")
        .lean();

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      return res.json(exam.printableAnswerSheetURLs || []);
    } catch (ex) {
      const { message = "Erro ao recuperar cartões-resposta" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/printable-answer-sheets/:fileUrl",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid, fileUrl } = req.params;
      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      await Exam.updateOne(
        { _id: exam._id },
        { $pull: { printableAnswerSheetURLs: fileUrl } }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.DELETE,
        fileTypeKey: FileTypeKey.PRINTABLE_ANSWER_SHEETS,
        fileName: extractFileNameFromUrl(fileUrl),
        fileUrl,
        examUuid: uuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ message: "Cartão-resposta removido com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover cartão-resposta" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/upload/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { name, type } = req.body;

      const prefix = `${StorageFolder.EXAMS}`;
      const { uuid, key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.DOCUMENT,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ uuid, key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-document/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const exam = await Exam.findOne(getExamFilter(examUuid, req.schoolPrefix)).select(
        "_id"
      );

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-document/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const exam = await Exam.findOne(getExamFilter(examUuid, req.schoolPrefix)).select(
        "_id"
      );

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}`;
      if (!isValidKeyForPrefix({ key, prefix: expectedPrefix, allowNested: false })) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne({ _id: exam._id }, { documentUrl: location });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.DOCUMENT,
        fileName: extractFileNameFromUrl(location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/upload",
  upload.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      doExamUpload(req, res);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao enviar arquivo" });
    }
  }
);

router.post(
  "/:uuid/upload-preliminarkey",
  upload.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const { uuid, location } = await doPreliminarkeyUpload(req, examUuid);

      await Exam.updateOne(
        { _id: exam._id },
        { preliminarkeyURL: location }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.PRELIMINARY_KEY,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ uuid, location });
    } catch (ex) {
      const { message = "Erro ao enviar arquivo" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-preliminarkey/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.PRELIMINARKEY}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-preliminarkey/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const exam = await Exam.findOne(getExamFilter(examUuid, req.schoolPrefix)).select(
        "_id"
      );

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.PRELIMINARKEY}`;
      if (!isValidKeyForPrefix({ key, prefix: expectedPrefix })) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne({ _id: exam._id }, { preliminarkeyURL: location });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.PRELIMINARY_KEY,
        fileName: extractFileNameFromUrl(location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-finalkey",
  upload.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const { uuid, location } = await doFinalkeyUpload(req, examUuid);

      await Exam.updateOne(
        { _id: exam._id },
        { finalkeyURL: location }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.FINAL_KEY,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ uuid, location });
    } catch (ex) {
      const { message = "Erro ao enviar arquivo" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-finalkey/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.FINALKEY}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-finalkey/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const exam = await Exam.findOne(getExamFilter(examUuid, req.schoolPrefix)).select(
        "_id"
      );

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.FINALKEY}`;
      if (!isValidKeyForPrefix({ key, prefix: expectedPrefix })) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne({ _id: exam._id }, { finalkeyURL: location });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.FINAL_KEY,
        fileName: extractFileNameFromUrl(location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-editabledocument/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.EDITABLE_DOCUMENT}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-editabledocument/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const exam = await Exam.findOne(getExamFilter(examUuid, req.schoolPrefix)).select(
        "_id"
      );

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.EDITABLE_DOCUMENT}`;
      if (!isValidKeyForPrefix({ key, prefix: expectedPrefix })) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne({ _id: exam._id }, { editableDocumentURL: location });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.EDITABLE_DOCUMENT,
        fileName: extractFileNameFromUrl(location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-namelist/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.NAMELIST}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-namelist/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const exam = await Exam.findOne(getExamFilter(examUuid, req.schoolPrefix)).select(
        "_id"
      );

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.NAMELIST}`;
      if (!isValidKeyForPrefix({ key, prefix: expectedPrefix })) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne({ _id: exam._id }, { namelistURL: location });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.NAMELIST,
        fileName: extractFileNameFromUrl(location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-namelist",
  upload.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid: examUuid } = req.params;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const { uuid, location } = await doNamelistUpload(req, examUuid);

      await Exam.updateOne(
        { _id: exam._id },
        { namelistURL: location }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.NAMELIST,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ uuid, location });
    } catch (ex) {
      const { message = "Erro ao enviar arquivo" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-classification-1",
  upload.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const { uuid, location } = await doClassification1Upload(req, examUuid);

      await Exam.updateOne(
        { _id: exam._id },
        { classification1URL: location }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.CLASSIFICATION_1,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ uuid, location });
    } catch (ex) {
      const { message = "Erro ao enviar arquivo" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-classification-1/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.CLASSIFICATION_1}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.CLASSIFICATION_1,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-classification-1/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.CLASSIFICATION_1}`;
      if (!key || !key.includes(expectedPrefix)) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne(
        { _id: exam._id },
        { classification1URL: location }
      );

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-classification-2",
  upload.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const { uuid, location } = await doClassification2Upload(req, examUuid);

      await Exam.updateOne(
        { _id: exam._id },
        { classification2URL: location }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.CLASSIFICATION_2,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ uuid, location });
    } catch (ex) {
      const { message = "Erro ao enviar arquivo" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-classification-2/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.CLASSIFICATION_2}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.CLASSIFICATION_2,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-classification-2/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.CLASSIFICATION_2}`;
      if (!key || !key.includes(expectedPrefix)) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne(
        { _id: exam._id },
        { classification2URL: location }
      );

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/upload-individual-results",
  uploadAnswerSheetImages.array("files"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const results = [];
      const locations = [];
      for (const file of req.files) {
        const singleFileReq = { ...req, file };
        const { uuid, location } = await doIndividualResultsUpload(singleFileReq, examUuid);
        results.push({ uuid, location });
        locations.push(location);
      }

      await Exam.updateOne(
        { _id: exam._id },
        { $push: { individualResultsURLs: { $each: locations } } }
      );

      for (const location of locations) {
        await createActivityLog({
          user: req.user,
          action: ActivityAction.UPLOAD,
          fileTypeKey: FileTypeKey.INDIVIDUAL_RESULTS,
          fileName: extractFileNameFromUrl(location),
          fileUrl: location,
          examUuid,
          schoolPrefix: req.schoolPrefix,
        });
      }

      return res.json({ locations, results });
    } catch (ex) {
      const { message = "Erro ao enviar arquivos" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/individual-results/presign",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const { name, type } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.INDIVIDUAL_RESULTS}`;
      const { key, uploadUrl, location, headers } = await createPresignedUpload({
        prefix,
        contentType: type,
        originalName: name,
      });

      await createActivityLog({
        user: req.user,
        action: ActivityAction.UPLOAD,
        fileTypeKey: FileTypeKey.INDIVIDUAL_RESULTS,
        fileName: resolveFileName(req, location),
        fileUrl: location,
        examUuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ key, uploadUrl, location, headers });
    } catch (ex) {
      const { message = "Erro ao gerar URL de upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/individual-results/confirm",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid: examUuid } = req.params;
      const { key } = req.body;
      const examFilter = {
        uuid: examUuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const expectedPrefix = `${StorageFolder.EXAMS}/${examUuid}/${StorageFolder.INDIVIDUAL_RESULTS}`;
      if (!key || !key.includes(expectedPrefix)) {
        throw new Error("Key inválida para esta prova");
      }

      const location = buildPublicUrl(key);

      await Exam.updateOne(
        { _id: exam._id },
        { $push: { individualResultsURLs: location } }
      );

      return res.json({ location });
    } catch (ex) {
      const { message = "Erro ao confirmar upload" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get(
  "/:uuid/classification-1",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!canDownloadResults(req.user)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { uuid } = req.params;
      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter)
        .select("classification1URL")
        .lean();

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const fileUrl = exam.classification1URL || null;
      if (fileUrl) {
        await createActivityLog({
          user: req.user,
          action: ActivityAction.DOWNLOAD,
          fileTypeKey: FileTypeKey.CLASSIFICATION_1,
          fileName: extractFileNameFromUrl(fileUrl),
          fileUrl,
          examUuid: uuid,
          schoolPrefix: req.schoolPrefix,
        });
      }

      return res.json({ url: fileUrl });
    } catch (ex) {
      const { message = "Erro ao recuperar classificação" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get(
  "/:uuid/classification-2",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!canDownloadResults(req.user)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { uuid } = req.params;
      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter)
        .select("classification2URL")
        .lean();

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      const fileUrl = exam.classification2URL || null;
      if (fileUrl) {
        await createActivityLog({
          user: req.user,
          action: ActivityAction.DOWNLOAD,
          fileTypeKey: FileTypeKey.CLASSIFICATION_2,
          fileName: extractFileNameFromUrl(fileUrl),
          fileUrl,
          examUuid: uuid,
          schoolPrefix: req.schoolPrefix,
        });
      }

      return res.json({ url: fileUrl });
    } catch (ex) {
      const { message = "Erro ao recuperar classificação" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get(
  "/:uuid/individual-results",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!canDownloadResults(req.user)) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const { uuid } = req.params;
      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter)
        .select("individualResultsURLs")
        .lean();

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      return res.json(exam.individualResultsURLs || []);
    } catch (ex) {
      const { message = "Erro ao recuperar resultados individuais" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid/individual-results/:fileUrl",
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      if (!assertCanManageResults(req, res)) {
        return;
      }

      const { uuid, fileUrl } = req.params;
      const examFilter = {
        uuid,
        ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
      };

      const exam = await Exam.findOne(examFilter).select("_id");

      if (!exam) {
        throw new Error("Não foi possível encontrar a prova");
      }

      await Exam.updateOne(
        { _id: exam._id },
        { $pull: { individualResultsURLs: fileUrl } }
      );

      await createActivityLog({
        user: req.user,
        action: ActivityAction.DELETE,
        fileTypeKey: FileTypeKey.INDIVIDUAL_RESULTS,
        fileName: extractFileNameFromUrl(fileUrl),
        fileUrl,
        examUuid: uuid,
        schoolPrefix: req.schoolPrefix,
      });

      return res.json({ message: "Resultado individual removido com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover resultado individual" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/import-questions",
  upload.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    const errors = [];

    try {
      const { file } = req;

      const csvContent = file.buffer.toString("utf8").trim();
      const csvRows = csvContent.split("\n");

      const entries = [];
      const courseNames = new Set();

      for (csvRow of csvRows) {
        const [label, type, answer, course] = csvRow.trim().split(",");
        if (course) {
          courseNames.add(course);
        }
        entries.push({ uuid: uuidv4(), label, type, answer, course });
      }

      const courses = await Course.find({
        name: { $in: Array.from(courseNames) },
      })
        .select("-_id uuid name")
        .lean();

      const coursesMap = courses.reduce(
        (acc, next) => ({ ...acc, ...{ [next.name]: next.uuid } }),
        {}
      );

      entries.forEach((entry, index) => {
        const { course } = entry;
        if (course) {
          const uuid = coursesMap[course];

          if (!uuid) {
            errors.push({ index, message: "Curso não encontrado" });
          }

          Object.assign(entry, {
            course: {
              uuid,
              name: course,
            },
          });
        }
      });

      if (errors.length) {
        throw new Error("Erro ao importar questoes");
      }

      return res.status(200).send(entries);
    } catch (ex) {
      const { message } = ex;
      return res.status(400).json({ message, errors });
    }
  }
);

router.post(
  "/:uuid/import-answers",
  upload.single("file"),
  hasPermission(Permission.UPDATE_EXAM.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const { file } = req;
      const result = await importCsvAnswers(uuid, file.buffer);
      return res.json(result);
    } catch (ex) {
      const { message = "Erro ao importar respostas" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.get("/:uuid/take", isStudent, async (req, res) => {
  try {
    const { user: student } = req;
    const { uuid } = req.params;

    const classroomMatch = createSchoolFilter(req.schoolPrefix, "name");

    const classrooms = await Classroom.find({
      enabled: true,
      students: { $in: [student] },
      ...(classroomMatch || {}),
    })
      .select("_id")
      .lean();

    const exam = await Exam.findOne({
      uuid,
      classrooms: { $in: classrooms },
      enabled: true,
      ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
    });

    if (!exam) {
      throw new Error(
        "Prova inexistente, excluída ou não associada a uma turma a qual o aluno pertence"
      );
    }

    const redirect = ({ uuid }) => {
      return res.redirect(`/exam-students/${uuid}`);
    };

    // Busca qualquer registro existente (independente do status)
    let examStudent = await ExamStudent.findOne({ exam, student });

    if (examStudent) {
      if (examStudent.status === ExamStudentStatus.SUBMITTED) {
        throw new Error("Aluno não pode realizar a mesma prova duas vezes");
      }
      return redirect(examStudent); // prova em andamento
    }

    const currentDateTime = Date.now();

    if (exam.startAt && exam.startAt > currentDateTime) {
      throw new Error(
        "Não é permitido iniciar a prova antes da data de ínicio"
      );
    }

    if (exam.endAt && exam.endAt < currentDateTime) {
      throw new Error(
        "Não é permitido iniciar a prova depois da data de término"
      );
    }

    const answers = exam.questions.reduce((acc, next) => {
      acc[next.uuid] = {
        value: "",
        skipped: false,
      };
      return acc;
    }, {});

    try {
      examStudent = await ExamStudent.create({ exam, student, answers });
    } catch (error) {
      // Se E11000 (duplicate key), outra requisição criou primeiro - race condition
      if (error.code === 11000) {
        examStudent = await ExamStudent.findOne({ exam, student });
        if (examStudent) {
          return redirect(examStudent);
        }
      }
      throw error;
    }

    redirect(examStudent);
  } catch (ex) {
    const { message = "Erro ao iniciar prova" } = ex;
    return res.status(400).json({ message });
  }
});

router.get("/:uuid/receipt", isStudent, async (req, res) => {
  try {
    const { user: student } = req;
    const { uuid } = req.params;

    const exam = await Exam.findOne({
      uuid,
      enabled: true,
      ...(createSchoolFilter(req.schoolPrefix, "name") || {}),
    }).select("id");

    if (!exam) {
      throw new Error("Prova não encontrada");
    }

    const examStudent = await ExamStudent.findOne({
      exam,
      student,
      enabled: true,
    }).select("-_id uuid");

    if (!examStudent) {
      throw new Error("Prova do aluno não encontrada");
    }

    return res.redirect(`/exam-students/${examStudent.uuid}/receipt`);
  } catch (ex) {
    const { message = "Erro ao recuperar comprovante" } = ex;
    return res.status(400).json({ message });
  }
});

module.exports = router;
