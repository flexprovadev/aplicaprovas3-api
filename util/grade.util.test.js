const fs = require("fs");
const { GradeType } = require("../enumerator");

const fileToExam = (file) => {
  const input = fs.readFileSync(file, "utf-8");
  const lines = input.split("\n");
  const exam = { questions: [] };
  lines.forEach((line) => {
    const [uuid, type, answer] = line.split(",");
    exam.questions.push({ uuid, type, answer });
  });
  return exam;
};

const fileToExamStudents = (file) => {
  const input = fs.readFileSync(file, "utf-8");
  const lines = input.split("\n");
  const examStudents = [];
  lines.forEach((line) => {
    const examStudent = { answers: {} };
    const answers = line.split(",");
    answers.forEach((answer, index) => {
      examStudent.answers[`Questao ${index + 1}`] = { value: answer };
    });
    examStudents.push(examStudent);
  });
  return examStudents;
};

const exam = fileToExam("test/eucorrijo_configuracao_1_prova_1.csv");

let examStudents = fileToExamStudents(
  "test/eucorrijo_configuracao_1_alunos.csv"
);

const calculateScore = require("./grade.util").calculateScore;

const gradeType = GradeType.PAS;

calculateScore(examStudents, exam, gradeType, {
  minGrade: 0.2,
  maxGrade: 2,
  decimalPlaces: 3,
});

let outputAsString = examStudents.reduce((acc, { answers, grade }, index) => {
  const { rawScore, factorX = 0, linearization } = grade;
  acc += `Aluno ${index + 1},${rawScore},${factorX},${linearization}\n`;
  return acc;
}, "");

fs.writeFileSync(`d:/output-${gradeType}-${Date.now()}.csv`, outputAsString);
