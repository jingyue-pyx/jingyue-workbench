import {
  inspectProject,
  parsePatch,
  parsePlan,
  resolvePlanAnswers,
  RunError,
  PlanValidationError,
  ExactEditError,
  safeDiagnostic,
  type ManagedPhase,
  type ManagedModelInput,
  type RunPhase,
  type RunState,
  type SourceFiles,
  type TaskPlan,
} from './protocol';
import { validatePlanAdjustment, type PlanReviewDecision } from './plan-review';
import { STYLED_REACT_VITE_TEMPLATE, DEMO_DATA_FILES, APP_AUTH_FILES } from './template';
import { validateImports } from './dependencies';
import { validateStyles } from './styles';
import { assertSameSources, sourceRevision, sourceSnapshot } from './source-revision';
import { validateCandidate } from './preflight';
import { enforceTaskCapabilities, validateAppAuthIntegration } from './capabilities';
import { failureCode } from './failure-code';
import type { StopCause } from './stop-cause';
import { validateNewModuleIntegration } from './module-integration';
import type { CandidateResume } from './candidate-recovery';
import { MANAGED_MAX_REPAIRS } from './request-policy';

export interface RunAdapter {
  appAuthEnabled?: boolean;
  capture(): SourceFiles;
  revision(): number;
  prepare?(signal: AbortSignal): Promise<void>;
  checkpoint(files: SourceFiles): Promise<void>;
  retainCandidate?(files: SourceFiles, context: { task: string; base: SourceFiles; plan: TaskPlan }): Promise<void>;
  compileCandidate?(
    files: SourceFiles,
    signal: AbortSignal,
    stage: (phase: RunPhase, detail: string) => void,
  ): Promise<void>;
  review?(plan: TaskPlan, signal: AbortSignal): Promise<PlanReviewDecision>;
  model(phase: ManagedPhase, payload: ManagedModelInput, signal: AbortSignal): Promise<string>;
  apply(files: SourceFiles, signal: AbortSignal): Promise<void>;
  verify(files: SourceFiles, signal: AbortSignal, stage: (phase: RunPhase, detail: string) => void): Promise<string>;
  stop(): void;
  diagnostic?(state: RunState): void;
  record(state: RunState): Promise<void>;
}

export class ManagedRunController {
  state: RunState = {
    id: '',
    phase: 'idle',
    detail: '',
    attempt: 0,
    maxRepairs: MANAGED_MAX_REPAIRS,
    events: [],
    errors: [],
    changed: [],
    startedAt: 0,
  };
  #abort?: AbortController;
  #liveRuntimeChanged = false;
  constructor(
    private _adapter: RunAdapter,
    private _publish: (state: RunState) => void,
    private _options: { maxRepairs: number; deadlineMs: number; candidateMs?: number; finalizationMs?: number } = {
      maxRepairs: MANAGED_MAX_REPAIRS,
      deadlineMs: 8 * 60 * 1000,
    },
  ) {}

  private _update(phase: RunPhase, detail: string) {
    this.state = {
      ...this.state,
      phase,
      detail: safeDiagnostic(detail),
      events: [...this.state.events, { phase, detail: safeDiagnostic(detail), at: Date.now() }].slice(-40),
    };
    this._publish(this.state);
  }

  cancel(reason = '任务已停止，已写入的草稿保留。', cause: StopCause = 'user_stop') {
    if (!this.#abort || this.#abort.signal.aborted) {
      return;
    }

    this.state = { ...this.state, stopCause: cause };
    this.#abort.abort(new RunError(reason));

    if (this.#liveRuntimeChanged) {
      this._adapter.stop();
    }
  }

