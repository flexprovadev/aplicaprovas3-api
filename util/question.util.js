const { QuestionType } = require("../enumerator");

const isQuestionAnswerValid = (answer, question, allowEmptyAnswer = true) => {
  const { skipped, value } = answer;

  if (!question) {
    return false;
  }

  if (skipped || (allowEmptyAnswer && value === "")) {
    return true;
  }

  switch (question.type) {
    case QuestionType.A:
      return ["C", "E"].includes(value);
    case QuestionType.B: {
      return value.match(/\d{3}/);
    }
    case QuestionType.C:
      return ["A", "B", "C", "D"].includes(value);
    case QuestionType.D: {
      return !!value.length;
    }
    case QuestionType.ENEM: {
      return ["A", "B", "C", "D", "E"].includes(value);
    }
    case QuestionType.F: {
      return !!value.length;
    }
  }
};

module.exports = { isQuestionAnswerValid };
