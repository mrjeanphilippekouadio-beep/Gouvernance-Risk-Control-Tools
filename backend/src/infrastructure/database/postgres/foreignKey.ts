import { ValidationError } from "../../../domain/errors/DomainErrors.js";

/**
 * QA-VIS2-05: a department id that does not exist violates the foreign key; answer it like the service answers an unknown
 * process (400), never a 500. Any other error is rethrown unchanged.
 */
export function unknownDepartmentAsValidation(err: unknown, departmentId: string | null | undefined): never {
  const pg = err as { code?: string; constraint?: string };
  if (pg?.code === "23503" && departmentId && (pg.constraint ?? "").includes("department")) {
    throw new ValidationError(`Department ${departmentId} does not exist in this tenant`);
  }
  throw err;
}
