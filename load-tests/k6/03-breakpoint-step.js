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
const STUDENTS_FILE = resolveStudentsFile(__ENV.STUDENTS_CSV);
const SLEEP_SECONDS = Number(__ENV.BREAKPOINT_SLEEP_SECONDS || 0.2);

if (!EXAM_UUID) {
  throw new Error("EXAM_UUID e obrigatorio no teste 03-breakpoint-step.");
}

const breakpointErrors = new Rate("breakpoint_errors");

const students = new SharedArray("students_breakpoint", () =>
  parseStudentsCsv(open(STUDENTS_FILE))
);

let session = null;
let iterationCounter = 0;

export const options = {
  stages: buildStepStages(
    __ENV.STEP_TARGETS || "25,50,100,150,200,300",
    __ENV.STEP_DURATION || "2m",
    __ENV.COOLDOWN_DURATION || "2m"
  ),
  thresholds: {
    checks: ["rate>0.9"],
    http_req_failed: ["rate<0.1"],
    http_req_duration: ["p(95)<5000"],
    "http_req_duration{endpoint:answer_put}": ["p(95)<4000"],
    breakpoint_errors: ["rate<0.1"],
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
  breakpointErrors.add(!isOk);

  sleep(SLEEP_SECONDS);
}

function buildStepStages(rawTargets, stepDuration, cooldownDuration) {
  const targets = rawTargets
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);

  const stages = targets.map((target) => ({
    duration: stepDuration,
    target,
  }));

  stages.push({ duration: cooldownDuration, target: 0 });
  return stages;
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
