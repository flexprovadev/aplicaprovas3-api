import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";
import { parseStudentsCsv, pickStudentForVu } from "./lib/data.js";
import { normalizeBaseUrl, authHeaders, buildAnswerPayload } from "./lib/flow.js";

const BASE_URL = normalizeBaseUrl(__ENV.BASE_URL || "http://localhost:4000");
const EXAM_UUID = (__ENV.EXAM_UUID || "").trim();
const STUDENTS_FILE = resolveStudentsFile(__ENV.STUDENTS_CSV);

const THINK_MIN_SECONDS = parsePositiveNumber(__ENV.THINK_MIN_SECONDS, 4);
const THINK_MAX_SECONDS = parsePositiveNumber(__ENV.THINK_MAX_SECONDS, 20);
const REVIEW_PROBABILITY = clamp(parseNumber(__ENV.REVIEW_PROBABILITY, 0.15), 0, 1);
const ANSWER_ERROR_RATE_MAX = clamp(parseNumber(__ENV.ANSWER_ERROR_RATE_MAX, 0.01), 0, 1);
const ANSWER_P95_GOAL_MS = parsePositiveNumber(__ENV.ANSWER_P95_GOAL_MS, 1000);

if (!EXAM_UUID) {
  throw new Error("EXAM_UUID e obrigatorio no teste 05-answer-realistic.");
}

const students = new SharedArray("students_answer_realistic", () =>
  parseStudentsCsv(open(STUDENTS_FILE))
);

const answerPutSuccess = new Rate("answer_put_success");
const endpoint401Rate = new Rate("endpoint_401_rate");
const endpoint4xxRate = new Rate("endpoint_4xx_rate");
const endpoint5xxRate = new Rate("endpoint_5xx_rate");
const answerPutDuration = new Trend("answer_put_duration", true);

let session = null;
let interactionCounter = 0;

export const options = {
  stages: parseStages(__ENV.REALISTIC_STAGES),
  summaryTrendStats: ["avg", "min", "med", "max", "p(50)", "p(90)", "p(95)"],
  thresholds: {
    checks: ["rate>0.95"],
    http_req_failed: ["rate<0.05"],
    answer_put_success: [`rate>${(1 - ANSWER_ERROR_RATE_MAX).toFixed(4)}`],
    answer_put_duration: [`p(95)<${ANSWER_P95_GOAL_MS}`],
    "endpoint_401_rate{endpoint:login}": ["rate<0.01"],
    "endpoint_401_rate{endpoint:take_exam}": ["rate<0.01"],
    "endpoint_401_rate{endpoint:exam_student_get}": ["rate<0.01"],
    "endpoint_401_rate{endpoint:answer_put}": ["rate<0.01"],
    "endpoint_4xx_rate{endpoint:login}": ["rate<0.02"],
    "endpoint_4xx_rate{endpoint:take_exam}": ["rate<0.02"],
    "endpoint_4xx_rate{endpoint:exam_student_get}": ["rate<0.02"],
    "endpoint_4xx_rate{endpoint:answer_put}": ["rate<0.02"],
    "endpoint_5xx_rate{endpoint:login}": ["rate<0.01"],
    "endpoint_5xx_rate{endpoint:take_exam}": ["rate<0.01"],
    "endpoint_5xx_rate{endpoint:exam_student_get}": ["rate<0.01"],
    "endpoint_5xx_rate{endpoint:answer_put}": ["rate<0.01"],
  },
};

export default function () {
  if (!session) {
    const student = pickStudentForVu(students, __VU);
    session = createSession(student);
  }

  interactionCounter += 1;
  const interaction = selectInteraction(session, interactionCounter);

  const response = saveAnswer(
    BASE_URL,
    session.token,
    session.examStudentUuid,
    interaction.question.uuid,
    interaction.payload,
    interaction.action
  );

  const success = response.status === 204;
  check(response, {
    "PUT /answer retornou 204": (res) => res.status === 204,
  });

  answerPutSuccess.add(success, { action: interaction.action });
  answerPutDuration.add(response.timings.duration, { action: interaction.action });
  session.answersByQuestion[interaction.question.uuid] = interaction.payload;

  sleep(randomThinkTimeSeconds(THINK_MIN_SECONDS, THINK_MAX_SECONDS));
}

