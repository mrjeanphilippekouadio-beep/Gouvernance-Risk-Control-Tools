export class NotFoundError extends Error {
  constructor(entityType: string, id: string) {
    super(`${entityType} ${id} not found`);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** 409: the request is valid but clashes with existing state; `existingId` lets the client reuse it. */
export class ConflictError extends Error {
  /** `code`: optional machine-readable discriminator of the 409 (I06), alongside the human message. */
  constructor(message: string, readonly existingId?: string, readonly code?: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Not authorized for this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}
