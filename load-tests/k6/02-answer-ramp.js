import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import { SharedArray } from "k6/data";
import { parseStudentsCsv, pickStudentForVu } from "./lib/data.js";
import {
  normalizeBaseUrl,
  login,
  resolveExamStudentContext,
  buildAnswerPayload,
  saveAnswer,
} from "./lib/flow.js";

const BASE_URL = normalizeBaseUrl(__ENV.BASE_URL || "http://localhost:4000");
const EXAM_UUID = (__ENV.EXAM_UUID || "").trim();
const STUDENTS_FILE = __ENV.STUDENTS_CSV || "../data/students.csv";
const SLEEP_SECONDS = Number(__ENV.ANSWER_SLEEP_SECONDS || 0.5);

if (!EXAM_UUID) {
  throw new Error("EXAM_UUID e obrigatorio no teste 02-answer-ramp.");
}

const answerSaveErrors = new Rate("answer_save_errors");

const students = new SharedArray("students_answer_ramp", () =>
  parseStudentsCsv(open(STUDENTS_FILE))
);

let session = null;
let iterationCounter = 0;

export const options = {
  stages: parseStages(__ENV.RAMP_STAGES),
  thresholds: {
    checks: ["rate>0.95"],
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2500"],
    "http_req_duration{endpoint:answer_put}": ["p(95)<2000"],
    answer_save_errors: ["rate<0.05"],
  },
};

export default function () {
  if (!session) {
    const student = pickStudentForVu(students, __VU);
    const token = login(BASE_URL, student);
    const context = resolveExamStudentContext(BASE_URL, token, {
      examUuid: EXAM_UUID,
      preferredExamStudentUuid: student.examStudentUuid,
      preferredQuestionUuid: student.questionUuid,
    });

    session = {
      token,
      examStudentUuid: context.examStudentUuid,
      questions: context.questions,
      questionCursor: 0,
    };
  }

  const question = session.questions[session.questionCursor % session.questions.length];
  session.questionCursor += 1;
  iterationCounter += 1;

  const payload = buildAnswerPayload(question, iterationCounter);
  const response = saveAnswer(
    BASE_URL,
    session.token,
    session.examStudentUuid,
    question.uuid,
    payload
  );

  const isOk = check(response, {
    "PUT /answer retornou 204": (res) => res.status === 204,
  });
  answerSaveErrors.add(!isOk);

  sleep(SLEEP_SECONDS);
}

function parseStages(rawStages) {
  if (!rawStages) {
    return [
      { duration: "2m", target: 20 },
      { duration: "5m", target: 80 },
      { duration: "5m", target: 150 },
      { duration: "2m", target: 0 },
    ];
  }

  // Formato esperado: "2m:20,5m:80,5m:150,2m:0"
  return rawStages.split(",").map((entry) => {
    const [duration, target] = entry.split(":");
    return {
      duration: (duration || "").trim(),
      target: Number((target || "").trim()),
    };
  });
}
