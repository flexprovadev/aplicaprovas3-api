const express = require("express");
const router = express.Router();
const { User, Role } = require("../../model");
const { Permission, UserType } = require("../../enumerator");
const { hasPermission } = require("../../middleware");
const { encryptPassword } = require("../../util/password.util");

const type = UserType.STAFF;

router.get("", hasPermission(Permission.READ_STAFF.key), async (req, res) => {
  try {
    const users = await User.find({ type, enabled: true })
      .select("-_id uuid email name contactNumber enabled")
      .populate("roles")
      .sort({ email: 1 })
      .lean();
    return res.json(users);
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar colaboradores" });
  }
});

router.get(
  "/:uuid",
  hasPermission(Permission.READ_STAFF.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      const user = await User.findOne({ uuid, type })
        .select("uuid name email ")
        .populate({ path: "roles", select: "uuid name" })
        .lean();

      if (!user) {
        throw new Error("Erro ao recuperar colaborador");
      }

      user.roles = user.roles.map((x) => x.uuid);

      return res.json(user);
    } catch (ex) {
      const { message = "Erro ao recuperar colaborador" } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.post(
  "",
  hasPermission(Permission.CREATE_STAFF.key),
  async (req, res) => {
    try {
      let { roles } = req.body;
      roles = await Role.find({ uuid: roles });

      const user = await User.create({
        ...req.body,
        type,
        roles,
      });

      if (!user) {
        throw new Error();
      }

      const { uuid } = user;
      return res.json({ uuid });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao criar colaborador" });
    }
  }
);

router.post(
  "/:uuid/password",
  hasPermission(Permission.UPDATE_STAFF.key),
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
  hasPermission(Permission.UPDATE_STAFF.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;

      let { roles, password } = req.body;
      roles = await Role.find({ uuid: roles });

      const updateQuery = { ...req.body, roles };

      if (password) {
        updateQuery.password = await encryptPassword(password);
      }

      const user = await User.findOneAndUpdate({ uuid, type }, updateQuery);

      if (!user) {
        throw new Error();
      }

      return res.json({ message: "Colaborador atualizado com sucesso" });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao atualizar colaborador" });
    }
  }
);

router.delete(
  "/:uuid",
  hasPermission(Permission.DELETE_STAFF.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const user = await User.findOneAndDelete({ uuid, type });
      if (!user) {
        throw new Error();
      }
      return res.json({ message: "Colaborador removido com sucesso" });
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao remover colaborador" });
    }
  }
);

module.exports = router;
