import "express";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        address: string;
      };
    }
  }
}
