#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL = "http://localhost:4000";
const DATE_PART = new Date().toISOString().slice(0, 10);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const help = args.help || args.h;
  if (help) {
    printHelp();
    process.exit(0);
  }

  const baseUrl = normalizeBaseUrl(args["base-url"] || DEFAULT_BASE_URL);
  const adminEmail = requireArg(args, "admin-email");
  const adminPassword = requireArg(args, "admin-password");
  const examUuidArg = args["exam-uuid"] || "";
  const school = args.school || "";
  const limit = toOptionalPositiveInt(args.limit);
  const includeDisabled = toBool(args["include-disabled"], false);
  const setStudentPassword = args["set-student-password"] || "";
  const defaultStudentPassword = args["default-student-password"] || "";
  const outputDir = resolveOutputDir(args["output-dir"]);
  const questionUuidOverride = args["question-uuid"] || "";
  const prepareExamStudents = toBool(args["prepare-exam-students"], false);

  if (!setStudentPassword && !defaultStudentPassword) {
    throw new Error(
      "Informe --default-student-password ou --set-student-password."
    );
  }

  console.log(`Base URL: ${baseUrl}`);
  console.log("Autenticando admin...");
  const adminToken = await login(baseUrl, adminEmail, adminPassword);

  console.log("Buscando alunos...");
  const students = await fetchStudents({
    baseUrl,
    token: adminToken,
    school,
  });

  console.log("Buscando provas...");
  const exams = await fetchExamList({
    baseUrl,
    token: adminToken,
    school,
  });

  const selectedExamSummary = selectExam(exams, examUuidArg);
  if (!selectedExamSummary) {
    throw new Error(
      examUuidArg
        ? `Prova ${examUuidArg} nao encontrada em /exams.`
        : "Nenhuma prova elegivel encontrada em /exams."
    );
  }

  const selectedExamUuid = selectedExamSummary.uuid;

  console.log(`Prova selecionada: ${selectedExamUuid} (${selectedExamSummary.name})`);
  console.log("Buscando detalhes da prova (questoes/progresso)...");

  const examDetails = await fetchExamDetails({
    baseUrl,
    token: adminToken,
    school,
    examUuid: selectedExamUuid,
  });

  const questionUuid = resolveQuestionUuid({
    questionUuidOverride,
    examDetails,
  });

  const classroomStudentEmails = new Set(
    (selectedExamSummary.classrooms || [])
      .flatMap((classroom) => classroom.students || [])
      .map((student) => student.email)
      .filter(Boolean)
  );

  const submittedEmails = new Set(
    (selectedExamSummary.examsSubmitted || [])
      .map((entry) => entry?.email)
      .filter(Boolean)
  );

  const studentsByEmail = new Map(
    students
      .filter((student) => includeDisabled || student.enabled !== false)
      .map((student) => [student.email, student])
  );

  let selectedStudents = [];
  if (classroomStudentEmails.size > 0) {
    selectedStudents = Array.from(classroomStudentEmails)
      .map((email) => studentsByEmail.get(email))
      .filter(Boolean);
  } else {
    selectedStudents = Array.from(studentsByEmail.values());
  }

  selectedStudents = selectedStudents.filter(
    (student) => !submittedEmails.has(student.email)
  );

  if (!selectedStudents.length) {
    throw new Error(
      "Nenhum aluno elegivel encontrado para a prova (todos enviados ou sem turma)."
    );
  }

  selectedStudents.sort((a, b) => a.email.localeCompare(b.email));

  if (limit) {
    selectedStudents = selectedStudents.slice(0, limit);
  }

  if (!selectedStudents.length) {
    throw new Error("Nenhum aluno restante apos aplicar --limit.");
  }

  const finalPassword = setStudentPassword || defaultStudentPassword;
  const rows = [];

  if (setStudentPassword) {
    console.log(
      `Definindo senha para ${selectedStudents.length} alunos (valor: "${setStudentPassword}")...`
    );

    for (const student of selectedStudents) {
      await resetStudentPassword({
        baseUrl,
        token: adminToken,
        school,
        studentUuid: student.uuid,
        password: setStudentPassword,
      });
    }
  }

  let examStudentMap = new Map();
  if (prepareExamStudents) {
    console.log("Preparando exam_student_uuid via /exams/:uuid/take ...");

    for (const student of selectedStudents) {
      try {
        const studentToken = await login(baseUrl, student.email, finalPassword);
        const examStudentUuid = await takeExamAndExtractExamStudentUuid({
          baseUrl,
          token: studentToken,
          school,
          examUuid: selectedExamUuid,
        });
        examStudentMap.set(student.email, examStudentUuid);
      } catch (error) {
        console.warn(
          `[WARN] Nao foi possivel preparar exam_student_uuid para ${student.email}: ${
            error.message || error
          }`
        );
      }
    }
  } else {
    examStudentMap = extractExamStudentMapFromDetails(examDetails);
  }

  for (const student of selectedStudents) {
    rows.push({
      email: student.email,
      password: finalPassword,
      examStudentUuid: examStudentMap.get(student.email) || "",
      questionUuid: questionUuid || "",
    });
  }

  const csvContent = toCsv(rows);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = buildOutputPath(outputDir);
  fs.writeFileSync(outputFile, csvContent, "utf8");

  console.log("");
  console.log("Arquivo gerado com sucesso:");
  console.log(outputFile);
  console.log("");
  console.log(`Total de alunos no CSV: ${rows.length}`);
  console.log(`Exam UUID usado: ${selectedExamUuid}`);
  console.log(`Question UUID usado: ${questionUuid || "(vazio)"}`);
  console.log(
    `ExamStudent UUID preenchido: ${
      rows.filter((entry) => !!entry.examStudentUuid).length
    }/${rows.length}`
  );
}

