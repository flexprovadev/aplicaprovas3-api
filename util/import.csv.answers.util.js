const { User, Exam, ExamStudent } = require("../model");
const { UserType, ExamStudentStatus } = require("../enumerator");

const importCsvAnswers = async (examUuid, fileBuffer) => {
  // 1. Buscar a prova e suas questões
  const exam = await Exam.findOne({ uuid: examUuid });
  if (!exam) {
    throw new Error("Prova não encontrada");
  }

  const questions = exam.questions;
  if (!questions || questions.length === 0) {
    throw new Error("Prova não possui questões");
  }

  // 2. Parsear CSV (mesmo padrão de /import-questions)
  const csvContent = fileBuffer.toString("utf8").trim();
  const csvRows = csvContent.split("\n").filter((row) => row.trim() !== "");

  if (csvRows.length === 0) {
    throw new Error("Arquivo CSV está vazio");
  }

  // Detectar se primeira linha é header ou dados
  // Se a primeira coluna contém @, é email (dados), senão é header
  const firstRowFirstCol = csvRows[0].split(",")[0].trim();
  const hasHeader = !firstRowFirstCol.includes("@");

  const dataRows = hasHeader ? csvRows.slice(1) : csvRows;

  if (dataRows.length === 0) {
    throw new Error("Arquivo CSV não contém dados de alunos");
  }

  const results = { success: 0, errors: [] };

  // 3. Processar cada linha
  for (const [index, row] of dataRows.entries()) {
    try {
      const values = row.split(",").map((v) => v.trim());
      const email = values[0];

      if (!email) {
        results.errors.push({ line: index + 2, error: "Email não informado" });
        continue;
      }

      // Buscar aluno
      const student = await User.findOne({ email, type: UserType.STUDENT });
      if (!student) {
        results.errors.push({
          line: index + 2,
          error: `Aluno não encontrado: ${email}`,
        });
        continue;
      }

      // Buscar ou criar ExamStudent
      let examStudent = await ExamStudent.findOne({
        exam: exam._id,
        student: student._id,
      });

      if (!examStudent) {
        examStudent = await ExamStudent.create({
          exam: exam._id,
          student: student._id,
          status: ExamStudentStatus.PROGRESS,
          answers: {},
        });
      }

      // Mapear respostas (colunas 1 em diante = Q01, Q02, ...)
      const answers = {};
      questions.forEach((question, qIndex) => {
        const value = values[qIndex + 1] || ""; // +1 porque coluna 0 é email
        answers[question.uuid] = {
          value: value,
          skipped: value === "",
        };
      });

      // Atualizar ExamStudent
      examStudent.answers = answers;
      examStudent.status = ExamStudentStatus.SUBMITTED;
      examStudent.submittedAt = new Date();
      await examStudent.save();

      results.success++;
    } catch (error) {
      results.errors.push({ line: index + 2, error: error.message });
    }
  }

  return results;
};

module.exports = { importCsvAnswers };
