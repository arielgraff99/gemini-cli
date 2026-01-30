/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExitPlanModeTool } from './exit-plan-mode.js';
import { createMockMessageBus } from '../test-utils/mock-message-bus.js';
import path from 'node:path';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { ToolConfirmationOutcome } from './tools.js';
import { ApprovalMode } from '../policy/types.js';

describe('ExitPlanModeTool', () => {
  let tool: ExitPlanModeTool;
  let mockMessageBus: ReturnType<typeof createMockMessageBus>;
  let mockConfig: Partial<Config>;

  const mockTargetDir = path.resolve('/mock/dir');
  const mockPlansDir = path.resolve('/mock/dir/plans');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mockMessageBus = createMockMessageBus();
    vi.mocked(mockMessageBus.publish).mockResolvedValue(undefined);
    mockConfig = {
      getTargetDir: vi.fn().mockReturnValue(mockTargetDir),
      setApprovalMode: vi.fn(),
      storage: {
        getProjectTempPlansDir: vi.fn().mockReturnValue(mockPlansDir),
      } as unknown as Config['storage'],
    };
    tool = new ExitPlanModeTool(
      mockConfig as Config,
      mockMessageBus as unknown as MessageBus,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('shouldConfirmExecute', () => {
    it('should return plan approval confirmation details', async () => {
      const planPath = 'plans/test-plan.md';
      const invocation = tool.build({ plan_path: planPath });

      const result = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      expect(result).not.toBe(false);
      if (result === false) return;

      expect(result.type).toBe('plan_approval');
      expect(result.title).toBe('Plan Approval');
      if (result.type === 'plan_approval') {
        expect(result.planPath).toBe(
          path.resolve(mockPlansDir, 'test-plan.md'),
        );
      }
      expect(typeof result.onConfirm).toBe('function');
    });

    it('should return false if plan path is invalid', async () => {
      // Create a tool with a plan path that resolves outside the plans directory
      const invocation = tool.build({ plan_path: 'plans/valid.md' });

      // Override getProjectTempPlansDir to make the validation fail
      vi.mocked(mockConfig.storage!.getProjectTempPlansDir).mockReturnValue(
        '/completely/different/path',
      );

      const result = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    it('should return approval message when plan is approved', async () => {
      const planPath = 'plans/test-plan.md';
      const invocation = tool.build({ plan_path: planPath });

      // Simulate the confirmation flow
      const confirmDetails = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmDetails).not.toBe(false);
      if (confirmDetails === false) return;

      // Call onConfirm with approval (using default approval mode)
      await confirmDetails.onConfirm(ToolConfirmationOutcome.ProceedOnce, {
        type: 'plan_approval',
        approved: true,
        approvalMode: ApprovalMode.DEFAULT,
      });

      const result = await invocation.execute(new AbortController().signal);
      const expectedPath = path.resolve(mockPlansDir, 'test-plan.md');

      expect(result).toEqual({
        llmContent: `Plan approved. Switching to Default mode (edits will require confirmation).

The approved implementation plan is stored at: ${expectedPath}
Read and follow the plan strictly during implementation.`,
        returnDisplay: `Plan approved: ${expectedPath}`,
      });
    });

    it('should return feedback message when plan is rejected', async () => {
      const planPath = 'plans/test-plan.md';
      const invocation = tool.build({ plan_path: planPath });

      // Simulate the confirmation flow
      const confirmDetails = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmDetails).not.toBe(false);
      if (confirmDetails === false) return;

      // Call onConfirm with rejection and feedback
      await confirmDetails.onConfirm(ToolConfirmationOutcome.ProceedOnce, {
        type: 'plan_approval',
        approved: false,
        feedback: 'Please add more details.',
      });

      const result = await invocation.execute(new AbortController().signal);
      const expectedPath = path.resolve(mockPlansDir, 'test-plan.md');

      expect(result).toEqual({
        llmContent: `Plan rejected. Feedback: Please add more details.

The plan is stored at: ${expectedPath}
Revise the plan based on the feedback.`,
        returnDisplay: 'Feedback: Please add more details.',
      });
    });

    it('should return cancellation message when cancelled', async () => {
      const planPath = 'plans/test-plan.md';
      const invocation = tool.build({ plan_path: planPath });

      // Simulate the confirmation flow
      const confirmDetails = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(confirmDetails).not.toBe(false);
      if (confirmDetails === false) return;

      // Call onConfirm with cancellation
      await confirmDetails.onConfirm(ToolConfirmationOutcome.Cancel);

      const result = await invocation.execute(new AbortController().signal);

      expect(result).toEqual({
        llmContent:
          'User cancelled the plan approval dialog. The plan was not approved and you are still in Plan Mode.',
        returnDisplay: 'Cancelled',
      });
    });

    it('should return error for invalid plan path', async () => {
      const planPath = 'plans/test-plan.md';
      const invocation = tool.build({ plan_path: planPath });

      // Override getProjectTempPlansDir to make the validation fail
      vi.mocked(mockConfig.storage!.getProjectTempPlansDir).mockReturnValue(
        '/completely/different/path',
      );

      const result = await invocation.execute(new AbortController().signal);

      expect(result).toEqual({
        llmContent:
          'Error: Plan path is outside the designated plans directory.',
        returnDisplay:
          'Error: Plan path is outside the designated plans directory.',
      });
    });
  });

  it('should throw error during build if plan path is outside plans directory', () => {
    expect(() => tool.build({ plan_path: '../../../etc/passwd' })).toThrow(
      /Access denied/,
    );
  });

  describe('validateToolParams', () => {
    it('should reject empty plan_path', () => {
      const result = tool.validateToolParams({ plan_path: '' });
      expect(result).toBe('plan_path is required.');
    });

    it('should reject whitespace-only plan_path', () => {
      const result = tool.validateToolParams({ plan_path: '   ' });
      expect(result).toBe('plan_path is required.');
    });

    it('should reject path outside plans directory', () => {
      const result = tool.validateToolParams({
        plan_path: '../../../etc/passwd',
      });
      expect(result).toContain('Access denied');
    });

    it('should accept valid path within plans directory', () => {
      const result = tool.validateToolParams({
        plan_path: 'plans/valid-plan.md',
      });
      expect(result).toBeNull();
    });
  });
});
