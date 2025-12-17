const express = require("express");
const multer = require("multer");
const router = express.Router();
const { ExamStudent, Course } = require("../../model");
const { isStudent } = require("../../middleware");
const { ExamStudentStatus } = require("../../enumerator");
const { doStudentUpload } = require("../../util/s3.util");
const { isQuestionAnswerValid } = require("../../util/question.util");
const { applyTimezone } = require("../../util/date.util");
const { scheduleGrade } = require("../../util/grade.util");

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
});

router.get("/:uuid", isStudent, async (req, res) => {
  try {
    const { user: student } = req;
    const { uuid } = req.params;

    const examStudent = await ExamStudent.findOne({
      uuid,
      student,
      status: ExamStudentStatus.PROGRESS,
    })
      .populate("exam")
      .lean();

    if (!examStudent) {
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

    const examStudent = await ExamStudent.findOne({
      uuid,
      student,
      status: ExamStudentStatus.SUBMITTED,
    })
      .populate("exam")
      .lean();

    const courses = await Course.find().lean();

    if (!examStudent) {
      throw new Error();
    }

    const { answers, exam, grade, createdAt, submittedAt } = examStudent;
    const { questions: examQuestions, documentUrl, name } = exam;

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

    const examStudent = await ExamStudent.findOne({
      student,
      uuid,
      status: ExamStudentStatus.PROGRESS,
    }).populate("exam");

    const {
      exam: { questions },
    } = examStudent;

    if (!examStudent) {
      throw new Error("Prova do aluno não encontrada");
    }

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
  "/:uuid/upload",
  upload.single("file"),
  isStudent,
  async (req, res) => {
    try {
      const { user: student } = req;
      const { uuid } = req.params;

      const examStudent = await ExamStudent.findOne({
        student,
        uuid,
        status: ExamStudentStatus.PROGRESS,
      })
        .populate("exam")
        .lean();

      if (!examStudent) {
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

    const examStudent = await ExamStudent.findOne({
      uuid,
      student,
      status: ExamStudentStatus.PROGRESS,
    }).populate("exam");

    if (!examStudent) {
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
