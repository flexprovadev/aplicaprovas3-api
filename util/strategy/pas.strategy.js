const { QuestionType } = require("../../enumerator");
const BaseStrategy = require("./base.strategy");

const questionValueByType = {
  [QuestionType.A]: {
    true: 1,
    false: -1,
  },
  [QuestionType.B]: {
    true: 2,
    false: 0,
  },
  [QuestionType.C]: {
    true: 2,
    false: -2 / 3,
  },
  [QuestionType.D]: {
    true: 0,
    false: 0,
  },
  [QuestionType.ENEM]: {
    true: 1,
    false: 0,
  },
  [QuestionType.F]: {
    true: 0,
    false: 0,
  },
};

const defaultOpts = {
  minGrade: 0,
  maxGrade: 1,
  decimalPlaces: 3,
  useLinearization: false,
};

class PasStrategy extends BaseStrategy {
  constructor(opts = {}) {
    super({ ...defaultOpts, ...opts });
  }

  execute = (examStudents, exam) => {
    this.calculateRawScore(examStudents, exam);
    this.calculateFactorX(examStudents, exam);
    this.calculateLinearization(examStudents, "factorX");
    this.limitDecimalPlaces(examStudents);
  };

  calculateFactorX = (examStudents, exam) => {
    const factorX = this.getFactorX(exam);
    examStudents.forEach(({ grade }) => {
      const { rawScore } = grade;
      grade.factorX = rawScore * factorX;
    });
  };

  getFactorX = (exam) => {
    const amountPerQuestionType = {
      [QuestionType.A]: 0,
      [QuestionType.B]: 0,
      [QuestionType.C]: 0,
      [QuestionType.D]: 0,
      [QuestionType.ENEM]: 0,
      [QuestionType.F]: 0,
    };

    exam.questions.forEach(({ type }) => {
      amountPerQuestionType[type] += 1;
    });

    return (
      exam.questions.length /
      (1 * amountPerQuestionType[QuestionType.A] +
        2 * amountPerQuestionType[QuestionType.B] +
        2 * amountPerQuestionType[QuestionType.C] +
        3 * amountPerQuestionType[QuestionType.D])
    );
  };

  getQuestionValue = (value, answer, type) => {
    return questionValueByType[type][value === answer];
  };
}

module.exports = PasStrategy;