function parseArgs(args) {
  const parsed = {};

  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i];
    if (!raw.startsWith("--")) {
      continue;
    }

    const keyValue = raw.slice(2);
    const eqIndex = keyValue.indexOf("=");
    if (eqIndex !== -1) {
      const key = keyValue.slice(0, eqIndex).trim();
      const value = keyValue.slice(eqIndex + 1).trim();
      parsed[key] = value;
      continue;
    }

    const key = keyValue.trim();
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    i += 1;
  }

  return parsed;
}

function requireArg(args, key) {
  const value = args[key];
  if (!value) {
    throw new Error(`Parametro obrigatorio ausente: --${key}`);
  }
  return value;
}

function toOptionalPositiveInt(value) {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Valor invalido para --limit: ${value}`);
  }
  return parsed;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function resolveOutputDir(argValue) {
  const raw = argValue || path.resolve(__dirname, "..", "data");
  return path.resolve(process.cwd(), raw);
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function addSchoolQuery(pathname, school) {
  if (!school) {
    return pathname;
  }
  const sep = pathname.includes("?") ? "&" : "?";
  return `${pathname}${sep}school=${encodeURIComponent(school)}`;
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await safeJson(response);
  if (!response.ok || !payload?.token) {
    throw new Error(
      `Falha no login para ${email}. status=${response.status}. ${
        payload?.message || ""
      }`
    );
  }

  return payload.token;
}

async function fetchStudents({ baseUrl, token, school }) {
  const response = await fetch(
    `${baseUrl}${addSchoolQuery("/students", school)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const payload = await safeJson(response);
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(
      `Falha ao buscar /students. status=${response.status}. ${
        payload?.message || ""
      }`
    );
  }
  return payload;
}

