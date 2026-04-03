const express = require("express");
const request = require("supertest");

const mockClassroom = {
  find: jest.fn(),
};

jest.mock("../model", () => ({
  User: {},
  Classroom: mockClassroom,
}));

jest.mock("../middleware", () => ({
  hasPermission: () => (req, res, next) => next(),
}));

const createLightweightChain = (result) => {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };

  return chain;
};

const createDefaultChain = (result) => {
  const chain = {
    select: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn().mockResolvedValue(result),
  };

  return chain;
};

describe("GET /classrooms list route", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();

    app = express();
    app.use((req, res, next) => {
      req.schoolPrefix = "school";
      next();
    });

    app.use("/classrooms", require("../route/protected/classrooms.route"));
  });

  test("returns the default populated payload when includeStudents is absent", async () => {
    const chain = createDefaultChain([
      {
        uuid: "class-1",
        name: "school.Turma A",
        year: 2026,
        level: "EM",
        students: [{ uuid: "student-1", name: "Ana" }],
      },
    ]);
    mockClassroom.find.mockReturnValue(chain);

    const response = await request(app).get("/classrooms");

    expect(response.status).toBe(200);
    expect(response.body[0].students).toEqual([{ uuid: "student-1", name: "Ana" }]);
    expect(chain.populate).toHaveBeenCalledTimes(1);
  });

  test("returns a lightweight payload without students when includeStudents=false", async () => {
    const chain = createLightweightChain([
      {
        uuid: "class-2",
        name: "school.Turma B",
        year: 2026,
        level: "EM",
        shift: "morning",
        enabled: true,
      },
    ]);
    mockClassroom.find.mockReturnValue(chain);

    const response = await request(app).get("/classrooms?includeStudents=false");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        uuid: "class-2",
        name: "school.Turma B",
        year: 2026,
        level: "EM",
        shift: "morning",
        enabled: true,
      },
    ]);
    expect(chain.populate).toBeUndefined();
  });
});