function createSession(student) {
  const loginResponse = http.post(
    `${BASE_URL}/login`,
    JSON.stringify({
      email: student.email,
      password: student.password,
    }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { endpoint: "login" },
    }
  );
  recordEndpointStatusRates(loginResponse, "login");

  if (loginResponse.status !== 200) {
    const message = extractErrorMessage(loginResponse);
    throw new Error(
      `Falha no login para ${student.email}. status=${loginResponse.status}. ${message}`
    );
  }

  const loginPayload = safeJson(loginResponse);
  if (!loginPayload?.token) {
    throw new Error(`Login sem token para ${student.email}.`);
  }

  const context = resolveExamStudentContext(loginPayload.token, {
    examUuid: EXAM_UUID,
    preferredExamStudentUuid: student.examStudentUuid,
    preferredQuestionUuid: student.questionUuid,
  });

  return {
    token: loginPayload.token,
    examStudentUuid: context.examStudentUuid,
    questions: context.questions,
    questionCursor: 0,
    answersByQuestion: {},
  };
}

function resolveExamStudentContext(token, options) {
  const { examUuid, preferredExamStudentUuid, preferredQuestionUuid } = options || {};

  if (!examUuid && !preferredExamStudentUuid) {
    throw new Error(
      "Informe EXAM_UUID ou exam_student_uuid no CSV para resolver contexto."
    );
  }

  let examStudentUuid = preferredExamStudentUuid || "";
  if (!examStudentUuid) {
    const takeResponse = http.get(`${BASE_URL}/exams/${examUuid}/take`, {
      headers: authHeaders(token),
      redirects: 0,
      tags: { endpoint: "take_exam" },
    });
    recordEndpointStatusRates(takeResponse, "take_exam");

    if (takeResponse.status !== 302) {
      const message = extractErrorMessage(takeResponse);
      throw new Error(
        `Falha em /exams/${examUuid}/take. status=${takeResponse.status}. ${message}`
      );
    }

    const locationHeader = readLocationHeader(takeResponse);
    examStudentUuid = parseExamStudentUuidFromLocation(locationHeader);
  }

  const detailsResponse = http.get(`${BASE_URL}/exam-students/${examStudentUuid}`, {
    headers: authHeaders(token),
    tags: { endpoint: "exam_student_get" },
  });
  recordEndpointStatusRates(detailsResponse, "exam_student_get");

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
  };
}

function saveAnswer(baseUrl, token, examStudentUuid, questionUuid, answerPayload, action) {
  const response = http.put(
    `${baseUrl}/exam-students/${examStudentUuid}/answer/${questionUuid}`,
    JSON.stringify(answerPayload),
    {
      headers: authHeaders(token),
      tags: { endpoint: "answer_put", action },
    }
  );

  recordEndpointStatusRates(response, "answer_put");
  return response;
}

function selectInteraction(currentSession, iteration) {
  const reviewQuestion = pickReviewQuestion(currentSession);
  if (reviewQuestion && Math.random() < REVIEW_PROBABILITY) {
    const previousPayload = currentSession.answersByQuestion[reviewQuestion.uuid];
    const revisedPayload = buildRevisedPayload(reviewQuestion, previousPayload, iteration);

    return {
      action: "review",
      question: reviewQuestion,
      payload: revisedPayload,
    };
  }

  const question =
    currentSession.questions[
      currentSession.questionCursor % currentSession.questions.length
    ];
  currentSession.questionCursor += 1;

  return {
    action: "answer",
    question,
    payload: buildAnswerPayload(question, iteration),
  };
}

function pickReviewQuestion(currentSession) {
  const answeredQuestions = currentSession.questions.filter((question) => {
    if (question.type === "F") {
      return false;
    }
    return Boolean(currentSession.answersByQuestion[question.uuid]);
  });

  if (!answeredQuestions.length) {
    return null;
  }

  const idx = Math.floor(Math.random() * answeredQuestions.length);
  return answeredQuestions[idx];
}

