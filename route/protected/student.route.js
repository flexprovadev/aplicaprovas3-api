const express = require("express");
const router = express.Router();
const { User, Classroom, ExamStudent } = require("../../model");
const { Permission, UserType } = require("../../enumerator");
const { hasPermission } = require("../../middleware");
const {
  EmailValidator,
  batchImportStudents,
  ClassroomValidator,
} = require("../../util/import.util");
const { encryptPassword } = require("../../util/password.util");

const type = UserType.STUDENT;

router.get("", hasPermission(Permission.READ_STUDENT.key), async (req, res) => {
  try {
    const users = await User.find({ type })
      .select("uuid email name enabled")
      .populate({
        path: "classrooms",
        select: "-_id uuid name level year -students",
      })
      .sort({ email: 1 })
      .lean();
    return res.json(users);
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar alunos" });
  }
});

router.get(
  "/:uuid",
  hasPermission(Permission.READ_STUDENT.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const user = await User.findOne({ uuid, type })
        .select("uuid name email")
        .populate({ path: "classrooms", select: "-_id uuid name" })
        .lean();

      if (!user) {
        throw new Error();
      }

      user.classrooms = user.classrooms.map((x) => x.uuid);

      return res.json(user);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao recuperar aluno" });
    }
  }
);

router.post(
  "",
  hasPermission(Permission.CREATE_STUDENT.key),
  async (req, res) => {
    try {
      const user = await User.create({
        ...req.body,
        type,
      });

      if (!user) {
        throw new Error("Erro ao criar aluno");
      }

      const { uuid, _id } = user;

      const { classrooms = [] } = req.body;

      await Classroom.collection.updateMany(
        { uuid: { $in: classrooms } },
        {
          $addToSet: {
            students: _id,
          },
        }
      );

      return res.json({ uuid });
    } catch (ex) {
      const { message = "Erro ao criar aluno" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/:uuid/password",
  hasPermission(Permission.UPDATE_STUDENT.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const { password } = req.body;

      const encryptedPassword = await encryptPassword(password);

      const user = await User.findOneAndUpdate(
        { uuid, type },
        { password: encryptedPassword }
      );

      if (!user) {
        throw new Error("Erro ao atualizar senha");
      }

      return res.status(204).send();
    } catch (ex) {
      const { message = "Erro ao atualizar senha" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.put(
  "/:uuid",
  hasPermission(Permission.UPDATE_STUDENT.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const { password } = req.body;

      let updateQuery = { ...req.body };
      if (password) {
        updateQuery.password = await encryptPassword(password);
      }

      const user = await User.findOneAndUpdate({ uuid, type }, updateQuery);

      if (!user) {
        throw new Error();
      }

      const { _id } = user;

      const { classrooms = [] } = req.body;

      await Classroom.collection.updateMany(
        { uuid: { $nin: classrooms } },
        {
          $pull: {
            students: {
              $in: [_id],
            },
          },
        }
      );

      await Classroom.collection.updateMany(
        { uuid: { $in: classrooms } },
        {
          $addToSet: {
            students: _id,
          },
        }
      );

      return res.json({ message: "Aluno atualizado com sucesso" });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao atualizar aluno" });
    }
  }
);

router.delete(
  "/:uuid",
  hasPermission(Permission.DELETE_STUDENT.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const user = await User.findOneAndDelete({ uuid, type });

      if (!user) {
        throw new Error("Erro ao remover aluno");
      }

      const { _id } = user;

      await Classroom.collection.updateMany(
        {},
        {
          $pull: {
            students: _id,
          },
        }
      );

      await ExamStudent.collection.deleteMany({ student: _id });

      return res.json({ message: "Aluno removido com sucesso" });
    } catch (ex) {
      const { message } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "/import",
  hasPermission(Permission.CREATE_STUDENT),
  async (req, res) => {
    try {
      const entries = req.body;

      let errors = [];

      const emailValidator = new EmailValidator();
      const classroomValidator = new ClassroomValidator();

      entries.forEach((entry, index) => {
        emailValidator.validate(entry, index);
        classroomValidator.validate(entry, index);
      });

      await emailValidator.validateDatabase();
      await classroomValidator.validateDatabase();

      errors = errors.concat(emailValidator.getErrors());
      errors = errors.concat(classroomValidator.getErrors());

      if (errors.length) {
        errors.sort((a, b) => a.index - b.index);
        return res.status(400).json(errors);
      }

      const classroomCache = classroomValidator.getCache();

      await batchImportStudents(entries, classroomCache);

      return res.sendStatus(204);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao importar alunos" });
    }
  }
);

module.exports = router;
