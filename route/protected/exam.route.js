const config = require("../../config");
const express = require("express");
const router = express.Router();
const { Classroom, Exam, ExamStudent, Course } = require("../../model");
const multer = require("multer");
const {
  doExamUpload,
  doPreliminarkeyUpload,
  doFinalkeyUpload,
  doNamelistUpload,
  doAnswerSheetImageUpload,
} = require("../../util/s3.util");
const {
  Permission,
  QuestionType,
  ExamStudentStatus,
} = require("../../enumerator");
const { hasPermission, isStudent } = require("../../middleware");
const { v4: uuidv4 } = require("uuid");
const { DateTime } = require("luxon");
const { applyTimezone } = require("../../util/date.util");
const { generateArchive } = require("../../util/exam.export.util");
const { importCsvAnswers } = require("../../util/import.csv.answers.util");
const { addSchoolPrefix, createSchoolFilter } = require("../../util/school.util");

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

router.get("", hasPermission(Permission.READ_EXAM.key), async (req, res) => {
  try {
    const studentsSelectFields = "-_id name email";

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
      const { name, email } = examStudent.student;
      return { name, email };
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

    const unavailableUuids = [...progress, ...done].map((entry) => entry.uuid);

    const classrooms = await Classroom.find({
      enabled: true,
      students: { $in: [student] },
      ...(classroomMatch || {}),
    })
      .select("_id")
      .lean();

    const currentDateTime = DateTime.local();
    const currentDate = currentDateTime.toJSDate();
    const comingSoonLimitDate = currentDateTime
      .plus({ days: config.exam.comingSoonMaxDays })
      .toJSDate();

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

    return res.json({
      done,
      available,
      progress,
      comingSoon,
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
          "uuid name startAt endAt durationExam instructions documentUrl namelistURL preliminarkeyURL finalkeyURL answerSheetImages questions gradeStrategy gradeOptions"
        )
        .lean();

      if (!exam) {
        throw new Error("Erro ao recuperar prova");
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
    const { questions, classrooms: classroomUuids, gradeStrategy } = req.body;

    if (classroomUuids !== undefined && !req.schoolPrefix) {
      return res.status(400).json({ message: "Escola não identificada" });
    }

    if (req.body.name !== undefined && !req.schoolPrefix) {
      return res.status(400).json({ message: "Escola não identificada" });
    }

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

    const updateQuery = {
      ...req.body,
      ...(req.body.name !== undefined
        ? { name: addSchoolPrefix(req.body.name, req.schoolPrefix) }
        : {}),
      gradeStrategy,
      questions: normalizeQuestions(questions),
      classrooms,
    };

    const exam = await Exam.findOneAndUpdate({ uuid }, updateQuery);

    if (!exam) {
      throw new Error("Não foi possível encontrar a prova");
    }

    return res.json({ message: "Prova atualizada com sucesso" });
  } catch (ex) {
    const { message = "Erro ao atualizar prova" } = ex;
    return res.status(400).json({ message });
  }
});


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
  hasPermission(Permission.CREATE_EXAM.key),
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

      return res.json({ uuid, location });
    } catch (ex) {
      const { message = "Erro ao enviar arquivo" } = ex;
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

      return res.json({ message: "Imagem removida com sucesso" });
    } catch (ex) {
      const { message = "Erro ao remover imagem" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/upload",
  upload.single("file"),
  hasPermission(Permission.CREATE_EXAM.key),
  async (req, res) => {
    try {
      doExamUpload(req, res);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao enviar arquivo" });
    }
  }
);

router.post(
  "/upload-preliminarkey",
  upload.single("file"),
  hasPermission(Permission.CREATE_EXAM.key),
  async (req, res) => {
    try {
      doPreliminarkeyUpload(req, res);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao enviar arquivo" });
    }
  }
);

router.post(
  "/upload-finalkey",
  upload.single("file"),
  hasPermission(Permission.CREATE_EXAM.key),
  async (req, res) => {
    try {
      doFinalkeyUpload(req, res);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao enviar arquivo" });
    }
  }
);

router.post(
  "/upload-namelist",
  upload.single("file"),
  hasPermission(Permission.CREATE_EXAM.key),
  async (req, res) => {
    try {
      doNamelistUpload(req, res);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao enviar arquivo" });
    }
  }
);

router.post(
  "/import-questions",
  upload.single("file"),
  hasPermission(Permission.CREATE_EXAM.key),
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
