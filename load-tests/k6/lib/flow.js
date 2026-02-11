import http from "k6/http";

export function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error("BASE_URL e obrigatorio.");
  }
  return baseUrl.replace(/\/+$/, "");
}

export function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export function login(baseUrl, student) {
  const response = http.post(
    `${baseUrl}/login`,
    JSON.stringify({
      email: student.email,
      password: student.password,
    }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { endpoint: "login" },
    }
  );

  if (response.status !== 200) {
    const message = extractErrorMessage(response);
    throw new Error(
      `Falha no login para ${student.email}. status=${response.status}. ${message}`
    );
  }

  const payload = safeJson(response);
  if (!payload?.token) {
    throw new Error(`Login sem token para ${student.email}.`);
  }

  return payload.token;
}

export function getAvailableExams(baseUrl, token) {
  return http.get(`${baseUrl}/exams/available`, {
    headers: authHeaders(token),
    tags: { endpoint: "available_exams" },
  });
}

export function resolveExamStudentContext(baseUrl, token, options) {
  const { examUuid, preferredExamStudentUuid, preferredQuestionUuid } = options || {};

  if (!examUuid && !preferredExamStudentUuid) {
    throw new Error(
      "Informe EXAM_UUID ou exam_student_uuid no CSV para resolver contexto."
    );
  }

  let examStudentUuid = preferredExamStudentUuid || "";
  if (!examStudentUuid) {
    const takeResponse = http.get(`${baseUrl}/exams/${examUuid}/take`, {
      headers: authHeaders(token),
      redirects: 0,
      tags: { endpoint: "take_exam" },
    });

    if (takeResponse.status !== 302) {
      const message = extractErrorMessage(takeResponse);
      throw new Error(
        `Falha em /exams/${examUuid}/take. status=${takeResponse.status}. ${message}`
      );
    }

    const locationHeader = readLocationHeader(takeResponse);
    examStudentUuid = parseExamStudentUuidFromLocation(locationHeader);
  }

  const detailsResponse = getExamStudent(baseUrl, token, examStudentUuid);
  if (detailsResponse.status !== 200) {
    const message = extractErrorMessage(detailsResponse);
    throw new Error(
      `Falha em /exam-students/${examStudentUuid}. status=${detailsResponse.status}. ${message}`
    );
  }

  const details = safeJson(detailsResponse);
  const questions = Array.isArray(details?.questions) ? details.questions : [];
  if (!questions.length) {
    throw new Error(`Prova ${examStudentUuid} sem questoes no payload.`);
  }

  const selectedQuestion =
    questions.find((entry) => entry.uuid === preferredQuestionUuid) ||
    questions.find((entry) => entry.type !== "F") ||
    questions[0];

  return {
    examStudentUuid,
    questions,
    selectedQuestion,
    details,
  };
}

export function getExamStudent(baseUrl, token, examStudentUuid) {
  return http.get(`${baseUrl}/exam-students/${examStudentUuid}`, {
    headers: authHeaders(token),
    tags: { endpoint: "exam_student_get" },
  });
}

export function saveAnswer(baseUrl, token, examStudentUuid, questionUuid, answerPayload) {
  return http.put(
    `${baseUrl}/exam-students/${examStudentUuid}/answer/${questionUuid}`,
    JSON.stringify(answerPayload),
    {
      headers: authHeaders(token),
      tags: { endpoint: "answer_put" },
    }
  );
}

export function submitExam(baseUrl, token, examStudentUuid, answers) {
  return http.post(
    `${baseUrl}/exam-students/${examStudentUuid}/submit`,
    JSON.stringify({ answers }),
    {
      headers: authHeaders(token),
      tags: { endpoint: "submit_exam" },
    }
  );
}

export function buildAnswerPayload(question, iteration) {
  const type = question?.type;

  if (type === "A") {
    return { value: iteration % 2 === 0 ? "C" : "E", skipped: false };
  }

  if (type === "B") {
    const value = String(100 + (iteration % 900));
    return { value, skipped: false };
  }

  if (type === "C") {
    const choices = ["A", "B", "C", "D"];
    return { value: choices[iteration % choices.length], skipped: false };
  }

  if (type === "ENEM") {
    const choices = ["A", "B", "C", "D", "E"];
    return { value: choices[iteration % choices.length], skipped: false };
  }

  if (type === "D") {
    return { value: `resposta_${iteration}`, skipped: false };
  }

  // Tipo F geralmente depende de upload de imagem; para teste de API de marcação usamos "em branco".
  return { value: "", skipped: true };
}

export function buildSubmitAnswers(questions) {
  const answers = {};
  questions.forEach((question, idx) => {
    answers[question.uuid] = buildAnswerPayload(question, idx);
  });
  return answers;
}

function readLocationHeader(response) {
  const value = response?.headers?.Location || response?.headers?.location;
  if (Array.isArray(value)) {
    return value[0];
  }
  return value || "";
}

function parseExamStudentUuidFromLocation(locationHeader) {
  const match = String(locationHeader || "").match(/\/exam-students\/([a-zA-Z0-9-]+)/);
  if (!match || !match[1]) {
    throw new Error(`Location invalida retornada em /take: "${locationHeader}"`);
  }
  return match[1];
}

function safeJson(response) {
  try {
    return response.json();
  } catch (error) {
    return null;
  }
}

function extractErrorMessage(response) {
  const payload = safeJson(response);
  return payload?.message || "";
}
