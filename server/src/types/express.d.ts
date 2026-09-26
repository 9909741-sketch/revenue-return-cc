declare global {
  namespace Express {
    interface Request {
      diagnosticId: string;
    }
  }
}

export {};