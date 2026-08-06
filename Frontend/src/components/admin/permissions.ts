/**
 * Who may act on whom in the control panel.
 *
 * This mirrors `assertCanManage` in `Server/src/modules/admin/admin.service.ts`
 * together with the `requireRoot` middleware on the routes. It MIRRORS the
 * server check; it does not replace it. Every rule below is re-evaluated by the
 * API against the session on the request itself, so editing `role` in devtools
 * changes which buttons render and earns a 403 when the request lands. What this
 * file buys is that the panel never offers an action the server is going to
 * refuse, which is a usability property rather than a security one.
 *
 * Because it is one function, the two rules that are genuine privilege
 * escalations when they are missing are stated exactly once:
 *
 *  - only root may act on a privileged account (an admin who can reset another
 *    admin's password inherits everything that account could do), and
 *  - nobody may destroy themselves (self-demotion is how an installation ends up
 *    with a control panel no one can open).
 */
import type { UserRole, UserStatus } from '@/types/api';

export type AdminAction =
  | 'edit'
  | 'change-role'
  | 'suspend'
  | 'reactivate'
  | 'set-quota'
  | 'reset-password'
  | 'reset-mfa'
  | 'delete';

export interface ActorRef {
  id: string;
  role: UserRole;
}

export interface TargetRef {
  id: string;
  role: UserRole;
  status: UserStatus;
}

export interface Permission {
  allowed: boolean;
  /** Why not, rendered in a tooltip so a disabled control explains itself. */
  reason: string | null;
}

const PRIVILEGED_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['root', 'admin']);

/** The routes that carry `requireRoot` in `admin.routes.ts`. */
const ROOT_ONLY: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'change-role',
  'reset-password',
  'reset-mfa',
  'delete',
]);

/**
 * The server's `destroy` intent. Reactivation is in here because it goes through
 * `PUT /users/:id/status`, which loads its target with `intent: 'destroy'`. The
 * ability to flip an account's status either way is the same power.
 */
const DESTRUCTIVE: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'change-role',
  'suspend',
  'reactivate',
  'delete',
]);

const ALLOWED: Permission = { allowed: true, reason: null };

function deny(reason: string): Permission {
  return { allowed: false, reason };
}

export function canAct(actor: ActorRef, target: TargetRef, action: AdminAction): Permission {
  if (ROOT_ONLY.has(action) && actor.role !== 'root') {
    return deny('Only the root account can do this.');
  }

  if (DESTRUCTIVE.has(action) && actor.id === target.id) {
    return deny('You cannot change the role, status or existence of your own account here.');
  }

  if (actor.role !== 'root' && PRIVILEGED_ROLES.has(target.role) && actor.id !== target.id) {
    return deny('Only the root account can manage administrator accounts.');
  }

  /*
   * State checks. The API answers a no-op status change with a 400 ("that
   * account is already suspended"), which reads as a failure to someone who just
   * clicked the wrong row. It is cheaper not to offer it.
   */
  if (action === 'suspend' && target.status === 'suspended') {
    return deny('That account is already suspended.');
  }

  if (action === 'reactivate' && target.status === 'active') {
    return deny('That account is already active.');
  }

  return ALLOWED;
}

/** `POST /api/admin/users` is the only path that mints a privileged account. */
export function canCreateUser(actor: ActorRef): Permission {
  return actor.role === 'root' ? ALLOWED : deny('Only the root account can create accounts.');
}

/**
 * Sections whose effects reach past the person editing them.
 *
 * The API lets any privileged account write every settings section, so this is a
 * panel convention rather than an enforced boundary, and it is commented as such
 * wherever it is used. The reasoning is that `maintenanceMode` locks out every
 * admin as well as every user, and only root can turn it back off; an admin who
 * sets it has locked themselves out of the switch that undoes it.
 */
export const ROOT_ONLY_SECTIONS: ReadonlySet<string> = new Set(['limits', 'features']);
