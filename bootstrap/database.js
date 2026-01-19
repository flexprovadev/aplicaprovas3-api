const {
  User,
  Role,
  Course,
  Classroom,
  Document,
  Exam,
  ExamStudent,
} = require("../model");
const config = require("../config");
const { UserType, Permission, QuestionType } = require("../enumerator");

const DAY_AS_TIMESTAMP = 24 * 60 * 60 * 1000;

const SAMPLE_EXAM_URL =
  "https://staging2026.s3.us-east-1.amazonaws.com/2023-ENEM-1D-Prova.pdf";

async function initializeDev() {
  console.log("Initializing development data");
  const coordenadorPerfil = await Role.create({
    name: "coordenador",
    permissions: Object.values(Permission).map((o) => o.key),
  });

  await User.create({
    email: "silvagirao@gmail.com",
    password: "abcd1234",
    type: UserType.SUPERUSER,
  });

  await User.create({
    email: "escola1.superuser@flexprova.com",
    password: "abc123",
    type: UserType.SUPERUSER,
  });

  await User.create({
    email: "escola2.superuser@flexprova.com",
    password: "abc123",
    type: UserType.SUPERUSER,
  });

  await User.create({
    email: "escola1.colaborador@flexprova.com",
    name: "Colaborador da Escola 1",
    password: "abc123",
    contactNumber: "(11) 43534-5345",
    type: UserType.STAFF,
    roles: [coordenadorPerfil],
  });

  await User.create({
    email: "escola2.colaborador@flexprova.com",
    name: "Colaborador da Escola 2",
    password: "abc123",
    contactNumber: "(22) 43534-5345",
    type: UserType.STAFF,
    roles: [coordenadorPerfil],
  });

  const studentA = await User.create({
    email: "escola1.aluno1@flexprova.com",
    name: "Aluno 1 da Escola 1",
    password: "abc123",
    type: UserType.STUDENT,
  });

  const studentB = await User.create({
    email: "escola2.aluno1@flexprova.com",
    name: "Aluno 1 da Escola 2",
    password: "abc123",
    type: UserType.STUDENT,
  });

  const studentC = await User.create({
    email: "escola1.aluno2@flexprova.com",
    name: "Aluno 2 da Escola 1",
    password: "abc123",
    type: UserType.STUDENT,
  });

  const studentD = await User.create({
    email: "escola2.aluno2@flexprova.com",
    name: "Aluno 2 da Escola 2",
    password: "abc123",
    type: UserType.STUDENT,
  });

  const studentE = await User.create({
    email: "escola1.aluno3@flexprova.com",
    name: "Aluno 3 da Escola 1",
    password: "abc123",
    type: UserType.STUDENT,
  });

  const studentF = await User.create({
    email: "escola2.aluno3@flexprova.com",
    name: "Aluno 3 da Escola 2",
    password: "abc123",
    type: UserType.STUDENT,
  });

  const teacherA = await User.create({
    email: "escola1.teachera@gmail.com",
    name: "Teacher A",
    password: "abcd1234",
    type: UserType.TEACHER,
  });

  const teacherB = await User.create({
    email: "escola1.teacherb@gmail.com",
    name: "Teacher B",
    password: "abcd1234",
    type: UserType.TEACHER,
  });

  const teacherC = await User.create({
    email: "escola2.teacherc@gmail.com",
    name: "Teacher C",
    password: "abcd1234",
    type: UserType.TEACHER,
  });

  const classroomA = await Classroom.create({
    name: "escola1.A",
    year: 2026,
    level: "Médio",
    students: [studentA, studentC],
  });

  const classroomB = await Classroom.create({
    name: "escola1.B",
    year: 2026,
    level: "Médio",
    students: [studentA, studentF],
  });

  const classroomC = await Classroom.create({
    name: "escola2.A",
    year: 2026,
    level: "1",
    students: [studentB, studentD],
  });

  const classroomD = await Classroom.create({
    name: "escola2.B",
    year: 2026,
    level: "1",
    students: [studentB, studentF],
  });

/*  ["A", "B", "C"].forEach(async (name) => {
    [2025, 2026].forEach(async (year) => {
      ["1", "2", "3"].forEach(async (level) => {
        await Classroom.create({ name, year, level });
      });
    });
  });
*/

  const courseA = await Course.create({ name: "escola1.Portugues" });
  const courseB = await Course.create({ name: "escola1.Matematica" });
  const courseC = await Course.create({ name: "escola2.Fisica" });
  const courseD = await Course.create({ name: "escola2.Quimica" });

  const formatDate = (date) => new Date(date).toISOString();

  await Exam.create({
    uuid: "dd4e5003-0041-4731-9beb-790c7573beaa",
    name: "escola1.Simulado 1",
    startAt: formatDate(Date.now() - DAY_AS_TIMESTAMP),
    endAt: formatDate(Date.now() + 1000), // 30 seconds
    documentUrl: SAMPLE_EXAM_URL,
    questions: [],
    classrooms: [classroomA],
  });

  await Exam.create({
    uuid: "80df7e04-086d-4d0e-bcca-c173e4446e07",
    name: "escola2.Simulado 2",
    startAt: formatDate(Date.now() - DAY_AS_TIMESTAMP),
    endAt: formatDate(Date.now() + 1000), // 30 seconds
    documentUrl: SAMPLE_EXAM_URL,
    questions: [],
    classrooms: [classroomC],
  });

  await Exam.create({
    name: "escola1.Prova de Fisica",
    startAt: formatDate(Date.now()),
    endAt: formatDate(Date.now() + DAY_AS_TIMESTAMP),
    documentUrl: SAMPLE_EXAM_URL,
    questions: [],
    classrooms: [classroomA],
  });

  await Exam.create({
    name: "escola2.Prova de Quimica",
    startAt: formatDate(Date.now() + DAY_AS_TIMESTAMP * 3),
    documentUrl: SAMPLE_EXAM_URL,
    questions: [],
    classrooms: [classroomC],
  });

  const exam = await Exam.create({
    uuid: "1192c2e1-c849-4a9d-a91b-b28eed94dff6",
    name: "escola1.Prova de Portugues",
    classrooms: [classroomA],
    documentUrl: SAMPLE_EXAM_URL,
    questions: [
      {
        uuid: "7c900b4e-70bb-49ca-802e-7461215dc431",
        label: "Portugues 1",
        type: QuestionType.A,
        answer: "C",
        course: courseA.uuid,
      },
      {
        uuid: "0693b959-b030-4f5c-b030-e8798ecf4c5c",
        label: "Portugues 2",
        type: QuestionType.A,
        answer: "E",
        course: courseA.uuid,
      },
      {
        uuid: "dc8b399c-a0c0-4e4f-8731-0cd83498e930",
        label: "Matematica 1",
        type: QuestionType.A,
        answer: "C",
        course: courseB.uuid,
      },
      {
        uuid: "bde9f55f-869c-44ab-9358-9b1f0a4cd2ac",
        label: "Matematica 2",
        type: QuestionType.A,
        answer: "E",
        course: courseB.uuid,
      },
      {
        uuid: "064f6dda-913f-43e8-88b1-241b5e6ee049",
        label: "Matematica 3",
        type: QuestionType.D,
        course: courseB.uuid,
      },
      {
        uuid: "c01b7a3a-923d-4eec-ad75-40872155c549",
        label: "Matematica 4",
        type: QuestionType.F,
        course: courseB.uuid,
      },
    ],
  });

  await ExamStudent.create({
    uuid: "f6021091-990a-4a41-82c5-f63866dd5ac5",
    exam,
    student: studentA,
    answers: {
      "7c900b4e-70bb-49ca-802e-7461215dc431": {
        value: "C",
        skipped: false,
      },
      "0693b959-b030-4f5c-b030-e8798ecf4c5c": {
        value: "C",
        skipped: false,
      },
      "dc8b399c-a0c0-4e4f-8731-0cd83498e930": {
        value: "",
        skipped: true,
      },
      "bde9f55f-869f-44ab-9358-9b1f0a4cd2ac": {
        value: "C",
        skipped: false,
      },
      "064f6dda-913f-43e8-88b1-241b5e6ee049": {
        value: "Lorem ipsum dolor sit amet, consectetur adipiscing elit",
        skipped: false,
      },
      "c01b7a3a-923d-4eec-ad75-40872155c549": {
        value:
          "https://staging2026.s3.us-east-1.amazonaws.com/discursiva.jpeg",
        skipped: false,
      },
    },
  });

  await ExamStudent.create({
    uuid: "b71f40d4-8e6b-442f-bc92-2c4ad4d75bc2",
    exam,
    student: studentC,
    answers: {
      "7c900b4e-70bb-49ca-802e-7461215dc431": {
        value: "A",
        skipped: false,
      },
      "0693b959-b030-4f5c-b030-e8798ecf4c5c": {
        value: "B",
        skipped: false,
      },
      "dc8b399c-a0c0-4e4f-8731-0cd83498e930": {
        value: "B",
        skipped: true,
      },
      "bde9f55f-869f-44ab-9358-9b1f0a4cd2ac": {
        value: "A",
        skipped: false,
      },
      "064f6dda-913f-43e8-88b1-241b5e6ee049": {
        value: "Lorem ipsum dolor sit amet, consectetur adipiscing elit",
        skipped: false,
      },
      "c01b7a3a-923d-4eec-ad75-40872155c549": {
        value:
          "https://staging2026.s3.us-east-1.amazonaws.com/discursiva.jpeg",
        skipped: false,
      },
    },
  });
  console.log("Development data initialized");
}

async function initializeProd() {
  console.log("Initializing production data");

  await User.create({
    email: "silvagirao@gmail.com",
    password: config.seed.password,
    type: UserType.SUPERUSER,
  });
  console.log("Production data initialized");
}

  /* Criar documento vazio para inicializar a coleção
  await Document.create({
    name: "Documento Inicial de Produção",
    description: "Documento criado automaticamente para garantir a inicialização da coleção.",
    questions: [],
    createdBy: null, // Nenhum criador definido
    dates: {
      start: new Date(),
      teacher: new Date(),
      deadline: new Date(),
      print: new Date(),
      final: new Date(),
    },
    intervals: {
      teacherDays: 0,
      reviewDays: 0,
      printDays: 0,
      finalDays: 0,
    },
  }); */

async function initialize() {
  const userCount = await User.countDocuments();
  console.log(`User count: ${userCount}`);

  if (userCount !== 0) {
    return;
  }

  if (config.isDev) {
    initializeDev();
  } else {
    initializeProd();
  }
}

module.exports = { initialize };

