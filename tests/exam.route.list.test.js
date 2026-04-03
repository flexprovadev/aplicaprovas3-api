const express = require("express");
const request = require("supertest");

const mockExam = {
  find: jest.fn(),
  countDocuments: jest.fn(),
};

const mockClassroom = {
  find: jest.fn(),
};

jest.mock("../model", () => ({
  Exam: mockExam,
  Classroom: mockClassroom,
  ExamStudent: {},
  Course: {},
  ActivityLog: {},
}));

jest.mock("../middleware", () => ({
  hasPermission: () => (req, res, next) => next(),
  isStudent: (req, res, next) => next(),
}));

jest.mock("../util/s3.util", () => ({
  doExamUpload: jest.fn(),
  doPreliminarkeyUpload: jest.fn(),
  doEditableDocumentUpload: jest.fn(),
  doFinalkeyUpload: jest.fn(),
  doNamelistUpload: jest.fn(),
  doAnswerSheetImageUpload: jest.fn(),
  doClassification1Upload: jest.fn(),
  doClassification2Upload: jest.fn(),
  doIndividualResultsUpload: jest.fn(),
  doPrintableAnswerSheetUpload: jest.fn(),
  createPresignedUpload: jest.fn(),
  buildPublicUrl: jest.fn(),
}));

jest.mock("../util/exam.export.util", () => ({
  generateArchive: jest.fn(),
}));

jest.mock("../util/import.csv.answers.util", () => ({
  importCsvAnswers: jest.fn(),
}));

jest.mock("../util/date.util", () => ({
  applyTimezone: jest.fn((value) => value),
}));

jest.mock("../util/activity.log.util", () => {
  const actual = jest.requireActual("../util/activity.log.util");
  return {
    ...actual,
    createActivityLog: jest.fn(),
    isTrackedUser: jest.fn(() => true),
  };
});

const createLegacyExamChain = (result) => {
  const chain = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };

  return chain;
};

const createPaginatedExamChain = (result) => {
  const chain = {
    populate: jest.fn(() => chain),
    select: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };

  return chain;
};

const createClassroomChain = (result) => {
  const chain = {
    select: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };

  return chain;
};

describe("GET /exams list route", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use((req, res, next) => {
      req.schoolPrefix = "school";
      req.user = {
        type: "staff",
        getPermissions: () => [],
        hasPermission: () => true,
      };
      next();
    });

    app.use("/exams", require("../route/protected/exam.route"));
  });

  test("keeps returning the legacy array when pagination params are absent", async () => {
    const legacyExam = {
      uuid: "exam-1",
      name: "school.Prova Matemática",
      classrooms: [],
      examsInProgress: [],
      examsSubmitted: [],
    };
    const examChain = createLegacyExamChain([legacyExam]);
    mockExam.find.mockReturnValue(examChain);

    const response = await request(app).get("/exams");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        ...legacyExam,
        examsPending: [],
      },
    ]);
    expect(mockExam.countDocuments).not.toHaveBeenCalled();
    expect(mockClassroom.find).not.toHaveBeenCalled();
    expect(examChain.populate).toHaveBeenCalledTimes(1);
  });

  test("returns paginated lightweight data and applies name/classroom filters", async () => {
    const examChain = createPaginatedExamChain([
      {
        uuid: "exam-2",
        name: "school.Prova História",
        classrooms: [
          {
            uuid: "class-2",
            name: "school.Turma B",
            year: 2026,
            level: "EM",
          },
        ],
      },
    ]);
    const classroomChain = createClassroomChain([{ _id: "mongo-class-2" }]);

    mockClassroom.find.mockReturnValue(classroomChain);
    mockExam.find.mockReturnValue(examChain);
    mockExam.countDocuments.mockResolvedValue(1);

    const response = await request(app).get(
      "/exams?page=1&limit=25&name=Hist&classroomUuids=class-2,class-3"
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [
        {
          uuid: "exam-2",
          name: "school.Prova História",
          classrooms: [
            {
              uuid: "class-2",
              name: "school.Turma B",
              year: 2026,
              level: "EM",
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });

    expect(mockClassroom.find).toHaveBeenCalledWith({
      uuid: { $in: ["class-2", "class-3"] },
      name: { $regex: "^school\\." },
    });
    expect(mockExam.find).toHaveBeenCalledWith({
      $and: [
        { name: { $regex: "^school\\." } },
        { name: { $regex: "Hist", $options: "i" } },
      ],
      classrooms: { $in: ["mongo-class-2"] },
    });
    expect(examChain.skip).toHaveBeenCalledWith(0);
    expect(examChain.limit).toHaveBeenCalledWith(25);
    expect(mockExam.countDocuments).toHaveBeenCalledWith({
      $and: [
        { name: { $regex: "^school\\." } },
        { name: { $regex: "Hist", $options: "i" } },
      ],
      classrooms: { $in: ["mongo-class-2"] },
    });
  });
});