function buildRevisedPayload(question, previousPayload, iteration) {
  if (!previousPayload) {
    return buildAnswerPayload(question, iteration + 1);
  }

  const type = question?.type;

  if (type === "A") {
    return {
      value: previousPayload.value === "C" ? "E" : "C",
      skipped: false,
    };
  }

  if (type === "B") {
    const parsed = Number(previousPayload.value);
    const nextValue = Number.isFinite(parsed) ? parsed + 1 : 101 + (iteration % 700);
    return {
      value: String(nextValue),
      skipped: false,
    };
  }

  if (type === "C") {
    return {
      value: rotateChoice(["A", "B", "C", "D"], previousPayload.value),
      skipped: false,
    };
  }

  if (type === "ENEM") {
    return {
      value: rotateChoice(["A", "B", "C", "D", "E"], previousPayload.value),
      skipped: false,
    };
  }

  if (type === "D") {
    const baseValue = String(previousPayload.value || `resposta_${iteration}`);
    return {
      value: `${baseValue}_rev`,
      skipped: false,
    };
  }

  // Tipo F depende de upload; mantemos como "em branco" para evitar flood de erro.
  return {
    value: "",
    skipped: true,
  };
}

function rotateChoice(choices, currentValue) {
  const currentIdx = choices.indexOf(String(currentValue || "").toUpperCase());
  if (currentIdx === -1) {
    return choices[0];
  }
  return choices[(currentIdx + 1) % choices.length];
}

function recordEndpointStatusRates(response, endpoint) {
  const status = Number(response?.status || 0);
  const tags = { endpoint };

  endpoint401Rate.add(status === 401, tags);
  endpoint4xxRate.add(status >= 400 && status < 500, tags);
  endpoint5xxRate.add(status >= 500 && status < 600, tags);
}

function parseStages(rawStages) {
  if (!rawStages) {
    return [
      { duration: "2m", target: 100 },
      { duration: "2m", target: 200 },
      { duration: "2m", target: 300 },
      { duration: "2m", target: 400 },
      { duration: "2m", target: 500 },
      { duration: "2m", target: 600 },
      { duration: "2m", target: 700 },
      { duration: "2m", target: 800 },
      { duration: "2m", target: 900 },
      { duration: "2m", target: 1000 },
      { duration: "4m", target: 0 },
    ];
  }

  const stages = rawStages
    .split(",")
    .map((entry) => {
      const [duration, target] = entry.split(":");
      return {
        duration: (duration || "").trim(),
        target: Number((target || "").trim()),
      };
    })
    .filter(
      (stage) =>
        stage.duration &&
        Number.isFinite(stage.target) &&
        stage.target >= 0 &&
        stage.duration.length > 0
    );

  if (!stages.length) {
    throw new Error(
      'REALISTIC_STAGES invalido. Formato esperado: "2m:100,2m:200,2m:300,2m:400,2m:500,2m:600,2m:700,2m:800,2m:900,2m:1000,4m:0"'
    );
  }

  return stages;
}

function randomThinkTimeSeconds(minSeconds, maxSeconds) {
  const min = Math.min(minSeconds, maxSeconds);
  const max = Math.max(minSeconds, maxSeconds);
  if (min === max) {
    return min;
  }
  return min + Math.random() * (max - min);
}

function parseNumber(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function parsePositiveNumber(rawValue, fallback) {
  const parsed = parseNumber(rawValue, fallback);
  if (parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function clamp(value, min, max) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function resolveStudentsFile(rawPath) {
  if (!rawPath) {
    return "../data/students.csv";
  }

  const normalized = String(rawPath).trim();
  if (normalized.startsWith("/")) {
    return normalized;
  }

  if (normalized.startsWith("./data/")) {
    return `../data/${normalized.slice("./data/".length)}`;
  }

  if (normalized.startsWith("data/")) {
    return `../${normalized}`;
  }

  return normalized;
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
