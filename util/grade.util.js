const { GradeType, ExamStudentStatus } = require("../enumerator");
const { ExamStudent } = require("../model");

const strategies = {
  [GradeType.SCORE]: require("./strategy/score.strategy"),
  [GradeType.PAS]: require("./strategy/pas.strategy"),
};

const calculateScore = (examStudents, exam, type) => {
  const strategy = new strategies[type](exam.gradeOptions);
  return strategy.execute(examStudents, exam);
};

const gradeTimers = {};

const scheduleGrade = (exam) => {
  const { uuid } = exam;

  if (gradeTimers[uuid]) {
    clearTimeout(gradeTimers[uuid]);
  }

  gradeTimers[uuid] = setTimeout(async () => {
    const { gradeStrategy } = exam;

    const examStudents = await ExamStudent.find({
      exam,
      status: ExamStudentStatus.SUBMITTED,
    });

    calculateScore(examStudents, exam, gradeStrategy);

    await Promise.all(examStudents.map((examStudent) => examStudent.save()));

    delete gradeTimers[uuid];
  }, 1000 * 30);
};

module.exports = { calculateScore, scheduleGrade };
