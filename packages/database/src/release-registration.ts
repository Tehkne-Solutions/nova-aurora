import { ReleaseCandidateService } from "./release-candidate.js";

export class RegistrationReleaseService extends ReleaseCandidateService {
  async isRegistrationReplay(idempotencyKey: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT user_id FROM registration_idempotency
      WHERE idempotency_key=${idempotencyKey}
    `;
    return Boolean(rows[0]);
  }
}
