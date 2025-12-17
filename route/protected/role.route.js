const express = require("express");
const router = express.Router();
const { Role, User } = require("../../model");
const { Permission } = require("../../enumerator");
const { hasPermission } = require("../../middleware");

router.get(
  "/permissions",
  hasPermission(Permission.READ_ROLE.key),
  async (req, res) => {
    try {
      return res.json(Permission);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao recuperar funções" });
    }
  }
);

router.get("", hasPermission(Permission.READ_ROLE.key), async (req, res) => {
  try {
    const missingPermissions = req.user.getMissingPermissions();
    const roles = await Role.find({
      permissions: { $nin: missingPermissions },
      enabled: true,
    })
      .select("-_id uuid name enabled permissions")
      .sort({ name: 1 })
      .lean();
    return res.json(roles);
  } catch (ex) {
    return res.status(400).json({ message: "Erro ao recuperar perfis" });
  }
});
// Em permissions, antes havia "funcoes"
router.get(
  "/:uuid",
  hasPermission(Permission.READ_ROLE.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const missingPermissions = req.user.getMissingPermissions();
      const role = await Role.findOne({
        uuid,
        permissions: { $nin: missingPermissions },
      }).lean();
      return res.json(role);
    } catch (ex) {
      return res.status(400).json({ message: "Erro ao recuperar perfil" });
    }
  }
);

router.post("", hasPermission(Permission.CREATE_ROLE.key), async (req, res) => {
  try {
    const { name, permissions } = req.body;
    const userPermissions = req.user.getPermissions();

    if (permissions.filter((o) => !userPermissions.includes(o)).length) {
      throw new Error(
        "Não é possível atribuir um perfil que o usuário autenticado não possui"
      );
    }

    const role = await Role.create({ name, permissions });

    if (!role) {
      throw new Error("Erro ao criar perfil");
    }

    const { uuid } = role;
    return res.json({ uuid });
  } catch (ex) {
    const { message } = ex;
    return res.status(400).json({ message });
  }
});
// Em permissions, antes havia "funcoes"
router.put(
  "/:uuid",
  hasPermission(Permission.UPDATE_ROLE.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const missingPermissions = req.user.getMissingPermissions();
      const role = await Role.findOneAndUpdate(
        { uuid, permissions: { $nin: missingPermissions } },
        req.body
      );

      if (!role) {
        throw new Error("Erro ao atualizar perfil");
      }
      return res.json({ message: "Perfil atualizado com sucesso" });
    } catch (ex) {
      const { message } = ex;
      return res.status(400).json({ message });
    }
  }
);

router.delete(
  "/:uuid",
  hasPermission(Permission.DELETE_ROLE.key),
  async (req, res) => {
    try {
      const { uuid } = req.params;
      const missingPermissions = req.user.getMissingPermissions();
      const role = await Role.findOneAndDelete({
        uuid,
        permissions: { $nin: missingPermissions },
      });
      if (!role) {
        throw new Error("Erro ao remover perfil");
      }

      const { _id } = role;

      await User.collection.updateMany(
        {},
        {
          $pull: {
            roles: {
              $in: [_id],
            },
          },
        }
      );

      return res.json({ message: "Perfil removido com sucesso" });
    } catch (ex) {
      const { message } = ex;
      return res.status(400).json({ message });
    }
  }
);

module.exports = router;
