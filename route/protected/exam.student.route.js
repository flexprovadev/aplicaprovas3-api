const express = require("express");
const multer = require("multer");
const router = express.Router();
const { ExamStudent, Course } = require("../../model");
const { isStudent } = require("../../middleware");
const { ExamStudentStatus, StorageFolder } = require("../../enumerator");
const { doStudentUpload, createPresignedUpload } = require("../../util/s3.util");
const { isQuestionAnswerValid } = require("../../util/question.util");
const { applyTimezone } = require("../../util/date.util");
const { scheduleGrade } = require("../../util/grade.util");
const { createSchoolFilter } = require("../../util/school.util");

const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
});

const decodeSafe = (value = "") => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const sanitizeReferenceName = (value = "") => {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
};

const extractResultReferenceToken = (url = "") => {
  if (!url || typeof url !== "string") {
    return "";
  }

  const withoutQuery = url.split("?")[0].split("#")[0];
  const filenameWithPrefix = decodeSafe(
    withoutQuery.substring(withoutQuery.lastIndexOf("/") + 1)
  );
  const underscoreIdx = filenameWithPrefix.indexOf("_");
  const filename =
    underscoreIdx > 30 && underscoreIdx < 40
      ? filenameWithPrefix.substring(underscoreIdx + 1)
      : filenameWithPrefix;
  const dotIndex = filename.lastIndexOf(".");
  const baseName = dotIndex > 0 ? filename.substring(0, dotIndex) : filename;
  return sanitizeReferenceName(baseName);
};

const matchesResultToken = (fileToken = "", token = "") => {
  if (!fileToken || !token) {
    return false;
  }

  return (
    fileToken === token ||
    fileToken.startsWith(`${token}_`) ||
    fileToken.startsWith(`${token}-`) ||
    fileToken.endsWith(`_${token}`) ||
    fileToken.endsWith(`-${token}`)
  );
};

const findIndividualResultUrl = (urls = [], student = {}) => {
  const tokens = [
    sanitizeReferenceName(student.email),
    sanitizeReferenceName(student.uuid),
  ].filter(Boolean);

  for (const token of tokens) {
    for (let index = urls.length - 1; index >= 0; index -= 1) {
      const resultUrl = urls[index];
      const fileToken = extractResultReferenceToken(resultUrl);
      if (matchesResultToken(fileToken, token)) {
        return resultUrl;
      }
    }
  }

  return null;
};

router.get("/:uuid", isStudent, async (req, res) => {
  try {
    const { user: student } = req;
    const { uuid } = req.params;

    const examMatch = createSchoolFilter(req.schoolPrefix, "name");

    const examStudent = await ExamStudent.findOne({
      uuid,
      student,
      status: ExamStudentStatus.PROGRESS,
    })
      .populate({
        path: "exam",
        ...(examMatch ? { match: examMatch } : {}),
      })
      .lean();

    if (!examStudent || !examStudent.exam) {
      throw new Error();
    }

    const { answers = {}, exam, createdAt } = examStudent;
    const { questions: examQuestions, documentUrl, durationExam, name } = exam;

    const questions = examQuestions.map((question) => {
      const { type, label, uuid } = question;
      const answer = answers[uuid] || { value: "", skipped: false };
      return { type, label, uuid, answer };
    });

    return res.json({
      questions,
      documentUrl,
      name,
      uuid,
      durationExam,
      createdAt: +createdAt,
      currentTimeStamp: Date.now(),
    });
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar prova" });
  }
});

router.get("/:uuid/receipt", isStudent, async (req, res) => {
  try {
    const { user: student } = req;
    const { uuid } = req.params;

    const examMatch = createSchoolFilter(req.schoolPrefix, "name");

    const examStudent = await ExamStudent.findOne({
      uuid,
      student,
      status: ExamStudentStatus.SUBMITTED,
    })
      .populate({
        path: "exam",
        ...(examMatch ? { match: examMatch } : {}),
      })
      .lean();

    const courses = await Course.find().lean();

    if (!examStudent || !examStudent.exam) {
      throw new Error();
    }

    const { answers, exam, grade, createdAt, submittedAt } = examStudent;
    const {
      questions: examQuestions,
      documentUrl,
      name,
      individualResultsURLs = [],
    } = exam;
    const individualResultUrl = findIndividualResultUrl(
      individualResultsURLs,
      student
    );

    const questions = examQuestions
      .filter(({ uuid }) => answers[uuid])
      .map((question) => {
        const { type, label, course, uuid } = question;
        const answer = answers[uuid];
        const { value: studentAnswer, grade } = answer;
        return {
          type,
          label,
          grade,
          studentAnswer,
          course: course
            ? courses.find(({ uuid }) => uuid === course).name
            : "",
        };
      });

    return res.json({
      questions,
      documentUrl,
      name,
      grade,
      individualResultUrl,
      createdAt: applyTimezone(createdAt),
      submittedAt: applyTimezone(submittedAt),
    });
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar comprovante" });
  }
});

