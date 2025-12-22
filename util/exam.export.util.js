const { ExamStudentStatus, QuestionType } = require("../enumerator");
const { ExamStudent } = require("../model");
const { Parser } = require("@json2csv/plainjs");
const DateTimeFormatter = require("date-time-format-timezone");
const config = require("../config");
const archiver = require("archiver");
const { getObject } = require("./s3.util");

const dateFormatter = new DateTimeFormatter("pt-BR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  minute: "2-digit",
  timeZone: config.timezone,
});

function freeTextAggregrator(acc, next) {
  const { name, email, value } = next;
  return (acc += `nome: ${name}\nemail: ${email}\nresposta: ${value}\n--------------------\n`);
}

const generateCSV = async ({ exam, examStudents, questionMap, archive }) => {
  const fields = ["name", "email", "createdAt", "submittedAt"];

  Object.values(questionMap).forEach(({ index }) => {
    fields.push(`question-${index}`);
  });

  const data = examStudents.reduce((acc, next) => {
    const { student, createdAt, submittedAt, answers } = next;
    const { name, email } = student;

    const entry = {
      name,
      email,
      createdAt: dateFormatter.format(createdAt),
      submittedAt: dateFormatter.format(submittedAt),
    };

    Object.entries(answers).forEach(([key, { value }]) => {
      const question = questionMap[key];
      if (question) {
        Object.assign(entry, { [`question-${question.index}`]: value || "NP" });
      }
    });

    acc.push(entry);

    return acc;
  }, []);

  const parser = new Parser({ fields });
  const csv = parser.parse(data);

  archive.append(csv, { name: `${exam.name}.csv` });
};

const generateFreeTextFolder = ({ examStudents, questionMap, archive }) => {
  const data = Object.entries(questionMap).reduce(
    (acc, [uuid, { label, type }]) => {
      if (type === QuestionType.D) {
        acc[uuid] = { label, entries: [] };
      }
      return acc;
    },
    {}
  );

  examStudents.forEach(({ answers, student }) => {
    Object.entries(answers).forEach(([uuid, { value }]) => {
      const question = data[uuid];
      if (!question) {
        return;
      }
      const { name, email } = student;
      question.entries.push({ value, name, email });
    });
  });

  Object.values(data).forEach(({ label, entries }) => {
    const output = entries.reduce(freeTextAggregrator, "");
    archive.append(output, { name: `${label}.txt`, prefix: "texto-livre" });
  });
};

const generateImagesFolder = async ({ examStudents, questionMap, archive }) => {
  const data = Object.entries(questionMap).reduce(
    (acc, [uuid, { label, type }]) => {
      if (type === QuestionType.F) {
        acc[uuid] = label;
      }
      return acc;
    },
    {}
  );

  const pendingFiles = [];

  examStudents.forEach(({ answers, student }) => {
    Object.entries(answers)
      .filter(([_, { value }]) => !!value)
      .forEach(([uuid, { value }]) => {
        const label = data[uuid];
        if (!label) {
          return;
        }
        const { email } = student;
        pendingFiles.push({ url: value, email, label });
      });
  });

  while (pendingFiles.length) {
    const currentFile = pendingFiles.pop();
    const { url, email, label } = currentFile;
    const { stream, extension } = await getObject(url);

    archive.append(stream, {
      name: `${email}.${extension}`,
      prefix: `arquivos/${label}`,
    });
  }
};

const generateArchive = async (exam) => {
  const archive = archiver("zip", { zlib: { level: 9 } });

  const examStudents = await ExamStudent.find({
    exam,
    status: ExamStudentStatus.SUBMITTED,
  }).populate("student");

  const questionMap = exam.questions.reduce(
    (acc, { uuid, label, type }, index) => {
      acc[uuid] = { index: index + 1, type, label };
      return acc;
    },
    {}
  );

  const input = { exam, examStudents, questionMap, archive };

  await generateCSV(input);

  await generateFreeTextFolder(input);

  await generateImagesFolder(input);

  return archive;
};

module.exports = { generateArchive };
