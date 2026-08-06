import type { FormInstance } from 'antd';

/**
 * `{"organization.email": ["Invalid email"]}` -> `['organization', 'email']`.
 *
 * The API flattens zod issue paths with dots (`formatZodError` in the server's
 * `middleware/error.ts`), and array indices arrive as digits, which Ant Design
 * needs as numbers, or `links.0.href` sets an error on a field named `"0"` that
 * no input is bound to.
 */
export function nameFromPath(path: string): (string | number)[] {
  return path.split('.').map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/**
 * Paint a 422's field errors onto a form, and report where the first one landed
 * so the caller can scroll to it.
 *
 * The cast is unavoidable: Ant Design v6 types `name` as a union derived from
 * the form's value type, and a path parsed out of a server response is a string
 * array at compile time. The values themselves are correct (they come from the
 * same zod schema the form was built against), but there is no way to prove that
 * to the type checker.
 */
export function applyFieldErrors<T>(
  form: FormInstance<T>,
  fieldErrors: Record<string, string[]>,
): (string | number)[] | null {
  const entries = Object.entries(fieldErrors).filter(([path]) => path !== '_');
  if (entries.length === 0) return null;

  form.setFields(
    entries.map(([path, errors]) => ({ name: nameFromPath(path), errors })) as Parameters<
      FormInstance<T>['setFields']
    >[0],
  );

  const first = entries[0];
  return first ? nameFromPath(first[0]) : null;
}

/** `scrollToField` carries the same name-typing problem as `setFields`. */
export function scrollToFieldPath<T>(form: FormInstance<T>, name: (string | number)[]): void {
  form.scrollToField(name as Parameters<FormInstance<T>['scrollToField']>[0], {
    behavior: 'smooth',
  });
}
