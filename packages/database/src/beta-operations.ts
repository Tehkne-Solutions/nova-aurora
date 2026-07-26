import { ControlledBetaService } from "./controlled-beta.js";
import { ModerationOperationsService } from "./moderation-operations.js";
import { ModerationService } from "./moderation-service.js";

export {
  type BetaControlView,
  type BetaWaveView
} from "./controlled-beta.js";
export {
  type ControlledBetaReadiness,
  type RolloutDecision
} from "./controlled-beta-rules.js";
export {
  type ModerationActionView,
  type ModerationAppealView,
  type ModerationShiftView
} from "./moderation-operations.js";
export { type ModerationReadiness } from "./moderation-operations-rules.js";

export class BetaOperationsService extends ControlledBetaService {
  private readonly moderationOperations = new ModerationOperationsService();
  private readonly reports = new ModerationService();

  preparePlayerAccess(userId: string) {
    return this.moderationOperations.preparePlayerAccess(userId);
  }

  assignReport(input: Parameters<ModerationOperationsService["assignReport"]>[0]) {
    return this.moderationOperations.assignReport(input);
  }

  acknowledgeReport(
    input: Parameters<ModerationOperationsService["acknowledgeReport"]>[0]
  ) {
    return this.moderationOperations.acknowledgeReport(input);
  }

  applyModerationAction(
    input: Parameters<ModerationOperationsService["applyAction"]>[0]
  ) {
    return this.moderationOperations.applyAction(input);
  }

  submitAppeal(
    input: Parameters<ModerationOperationsService["submitAppeal"]>[0]
  ) {
    return this.moderationOperations.submitAppeal(input);
  }

  reviewAppeal(
    input: Parameters<ModerationOperationsService["reviewAppeal"]>[0]
  ) {
    return this.moderationOperations.reviewAppeal(input);
  }

  scheduleModerationShift(
    input: Parameters<ModerationOperationsService["scheduleShift"]>[0]
  ) {
    return this.moderationOperations.scheduleShift(input);
  }

  moderationReadiness() {
    return this.moderationOperations.readiness();
  }

  controlledBetaReadiness() {
    return this.readiness();
  }

  async moderationState() {
    const [operations, reports] = await Promise.all([
      this.moderationOperations.state(),
      this.reports.reports()
    ]);
    return { ...operations, reports };
  }
}
