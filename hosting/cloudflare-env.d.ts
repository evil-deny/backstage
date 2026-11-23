declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ADMIN_EMAILS?: string;
    STAFF_EMAILS?: string;
    GOOGLE_CLIENT_ID?: string;
    BUCKET?: R2Bucket;
  }
}
