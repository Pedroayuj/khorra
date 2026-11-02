export function canManageRole(actorRole, targetRole, newRole = null) {
  if (!actorRole || !targetRole) {
    return false;
  }

  // Ninguém pode alterar o Dono.
  if (targetRole.is_owner) {
    return false;
  }

  // Não é permitido atribuir o cargo protegido.
  if (newRole?.is_owner) {
    return false;
  }

  // O Dono pode gerenciar todos os outros cargos.
  if (actorRole.is_owner) {
    return true;
  }

  // O cargo de quem executa precisa ser superior.
  if (actorRole.position <= targetRole.position) {
    return false;
  }

  // Não pode atribuir cargo igual ou superior ao próprio.
  if (
    newRole &&
    actorRole.position <= newRole.position
  ) {
    return false;
  }

  return true;
}