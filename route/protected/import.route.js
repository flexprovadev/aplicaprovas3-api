const express = require('express');
const multer = require('multer');
const { importExamAnswers } = require('../../util/import.exam.util');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const filePath = req.file.path;
    await importExamAnswers(filePath);
    res.status(200).json({ message: 'Respostas importadas com sucesso' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao importar respostas', error: error.message });
  }
});

module.exports = router;
