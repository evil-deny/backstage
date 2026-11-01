declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ADMIN_EMAILS?: string;
    BUCKET?: R2Bucket;
  }
}