async function fetchExamList({ baseUrl, token, school }) {
  const response = await fetch(`${baseUrl}${addSchoolQuery("/exams", school)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = await safeJson(response);
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(
      `Falha ao buscar /exams. status=${response.status}. ${
        payload?.message || ""
      }`
    );
  }
  return payload;
}

async function fetchExamDetails({ baseUrl, token, school, examUuid }) {
  const response = await fetch(
    `${baseUrl}${addSchoolQuery(`/exams/${examUuid}`, school)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const payload = await safeJson(response);
  if (!response.ok || !payload || !payload.uuid) {
    throw new Error(
      `Falha ao buscar /exams/${examUuid}. status=${response.status}. ${
        payload?.message || ""
      }`
    );
  }
  return payload;
}

function selectExam(exams, examUuidArg) {
  if (!Array.isArray(exams) || !exams.length) {
    return null;
  }

  if (examUuidArg) {
    return exams.find((exam) => exam.uuid === examUuidArg) || null;
  }

  const withClassrooms = exams.find(
    (exam) =>
      Array.isArray(exam.classrooms) &&
      exam.classrooms.some(
        (classroom) =>
          Array.isArray(classroom.students) && classroom.students.length > 0
      )
  );

  return withClassrooms || exams[0];
}

function resolveQuestionUuid({ questionUuidOverride, examDetails }) {
  if (questionUuidOverride) {
    return questionUuidOverride;
  }

  const questions = Array.isArray(examDetails?.questions)
    ? examDetails.questions
    : [];

  if (!questions.length) {
    return "";
  }

  const firstNonImageQuestion = questions.find((question) => question.type !== "F");
  return (firstNonImageQuestion || questions[0]).uuid || "";
}

async function resetStudentPassword({
  baseUrl,
  token,
  school,
  studentUuid,
  password,
}) {
  const response = await fetch(
    `${baseUrl}${addSchoolQuery(`/students/${studentUuid}/password`, school)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    }
  );

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(
      `Falha ao redefinir senha do aluno ${studentUuid}. status=${response.status}. ${
        payload?.message || ""
      }`
    );
  }
}

function extractExamStudentMapFromDetails(examDetails) {
  const entries = Array.isArray(examDetails?.examsInProgress)
    ? examDetails.examsInProgress
    : [];

  const map = new Map();
  entries.forEach((entry) => {
    const email = entry?.student?.email;
    const uuid = entry?.uuid;
    if (email && uuid) {
      map.set(email, uuid);
    }
  });
  return map;
}

async function takeExamAndExtractExamStudentUuid({
  baseUrl,
  token,
  school,
  examUuid,
}) {
  const response = await fetch(
    `${baseUrl}${addSchoolQuery(`/exams/${examUuid}/take`, school)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      redirect: "manual",
    }
  );

  if (response.status !== 302) {
    const payload = await safeJson(response);
    throw new Error(
      `Falha em /exams/${examUuid}/take. status=${response.status}. ${
        payload?.message || ""
      }`
    );
  }

  const location = response.headers.get("location") || "";
  const match = location.match(/\/exam-students\/([a-zA-Z0-9-]+)/);
  if (!match || !match[1]) {
    throw new Error(`Location invalida retornada em /take: "${location}"`);
  }

  return match[1];
}

function toCsv(rows) {
  const header = "email,password,exam_student_uuid,question_uuid";
  const body = rows
    .map((entry) =>
      [
        escapeCsv(entry.email),
        escapeCsv(entry.password),
        escapeCsv(entry.examStudentUuid),
        escapeCsv(entry.questionUuid),
      ].join(",")
    )
    .join("\n");

  return `${header}\n${body}\n`;
}

function escapeCsv(value) {
  const stringValue = String(value || "");
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function buildOutputPath(outputDir) {
  const baseName = `students-${DATE_PART}.csv`;
  const fullPath = path.join(outputDir, baseName);
  if (!fs.existsSync(fullPath)) {
    return fullPath;
  }

  const suffix = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  return path.join(outputDir, `students-${DATE_PART}-${suffix}.csv`);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function printHelp() {
  console.log(`
Gerador de CSV para load tests

Uso:
  node ./scripts/generate-students-csv.js \\
    --admin-email "admin@dominio.com" \\
    --admin-password "SENHA" \\
    --exam-uuid "UUID_DA_PROVA" \\
    --default-student-password "senha-dos-alunos"

Parametros principais:
  --base-url                    URL da API (padrao: http://localhost:4000)
  --admin-email                 Email do usuario admin/superuser (obrigatorio)
  --admin-password              Senha do admin/superuser (obrigatorio)
  --exam-uuid                   UUID da prova alvo (opcional; auto-seleciona se omitido)
  --default-student-password    Senha usada no CSV (modo leitura)
  --set-student-password        Redefine senha dos alunos via API e usa no CSV
  --question-uuid               Forca um question_uuid especifico no CSV
  --prepare-exam-students       Faz /take para cada aluno e preenche exam_student_uuid
  --include-disabled            Inclui alunos desabilitados
  --limit                       Limita quantidade de alunos no CSV
  --school                      Filtro de escola (query ?school=)
  --output-dir                  Pasta de saida (padrao: ../data)

Exemplo (somente leitura):
  node ./scripts/generate-students-csv.js \\
    --admin-email "silvagirao@gmail.com" \\
    --admin-password "abcd1234" \\
    --exam-uuid "1192c2e1-c849-4a9d-a91b-b28eed94dff6" \\
    --default-student-password "abc123" \\
    --prepare-exam-students true \\
    --limit 50

Exemplo (garantir credencial valida):
  node ./scripts/generate-students-csv.js \\
    --admin-email "silvagirao@gmail.com" \\
    --admin-password "abcd1234" \\
    --exam-uuid "1192c2e1-c849-4a9d-a91b-b28eed94dff6" \\
    --set-student-password "Carga2026!" \\
    --prepare-exam-students true \\
    --limit 100
`);
}

main().catch((error) => {
  console.error("");
  console.error("Erro ao gerar CSV:", error.message || error);
  process.exit(1);
});
