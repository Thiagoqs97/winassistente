// Espelho do backend (api/lib/auth.ts). Mantenha em sync.

export const PERMISSIONS = [
  'products.view',
  'products.edit',
  'products.import',
  'clientes.view',
  'clientes.edit',
  'clientes.delete',
  'orcamentos.view',
  'orcamentos.edit',
  'kanban.view',
  'vendas.view',
  'vendedores.view',
  'vendedores.edit',
  'historico.view',
  'config.view',
  'config.edit',
  'dashboard.view',
  'users.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface AuthUser {
  id: string;
  email: string;
  nome: string;
  role: 'admin' | 'sub';
  vendedor_id: string | null;
  permissions: Permission[];
}

export function hasPermission(user: AuthUser | null, perm: Permission): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.permissions.includes(perm);
}

export function hasAnyPermission(user: AuthUser | null, ...perms: Permission[]): boolean {
  return perms.some(p => hasPermission(user, p));
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  'products.view': 'Ver produtos',
  'products.edit': 'Editar produtos',
  'products.import': 'Importar estoque',
  'clientes.view': 'Ver clientes',
  'clientes.edit': 'Editar clientes',
  'clientes.delete': 'Desativar clientes',
  'orcamentos.view': 'Ver orçamentos',
  'orcamentos.edit': 'Editar orçamentos (fechar/cancelar/reabrir)',
  'kanban.view': 'Ver Kanban (funil de negócios)',
  'vendas.view': 'Ver vendas',
  'vendedores.view': 'Ver vendedores',
  'vendedores.edit': 'Editar vendedores',
  'historico.view': 'Ver histórico de conversas',
  'config.view': 'Ver configurações',
  'config.edit': 'Editar configurações',
  'dashboard.view': 'Ver dashboard',
  'users.manage': 'Gerenciar usuários',
};
