const axios = require('axios');
const fs = require('fs');

const importExamAnswers = async (filePath) => {
  const rawData = fs.readFileSync(filePath);
  const respostasPorAluno = JSON.parse(rawData);

  const baseUrl = 'http://localhost:4000/exam-students';

  for (const aluno of respostasPorAluno) {
    const { studentExamUuid, jwtToken, questions } = aluno;

    console.log(`Enviando respostas para o aluno: ${studentExamUuid}`);
    console.log(`Token JWT: ${jwtToken}`);
    console.log('Questões:', questions);

    for (const { uuid, answer, skipped } of questions) {
      try {
        const response = await axios.put(
          `${baseUrl}/${studentExamUuid}/answer/${uuid}`,
          { value: answer, skipped: skipped },
          { headers: { Authorization: `Bearer ${jwtToken}` } }
        );
        console.log(`Resposta enviada para a questão ${uuid} do aluno ${studentExamUuid}:`, response.status);
      } catch (error) {
        console.error(`Erro ao enviar resposta para a questão ${uuid} do aluno ${studentExamUuid}:`, error.response ? error.response.data : error.message);
      }
    }
  }
};

module.exports = { importExamAnswers };
