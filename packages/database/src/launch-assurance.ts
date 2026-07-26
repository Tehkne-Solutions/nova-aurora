import { LaunchOperationsService } from "./launch-operations-service.js";
import { ModerationService } from "./moderation-service.js";
import { TrustPolicyService } from "./trust-policy.js";

export {
  type GuardianRequestView,
  type TrustPolicyUserState
} from "./trust-policy.js";
export { type TrustReportView } from "./moderation-service.js";
export {
  type LaunchRehearsalView,
  type ResponseExerciseView,
  type ServiceComponentView
} from "./launch-operations-service.js";

export class LaunchAssuranceService extends TrustPolicyService {
  private readonly moderation = new ModerationService();
  private readonly operations = new LaunchOperationsService();

  submitReport(input: Parameters<ModerationService["submitReport"]>[0]) {
    return this.moderation.submitReport(input);
  }
  updateReport(input: Parameters<ModerationService["updateReport"]>[0]) {
    return this.moderation.updateReport(input);
  }
  createExercise(input: Parameters<LaunchOperationsService["createExercise"]>[0]) {
    return this.operations.createExercise(input);
  }
  completeExercise(input: Parameters<LaunchOperationsService["completeExercise"]>[0]) {
    return this.operations.completeExercise(input);
  }
  createRehearsal(input: Parameters<LaunchOperationsService["createRehearsal"]>[0]) {
    return this.operations.createRehearsal(input);
  }
  completeRehearsal(input: Parameters<LaunchOperationsService["completeRehearsal"]>[0]) {
    return this.operations.completeRehearsal(input);
  }
  updateComponent(input: Parameters<LaunchOperationsService["updateComponent"]>[0]) {
    return this.operations.updateComponent(input);
  }
  operationsReadiness() {
    return this.operations.readiness();
  }
  publicStatus() {
    return this.operations.publicStatus();
  }
  async operationsState() {
    const [state, reports] = await Promise.all([
      this.operations.state(),
      this.moderation.reports()
    ]);
    return { ...state, reports };
  }
}
