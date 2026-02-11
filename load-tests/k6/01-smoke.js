import { check, fail, sleep } from "k6";
import { SharedArray } from "k6/data";
import { parseStudentsCsv, pickStudentForVu } from "./lib/data.js";
import {
  normalizeBaseUrl,
  login,
  getAvailableExams,
  resolveExamStudentContext,
  buildAnswerPayload,
  saveAnswer,
  buildSubmitAnswers,
  submitExam,
} from "./lib/flow.js";

const BASE_URL = normalizeBaseUrl(__ENV.BASE_URL || "http://localhost:4000");
const EXAM_UUID = (__ENV.EXAM_UUID || "").trim();
const SHOULD_SUBMIT = String(__ENV.DO_SUBMIT || "false").toLowerCase() === "true";
const STUDENTS_FILE = __ENV.STUDENTS_CSV || "../data/students.csv";

if (!EXAM_UUID) {
  fail("EXAM_UUID e obrigatorio no smoke test.");
}

const students = new SharedArray("students_smoke", () =>
  parseStudentsCsv(open(STUDENTS_FILE))
);

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1500"],
  },
};

export default function () {
  const student = pickStudentForVu(students, __VU);
  const token = login(BASE_URL, student);

  const availableResponse = getAvailableExams(BASE_URL, token);
  check(availableResponse, {
    "GET /exams/available retornou 200": (res) => res.status === 200,
  });

  const context = resolveExamStudentContext(BASE_URL, token, {
    examUuid: EXAM_UUID,
    preferredExamStudentUuid: student.examStudentUuid,
    preferredQuestionUuid: student.questionUuid,
  });

  const answerPayload = buildAnswerPayload(context.selectedQuestion, 0);
  const answerResponse = saveAnswer(
    BASE_URL,
    token,
    context.examStudentUuid,
    context.selectedQuestion.uuid,
    answerPayload
  );

  check(answerResponse, {
    "PUT /answer retornou 204": (res) => res.status === 204,
  });

  if (SHOULD_SUBMIT) {
    const submitAnswers = buildSubmitAnswers(context.questions);
    const submitResponse = submitExam(
      BASE_URL,
      token,
      context.examStudentUuid,
      submitAnswers
    );

    check(submitResponse, {
      "POST /submit retornou 204": (res) => res.status === 204,
    });
  }

  sleep(1);
}
