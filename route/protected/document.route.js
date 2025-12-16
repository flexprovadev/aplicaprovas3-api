const express = require("express");
const router = express.Router();
const { Document } = require("../../model");
const { Permission } = require("../../enumerator");
const { hasPermission } = require("../../middleware");

// Listar documentos
router.get("", hasPermission(Permission.READ_DOCUMENT.key), async (req, res) => {
  console.log("Rota /document foi acessada");
  try {
    const documents = await Document.find()
      .select("uuid name description state dates")
      .populate("questions.teacher", "name email")
      .lean();
    return res.json(documents);
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar documentos" });
  }
});

// Obter detalhes de um documento
router.get(
  "/:uuid",
  hasPermission(Permission.READ_DOCUMENT.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const document = await Document.findOne({ uuid })
        .populate("questions.teacher", "name email")
        .populate("questions.course", "name")
        .lean();

      if (!document) {
        throw new Error("Documento não encontrado");
      }

      return res.json(document);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao recuperar documento" });
    }
  }
);

// Criar um novo documento
router.post(
  "",
  hasPermission(Permission.CREATE_DOCUMENT.key),
  async (req, res) => {
    try {
      const { name, description, questions, createdBy, dates} = req.body;

      // Preparar os dados do documento
      const documentData = {
        name,
        description,
        questions,
        createdBy,
        dates: {
          start: dates.start,
          teacher: dates.teacher,
          print: dates.print,
          final: dates.final,
        },
        state: "draft", // Inicialmente definido como draft
      };

      // Criar o documento no banco
      const document = await Document.create(documentData);

      if (!document) {
        throw new Error("Erro ao criar documento");
      }

      return res.json({ uuid: document.uuid });
    } catch (ex) {
      console.error("Erro ao criar documento:", ex);
      return res.status(400).json({ message: "Erro ao criar documento" });
    }
  }
);

// Atualizar um documento
router.put(
  "/:uuid",
  hasPermission(Permission.UPDATE_DOCUMENT.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const { name, description, questions, dates} = req.body;

      // Determinar o estado do documento com base nas condições
      let status = "draft";

      if (questions.some((q) => q.questionFileUrl)) {
        status = "in_progress";
      }

      if (
        questions.every((q) => q.questionFileUrl) &&
        questions.every((q) => q.state === "approved")
      ) {
        status = "completed";
      }

      // Preparar os dados atualizados
      const updatedData = {
        name,
        description,
        questions,
        dates: {
          start: dates.start,
          teacher: dates.teacher,
          print: dates.print,
          final: dates.final,
        },
        state: status,
      };

      // Atualizar o documento no banco de dados
      const document = await Document.findOneAndUpdate({ uuid }, updatedData, {
        new: true,
      });

      if (!document) {
        throw new Error("Erro ao atualizar documento");
      }

      return res.json({ message: "Documento atualizado com sucesso" });
    } catch (ex) {
      console.error("Erro ao atualizar documento:", ex);
      return res.status(400).json({ message: "Erro ao atualizar documento" });
    }
  }
);


// Excluir um documento
router.delete(
  "/:uuid",
  hasPermission(Permission.DELETE_DOCUMENT.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const document = await Document.findOneAndDelete({ uuid });

      if (!document) {
        throw new Error("Erro ao remover documento");
      }

      return res.json({ message: "Documento removido com sucesso" });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao remover documento" });
    }
  }
);

module.exports = router;
