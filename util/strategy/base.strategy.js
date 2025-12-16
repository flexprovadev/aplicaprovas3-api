class BaseStrategy {
  constructor(opts) {
    this.opts = opts;
  }

  limitDecimalPlaces = (examStudents) => {
    const decimalPlaces = this.opts.decimalPlaces || 2;
    examStudents.forEach(({ answers, grade }) => {
      Object.keys(answers).forEach((key) => {
        const answer = answers[key];
        const { grade } = answer;
        if (grade) {
          Object.assign(answer, {
            grade: +parseFloat(answer.grade).toFixed(decimalPlaces),
          });
        }
      });

      Object.keys(grade).forEach((key) => {
        const value = grade[key];
        grade[key] = +parseFloat(value).toFixed(decimalPlaces);
      });
    });
  };

  calculateLinearization = (examStudents, scoreAttribute = "rawScore") => {
    const { minGrade, maxGrade, useLinearization } = this.opts;

    if (!useLinearization) {
      return;
    }

    const range = examStudents.reduce((acc, { grade }) => {
      const score = grade[scoreAttribute];
      const min = Math.min(acc.min, score);
      const max = Math.max(acc.max, score);
      return {
        min: min < score ? min : score,
        max: max > score ? max : score,
      };
    }, {});

    const { min, max } = range;

    examStudents.forEach(({ grade }) => {
      const studentScore = grade[scoreAttribute];
      const denominator = max - min || 1;
      const result =
        minGrade + ((maxGrade - minGrade) * (studentScore - min)) / denominator;
      grade.linearization = result;
    });
  };

  calculateRawScore = (examStudents, exam) => {
    examStudents.forEach((examStudent) => {
      const rawScore = this.getRawScore(examStudent, exam);
      examStudent.grade = { rawScore };
    });
  };

  getRawScore = (examStudent, exam) => {
    return Object.entries(examStudent.answers).reduce(
      (acc, [uuid, studentAnswer]) => {
        const { value } = studentAnswer;

        const question = exam.questions.filter(
          (question) => question.uuid === uuid
        )[0];

        if (question) {
          const { type, answer } = question;
          const questionValue = this.getQuestionValue(value, answer, type);
          examStudent.answers = {
            ...examStudent.answers,
            [uuid]: {
              ...studentAnswer,
              grade: questionValue,
            },
          };
          acc += questionValue;
        }

        return acc;
      },
      0
    );
  };
}

module.exports = BaseStrategy;