  async run(task: string, options: { reviewPlan?: boolean; resumeCandidate?: CandidateResume } = {}) {
    if (this.#abort) {
      throw new RunError('上一个任务仍在运行，请先停止。');
    }

    const abort = new AbortController();
    this.#abort = abort;

    const signal = abort.signal;
    this.#liveRuntimeChanged = false;

    let timer = setTimeout(
      () => this.cancel('达到任务时间上限，草稿保留；可拆分需求后继续。', 'task_timeout'),
      this._options.deadlineMs,
    );
    this.state = {
      id: crypto.randomUUID(),
      phase: 'planning',
      detail: '',
      attempt: 0,
      maxRepairs: this._options.maxRepairs,
      events: [],
      errors: [],
      changed: [],
      startedAt: Date.now(),
    };

    const revision = this._adapter.revision();
    let runtimeChanged = false;
    const guard = () => {
      signal.throwIfAborted();

      if (this._adapter.revision() !== revision) {
        throw new RunError('检测到手动修改，自动任务已停止，避免覆盖你的内容。');
      }
    };

    try {
      /*
       * Runtime availability is independent of the user's request. Do not spend
       * model quota or ask for repeated approvals when the sandbox cannot boot.
       */
      this._update('planning', '检查浏览器运行环境，尚未开始规划或写入源码');
      await this._adapter.prepare?.(signal);
      guard();
      this._update('planning', '正在规划任务与验收步骤');

      const before = sourceSnapshot(this._adapter.capture());
      const resume =
        options.resumeCandidate?.baseRevision === (await sourceRevision(before)) ? options.resumeCandidate : undefined;
      const requestPlan = async (prior?: TaskPlan): Promise<TaskPlan> => {
        let errors: string[] = [];

        /*
         * Each attempt uses the ordinary gateway-counted request. Correct only
         * invalid plan output, once; never retry auth, quota or network errors.
         */
        for (let correction = 0; correction <= 1; correction++) {
          guard();
          assertSameSources(before, this._adapter.capture());

          try {
            const raw = await this._adapter.model(
              'plan',
              { task, plan: prior, files: before, errors, runId: this.state.id, attempt: 0 },
              signal,
            );
            guard();
            assertSameSources(before, this._adapter.capture());

            return enforceTaskCapabilities(
              task,
              parsePlan(raw, { finalizing: !!prior?.decisions?.length }),
              this._adapter.appAuthEnabled,
            );
          } catch (error) {
            guard();
            assertSameSources(before, this._adapter.capture());

            if (!(error instanceof PlanValidationError)) {
              throw error;
            }

            if (correction === 1) {
              throw new PlanValidationError(error.issues, correction);
            }

            errors = error.issues;
            this._update('planning', '方案格式校验未通过，正在自动纠正 1/1；尚未改动文件。');
          }
        }
        throw new RunError('方案校验未完成，尚未改动文件。');
      };
      let plan = resume
        ? enforceTaskCapabilities(task, resume.plan, this._adapter.appAuthEnabled)
        : await requestPlan();
      guard();
      assertSameSources(before, this._adapter.capture());
      this.state = { ...this.state, plan };

      const requireSupportedPlan = () => {
        if (!plan.supported && !plan.questions.length) {
          throw new RunError(
            `当前能力不支持：${plan.reason || '此任务超出当前浏览器前端运行范围。'}`,
            false,
            'capability',
          );
        }
      };
      requireSupportedPlan();

      let reviewDuration = 0;

      /*
       * Compilation/network installation time is not model-generation time.
       * All candidate attempts share ONE finite runtime allowance; retries do
       * not reset it. The model retains its original call/token/time budget.
       */
      let candidateDuration = 0;
      const modelRemaining = () =>
        Math.max(
          1,
          this._options.deadlineMs - (Date.now() - this.state.startedAt - reviewDuration - candidateDuration),
        );
      const compileCandidate = async (files: SourceFiles) => {
        if (!this._adapter.compileCandidate) {
          return;
        }

        const remaining = (this._options.candidateMs ?? 6 * 60 * 1000) - candidateDuration;

        if (remaining <= 0) {
          this.cancel('候选安装与编译已达到运行检查时间上限，候选草稿保留。', 'task_timeout');
          guard();
        }

        clearTimeout(timer);

        const started = Date.now();
        timer = setTimeout(
          () => this.cancel('候选安装与编译已达到运行检查时间上限，候选草稿保留。', 'task_timeout'),
          remaining,
        );

        try {
          await this._adapter.compileCandidate(files, signal, (phase, detail) => {
            guard();
            this._update(phase, detail);
          });
        } finally {
          candidateDuration += Date.now() - started;
          clearTimeout(timer);

          if (!signal.aborted) {
            timer = setTimeout(
              () => this.cancel('达到生成与修复时间上限，草稿保留；可继续修复。', 'task_timeout'),
              modelRemaining(),
            );
          }
        }
      };
      const review = async () => {
        /*
         * Human review is not model execution time. No file is written before
         * approval, and cancelling/reloading must not approve a pending plan.
         */
        const remaining = Math.max(1, this._options.deadlineMs - (Date.now() - this.state.startedAt - reviewDuration));
        clearTimeout(timer);

        const started = Date.now();
        this._update(
          'reviewing',
          plan.questions.length
            ? '请点选方案偏好；选择后更新方案，确认后才生成文件。'
            : '技术方案已准备好；确认后才会生成文件和运行检查。',
        );

        const result = await this._adapter.review!(plan, signal);
        reviewDuration += Date.now() - started;
        guard();
        timer = setTimeout(
          () => this.cancel('达到任务时间上限，草稿保留；可拆分需求后继续。', 'task_timeout'),
          remaining,
        );

        return result;
      };

      /*
       * Direct implementation requests keep internal planning and all checks,
       * but do not force another approval click. Design requests and genuinely
       * unresolved scope choices still require an explicit decision.
       */
      if (!resume && this._adapter.review && (options.reviewPlan !== false || plan.questions.length > 0)) {
        /*
         * Adjusting is a human-directed plan revision, not a cancelled coding
         * task. Each changed plan needs a fresh approval before any file write.
         */
        for (;;) {
          requireSupportedPlan();

          const decision = await review();

          if (decision.kind === 'confirm' && !plan.questions.length) {
            break;
          }

          const decisions =
            decision.kind === 'adjust'
              ? [
                  ...(plan.decisions || []),
                  { question: '用户调整要求', answer: validatePlanAdjustment(decision.feedback) },
                ]
              : [...(plan.decisions || []), ...resolvePlanAnswers(plan, decision.answers || {})];
          this._update('planning', '正在按你的要求更新方案，尚未改动文件。');

          try {
            const refined = await requestPlan({ ...plan, questions: [], decisions });
            guard();
            plan = { ...refined, decisions };
            this.state = { ...this.state, plan, reviewError: undefined };
          } catch {
            guard();

            /*
             * After bounded correction, retain the prior plan for another user
             * decision. Cancellation/manual edits still propagate via guard.
             */
            this.state = {
              ...this.state,
              reviewError: '方案更新未成功，原方案和源码保留。可以重新调整，或确认原方案。',
            };
          }
        }
      } else if (plan.questions.length) {
        throw new RunError('请先完成方案问题，尚未修改文件。');
      }

      if (!plan.supported) {
        throw new RunError(
          `当前能力不支持：${plan.reason || '此任务超出当前浏览器前端运行范围。'}`,
          false,
          'capability',
        );
      }

      await this._adapter.checkpoint(before);
      guard();
      assertSameSources(before, this._adapter.capture());

      let pending: SourceFiles | undefined;
      let pendingBase: SourceFiles | undefined;

      if (!before['package.json'] && Object.keys(before).length === 0) {
        /*
         * Seed the model's candidate, not the live project. Rejected output
         * must not stop an existing preview or leave a half-created template.
         */
        pending = sourceSnapshot(STYLED_REACT_VITE_TEMPLATE);
        pendingBase = before;
      } else {
        try {
          inspectProject(before); // Never replace an existing unsupported project with a template.
          validateStyles(before); // Give generation all known style gaps before its first attempt.
        } catch (error) {
          if (!(error instanceof RunError) || !error.repairable) {
            throw error;
          }

          this.state = { ...this.state, errors: [safeDiagnostic(error.message)] };
        }
      }

      let lastFailure = '';
      let unresolvedError: RunError | undefined;
      let finalizationGranted = false;
      let canAcceptNoChange = !pending && !this.state.errors.length;
      const fullFilePaths = new Set<string>();

      for (let attempt = 0; attempt <= this._options.maxRepairs; attempt++) {
        guard();
        this.state = { ...this.state, attempt };
        this._update(
          attempt ? 'repairing' : 'generating',
          attempt ? `自动修复 ${attempt}/${this._options.maxRepairs}` : '按计划生成文件改动',
        );

        try {
          const live = sourceSnapshot(this._adapter.capture());

          if (pending && pendingBase) {
            assertSameSources(pendingBase, live);
          }

          const files = sourceSnapshot(pending || live);
          const inputRevision = await sourceRevision(files);
          guard();
          assertSameSources(live, this._adapter.capture());

          const result =
            resume && attempt === 0
              ? JSON.stringify({
                  status: 'changed',
                  summary: '恢复上次完整候选，先复检，不重新生成',

                  /*
                   * Checkpoints are full snapshots, including npm's lockfile.
                   * Replay only changes through the model-write path validator;
                   * unchanged protected files stay in the trusted live base.
                   */
                  files: Object.entries(resume.files)
                    .filter(([path, content]) => files[path] !== content)
                    .map(([path, content]) => ({ path, content })),
                })
              : await this._adapter.model(
                  attempt ? 'repair' : 'generate',
                  {
                    task,
                    plan,
                    files,

                    /*
                     * Older failures are audit history, not necessarily unresolved.
                     * A recheck gives a complete diagnostic for the current snapshot.
                     */
                    errors: this.state.errors.slice(-1),
                    fullFilePaths: [...fullFilePaths],
                    sourceRevision: inputRevision,
                    runId: this.state.id,
                    attempt,
                  },
                  signal,
                );
          guard();
          assertSameSources(live, this._adapter.capture());

          const patch = parsePatch(result, files, [...fullFilePaths]);
          const changed = patch.files.filter((file) => files[file.path] !== file.content);

          if (!changed.length) {
            /*
             * A complete, valid no-op is not malformed/truncated output. Do not
             * stop the existing preview or spend repair quota inventing edits.
             * It also cannot clear an outstanding error or complete a new app.
             */
            if (patch.status === 'unchanged' && canAcceptNoChange && !runtimeChanged && Object.keys(before).length) {
              inspectProject(files);
              validateImports(files);
              validateStyles(files);
              validateAppAuthIntegration(task, files, !!this._adapter.appAuthEnabled);
              this._update('unchanged', patch.summary);

              return this.state;
            }

            throw new RunError('模型未提供实际改动，当前任务或待修复问题仍未完成。', true, 'no-change');
          }

          const candidate = {
            ...files,
            ...(!files['src/lib/jingyue-data.ts'] ? DEMO_DATA_FILES : {}),
            ...Object.fromEntries(changed.map((file) => [file.path, file.content])),
            ...(this._adapter.appAuthEnabled ? APP_AUTH_FILES : {}),
          };

          /*
           * Retain a rejected candidate only as repair context. The next model
           * sees the exact failed candidate, while the live project stays intact.
           */
          pending = sourceSnapshot(candidate);
          pendingBase = live;
          this.state = { ...this.state, candidatePending: true };
          await this._adapter.retainCandidate?.(pending, { task, base: before, plan });
          guard();
          assertSameSources(live, this._adapter.capture());
          validateCandidate(candidate);

          if (!Object.keys(before).length) {
            validateNewModuleIntegration(candidate);
          }

          validateAppAuthIntegration(task, candidate, !!this._adapter.appAuthEnabled);
          await compileCandidate(candidate);
          guard();
          assertSameSources(live, this._adapter.capture());

          /*
           * Candidate compilation is intentionally isolated from the live
           * preview. Do not kill a validated candidate during the subsequent
           * live install/build just because model generation used most of the
           * task clock. Grant this bounded reserve ONCE, only after the real
           * candidate compiler passed. Model call/token/repair limits do not
           * change, and each install/compiler/preview still has its own timeout.
           */
          if (this._adapter.compileCandidate && !finalizationGranted) {
            finalizationGranted = true;

            const remaining = modelRemaining();
            clearTimeout(timer);
            timer = setTimeout(
              () => this.cancel('预览收尾达到时间上限，已校验源码保留；可以继续检查预览。', 'task_timeout'),
              Math.max(remaining, this._options.finalizationMs ?? 4 * 60 * 1000),
            );
          }

          const writes = Object.fromEntries(
            Object.entries(candidate).filter(([path, content]) => live[path] !== content),
          );
          assertSameSources(live, this._adapter.capture());
          this._update('applying', patch.summary);
          runtimeChanged = true;
          this.#liveRuntimeChanged = true;
          this.state = { ...this.state, candidatePending: false };
          await this._adapter.apply(writes, signal);
          guard();
          pending = undefined;
          pendingBase = undefined;
          this.state = {
            ...this.state,
            candidatePending: false,
            changed: [...new Set([...this.state.changed, ...Object.keys(writes)])],
          };

          validateImports(candidate);
          validateStyles(candidate);

          const url = await this._adapter.verify(this._adapter.capture(), signal, (phase, detail) => {
            guard();
            this._update(phase, detail);
          });
          guard();
          this.state = { ...this.state, previewUrl: url };
          this._update('succeeded', '编译通过，预览初始挂载检查通过；业务功能请继续测试。');

          return this.state;
        } catch (error) {
          guard();

          /*
           * A repair no-op is not a new source failure. Keep the actual failed
           * check authoritative instead of replacing it with "no changes".
           */
          const ineffectiveRepair = error instanceof RunError && error.category === 'no-change' && unresolvedError;

          if (ineffectiveRepair) {
            /*
             * Correct an ineffective answer within the remaining repair budget;
             * do not stop early or reset the budget and do not erase the cause.
             */
            error = new RunError(
              '自动修复未提供有效改动，原检查错误仍未解决。请修改诊断对应的实际调用与类型契约，不可再次返回 unchanged：\n' +
                safeDiagnostic(unresolvedError!.message),
              true,
              unresolvedError!.category,
            );
          }

          if (
            !ineffectiveRepair &&
            error instanceof RunError &&
            ['compile', 'syntax', 'dependency', 'style'].includes(error.category)
          ) {
            unresolvedError = error;
          }

          if (error instanceof ExactEditError) {
            fullFilePaths.add(error.filePath);
          }

          if (!(error instanceof RunError) || !['format', 'model-output', 'no-change'].includes(error.category)) {
            canAcceptNoChange = false;
          }

          /*
           * A missing transport handshake is not proof the running app is bad.
           * Keep its existing preview available; never mark it verified.
           */
          if (runtimeChanged && (!(error instanceof RunError) || error.category !== 'preview-network')) {
            this._adapter.stop();
          }

          const diagnostic = safeDiagnostic(error instanceof Error ? error.message : String(error));
          this.state = { ...this.state, errors: [...this.state.errors, diagnostic].slice(-3) };

          // Diagnostic reporting is best-effort; it cannot break execution.
          try {
            this._adapter.diagnostic?.({
              ...this.state,
              phase: 'failed',
              detail: diagnostic,
              failureCode: failureCode(error),
            });
          } catch {
            /* Keep the original failure. */
          }

          if (!(error instanceof RunError) || !error.repairable || attempt >= this._options.maxRepairs) {
            throw error;
          }

          const failure = `${diagnostic}\n${await sourceRevision(pending || this._adapter.capture())}`;
          guard();

          if (failure === lastFailure) {
            throw new RunError('相同错误重复出现且未改善，已保留日志和草稿。\n' + diagnostic);
          }

          lastFailure = failure;
        }
      }
      throw new RunError('自动修复未通过。');
    } catch (error) {
      if (runtimeChanged && (signal.aborted || !(error instanceof RunError) || error.category !== 'preview-network')) {
        this._adapter.stop();
      }

      const message = signal.aborted
        ? signal.reason?.message || '任务已停止。'
        : error instanceof Error
          ? error.message
          : String(error);
      const timedOut = signal.aborted && this.state.stopCause === 'task_timeout';
      this.state = {
        ...this.state,
        failureCode: timedOut ? 'task_timeout' : signal.aborted ? undefined : failureCode(error),
      };
      this._update(signal.aborted && !timedOut ? 'cancelled' : 'failed', message);

      return this.state;
    } finally {
      clearTimeout(timer);
      this.#abort = undefined;

      // Persistence failure must not turn a successful build into a failed build.
      try {
        await this._adapter.record(this.state);
      } catch {
        /* Save UI independently reports local/cloud status. */
      }
    }
  }
}
