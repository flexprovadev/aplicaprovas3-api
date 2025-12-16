const express = require("express");
const router = express.Router();
const { User, Classroom } = require("../../model");
const { Permission, UserType } = require("../../enumerator");
const { hasPermission } = require("../../middleware");
const { encryptPassword } = require("../../util/password.util");

const type = UserType.TEACHER;

// Listar todos os professores
router.get("", hasPermission(Permission.READ_TEACHER.key), async (req, res) => {
  try {
    const teachers = await User.find({ type, enabled: true })
      .select("uuid email name contactNumber enabled")
      .sort({ email: 1 })
      .lean();
    return res.json(teachers);
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar professores" });
  }
});

// Obter um professor específico
router.get(
  "/:uuid",
  hasPermission(Permission.READ_TEACHER.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const teacher = await User.findOne({ uuid, type })
        .select("uuid name email contactNumber enabled")
        .lean();

      if (!teacher) {
        throw new Error("Professor não encontrado");
      }

      return res.json(teacher);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao recuperar professor" });
    }
  }
);

// Criar professor
router.post("", hasPermission(Permission.CREATE_TEACHER.key), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Todos os campos obrigatórios devem ser preenchidos" });
    }    
    
    const teacher = await User.create({
      ...req.body,
      type,
    });

    if (!teacher) {
      throw new Error("Erro ao criar professor");
    }

    return res.json({ uuid: teacher.uuid });
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao criar professor" });
  }
});

// Atualizar dados do professor
router.put(
  "/:uuid",
  hasPermission(Permission.UPDATE_TEACHER.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const updateQuery = { ...req.body };
      if (req.body.password) {
        updateQuery.password = await encryptPassword(req.body.password);
      }

      const teacher = await User.findOneAndUpdate({ uuid, type }, updateQuery, {
        new: true,
      });

      if (!teacher) {
        throw new Error("Erro ao atualizar professor");
      }

      return res.json({ message: "Professor atualizado com sucesso" });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao atualizar professor" });
    }
  }
);

// Atualizar senha do professor
router.post(
  "/:uuid/password",
  hasPermission(Permission.UPDATE_TEACHER.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const { password } = req.body;

      if (!password || password.length < 6) {
        throw new Error("A senha deve ter pelo menos 6 caracteres");
      }

      const encryptedPassword = await encryptPassword(password);

      const teacher = await User.findOneAndUpdate(
        { uuid, type },
        { password: encryptedPassword }
      );

      if (!teacher) {
        throw new Error("Erro ao atualizar senha do professor");
      }

      return res.status(204).send();
    } catch (ex) {
      return res.status(400).json({ message: ex.message || "Erro ao atualizar senha" });
    }
  }
);

// Remover professor
router.delete(
  "/:uuid",
  hasPermission(Permission.DELETE_TEACHER.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const teacher = await User.findOneAndDelete({ uuid, type });

      if (!teacher) {
        throw new Error("Erro ao remover professor");
      }

      return res.json({ message: "Professor removido com sucesso" });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao remover professor" });
    }
  }
);

module.exports = router;

