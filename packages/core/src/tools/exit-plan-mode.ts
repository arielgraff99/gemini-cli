/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolResult,
  Kind,
  type ToolPlanApprovalConfirmationDetails,
  type ToolConfirmationPayload,
  type PlanApprovalConfirmationPayload,
  ToolConfirmationOutcome,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import path from 'node:path';
import type { Config } from '../config/config.js';
import { EXIT_PLAN_MODE_TOOL_NAME } from './tool-names.js';
import { isWithinRoot } from '../utils/fileUtils.js';
import { ApprovalMode } from '../policy/types.js';

/**
 * Returns a human-readable description for an approval mode.
 */
function getApprovalModeDescription(mode: ApprovalMode): string {
  switch (mode) {
    case ApprovalMode.AUTO_EDIT:
      return 'Auto-Edit mode (edits will be applied automatically)';
    case ApprovalMode.DEFAULT:
    default:
      return 'Default mode (edits will require confirmation)';
  }
}

export interface ExitPlanModeParams {
  plan_path: string;
}

export class ExitPlanModeTool extends BaseDeclarativeTool<
  ExitPlanModeParams,
  ToolResult
> {
  constructor(
    private config: Config,
    messageBus: MessageBus,
  ) {
    super(
      EXIT_PLAN_MODE_TOOL_NAME,
      'Exit Plan Mode',
      'Signals that the planning phase is complete and requests user approval to start implementation.',
      Kind.Plan,
      {
        type: 'object',
        required: ['plan_path'],
        properties: {
          plan_path: {
            type: 'string',
            description:
              'The file path to the finalized plan (e.g., "plans/feature-x.md").',
          },
        },
      },
      messageBus,
    );
  }

  protected override validateToolParamValues(
    params: ExitPlanModeParams,
  ): string | null {
    if (!params.plan_path || params.plan_path.trim() === '') {
      return 'plan_path is required.';
    }

    const resolvedPath = path.resolve(
      this.config.getTargetDir(),
      params.plan_path,
    );

    const plansDir = this.config.storage.getProjectTempPlansDir();
    if (!isWithinRoot(resolvedPath, plansDir)) {
      return `Access denied: plan path must be within the designated plans directory (${plansDir}).`;
    }

    return null;
  }

  protected createInvocation(
    params: ExitPlanModeParams,
    messageBus: MessageBus,
    toolName: string,
    toolDisplayName: string,
  ): ExitPlanModeInvocation {
    return new ExitPlanModeInvocation(
      params,
      messageBus,
      toolName,
      toolDisplayName,
      this.config,
    );
  }
}

export class ExitPlanModeInvocation extends BaseToolInvocation<
  ExitPlanModeParams,
  ToolResult
> {
  private confirmationOutcome: ToolConfirmationOutcome | null = null;
  private approvalPayload: PlanApprovalConfirmationPayload | null = null;

  constructor(
    params: ExitPlanModeParams,
    messageBus: MessageBus,
    toolName: string,
    toolDisplayName: string,
    private config: Config,
  ) {
    super(params, messageBus, toolName, toolDisplayName);
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolPlanApprovalConfirmationDetails | false> {
    const resolvedPlanPath = this.getValidatedPlanPath();
    if (!resolvedPlanPath) {
      return false;
    }

    return {
      type: 'plan_approval',
      title: 'Plan Approval',
      planPath: resolvedPlanPath,
      onConfirm: async (
        outcome: ToolConfirmationOutcome,
        payload?: ToolConfirmationPayload,
      ) => {
        this.confirmationOutcome = outcome;
        if (payload?.type === 'plan_approval') {
          this.approvalPayload = payload;
        }
      },
    };
  }

  getDescription(): string {
    return `Requesting plan approval for: ${this.params.plan_path}`;
  }

  /**
   * Returns the resolved plan path if valid, or null if outside the plans directory.
   */
  private getValidatedPlanPath(): string | null {
    const plansDir = this.config.storage.getProjectTempPlansDir();
    const resolvedPath = path.resolve(
      this.config.getTargetDir(),
      this.params.plan_path,
    );
    return isWithinRoot(resolvedPath, plansDir) ? resolvedPath : null;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const resolvedPlanPath = this.getValidatedPlanPath();
    if (!resolvedPlanPath) {
      return {
        llmContent:
          'Error: Plan path is outside the designated plans directory.',
        returnDisplay:
          'Error: Plan path is outside the designated plans directory.',
      };
    }

    if (this.confirmationOutcome === ToolConfirmationOutcome.Cancel) {
      return {
        llmContent:
          'User cancelled the plan approval dialog. The plan was not approved and you are still in Plan Mode.',
        returnDisplay: 'Cancelled',
      };
    }

    const payload = this.approvalPayload;
    if (payload?.approved) {
      // Set the approval mode based on user's choice
      const newMode = payload.approvalMode ?? ApprovalMode.DEFAULT;
      this.config.setApprovalMode(newMode);

      const description = getApprovalModeDescription(newMode);

      return {
        llmContent: `Plan approved. Switching to ${description}.

The approved implementation plan is stored at: ${resolvedPlanPath}
Read and follow the plan strictly during implementation.`,
        returnDisplay: `Plan approved: ${resolvedPlanPath}`,
      };
    } else {
      const feedback = payload?.feedback || 'None';
      return {
        llmContent: `Plan rejected. Feedback: ${feedback}

The plan is stored at: ${resolvedPlanPath}
Revise the plan based on the feedback.`,
        returnDisplay: `Feedback: ${feedback}`,
      };
    }
  }
}