router.post("/:uuid/submit", isStudent, async (req, res) => {
  try {
    const { user: student } = req;
    const { uuid } = req.params;
    const { answers } = req.body;

    const examMatch = createSchoolFilter(req.schoolPrefix, "name");

    const examStudent = await ExamStudent.findOne({
      student,
      uuid,
      status: ExamStudentStatus.PROGRESS,
    }).populate({
      path: "exam",
      ...(examMatch ? { match: examMatch } : {}),
    });

    if (!examStudent || !examStudent.exam) {
      throw new Error("Prova do aluno não encontrada");
    }

    const {
      exam: { questions },
    } = examStudent;

    const latestAnswers = { ...examStudent.answers, ...answers };

    Object.entries(latestAnswers).forEach(([questionUuid, answer]) => {
      const question = questions.find((next) => next.uuid === questionUuid);
      if (!isQuestionAnswerValid(answer, question, false)) {
        throw new Error("Resposta invalida");
      }
    });

    Object.assign(examStudent, {
      answers: latestAnswers,
      submittedAt: Date.now(),
      status: ExamStudentStatus.SUBMITTED,
    });

    await examStudent.save();

    scheduleGrade(examStudent.exam);

    return res.sendStatus(204);
  } catch (ex) {
    const { message = "Erro ao enviar prova" } = ex;
    return res.status(400).json({ message });
  }
});

router.post(
  "/:uuid/upload/presign",
  isStudent,
  async (req, res) => {
    try {
      const { user: student } = req;
      const { uuid } = req.params;
      const { name, type } = req.body;

      const examMatch = createSchoolFilter(req.schoolPrefix, "name");

      const examStudent = await ExamStudent.findOne({
        student,
        uuid,
        status: ExamStudentStatus.PROGRESS,
      })
        .populate({
          path: "exam",
          ...(examMatch ? { match: examMatch } : {}),
        })
        .lean();

      if (!examStudent || !examStudent.exam) {
        throw new Error("Prova não encontrada ou não está em progresso");
      }

      const { uuid: examStudentUuid, exam } = examStudent;
      const { uuid: examUuid } = exam;

      const prefix = `${StorageFolder.EXAMS}/${examUuid}/${examStudentUuid}`;
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
  "/:uuid/upload",
  upload.single("file"),
  isStudent,
  async (req, res) => {
    try {
      const { user: student } = req;
      const { uuid } = req.params;

      const examMatch = createSchoolFilter(req.schoolPrefix, "name");

      const examStudent = await ExamStudent.findOne({
        student,
        uuid,
        status: ExamStudentStatus.PROGRESS,
      })
        .populate({
          path: "exam",
          ...(examMatch ? { match: examMatch } : {}),
        })
        .lean();

      if (!examStudent || !examStudent.exam) {
        throw new Error();
      }

      doStudentUpload(examStudent, req, res);
    } catch (ex) {
      const { message = "Erro ao enviar arquivo" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.put("/:uuid/answer/:answerUuid", isStudent, async (req, res) => {
  try {
    const { user: student } = req;
    const { uuid, answerUuid } = req.params;
    const { value, skipped } = req.body;

    const examMatch = createSchoolFilter(req.schoolPrefix, "name");

    const examStudent = await ExamStudent.findOne({
      uuid,
      student,
      status: ExamStudentStatus.PROGRESS,
    }).populate({
      path: "exam",
      ...(examMatch ? { match: examMatch } : {}),
    });

    if (!examStudent || !examStudent.exam) {
      throw new Error("Prova do aluno não encontrada");
    }

    const {
      exam: { questions },
    } = examStudent;

    const answer = {
      value: !!skipped ? "" : value || "",
      skipped: !!skipped,
    };

    const question = questions.find(({ uuid }) => uuid === answerUuid);

    if (!question) {
      throw new Error("Questão não encontrada");
    }

    if (!isQuestionAnswerValid(answer, question)) {
      throw new Error("Resposta inválida");
    }

    examStudent.answers = {
      ...examStudent.answers,
      [answerUuid]: answer,
    };

    await examStudent.save();

    return res.sendStatus(204);
  } catch (ex) {
    const { message = "Erro ao salvar resposta" } = ex;
    return res.status(400).json({ message });
  }
});

module.exports = router;
