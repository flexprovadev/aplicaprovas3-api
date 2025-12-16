const BaseStrategy = require("./base.strategy");

const defaultOpts = {
  minGrade: 0,
  maxGrade: 1,
  decimalPlaces: 3,
  useLinearization: false,
};

class RawStrategy extends BaseStrategy {
  constructor(opts = {}) {
    super({ ...defaultOpts, ...opts });
  }

  execute = (examStudents, exam) => {
    this.calculateRawScore(examStudents, exam);
    this.calculateLinearization(examStudents);
    this.limitDecimalPlaces(examStudents);
  };

  getQuestionValue = (value, answer) => {
    return value === answer ? 1 : 0;
  };
}

module.exports = RawStrategy;
